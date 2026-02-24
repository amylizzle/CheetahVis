// Import the necessary THREE.js modules
import * as THREE from 'three';

// To allow for the camera to move around the scene
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// To allow for importing the .gltf file
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// For reflective surfaces
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

// For postprocessing effects
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';


class SceneManager {
    constructor(containerId) {
        // WebSocket properties
        this.ws = null;                       // WebSocket connection object, initially set to null
        this.reconnectAttempts = 0;           // Counter for tracking the number of reconnect attempts
        this.max_reconnect_attempts = 5;      // Maximum number of reconnect attempts before giving up
        this.reconnect_delay = 2000;          // Delay in milliseconds between reconnect attempts (2 seconds)
        this.isSceneReady = false;            // Flag to track whether the scene is fully loaded and ready
        this.newDataAvailable = false;        // Flag to track if new data has been received from the WebSocket

        // Particle System Properties
        this.particleCount = 1000;      // The total number of particles to be simulated, matching the Python code
        this.particles = [];            // Array to hold all particle instances for the simulation

        // Segment Properties
        this.totalPathLength = 0;       // Total length of the entire path, calculated from segment distances
        this.totalProgress = 0;         // Overall progress through all segments (from 0 to 1) for the animation

        // Animation Properties
        this.particleSpeed = 1.0;      // Units per frame 
        this.scaleBeamPosition = 0.0;
        this.scaleBeamSpread = 1.0;
        this.currentData = null;       // Store latest WebSocket data
        this.animationRunning = true;  // Start with animation running

        // Scene Initialization
        this.scene = new THREE.Scene();
        this.scene.name = "Scene";

        // Setup core rendering components
        this.camera = this.setupCamera();
        this.renderer = this.setupRenderer(containerId);
        this.controls = this.setupOrbitalControls();
        this.composer = this.setupPostProcessing();

        // Raycasting and Interaction
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Scene Configuration
        this.setupLighting();
        this.createReflectivePlane();
        this.createControlPanel();
        this.loadModels();

        // Event Listeners
        this.setupEventListeners();

        // Particle System Initialization
        this.createParticles();

        // Start Animation Loop
        this.startAnimation();

        // WebSocket Setup (only after everything else is ready)
        this.setupWebSocket();
    }

    // Scene Initialization
    setupCamera() {
        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        // Set how far the camera will start from the 3D model
        camera.position.set(-1.5, 0.75, -1.5); // Initial camera position (x, y, z)

        camera.updateMatrixWorld();  // Apply rotation change

        return camera;
    }

    setupRenderer(containerId) {
        // Instantiate a new renderer and set its size
        const renderer = new THREE.WebGLRenderer({ alpha: false });  //Alpha: true allows for the transparent background
        renderer.setSize(window.innerWidth, window.innerHeight);

        // Add the renderer to the DOM
        document.getElementById(containerId).appendChild(renderer.domElement);
        return renderer;
    }

    setupOrbitalControls() {
        // Add orbit controls to the camera, enabling rotation and zoom functionality using the mouse
        const controls = new OrbitControls(this.camera, this.renderer.domElement);

        controls.target.set(0.0, 0.0, 2.0); // Looking towards the center of the diagnostic screen
        controls.minDistance = 0;    // Minimum zoom distance (closer)
        controls.maxDistance = 40;   // Maximum zoom distance (farther)
        controls.minPolarAngle = 0;       // 0 radians (0 degrees) - Looking straight up (at the sky)
        controls.maxPolarAngle = Math.PI;   // π radians (180 degrees) - Looking straight down (at the ground)

        controls.update();  // Apply the change

        return controls;
    }

    setupLighting() {
        const topLight = new THREE.DirectionalLight(0xffffff, 1);  // (color, intensity)
        topLight.position.set(50, 50, 50); //top-left-ish
        topLight.castShadow = false;
        topLight.name = "TopDirectionalLight";
        this.scene.add(topLight);

        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        ambientLight.name = "AmbientLight";
        this.scene.add(ambientLight);
    }

