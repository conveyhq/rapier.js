import {Graphics} from './Graphics'
import {Gui} from './Gui'

const PHYSX_BACKEND_NAME = "physx.release.wasm";

class SimulationParameters {
    constructor(backends, builders) {
        this.backend = 'rapier';
        this.prevBackend = 'rapier';
        this.demo = 'CCD';
        this.numVelocityIter = 4;
        this.numPositionIter = 1;
        this.running = false;
        this.stepping = true;
        this.steps = 1;
        this.step = function () {
        }
        this.restart = function () {
        }
        this.takeSnapshot = function () {
        }
        this.restoreSnapshot = function () {
        }
        this.backends = backends;
        this.builders = builders;
        this.debugInfos = false;

    }
}

export class Testbed {
    constructor(RAPIER, builders, worker) {
        let backends = [
            "rapier",
            // "ammo.js",
            // "ammo.wasm",
            // "cannon.js",
            // "oimo.js",
            // PHYSX_BACKEND_NAME
        ];
        this.RAPIER = RAPIER;
        let parameters = new SimulationParameters(backends, builders);
        this.gui = new Gui(this, parameters);
        this.graphics = new Graphics();
        this.inhibitLookAt = false;
        this.parameters = parameters;
        this.worker = worker;
        this.demoToken = 0;
        this.mouse = {x: 0, y: 0};
        this.switchToDemo(builders.keys().next().value);

        this.syncTime(0);

        

        //const currentTimeFrames = document.querySelector("#time span:nth-child(2)")

        //currentTimeMinutes.style.color = "red";


        this.worker.onmessage = msg => {
            if (!!msg.data && msg.data.token != this.demoToken) {
                // This messages comes from an older demo update loop
                // so we can stop the loop now.
                return;
            }

            let modifications;

            if (!!msg.data && msg.data.token == this.demoToken) {
                switch (msg.data.type) {
                    case 'collider.highlight':
                        this.graphics.highlightCollider(msg.data.handle);
                        return;
                    case 'colliders.setPositions':
                        this.syncTime(msg.data.stepId);
                        if(msg.data.stepId >=parseInt(document.getElementById('slider').max) ){
                            //parameters.running = false;
                            this.gui.togglePlayPause(true);
                        } 
                        if(document.getElementById('slider').value !== msg.data.stepId){
                            document.getElementById('slider').value = msg.data.stepId;
                        }
                        this.graphics.updatePositions(msg.data.positions);
                        break;
                }
                this.gui.setTiming(msg.data.stepTime);
                this.gui.setDebugInfos(msg.data);
            }

            let now = new Date().getTime();
            let raycastMessage = this.raycastMessage();
            let timestepTimeMS = this.world.timestep * 1000 * 0.75;
            
            /// Don't step the physics world faster than the real world.
            if (now - this.lastMessageTime >= timestepTimeMS) {
                if (!!this.preTimestepAction && this.parameters.running) {
                    modifications = this.preTimestepAction();
                }
                let stepMessage = this.stepMessage(modifications);

                this.graphics.applyModifications(this.RAPIER, this.world, modifications);
                this.worker.postMessage(raycastMessage);
                this.worker.postMessage(stepMessage);
                this.lastMessageTime = now;
            } else {
                setTimeout(() => {
                    if (!!this.preTimestepAction && this.parameters.running) {
                        modifications = this.preTimestepAction();
                    }
                    let stepMessage = this.stepMessage(modifications);

                    this.graphics.applyModifications(this.RAPIER, this.world, modifications);
                    this.worker.postMessage(raycastMessage);
                    this.worker.postMessage(stepMessage);
                    this.lastMessageTime = new Date().getTime();
                }, timestepTimeMS - (now - this.lastMessageTime));
            }
        };

        window.addEventListener('mousemove', event => {
            this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = 1 - (event.clientY / window.innerHeight) * 2;
        });
    }
    
    syncTime(steps){
        const currentTimeMinutesSeconds = document.querySelector("#time span:nth-child(1)")
        //currentTimeMinutesSeconds.style.color = "red";
        const currentTimeFrames = document.querySelector("#time span:nth-child(2)")
        //currentTimeFrames.style.color = "green";

        const totalTimeMinutesSeconds = document.querySelector("#time span:nth-child(3)")
        //totalTimeMinutesSeconds.style.color = "blue";
        const totalTimeFrames = document.querySelector("#time span:nth-child(4)")
        //totalTimeFrames.style.color = "pink";

        const slider = document.getElementById('slider');

        function formatTime(steps){
            const seconds = Math.floor(steps/90.0);
            const minutes = Math.floor(seconds/60);
            return `${minutes}:${(seconds%60).toString().padStart(2, '0')}:`;
        }

        currentTimeMinutesSeconds.innerHTML = formatTime(steps);
        currentTimeFrames.innerHTML = (steps%90).toString().padStart(2, '0');

        
        totalTimeMinutesSeconds.innerHTML = formatTime(parseInt(slider.max));
        totalTimeFrames.innerHTML = (parseInt(slider.max)%90).toString().padStart(2, '0');
    }

