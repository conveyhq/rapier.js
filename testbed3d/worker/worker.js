import {CannonJSBackend /* , CannonESBackend */} from "./CannonBackend";
import {AmmoJSBackend, AmmoWASMBackend} from "./AmmoBackend";
import {PhysXBackend} from "./PhysXBackend";
import {OimoBackend} from "./OimoBackend";
import {RapierBackend} from "./RapierBackend";
import crc32 from 'buffer-crc32'

const RAPIER = import('@dimforge/rapier3d');
var interval = null;

export class Worker {
    constructor(postMessage) {
        this.stepId = 0;
        this.postMessage = postMessage;
        this.backends = new Map([
            ["rapier", (R, w, b, c, j) => new RapierBackend(R, w, b, c, j)],
            ["ammo.js", (R, w, b, c, j) => new AmmoJSBackend(R, w, b, c, j)],
            ["ammo.wasm", (R, w, b, c, j) => new AmmoWASMBackend(R, w, b, c, j)],
            ["cannon.js", (R, w, b, c, j) => new CannonJSBackend(R, w, b, c, j)],
            // ["cannon-es", (R, w, b, c, j) => new CannonESBackend(R, w, b, c, j)], // FIXME: this does not work in a web worker?
            ["oimo.js", (R, w, b, c, j) => new OimoBackend(R, w, b, c, j)],
            ["physx.release.wasm", (R, w, b, c, j) => new PhysXBackend(R, w, b, c, j)]
        ]);

        this.effects = [];
        this.snapshots = {};
    }

    handleMessage(event) {
        switch (event.data.type) {
            case 'setWorld':
                this.snapshot = undefined;
                this.token = event.data.token;
                let backend = this.backends.get(event.data.backend);
                if (!!this.backend)
                    this.backend.free();

                RAPIER.then(R => {
                    this.backend = backend(R);
                    setTimeout(() => this.backend.takeSnapshot(),1000); 
                    this.backend.restoreSnapshot(event.data.world);
                });
                this.stepId = 0;
                break;
            case 'step':
                this.step(event.data);
                break;
            case 'takeSnapshot':
                this.snapshot = this.backend.takeSnapshot();
                this.snapshotStepId = this.stepId;
                break;
            case 'restoreSnapshot':
                this.backend.restoreSnapshot(this.snapshot);
                this.stepId = this.snapshotStepId;
                break;
            case 'castRay':
                this.castRay(event.data);
                break;
        }
    }

    castRay(params) {
        if (!!this.backend && !!this.backend.castRay) {
            let hit = this.backend.castRay(params.ray);
            postMessage({
                token: params.token,
                type: "collider.highlight",
                handle: !!hit ? hit.colliderHandle : null,
            });
        }
    }

    step(params) {
        if (!!this.backend && params.running ) {

            let startStep = 0;
            if(params.steps !== 1 ){
                if(this.stepId===0 && this.snapshots[0] === undefined ){
                    this.snapshots[0] = this.backend.takeSnapshot();
                }

                // Find oldest but younger snapshot to the target frame (steps)
                const oldestYoungestIndex = Object.keys(this.snapshots).map(s => parseInt(s)).reverse().find(s=>s<=params.steps);

                this.backend.restoreSnapshot(this.snapshots[oldestYoungestIndex]);
                this.stepId = oldestYoungestIndex;
                startStep = oldestYoungestIndex+1;
            } else if(params.steps===1 && this.stepId >= params.endTime){
                return;
                
            }

            this.backend.applyModifications(params.modifications);
            
            if(startStep >=params.steps){
                // Do nothing
                console.log(`Took ${"N/A"}ms. (frame=${params.steps})`)
                console.log(`Average ${"N/A"} (frame=${params.steps})`);
                console.log(`Realtime x ${"N/A"} (frame=${params.steps})`);
            } else {
                console.log("timestep", params.timestep)
                const realTime = params.timestep;
                const before = performance.now();
                for(let i = startStep; i<params.steps; i++){
                    
                    // Snapshot every 20 frames if there isn't one already
                    if( i%20 === 0 && this.snapshots[i] === undefined){
                        console.log(`snapshot ${i}`)
                        this.snapshots[i] = this.backend.takeSnapshot();
                    }

                    let ok = this.backend.step(params.maxVelocityIterations, params.maxPositionIterations);
                    if (ok){
                        this.stepId += 1;
                    }
                }
                const deltaTime = performance.now()-before;
                const averageTime = deltaTime/(params.steps-startStep);
                console.log(`Took ${deltaTime.toFixed(2)}ms.`)
                console.log(`Average ${(averageTime).toFixed(2)}`);
                console.log(`Realtime x ${(params.timestep/averageTime*1000.0).toFixed(2)}`);
            }
        }

        if (!!this.backend) {
            let pos = this.backend.colliderPositions();

            if (!!pos) {
                pos.type = "colliders.setPositions";
                pos.token = this.token;
                pos.stepId = this.stepId;

                if (!!params.debugInfos) {
                    if (!!this.backend.worldHash) {

                        let t0 = performance.now();
                        let snapshot = this.backend.takeSnapshot();
                        let t1 = performance.now();
                        let snapshotTime = t1 - t0;

                        t0 = performance.now();
                        pos.worldHash = crc32(new Buffer(snapshot));
                        t1 = performance.now();
                        let worldHashTime = t1 - t0;

                        pos.worldHashTime = worldHashTime;
                        pos.snapshotTime = snapshotTime;
                    }
                }
            }

            postMessage(pos);
        } else {
            postMessage(null);
        }
    }
}

var worker = new Worker(postMessage);

onmessage = (event) => {
    worker.handleMessage(event);
};
