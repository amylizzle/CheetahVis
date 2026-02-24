import asyncio
import json
import logging
import os
import subprocess
import sys
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Callable

import numpy as np
import torch
import trimesh
import websockets
import cheetah
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent / ".env"  

# Load the .env file
load_dotenv(dotenv_path=env_path)

# Set logging level based on environment
debug_mode = os.getenv("DEBUG_MODE", "False").lower() == "true"

# Setup logging with conditional log level
log_level = (
    logging.DEBUG if debug_mode else logging.WARNING
)  # Set to WARNING to suppress info/debug logs
logging.basicConfig(level=log_level, format="%(asctime)s [%(levelname)s] %(message)s")

logger = logging.getLogger(__name__)

logger.info(f"Loaded .env from {env_path}")
logger.info(f"NODE_ENV: {os.getenv('NODE_ENV')}")

# Network defaults
DEFAULT_HTTP_HOST = "0.0.0.0"
DEFAULT_HTTP_PORT = 8080
DEFAULT_WS_PORT = 8081

# Sim defaults
DEFAULT_NUM_PARTICLES = 1000


class CheetahVis():
    """
    A Gym wrapper that encapsulates the beam simulation logic and manages the
    initialization of the JavaScript web application for 3D visualization.

    Args:
        lattice_path (Path | str): the path to a JSON formatted Cheetah lattice 
        beam_factory (Callable[[int], cheetah.ParticleBeam]): a function which takes an int num_particles and returns a cheetah.ParticleBeam with that many particles
        num_particles (int): the number of particles to simulate and display. Default 1000.
        http_host (str): the IP of the adapter to host the ports on. Default 0.0.0.0 (ie, all interfaces)
        http_port (int): the port to host the web server on. Default 8080
        ws_port (int): the port to host the websocket on. Default 8081
    """

    def __init__(
        self,
        lattice_path: Path | str,
        beam_factory: Callable[[int], cheetah.ParticleBeam],
        num_particles: int = DEFAULT_NUM_PARTICLES,
        http_host: str = DEFAULT_HTTP_HOST,
        http_port: int = DEFAULT_HTTP_PORT,        
        ws_port: int = DEFAULT_WS_PORT,
    ):
        # Basic configuration
        self.base_path = Path(__file__).resolve().parent
        self.num_particles = num_particles
        self.beam_factory = beam_factory
        self.data = OrderedDict()
        self.web_process = None

        # Store host and port
        self.ws_host = http_host
        self.ws_port = ws_port
        self.http_host = http_host
        self.http_port = http_port

        # WebSocket management attributes
        self.clients = set()
        self.connected = False
        self.server = None

        self.stop_simulation = False

        # Start the WebSocket server in a separate thread
        self._lock = asyncio.Lock()

        # Initialize state
        self.incoming_particle_beam = None

        # Init cheetah
        self.segment = cheetah.Segment.from_lattice_json(
            lattice_path
        )

        # Ensures the necessary npm dependencies are installed
        self._setup()

    async def start_server(self):
        # Start the JavaScript web application (dev or prod mode)
        
        print(f"Server hosted at http://{self.http_host}:{self.http_port}")
        # Start the websocket and return the coroutine
        return asyncio.gather(self._start_websocket(), self._start_web_application())

    def reset(
        self, *, seed: Optional[int] = None, options: Optional[Dict] = None
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """
        Reset the environment, reset last_action, and run the simulation.

        Args:
            seed (Optional[int]): Seed for random number generation.
            options (Optional[Dict]): Additional reset options.

        Returns:
            Tuple[np.ndarray, Dict[str, Any]]: Initial observation and info.
        """
        # Run simulation
        self._simulate()

        return None, {}

    def _initialize_particle_beam(self) -> None:
        """
        Initialize the incoming particle beam for simulation.

        Raises:
            ValueError: If the incoming particle beam cannot be initialized.
        """
        
        self.incoming_particle_beam = self.beam_factory(self.num_particles)

        if self.incoming_particle_beam is None:
            raise ValueError(
                "Incoming particle beam is None. Check beam initialization."
            )

        # Log the initial beam state for debugging
        logger.info(
            f"Initialized incoming particle beam with {self.num_particles} particles."
        )

    def step(
        self, action: np.ndarray
    ) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        """
        Execute a step in the environment and run the simulation.

        Args:
            action (np.ndarray): Action to take.

        Returns:
            Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]: Observation, reward,
                terminated, truncated, and info.
        """
        # Execute step in the underlying environment
        terminated = False #self._get_terminated()
        reward = 0 #self._get_reward()
        observation = None #self._get_obs()
        info = None #self._get_info()
        truncated = False

        # Run simulation
        self._simulate()

        #info.update({"stop_simulation": self.data["stop_simulation"]})

        return observation, reward, terminated, truncated, info

    async def render(self):
        """
        Render the environment by preparing simulation data and broadcasting it
        via WebSocket.
        This method does not rely on the underlying environment's render method, as all
        visualization logic is handled by this wrapper.

        Note: The simulation data is already updated in step() or reset(),
        so we don't need to call _simulate() again here.
        """
        logger.debug("Broadcasting data to WebSocket clients...")
        results = await self.broadcast(self.data)
        for result in results:
            if isinstance(result, Exception):
                logger.exception("broadcast task failed", exc_info=result)
        logger.debug("Data broadcast completed.")

        # Add delay after broadcasting to allow animation to complete
        # before sending new data
        await asyncio.sleep(1.25)

    def close(self):
        """
        Close the wrapper and terminate the web application process.
        """
        # Terminate the web application process if it exists
        if self.web_process:
            self.web_process.kill()
            self.web_process.wait()
            print("Terminated JavaScript web application process.")
        if self.server:
            self.server.close()  # This will stop the WebSocket server and trigger cleanup
            print("Closed WebSocket server.")

    def _setup(self):
        """
        Automates the setup process by running npm install to install dependencies.
        This should be run once to ensure the JavaScript dependencies are installed.
        """
        try:
            # Path to the node_modules directory
            node_modules_path = os.path.join(self.base_path, "node_modules")

            # Check if package.json exists to confirm we are in the correct directory
            package_json_path = os.path.join(self.base_path, "package.json")
            if not os.path.exists(package_json_path):
                raise FileNotFoundError(
                    f"{package_json_path} not found."
                    f" Make sure you are in the correct project directory."
                )

            # Check if node_modules exists and is not empty
            if os.path.exists(node_modules_path) and os.listdir(node_modules_path):
                logger.info("Dependencies are already installed. Skipping npm install.")
            else:
                logger.info("Running npm install...")
                result = subprocess.run(
                    ["npm", "install"],
                    cwd=self.base_path,  # Run in directory with package.json
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    shell=(
                        True if sys.platform == "win32" else None
                    ),  # Only use shell=True on Windows
                )

                # Log the output for debugging purposes
                if result.returncode == 0:
                    logger.info("npm install completed successfully.")
                else:
                    logger.error(f"npm install failed with error: {result.stderr}")
                    raise RuntimeError(f"npm install failed: {result.stderr}")

        except Exception as e:
            logger.error(f"Error during setup: {e}")
            raise

    def _simulate(self) -> None:
        """
        Calculate the positions of beam segments with dynamic angles.

        This method tracks the particle beam through each element in the segment,
        computing the positions of particles at each step. The beam travels along
        the x-axis, with position variations in the yz-plane. The simulation
        data is stored in self.data for later use in visualization.
        """
        # Reset segments data for this simulation step
        self.data["segments"] = []
        origin = np.array([0, 0, 0, 1])
        pathlength = 0
        input_transform = trimesh.transformations.identity_matrix()
        self._initialize_particle_beam()

        # Track beam through each lattice element
        references = [self.incoming_particle_beam]
        for element in self.segment.elements:
            _, element_output_transform = element.to_mesh()
            # Track beam through this element
            # Use the output beam of the previous segment as the input
            # for the next lattice section
            outgoing_beam = element.track(references[-1])
            references.append(outgoing_beam)

            # Extract particle positions
            x = -outgoing_beam.particles[:, 0]  # Column 0
            px = outgoing_beam.particles[:, 1]
            y = outgoing_beam.particles[:, 2]  # Column 2
            py = outgoing_beam.particles[:, 3]
            z = -outgoing_beam.particles[:, 4]  # Column 4
            w = torch.zeros_like(z)

            # Note: In Cheetah, the coordinates of the particles are defined
            # by a 7-dimensional vector: x = (x, p_x, y, p_y, 𝜏, 1),
            # where 𝜏 = t - t_0 represents the time offset of a particle
            # relative to the reference particle.
            #
            # Since we use z to represent the `longitudinal position` of particles
            # in the beamline (instead of time offset), we flip the sign of 𝜏.
            #
            # This ensures that particles:
            # - `ahead` of the reference particle (bunch head) have `positive` z,
            # - `behind` the reference particle (bunch tail) have `negative` z.
            #
            # This sign convention aligns with spatial representations
            # of beam bunches, where a leading particle has a larger
            # longitudinal position z.
            #
            # Source:
            # https://cheetah-accelerator.readthedocs.io/en/latest/coordinate_system.html

            # Shift beam particles 3D position in reference to segment component
            R = element_output_transform.copy()
            R[:3, 3] = 0

            momenta = torch.stack([px, py], dim=1)
            positions = torch.stack([x, y, z, w], dim=1) 

            correction = (origin @ input_transform.T)
            positions = positions @ R.T + correction

            # Store segment data
            self.data["segments"].append(
                {
                    "segment_name": element.name,
                    "segment_type": element.__class__.__name__,
                    "particle_positions": positions[:,:3].tolist(),
                    "mean_particle_position": positions[:,:3].mean(dim=0).tolist(),
                    "momenta": momenta.tolist(),
                    "element_transform": input_transform.T.flatten().tolist(),
                    "element_position": pathlength,
                    "mesh_position": correction.tolist()
                }
            )
            pathlength += element.length.item()

            input_transform = input_transform @ element_output_transform

    async def _start_web_application(self):
        """
        Start the JavaScript web application (Vite development server)
        in a background thread.
        """

        # Give the server a moment to start
        logger.debug(
            f"JavaScript web application setup initiated on "
            f"http://{self.http_host}:{self.http_port}"
        )     

        try:
            # Determine the mode and load the appropriate .env file
            node_env = os.getenv("NODE_ENV", "production")
            server_env = os.environ.copy()
            server_env['VITE_HTTP_PORT'] = str(self.http_port)
            server_env['VITE_HTTP_HOST'] = self.http_host
            server_env['VITE_APP_WEBSOCKET_PORT'] = str(self.ws_port)

            logger.debug(f"Running in mode: {node_env}")

            if node_env == "development":
                # Development mode: Start Vite dev server
                # Start Vite development server
                cmd = [
                    "npx",
                    "vite",
                    "--host",
                    self.http_host,
                    "--port",
                    str(self.http_port),
                ]
                logger.debug(
                    f"Starting Vite dev server"
                    f" on http://{self.http_host}:{self.http_port}"
                )
            else:
                # Production mode: Start Express server (server.js)
                dist_path = self.base_path / "dist"
                if not dist_path.exists():
                    raise FileNotFoundError(
                        f"Pre-built dist folder not found at {dist_path}. Run `npm run build` first."
                    )
                cmd = ["node", "server.js"]
                logger.debug(
                    f"Starting Express server (server.js)"
                    f" on http://{self.http_host}:{self.http_port}"
                )

            self.web_process = await asyncio.subprocess.create_subprocess_shell(
                cmd=" ".join(cmd),
                cwd=self.base_path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                # Pass environment variables (e.g., PORT from .env)
                env=server_env,
            )

            await self.web_process.wait()

        except Exception as e:
            logger.error(f"Failed to start web application: {e}")
            raise(e)

    async def _start_websocket(self):
        """Run the WebSocket server."""

        self.server = await websockets.serve(
            self._handle_client,
            host=self.ws_host,
            port=self.ws_port,
        )
        logger.debug(f"WebSocket server running on ws://{self.ws_host}:{self.ws_port}")
        await self.server.wait_closed()

    async def _handle_client(
        self, websocket: websockets.WebSocketServerProtocol, path: str = None
    ):
        """Handle incoming WebSocket connections and messages."""
        async with self._lock:
            logger.debug("acquired lock for client add")
            self.connected = True
            self.clients.add(websocket)
        logger.debug("WebSocket connection established.")

        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    logger.debug(f"Received data: {data}")

                    if "controls" in data:
                        # Update the control parameters based on the WebSocket data
                        controls = data.get("controls", {})

                        self.stop_simulation = controls.get("stopSimulation", False)

                        if self.stop_simulation:
                            print("Stop signal recieved, shutting down...")
                            self.close()
                            break

                        #for key in controls
                        #see if it's in the lattice
                        #set the value appropriately

                        control_action = None

                        observation, reward, terminated, truncated, info = self.step(
                            control_action
                        )

                        # Render and broadcast data to clients
                        await self.render()

                        if truncated:  # Stop the simulation if truncated is True
                            print("Truncated flag is True, stopping simulation...")
                            self.close()
                            break
                except json.JSONDecodeError:
                    logger.error("Error: Received invalid JSON data.")
        except asyncio.exceptions.CancelledError:
            logger.debug("WebSocket task was cancelled.")
            raise
        except websockets.ConnectionClosed:
            logger.debug("WebSocket connection closed by client.")
        finally:
            async with self._lock:
                logger.debug("acquired lock for client shutdown")
                self.clients.discard(websocket)
                if not self.clients:
                    self.connected = False
            logger.debug("Client cleanup completed.")

    async def broadcast(self, message: Dict):
        """Safely broadcast a message to all connected clients."""
        if message is None:
            logger.warning("No data to broadcast.")
            return

        tasks = []
        async with self._lock:
            logger.debug("acquired lock for broadcast")
            if not self.clients:
                logger.debug("No clients connected, skipping broadcast.")
                self.connected = False
                return
            tasks = [self.safe_send(client, message) for client in self.clients]
        return await asyncio.gather(*tasks, return_exceptions=True)

    async def safe_send(self, client, message):
        try:
            async with asyncio.timeout(2.5):
                await client.send(json.dumps(message))
        except asyncio.TimeoutError:
            logger.warning("WebSocket send timed out.")
        except websockets.ConnectionClosed:
            logger.debug("WebSocket connection closed during broadcast.")
        except asyncio.CancelledError:
            logger.debug("WebSocket task was cancelled.")
            raise