    raycastMessage() {
        let ray = this.graphics.rayAtMousePosition(this.mouse);
        return {
            type: 'castRay',
            token: this.demoToken,
            ray: ray
        };
    }

    stepMessage(modifications) {
        let res = {
            type: 'step',
            steps: this.parameters.steps,
            timestep: this.world.timestep,
            maxVelocityIterations: this.parameters.numVelocityIter,
            maxPositionIterations: this.parameters.numPositionIter,
            modifications: modifications,
            running: this.parameters.running || this.parameters.stepping,
            debugInfos: this.parameters.debugInfos
        };

        if (this.parameters.stepping) {
            this.parameters.running = false;
            this.parameters.stepping = false;
        }

        return res;
    }

    setpreTimestepAction(action) {
        this.preTimestepAction = action;
    }

    setWorld(world) {
        this.preTimestepAction = null;
        this.world = world;
        this.world.maxVelocityIterations = this.parameters.numVelocityIter;
        this.world.maxPositionIterations = this.parameters.numPositionIter;
        this.demoToken += 1;
        this.gui.resetTiming();

        world.forEachCollider(coll => {
            this.graphics.addCollider(this.RAPIER, world, coll);
        });

        let message = {
            type: 'setWorld',
            backend: this.parameters.backend,
            token: this.demoToken,
            world: world.takeSnapshot(),
        };
        this.worker.postMessage(message);
        this.worker.postMessage(this.stepMessage());
        this.lastMessageTime = new Date().getTime();
    }

    lookAt(pos) {
        if (!this.inhibitLookAt) {
            this.graphics.lookAt(pos)
        }

        this.inhibitLookAt = false;
    }

    switchToDemo(demo) {
        if (demo == this.prevDemo) {
            this.inhibitLookAt = true;
        }

        this.prevDemo = demo;
        this.graphics.reset();

        // TODO: the PhysX bindings don't allow the number of solver iterations to be modified yet.
        if (this.parameters.backend != PHYSX_BACKEND_NAME && this.parameters.prevBackend == PHYSX_BACKEND_NAME) {
            this.parameters.numVelocityIter = 4;
            this.parameters.numPositionIter = 1;
            this.gui.velIter.domElement.style.pointerEvents = "auto";
            this.gui.velIter.domElement.style.opacity = 1;
            this.gui.posIter.domElement.style.pointerEvents = "auto";
            this.gui.posIter.domElement.style.opacity = 1;
        }

        // Initialize the other backend if it is enabled.
        switch (this.parameters.backend) {
            case 'rapier':
                this.otherWorld = undefined;
                break;
            case PHYSX_BACKEND_NAME:
                this.parameters.numVelocityIter = 1;
                this.parameters.numPositionIter = 4;
                this.gui.velIter.domElement.style.pointerEvents = "none";
                this.gui.velIter.domElement.style.opacity = .5;
            default:
                break;
        }

        if (this.parameters.backend == "rapier") {
            this.gui.posIter.domElement.style.pointerEvents = "auto";
            this.gui.posIter.domElement.style.opacity = 1;
        } else {
            this.gui.posIter.domElement.style.pointerEvents = "none";
            this.gui.posIter.domElement.style.opacity = .5;
        }

        this.parameters.prevBackend = this.parameters.backend;
        this.parameters.builders.get(demo)(this.RAPIER, this);
    }

    switchToBackend(backend) {
        this.otherWorld = undefined;
        this.switchToDemo(this.parameters.demo);
    }

    takeSnapshot() {
        this.worker.postMessage({type: 'takeSnapshot'});
    }

    restoreSnapshot() {
        this.worker.postMessage({type: 'restoreSnapshot'});
    }

    run() {
        // if (this.parameters.running || this.parameters.stepping) {
        //     this.world.maxVelocityIterations = this.parameters.numVelocityIter;
        //     this.world.maxPositionIterations = this.parameters.numPositionIter;
        // }
        //
        // if (this.parameters.stepping) {
        //     this.parameters.running = false;
        //     this.parameters.stepping = false;
        // }

        this.gui.stats.begin();
        this.graphics.render();
        this.gui.stats.end();

        requestAnimationFrame(() => this.run());
    }
}