    setupPostProcessing() {
        const composer = new EffectComposer(this.renderer);
        composer.addPass(new RenderPass(this.scene, this.camera));

        const params = {
            exposure: 1,
            strength: 0.25,
            radius: 1,
            threshold: 0.1
        };
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            params.strength,
            params.radius,
            params.threshold
        );
        composer.addPass(bloomPass);
        return composer;
    }

    setupEventListeners() {
        // Window resize listener, allowing us to resize the window and the camera
        window.addEventListener("resize", () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Handle pagehide to allow back/forward cache (bfcache)
        window.addEventListener("pagehide", () => {
            if (window.myBroadcastChannel) {
                window.myBroadcastChannel.close();
                window.myBroadcastChannel = null;
            }

            if (this.websocket) {
                this.websocket.close();
            }
        });

        // Click event handling
        // const delta = 4;
        // let startX, startY;

        // document.addEventListener("pointerdown", (event) => {
        //     startX = event.pageX;
        //     startY = event.pageY;
        // });

        // document.addEventListener("pointerup", (event) => {
        //     const diffX = Math.abs(event.pageX - startX);
        //     const diffY = Math.abs(event.pageY - startY);

        //     if (diffX < delta && diffY < delta) {
        //         //not a click-drag
        //     }
        // });
    }

    createReflectivePlane() {
        const geometry = new THREE.PlaneGeometry(200, 200);
        const groundMirror = new Reflector(geometry, {
            clipBias: 0.003,
            textureWidth: window.innerWidth * window.devicePixelRatio,
            textureHeight: window.innerHeight * window.devicePixelRatio,
            color: 0x3333333,
        });

        groundMirror.rotateX(-Math.PI / 2);
        groundMirror.position.y = -1.4;
        groundMirror.name = "Reflector";
        this.scene.add(groundMirror);
    }

    // Create control panel UI with sliders and reset button
    createControlPanel() {
        // Create the control panel container
        const panel = document.createElement('div');
        panel.style.position = 'absolute';
        panel.style.top = '20px';
        panel.style.left = '20px';
        panel.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        panel.style.padding = '6px';
        panel.style.borderRadius = '5px';
        panel.style.zIndex = '101';
        panel.style.color = '#fff';
        panel.style.fontFamily = 'Arial, sans-serif';
        panel.style.fontSize = '12px';
        panel.style.width = '200px';

        // Control panel title
        const title = document.createElement('h3');
        title.textContent = 'Control Panel';
        title.style.margin = '0 0 10px 0';
        title.style.fontSize = '14px';
        title.style.textAlign = 'center';
        panel.appendChild(title);

        // Define the controls and their properties
        const controls = [
            { id: 'particleSpeed', type: 'speed', label: 'Particle Speed', min: 0.001, max: 5.0, step: 0.001, scale: 1.0, initial: this.particleSpeed },
            { id: 'scaleBeamSpread', type: 'speed', label: 'Scale beam width', min: 1.0, max: 100.0, step: 1.0, scale: 1.0, initial: this.scaleBeamSpread },
            { id: 'scaleBeamPosition', type: 'speed', label: 'Scale beam position', min: 0.0, max: 100.0, step: 1, scale: 1.0, initial: this.scaleBeamPosition }
        ];

        // Create each slider element
        this.controlSliders = {};
        this.defaultValues = {}; // Store default values for reset
        controls.forEach(control => {
            const container = document.createElement('div');
            container.style.marginBottom = '8px';
            container.style.width = '100%'; // Ensure consistent width within the panel

            const label = document.createElement('label');
            label.textContent = control.label;
            label.htmlFor = control.id;
            label.style.display = 'block';
            label.style.marginBottom = '4px';

            const input = document.createElement('input');
            input.type = 'range';
            input.id = control.id;
            input.min = control.min;
            input.max = control.max;
            input.step = control.step;
            input.value = control.initial;
            input.style.width = '150px';

            // Display current value with fixed width
            const valueDisplay = document.createElement('span');
            valueDisplay.id = `${control.id}-value`;
            valueDisplay.textContent = control.initial;
            valueDisplay.style.marginLeft = '11px';
            valueDisplay.style.display = 'inline-block'; // Prevent width changes
            valueDisplay.style.minWidth = '10px';        // Ensure fixed width
            valueDisplay.style.textAlign = 'left';       // Align numbers neatly

            // Store default value
            this.defaultValues[control.id] = control.initial;

            input.addEventListener('input', () => {
                let displayValue = input.value;
                if (control.scale !== 1.0) {
                    displayValue = (parseFloat(input.value)*control.scale).toFixed(2);
                    valueDisplay.textContent = displayValue;
                } else {
                    valueDisplay.textContent = displayValue;
                }
                this.updateControls(control.id);
            });

            container.appendChild(label);
            container.appendChild(input);
            container.appendChild(valueDisplay);
            panel.appendChild(container);

            this.controlSliders[control.id] = input;
        });

        // Create reset button
        const resetButton = document.createElement('button');
        resetButton.textContent = 'Reset';
        resetButton.style.marginTop = '10px';
        resetButton.style.width = '40px'; // '50%'
        resetButton.style.height = '40px'; // Set the same height for a circle
        resetButton.style.padding = '0'; // No extra padding (prev '5px')
        resetButton.style.border = 'none';
        resetButton.style.borderRadius = '50%'; // Make it a circle (prev '3px')
        resetButton.style.display = 'flex'; // Ensure text is centered
        resetButton.style.alignItems = 'center';
        resetButton.style.justifyContent = 'center';
        resetButton.style.cursor = 'pointer';
        resetButton.style.backgroundColor = '#4885a8';
        resetButton.style.color = '#fff';
        resetButton.style.fontSize = '10px'; // '12px'

        // Reset function
        resetButton.addEventListener('click', () => {
            Object.keys(this.controlSliders).forEach(id => {
                this.controlSliders[id].value = this.defaultValues[id];
                document.getElementById(`${id}-value`).textContent = this.defaultValues[id];
            });
            // Explicitly update internal state after resetting sliders
            this.updateControls();
        });

        // Create Stop button
        const stopButton = document.createElement('button');
        stopButton.textContent = 'Stop';
        stopButton.style.width = '40px';
        stopButton.style.height = '40px';
        stopButton.style.borderRadius = '50%';
        stopButton.style.display = 'flex';
        stopButton.style.alignItems = 'center';
        stopButton.style.justifyContent = 'center';
        stopButton.style.fontSize = '12px';
        stopButton.style.backgroundColor = 'red';
        stopButton.style.color = '#fff';
        stopButton.style.border = 'none';
        stopButton.style.cursor = 'pointer';

        stopButton.addEventListener('click', () => {
            // Send updated value over WebSocket
            this.updateControls("stopSimulation");
        });

        // Common button styles
        const buttonStyle = {
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',  // Ensure same font size
            padding: '0',
            margin: '0',        // Remove margin inconsistencies
            lineHeight: '1',    // Normalize text height inside buttons
            border: 'none',
            cursor: 'pointer',
        };

        // Apply styles to Reset button
        Object.assign(resetButton.style, buttonStyle);
        resetButton.style.backgroundColor = '#4885a8';
        resetButton.style.color = '#fff';

        // Apply styles to Stop button
        Object.assign(stopButton.style, buttonStyle);
        stopButton.style.backgroundColor = 'red';
        stopButton.style.color = '#fff';

        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginTop = '10px';
        buttonContainer.style.justifyContent = 'center'; // Aligns buttons to the left
        buttonContainer.style.width = '50%';

        // Append buttons to the button container
        buttonContainer.appendChild(resetButton);
        buttonContainer.appendChild(stopButton);

        // Append button container to the control panel
        panel.appendChild(buttonContainer);

        // Append the control panel to the container
        const containerEl = document.getElementById('container3D');
        if (containerEl) {
            containerEl.appendChild(panel);
        }
    }

    // Initial creation of particles and adding to scene
    createParticles() {
        console.log('Create particles ...');

        const sphereGeometry = new THREE.SphereGeometry(0.001, 8, 8); // Default: radius=0.001, widthSegments=8, heightSegments=8
        const material = new THREE.MeshBasicMaterial({
            color: 0x52FF4D, // Match original beam color
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending
        });

        // Create particles
        for (let i = 0; i < this.particleCount; i++) {
            const sphere = new THREE.Mesh(sphereGeometry, material.clone()); // cloned mat so particles can be recoloured individually

            this.particles.push({
                mesh: sphere,  
                index: i,
            });

            sphere.name = "Sphere_" + i;

            this.scene.add(sphere);
        }
        console.log(`Total particles created: ${this.particles.length}`);
    }

    // Model Loading & Scene Management
    loadModels() {
        const loader = new GLTFLoader();

        // Load all element models into dict
        this.elementModels = {
            'CombinedCorrector': null,
            'HorizontalCorrector': null,
            'VerticalCorrector': null,
            'Quadrupole': null,
            'Dipole': null,
            'Screen': null,
            'Cavity': null,
        }

        for(let elementName in this.elementModels) {
            loader.load(
                `/models/${elementName}.glb`, 
                (gltf) => {    
                    console.log(`${elementName} model loaded`);
                    gltf.scene.scale.set(0.1,0.1,0.1)
                    this.elementModels[elementName] = gltf.scene;
                },
                undefined,
                (error) => console.error(`Error loading ${elementName} model:`, error)
            );
        }
    }

    // Rendering & Animation
    startAnimation() {
        this.animationRunning = true;
        this.animate(); // restart the animation loop
    }

    // Render the scene
    animate() {
        // Start the 3D rendering
        requestAnimationFrame(this.animate.bind(this));

        if (this.animationRunning && this.isSceneReady) {
            const deltaTime = this.getElapsedTime();

            // Update total progress based on speed and time
            this.totalProgress = (deltaTime * this.particleSpeed) / this.totalPathLength;

            // Calculate actual distance traveled along the path
            const distanceTraveled = this.totalProgress * this.totalPathLength;

            // Find current segment and progress
            const { segmentIndex, segmentProgress } = this.findCurrentSegment(distanceTraveled);
            
            // Get position data for current and next segments
            let currentSegment = this.currentData.segments[segmentIndex-1];
            let nextSegment = (segmentIndex === this.segmentsCount)
                ? currentSegment
                : this.currentData.segments[segmentIndex];

            // this.camera.position =  + currentSegment.mesh_position + (nextSegment.mesh_position - currentSegment.mesh_position) * segmentProgress;
            this.camera.position.lerpVectors(new THREE.Vector3(-0.25 + currentSegment.mesh_position[0], 0.5 + currentSegment.mesh_position[1], -0.75 + currentSegment.mesh_position[2]), new THREE.Vector3(-0.25 + nextSegment.mesh_position[0], 0.5 + nextSegment.mesh_position[1], -0.75 + nextSegment.mesh_position[2]), segmentProgress)
            // Update each particle
            this.particles.forEach((particle, i) => {
                const startPos = new THREE.Vector3(...currentSegment.particle_positions[i]);
                const endPos = new THREE.Vector3(...nextSegment.particle_positions[i]);

                if(this.scaleBeamSpread > 1.0 || this.scaleBeamPosition > 0.0){
                    const currentMeanPos = new THREE.Vector3(...currentSegment.mean_particle_position);
                    const nextMeanPos = new THREE.Vector3(...nextSegment.mean_particle_position);
                    
                    if(this.scaleBeamSpread > 1.0){
                        startPos.sub(currentMeanPos).multiplyScalar(this.scaleBeamSpread).add(currentMeanPos)
                        endPos.sub(nextMeanPos).multiplyScalar(this.scaleBeamSpread).add(nextMeanPos)
                    }
                    if(this.scaleBeamPosition > 0.0){
                        startPos.add(new THREE.Vector3( this.scaleBeamPosition, this.scaleBeamPosition, 0).multiply(currentMeanPos))
                        endPos.add(new THREE.Vector3( this.scaleBeamPosition, this.scaleBeamPosition, 0).multiply(nextMeanPos))
                    }
                }

                // Interpolate position based on constant speed progress
                particle.mesh.position.lerpVectors(startPos, endPos, segmentProgress);
                particle.mesh.material.color.setRGB(currentSegment.momenta[i,0]*10000, 1, currentSegment.momenta[i,1]*10000)
                // Keep particles fully visible across all segments
                particle.mesh.material.opacity = 1.0;
                particle.mesh.visible = true;
            });

            // restart animation when we reach 100% of total progress
            if (distanceTraveled >= this.totalPathLength*1.1) { //hold for a beat before resetting to allow particles to be visible at the end of the path
                this.resetAnimation();
            }
        }

        this.renderer.render(this.scene, this.camera);
        this.composer.render();
    }

    // Find which segment we're in based on distance traveled
    findCurrentSegment(distanceTraveled) {
        // If we've exceeded the total path length, return the last segment at 100% progress
        if (distanceTraveled > this.totalPathLength) {
            // console.debug("Reached or exceeded total path length, returning last segment");
            return { segmentIndex: this.currentData.segments.length - 1, segmentProgress: 1.0 };
        }

        // Iterate through the segment start points to find the current segment
        for (let i = 0; i < this.currentData.segments.length - 1; i++) {

            const segmentStart = this.currentData.segments[i].element_position;
            const segmentEnd = this.currentData.segments[i + 1].element_position;

            // Check if the distance traveled is within the range of the current segment
            if (distanceTraveled >= segmentStart && distanceTraveled <= segmentEnd) {
                const distanceInSegment = distanceTraveled - segmentStart;
                const segmentProgress = distanceInSegment / (segmentEnd - segmentStart); 
                // Return the index of the segment and the progress within it
                return {
                    segmentIndex: i+1,
                    segmentProgress: Math.min(Math.max(segmentProgress, 0), 1.0)
                };
            }
        }

        // If we've exceeded the total path length, return the last segment at 100% progress
        return { segmentIndex: this.currentData.segments.length - 1, segmentProgress: 0 };
    }

    getElapsedTime() {
        // Assuming you start the timing when the particle system is initialized or when the particle starts moving
        const now = performance.now(); // You could also use Date.now()
        return (now - this.startTime) / 1000;  // Returns time in seconds
    }

    // WebSocket setup
    setupWebSocket() {
        // Ensure connection status element exists before initializing connection
        this.ensureConnectionStatusElement();

        this.connectWebSocket();
    }

    async getWebSocketUrl() {
        // Use the environment variable if available, otherwise fallback to a default
        let WEBSOCKET_PORT = import.meta.env.VITE_APP_WEBSOCKET_PORT
        if(!WEBSOCKET_PORT){
            return fetch('/wsport').then((response) => { return response.text() }).then((responsetext) => { return `ws://${window.location.hostname}:${responsetext}` })
        }
        return `ws://${window.location.hostname}:${WEBSOCKET_PORT}`;
    }

    async connectWebSocket() {
        if (this.reconnectAttempts >= this.max_reconnect_attempts) {
            this.updateConnectionStatus(false, 'Connection failed after multiple attempts');
            return;
        }

        try {
            this.updateConnectionStatus(false, 'Connecting...');
            const url = await this.getWebSocketUrl();
            console.log('Attempting to connect to:', url); // Log the URL being used

            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                console.log('WebSocket connected successfully');
                this.reconnectAttempts = 0;
                this.updateConnectionStatus(true, 'Connected');
                this.updateControls(); // Send initial control values to backend upon connection
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data); // Assuming the data is in JSON format
                    console.log("WebSocket Data Update: Refreshing the scene and plot or restarting the animation!");
                    this.updateSceneFromWebSocket(data);
                } catch (e) {
                    console.error('Error processing WebSocket message:', e);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus(false, `Connection error: ${error.message}`);
            };

            this.ws.onclose = (event) => {
                console.log('WebSocket closed:', event);
                this.updateConnectionStatus(false, 'Disconnected');
                this.reconnectAttempts++;

                // Only attempt reconnect if it wasn't an intentional close
                if (!event.wasClean) {
                    setTimeout(() => this.connectWebSocket(), this.reconnect_delay);
                }
            };
        } catch (e) {
            console.error('WebSocket connection error:', e);
            this.reconnectAttempts++;
            setTimeout(() => this.connectWebSocket(), this.reconnect_delay);
        }
    }

    updateSceneFromWebSocket(data) {
        // console.debug(`Received WebSocket message: ${JSON.stringify(data, null, 2)}`);
        if (!data?.segments) {
            console.warn('Invalid WebSocket data received');
            console.warn(data)
            return;
        }

        if(!this.isSceneReady){
            for(let segmentIndex in data.segments){ 
                let segment = data.segments[segmentIndex];
                console.log(`Processing segment with name: ${segment.segment_name}`);
                if(segment.segment_type in this.elementModels){
                    console.debug(`Segment name: ${segment.segment_name} is type ${segment.segment_type} and will be rendered with the corresponding model.`);
                    let meshcopy = this.elementModels[segment.segment_type].clone();
                    meshcopy.applyMatrix4((new THREE.Matrix4).fromArray(segment.element_transform))
                    this.scene.add(meshcopy)
                }
            }
            this.totalPathLength = data.segments[data.segments.length-1].element_position;
            this.isSceneReady = true;
            console.log(`Scene ready! Total path length: ${this.totalPathLength}`)
        }

        // Store current data
        this.currentData = data;

        this.resetAnimation();
    }

    resetAnimation(){
        // Reset progress state when new data arrives
        this.totalProgress = 0;

        // Initialize the start time per data update
        this.startTime = performance.now();

        // Flag that new data has arrived
        this.newDataAvailable = true;

        // Reset particle positions to segment_0
        const startSegment = this.currentData.segments[0];

        this.particles.forEach((particle, i) => {
            particle.mesh.position.set(...startSegment.particle_positions[i]);
        });
    
        this.camera.position.set(-0.25, 0.5, -0.75);
    }

    // Gather slider values, map them, and send over WebSocket
    updateControls(changedControlId = null) {
        console.log("updateControls")
        if (!this.controlSliders) return;

        // Always update particleSpeed to match the slider value
        this.scaleBeamSpread = parseFloat(this.controlSliders['scaleBeamSpread'].value),
        this.scaleBeamPosition = parseFloat(this.controlSliders['scaleBeamPosition'].value),
        this.particleSpeed = parseFloat(this.controlSliders['particleSpeed'].value)
        
        let controlValues = {};

        // If a specific control changed, log it
        if (changedControlId) {
            const slider = this.controlSliders[changedControlId];

            if (changedControlId === 'stopSimulation') {
                controlValues[changedControlId] = 1
            } else if (changedControlId === 'particleSpeed' || 'scaleBeamSpread' || 'scaleBeamPosition') {
                return // don't send to the websocket if only local things changed
            } else {
                controlValues[changedControlId] = parseFloat(slider.value);
            }
        } else {
            // Update all controls if no specific id is provided.
            controlValues = {
               
            };
        }

        // If WebSocket is open, send the control values (excluding particleSpeed as it's local)
        const wsData = { controls: controlValues };

        // Confirm the WebSocket is connected before sending updates:
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(wsData));
        } else {
            console.warn("WebSocket not ready. Message not sent.");
        }
    }

    // Create connection status element if it doesn't exist
    ensureConnectionStatusElement() {
        let statusElement = document.getElementById('websocket-status');
        if (!statusElement) {
            statusElement = document.createElement('div');
            statusElement.id = 'websocket-status';
            statusElement.style.position = 'absolute';
            //statusElement.style.top = '10px';

            statusElement.style.bottom = '10px';
            statusElement.style.left = '50%';
            statusElement.style.transform = 'translateX(-50%)';
            statusElement.style.padding = '5px 10px';
            statusElement.style.borderRadius = '4px';
            statusElement.style.fontFamily = 'monospace';
            statusElement.style.zIndex = '100';
            statusElement.style.maxWidth = '80%';
            statusElement.style.wordWrap = 'break-word';

            // Add to the container
            const container = document.getElementById('container3D');
            if (container) {
                container.appendChild(statusElement);
            }
        }
    }

    updateConnectionStatus(status, message) {
        const statusElement = document.getElementById('websocket-status');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = status ? 'connected' : 'disconnected';
            statusElement.style.color = status ? '#006400' : '#640000';  // 'green' and 'red', respectively
            statusElement.style.backgroundColor = status ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 0, 0, 0.2)';
        } else {
            console.warn('WebSocket status element not found');
        }
    }
}

// Initialize the scene when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new SceneManager('container3D');
});

export default SceneManager;
