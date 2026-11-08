import {ResidentWaterPipeline} from './pipeline.js';
import {predictBeach} from '../../../sand-lab/beach-predict.js';
// Only the shared live scene opts in; earlier fixtures keep their implementations.
export function installResidentWater(lab,{enabled=true}={}){
 const f=lab.bulkFields;if(!f)return;
 lab.optimizations.residentWater=enabled;
 f.createConnectedPipeline=()=>new ResidentWaterPipeline({residentEnabled:()=>lab.optimizations.residentWater!==false,localEnabled:()=>lab.optimizations.fieldLocalPressure!==false});
 lab.deferWaterPrediction=()=>f.enabled&&f.particleBackend==='connected'&&f.connected instanceof ResidentWaterPipeline&&f.connected.validated&&!f.connected.disabled&&f.connected.residentEnabled()&&lab.kind==='ocean'&&lab.optimizations.fastPredict!==false&&!lab.player;
 // First-person player impulses still consume the reference prediction. Other
 // tools need only the published state. Never leave a deferred prediction in
 // a CPU fallback or after changing backend/checkbox between steps.
 lab.completeWaterPrediction=context=>{if(context.predictionDeferred){predictBeach(lab,context.old,context.predicted,context.dt);context.predictionDeferred=false;}};
}
