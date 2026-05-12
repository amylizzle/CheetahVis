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

        // Particle System Properties
        this.particleCount = 1000;      // The total number of particles, set by size of floatarray from sim
        this.particles = null;            // LineSegment mesh to draw 

        // Segment Properties
        this.totalPathLength = 1;       // Total length of the entire path, calculated from segment distances
        this.totalProgress = 0;         // Overall progress through all segments (from 0 to 1) for the animation
        this.lastAnimateTick = performance.now();
        this.speedMultiplier = 1.0;

        // Animation Properties
        this.particleSpeed = 1.0;      // Units per frame 
        this.scaleBeamMomentum = 1.0;
        this.scaleBeamSpread = 1.0;
        this.currentData = null;       // Store latest WebSocket data
        this.animationRunning = true;  // Start with animation running

        // Scene Initialization
        this.scene = new THREE.Scene();
        this.scene.name = "Scene";
        this.graphScene = new THREE.Scene();
        this.graphScene.name = "GraphScene";
        this.graphCamera = null;

        // Setup core rendering components
        this.camera = this.setupCamera();
        this.renderer = this.setupRenderer(containerId);
        this.graphrenderer = this.setupGraphWindow();
        this.controls = this.setupOrbitalControls();
        this.composer = this.setupPostProcessing();

        // Scene Configuration
        this.setupLighting();
        this.createControlPanel();
        this.loadModels().then(() => {
            // Event Listeners
            this.setupEventListeners();
            // WebSocket Setup (only after everything else is ready)
            this.setupWebSocket();
        });
    }

    // Scene Initialization
    setupCamera() {
        const camera = new THREE.PerspectiveCamera(
            75, //fov
            window.innerWidth / window.innerHeight, //aspect ratio
            0.001, //near plane
            1000 //far plane
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

    setupGraphWindow() {
        const win = document.getElementById("window-container")
        const header = document.getElementById("window-header");

        let isDragging = false;
        let offset = { x: window.innerWidth - win.getBoundingClientRect().width, y: window.innerHeight - win.getBoundingClientRect().height };
        win.style.left = `${offset.x}px`;
        win.style.top = `${offset.y}px`;

        header.addEventListener("mousedown", (e) => {
            isDragging = true;
            offset.x = e.clientX - win.offsetLeft;
            offset.y = e.clientY - win.offsetTop;
        });

        window.addEventListener("mousemove", (e) => {
            if (!isDragging) return;

            win.style.left = `${e.clientX - offset.x}px`;
            win.style.top = `${e.clientY - offset.y}px`;
        });

        window.addEventListener("mouseup", () => {
            isDragging = false;
        });

        const container = document.getElementById("graph-canvas-container");
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Renderer setup
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        container.appendChild(renderer.domElement);

        this.graphCamera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, -10, 10);
        this.graphCamera.aspect = width / height;
        this.graphCamera.updateProjectionMatrix();
        return renderer;
    }

    setupOrbitalControls() {
        // Add orbit controls to the camera, enabling rotation and zoom functionality using the mouse
        const controls = new OrbitControls(this.camera, this.renderer.domElement);

        controls.target.set(0.0, 0.0, 0.0); // Looking towards the center of the diagnostic screen
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
            { id: 'scaleBeamMomentum', type: 'speed', label: 'Scale beam momentum', min: 1.0, max: 100.0, step: 1.0, scale: 1.0, initial: this.scaleBeamMomentum }
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
                    displayValue = (parseFloat(input.value) * control.scale).toFixed(2);
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

        // Create reset button
        const resetButton = document.createElement('button');
        Object.assign(resetButton.style, buttonStyle);
        resetButton.textContent = 'Reset';
        resetButton.style.backgroundColor = '#4885a8';
        resetButton.style.color = '#fff';

        // Reset function
        resetButton.addEventListener('click', () => {
            Object.keys(this.controlSliders).forEach(id => {
                this.controlSliders[id].value = this.defaultValues[id];
                document.getElementById(`${id}-value`).textContent = this.defaultValues[id];
            });
            // Explicitly update internal state after resetting sliders
            this.updateControls();
        });
        panel.appendChild(resetButton);

        // Create animation controls
        const skipbackwardButton = document.createElement('button');
        Object.assign(skipbackwardButton.style, buttonStyle);
        skipbackwardButton.textContent = '⏮';
        skipbackwardButton.style.backgroundColor = 'blue';
        skipbackwardButton.style.color = '#fff';
        skipbackwardButton.addEventListener('click', () => {
            this.totalProgress = 0.0;
        });

        const reverseButton = document.createElement('button');
        Object.assign(reverseButton.style, buttonStyle);
        reverseButton.textContent = '⏪︎';
        reverseButton.style.backgroundColor = 'green';
        reverseButton.style.color = '#fff';
        reverseButton.addEventListener('mousedown', () => {
            this.speedMultiplier = -1.0;
            this.restoreState = this.animationRunning
            this.animationRunning = true
        });
        reverseButton.addEventListener('mouseup', () => {
            this.speedMultiplier = 1.0;
            this.animationRunning = this.restoreState
        });

        const playpauseButton = document.createElement('button');
        Object.assign(playpauseButton.style, buttonStyle);
        playpauseButton.textContent = '⏯';
        playpauseButton.style.backgroundColor = 'red';
        playpauseButton.style.color = '#fff';

        playpauseButton.addEventListener('click', () => {
            this.animationRunning = !this.animationRunning;
            playpauseButton.style.backgroundColor = this.animationRunning ? 'red' : 'green'
        });

        const fastforwardButton = document.createElement('button');
        Object.assign(fastforwardButton.style, buttonStyle);
        fastforwardButton.textContent = '⏩︎';
        fastforwardButton.style.backgroundColor = 'green';
        fastforwardButton.style.color = '#fff';
        fastforwardButton.addEventListener('mousedown', () => {
            this.speedMultiplier = 2.0;
            this.restoreState = this.animationRunning
            this.animationRunning = true
        });
        fastforwardButton.addEventListener('mouseup', () => {
            this.speedMultiplier = 1.0;
            this.animationRunning = this.restoreState
        });

        const skipforwardButton = document.createElement('button');
        Object.assign(skipforwardButton.style, buttonStyle);
        skipforwardButton.textContent = '⏭';
        skipforwardButton.style.backgroundColor = 'blue';
        skipforwardButton.style.color = '#fff';
        skipforwardButton.addEventListener('click', () => {
            this.totalProgress = 1.0;
        });

        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginTop = '10px';
        buttonContainer.style.justifyContent = 'center'; // Aligns buttons to the left
        buttonContainer.style.width = '95%';

        // Append buttons to the button container
        buttonContainer.appendChild(skipbackwardButton);
        buttonContainer.appendChild(reverseButton);
        buttonContainer.appendChild(playpauseButton);
        buttonContainer.appendChild(fastforwardButton);
        buttonContainer.appendChild(skipforwardButton);

        // Append button container to the control panel
        panel.appendChild(buttonContainer);

        // Append the control panel to the container
        const containerEl = document.getElementById('container3D');
        if (containerEl) {
            containerEl.appendChild(panel);
        }
    }

    // create particles as a point cloud with shaders to do the interpolation & colouring
    createParticles() {
        const geo = new THREE.InstancedBufferGeometry();

        // template for line (two points) that gets applied to each point in the particle array
        const linePositions = new Float32Array([0, 0, -.5, 0, 0, .5]);
        geo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));//position has special meaning in threejs shaders
        const count = this.particleCount;

        const positions = new Float32Array(count * 3);
        const targetPositions = new Float32Array(count * 3);
        const momenta = new Float32Array(count * 3);
        const targetMomenta = new Float32Array(count * 3);

        geo.setAttribute('startPosition', new THREE.InstancedBufferAttribute(positions, 3));
        geo.setAttribute('targetPosition', new THREE.InstancedBufferAttribute(targetPositions, 3));
        geo.setAttribute('startMomenta', new THREE.InstancedBufferAttribute(momenta, 3));
        geo.setAttribute('targetMomenta', new THREE.InstancedBufferAttribute(targetMomenta, 3));

        this.particleMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uProgress: { value: 0 },
                uScaleSpread: { value: this.scaleBeamSpread },
                uScaleMomentum: { value: this.scaleBeamMomentum },
                uMaxMomentum: { value: 1.0 },
                startMeanPosition: { value: [0.0, 0.0, 0.0] },
                targetMeanPosition: { value: [0.0, 0.0, 0.0] },
                startInputTransform: {
                    value: [
                        [1., 0., 0., 0.],
                        [0., 1., 0., 0.]
                        [0., 0., 1., 0.]
                        [0., 0., 0., 1.]
                    ]
                },
                targetInputTransform: {
                    value: [
                        [1., 0., 0., 0.],
                        [0., 1., 0., 0.]
                        [0., 0., 1., 0.]
                        [0., 0., 0., 1.]
                    ]
                },
                startPositionCorrection: { value: [0., 0., 0.] },
                targetPositionCorrection: { value: [0., 0., 0.] }
            },
            vertexShader: `
            attribute vec3 startPosition;
            attribute vec3 targetPosition;
            attribute vec3 startMomenta;
            attribute vec3 targetMomenta;
            
            varying vec3 vColor;
            uniform float uProgress;
            uniform float uScaleSpread;
            uniform float uScaleMomentum;
            uniform float uMaxMomentum;
            uniform vec3 startMeanPosition; 
            uniform vec3 targetMeanPosition;
            uniform mat4 startInputTransform;
            uniform mat4 targetInputTransform;
            uniform vec3 startPositionCorrection;
            uniform vec3 targetPositionCorrection;
            
            void main() {
                //Apply transforms
                // # positions = positions @ R.T + correction
                // # momenta = momenta @ R.T
                mat3 startRotationMatrix = mat3(startInputTransform);
                mat3 targetRotationMatrix = mat3(targetInputTransform);

                //Interpolate position
                vec3 currentPos = mix(startRotationMatrix * startPosition + startPositionCorrection, targetRotationMatrix * targetPosition + targetPositionCorrection, uProgress);
                vec3 currentMeanPos = mix(startRotationMatrix * startMeanPosition + startPositionCorrection, targetRotationMatrix * targetMeanPosition + targetPositionCorrection, uProgress);
                currentPos = ((currentPos - currentMeanPos) * vec3(uScaleSpread)) + currentMeanPos;

                //assuming a linear interp of momentum here, which is not correct at all
                vec3 currentMom = mix(startRotationMatrix * startMomenta, targetRotationMatrix * targetMomenta, uProgress); 

                //momentum colouring
                float mag = length(currentMom);
                vColor = mix(vec3(1.0, clamp(position.z, 0.0, 1.0), 0.0), vec3(0.0, clamp(position.z, 0.0, 1.0), 1.0), clamp(mag/uMaxMomentum, 0.0, 1.0)); 
                // 'position' here refers to the TEMPLATE line (0,0,-.5 to 0,0,.5)
                // using the position.z to distinguish between the start and end points
                // we draw a line centered on position with momentum dictating line length
                vec3 finalPos = currentPos + (position.z * normalize(currentMom) * clamp(mag * uScaleMomentum, 0.001, 2.0));

                gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
            } 
        `,
            fragmentShader: `
            varying vec3 vColor;
            void main() {
                gl_FragColor = vec4(vColor, 1.0);
            }
        `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

        this.particles = new THREE.LineSegments(geo, this.particleMaterial);
        this.scene.add(this.particles);
    }

    createPhaseSpaceGraphs() {
        const geo = new THREE.InstancedBufferGeometry();

        // one "point" for each graph (x/px, y/py, z/pz)
        const linePositions = new Float32Array([
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
        ]);
        geo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));//position has special meaning in threejs shaders
        const count = this.particleCount;

        const positions = new Float32Array(count * 3);
        const targetPositions = new Float32Array(count * 3);
        const momenta = new Float32Array(count * 3);
        const targetMomenta = new Float32Array(count * 3);

        geo.setAttribute('startPosition', new THREE.InstancedBufferAttribute(positions, 3));
        geo.setAttribute('targetPosition', new THREE.InstancedBufferAttribute(targetPositions, 3));
        geo.setAttribute('startMomenta', new THREE.InstancedBufferAttribute(momenta, 3));
        geo.setAttribute('targetMomenta', new THREE.InstancedBufferAttribute(targetMomenta, 3));

        this.graphMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uProgress: { value: 0 },
                uPosMax: { value: [1.0, 1.0, 1.0] }, // Max meters
                uMomMax: { value: [1.0, 1.0, 1.0] }, // Max momentum units
                uPosMin: { value: [-1.0, -1.0, -1.0] }, // Min meters
                uMomMin: { value: [-1.0, -1.0, -1.0] }, // Min momentum units
                startMeanPosition: { value: [0.0, 0.0, 0.0] },
                targetMeanPosition: { value: [0.0, 0.0, 0.0] },
            },
            vertexShader: `
                attribute vec3 startPosition;
                attribute vec3 targetPosition;
                attribute vec3 startMomenta;
                attribute vec3 targetMomenta;
                
                varying vec3 vColor;
                uniform float uProgress;
                uniform vec3 uPosMin;
                uniform vec3 uPosMax;
                uniform vec3 uMomMin;
                uniform vec3 uMomMax;
                uniform vec3 startMeanPosition; 
                uniform vec3 targetMeanPosition;

                void main() {
                    vec3 pos = mix(startPosition, targetPosition, uProgress);
                    vec3 mom = mix(startMomenta, targetMomenta, uProgress);
                    vec3 currentMeanPos = mix(startMeanPosition, targetMeanPosition, uProgress);

                    // graph select by multiplying position vector (which is 0 at the elements we aren't considering)
                    // and then working on the sum
                    float xval = dot(position * (pos - currentMeanPos), vec3(1.0));
                    float yval = dot(position * (mom - uMomMin), vec3(1.0));
                    float xrange = dot(position * (uPosMax - uPosMin), vec3(1.0));
                    float yrange = dot(position * (uMomMax - uMomMin), vec3(1.0));
                    float xMeanPos = dot(position * currentMeanPos, vec3(1.0));

                    float offset = dot(position, vec3(-0.75, 0.0, 0.75));

                    // map to containing object space, with a little margin for axes etc
                    float x = offset+((xval / xrange) * 0.5);
                    float y = -1.0 + ((yval / yrange) * 2.0);

                    // Simple Red-Blue gradient for momentum magnitude
                    float mag = length(mom);
                    // vColor = mix(vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), clamp(mag/yrange, 0.0, 1.0));
                    vColor = vec3(0.3, 0.0, 0.5);

                    gl_Position =  vec4(x, y, 0.0, 1.0);
                    gl_PointSize = 5.0;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
                    gl_FragColor = vec4(vColor, 0.3);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.graphs = new THREE.Points(geo, this.graphMaterial);
        this.graphs.frustumCulled = false;
        this.graphScene.add(this.graphs);
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

        for (let elementName in this.elementModels) {
            this.elementModels[elementName] = loader.loadAsync(`/models/${elementName}.glb`).then(
                (gltf) => {
                    console.log(`${elementName} model loaded`);
                    gltf.scene.scale.set(0.1, 0.1, 0.1);
                    this.elementModels[elementName] = gltf.scene;
                })
        }
        return Promise.all(Object.values(this.elementModels))
    }

    // Rendering & Animation
    startAnimation() {
        this.animationRunning = true;
        this.lastAnimateTick = performance.now() - 1;
        this.animate(); // restart the animation loop
    }

    // Render the scene
    animate() {
        requestAnimationFrame(this.animate.bind(this));
        if (this.animationRunning && this.isSceneReady) {
            const deltaTime = (performance.now() - this.lastAnimateTick) / 1000.0
            this.totalProgress += this.speedMultiplier * (deltaTime * this.particleSpeed) / this.totalPathLength;
            const distanceTraveled = this.totalProgress * this.totalPathLength;
            const { segmentIndex, segmentProgress } = this.findCurrentSegment(distanceTraveled);

            // Check if we've moved to a new segment
            if (segmentIndex !== this.lastLoadedSegment) {
                this.updateSegmentBuffers(segmentIndex);
                this.lastLoadedSegment = segmentIndex;
            }

            // Update the lerp progress on the GPU
            this.particleMaterial.uniforms.uProgress.value = segmentProgress;

            let currentSegment = this.currentData.segments[segmentIndex - 1];
            let nextSegment = this.currentData.segments[segmentIndex];

            let delta = new THREE.Vector3().subVectors(this.camera.position, this.controls.target)
            this.controls.target.lerpVectors(new THREE.Vector3(...currentSegment.mesh_position), new THREE.Vector3(...nextSegment.mesh_position), segmentProgress);
            this.camera.position.copy(this.controls.target).add(delta);
            this.controls.update();
            if (distanceTraveled >= this.totalPathLength * 1.1) {
                //the extra .1 makes us hold for a beat before resetting to allow particles to be visible at the end of the path
                this.resetAnimation();
            }
        }
        this.lastAnimateTick = performance.now();
        this.renderer.render(this.scene, this.camera);
        this.graphrenderer.render(this.graphScene, this.graphCamera);
    }

    updateSegmentBuffers(segmentIndex) {
        let currentSegment = this.currentData.segments[segmentIndex - 1];
        let nextSegment = this.currentData.segments[segmentIndex];

        const geo = this.particles.geometry;
        const startPosAttr = geo.getAttribute('startPosition');
        const targetPosAttr = geo.getAttribute('targetPosition');
        const startMomentaAttr = geo.getAttribute('startMomenta');
        const targetMomentaAttr = geo.getAttribute('targetMomenta');

        startPosAttr.array.set(currentSegment.getParticlePositionArray());
        targetPosAttr.array.set(nextSegment.getParticlePositionArray());
        startMomentaAttr.array.set(currentSegment.getParticleMomentaArray());
        targetMomentaAttr.array.set(nextSegment.getParticleMomentaArray());

        this.particleMaterial.uniforms.uMaxMomentum.value = Math.max(currentSegment.getParticleMomentaArray().reduce((a, b) => Math.max(a, b), -Infinity), nextSegment.getParticleMomentaArray().reduce((a, b) => Math.max(a, b), -Infinity));
        this.particleMaterial.uniforms.startMeanPosition.value = currentSegment.mean_particle_position;
        this.particleMaterial.uniforms.targetMeanPosition.value = nextSegment.mean_particle_position;
        this.particleMaterial.uniforms.startPositionCorrection.value = currentSegment.mesh_position;
        this.particleMaterial.uniforms.targetPositionCorrection.value = nextSegment.mesh_position;
        this.particleMaterial.uniforms.startInputTransform.value = currentSegment.element_transform;
        this.particleMaterial.uniforms.targetInputTransform.value = nextSegment.element_transform;

        this.graphMaterial.uniforms.startMeanPosition.value = currentSegment.mean_particle_position;
        this.graphMaterial.uniforms.targetMeanPosition.value = nextSegment.mean_particle_position;
        this.graphMaterial.uniforms.uPosMin.value = currentSegment.position_range.min;
        this.graphMaterial.uniforms.uPosMax.value = currentSegment.position_range.max;
        this.graphMaterial.uniforms.uMomMin.value = currentSegment.momenta_range.min;
        this.graphMaterial.uniforms.uMomMax.value = currentSegment.momenta_range.max;

        startPosAttr.needsUpdate = true;
        targetPosAttr.needsUpdate = true;
        startMomentaAttr.needsUpdate = true;
        targetMomentaAttr.needsUpdate = true;

        const geograph = this.graphs.geometry;
        const startPosAttrG = geograph.getAttribute('startPosition');
        const targetPosAttrG = geograph.getAttribute('targetPosition');
        const startMomentaAttrG = geograph.getAttribute('startMomenta');
        const targetMomentaAttrG = geograph.getAttribute('targetMomenta');

        startPosAttrG.array.set(currentSegment.getParticlePositionArray());
        targetPosAttrG.array.set(nextSegment.getParticlePositionArray());
        startMomentaAttrG.array.set(currentSegment.getParticleMomentaArray());
        targetMomentaAttrG.array.set(nextSegment.getParticleMomentaArray());

        startPosAttrG.needsUpdate = true;
        targetPosAttrG.needsUpdate = true;
        startMomentaAttrG.needsUpdate = true;
        targetMomentaAttrG.needsUpdate = true;
    }

    getXYZRange(floatArray) {
        const bounds = this.getXYZMinMax(floatArray)
        return [
            bounds.max[0] - bounds.min[0],
            bounds.max[1] - bounds.min[1],
            bounds.max[2] - bounds.min[2],
        ]
    }

    getXYZMinMax(floatArray) {
                const initial = {
            min: [Infinity, Infinity, Infinity],
            max: [-Infinity, -Infinity, -Infinity]
        };

        const bounds = floatArray.reduce((acc, val, i) => {
            const axis = i % 3; // 0 for x, 1 for y, 2 for z

            if (val < acc.min[axis]) acc.min[axis] = val;
            if (val > acc.max[axis]) acc.max[axis] = val;

            return acc;
        }, initial);
        return bounds;
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
                    segmentIndex: i + 1,
                    segmentProgress: Math.min(Math.max(segmentProgress, 0), 1.0)
                };
            }
        }

        // If we've exceeded the total path length, return the last segment at 100% progress
        return { segmentIndex: this.currentData.segments.length - 1, segmentProgress: 0 };
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
        if (!WEBSOCKET_PORT) {
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

        if (!this.isSceneReady) {
            for (let segmentIndex in data.segments) {
                let segment = data.segments[segmentIndex];
                console.log(`Processing segment with name: ${segment.segment_name}`);
                if (segment.segment_type in this.elementModels) {
                    console.debug(`Segment name: ${segment.segment_name} is type ${segment.segment_type} and will be rendered with the corresponding model.`);
                    let meshcopy = this.elementModels[segment.segment_type].clone();
                    meshcopy.applyMatrix4((new THREE.Matrix4).fromArray(segment.element_transform))
                    this.scene.add(meshcopy)
                }
            }
            this.totalPathLength = data.segments[data.segments.length - 1].element_position;
        }
        data.segments.forEach(seg => {
            // This is vastly faster than parsing a million string numbers
            const blobpos = atob(seg.particle_positions);
            const bufpos = new Uint8Array(blobpos.length);
            for (let i = 0; i < blobpos.length; i++) bufpos[i] = blobpos.charCodeAt(i);

            const floatArrayPosition = new Float32Array(bufpos.buffer);
            this.particleCount = floatArrayPosition.length / 3;
            Object.defineProperty(seg, 'getParticlePositionArray', { value: () => (floatArrayPosition), });
            Object.defineProperty(seg, 'getParticlePosition', {
                value: (i) => ([
                    floatArrayPosition[i * 3],
                    floatArrayPosition[i * 3 + 1],
                    floatArrayPosition[i * 3 + 2]
                ]),
            });

            const blobmom = atob(seg.particle_momenta);
            const bufmom = new Uint8Array(blobmom.length);
            for (let i = 0; i < blobmom.length; i++) bufmom[i] = blobmom.charCodeAt(i);

            const floatArrayMomenta = new Float32Array(bufmom.buffer);
            Object.defineProperty(seg, 'getParticleMomentaArray', { value: () => (floatArrayMomenta), });
            Object.defineProperty(seg, 'getParticleMomenta', {
                value: (i) => ([
                    floatArrayMomenta[i * 3],
                    floatArrayMomenta[i * 3 + 1],
                    floatArrayMomenta[i * 3 + 2]
                ]),
            });

            seg.position_range = this.getXYZMinMax(floatArrayPosition);
            seg.momenta_range = this.getXYZMinMax(floatArrayMomenta);

            if (!seg.mean_particle_position.every(v => Number.isFinite(v))) {
                console.error('Invalid mean_particle_position:', seg);
                return;
            }
            if (!seg.mesh_position.every(v => Number.isFinite(v))) {
                console.error('Invalid mesh_position:', seg);
                return;
            }
        });
        // Store current data
        this.currentData = data;

        // Particle System Initialization
        this.createParticles();
        this.createPhaseSpaceGraphs();

        this.isSceneReady = true;

        console.log(`Scene ready! Total path length: ${this.totalPathLength}`)
        // Start Animation Loop
        this.startAnimation();
        this.resetAnimation();
    }


    resetAnimation() {
        this.totalProgress = 0;
        this.updateSegmentBuffers(1);
        let delta = new THREE.Vector3().subVectors(this.camera.position, this.controls.target)

        this.controls.target.set(...this.currentData.segments[0].mean_particle_position)
        this.camera.position.copy(this.controls.target).add(delta);
        this.controls.update();
    }

    // Gather slider values, map them, and send over WebSocket
    updateControls(changedControlId = null) {
        if (!this.controlSliders) return;

        // Always update particleSpeed to match the slider value
        this.scaleBeamSpread = parseFloat(this.controlSliders['scaleBeamSpread'].value)
        if (this.particleMaterial)
            this.particleMaterial.uniforms.uScaleSpread.value = this.scaleBeamSpread;
        this.scaleBeamMomentum = parseFloat(this.controlSliders['scaleBeamMomentum'].value)
        if (this.particleMaterial)
            this.particleMaterial.uniforms.uScaleMomentum.value = this.scaleBeamMomentum;
        this.particleSpeed = parseFloat(this.controlSliders['particleSpeed'].value)
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
