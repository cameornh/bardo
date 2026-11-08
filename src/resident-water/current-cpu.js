// Control arm: today's complete CPU beach physics feeding the exact same
// WebGPU renderer. This isolates renderer savings from physics/residency gains.
import {LiveSandLab} from '../rtx-sand-lab/live-lab.js';
import {configureRTXLab} from '../rtx-sand-lab/profile.js';
import {densityKernelReady} from '../sand-lab/native-density.js';
import {neighborKernelReady} from '../sand-lab/native-neighbors.js';
import {transferKernelReady} from '../rtx-sand-lab/fields/native-transfer.js';
import {transportKernelReady} from '../rtx-sand-lab/fields/native-transport.js';
import {pressureKernelReady} from '../rtx-sand-lab/fields/native-pressure.js';
import {outputState} from './model.js';
export async function currentCPU(f){
 await Promise.all([densityKernelReady,neighborKernelReady,transferKernelReady,transportKernelReady,pressureKernelReady]);
 const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});configureRTXLab(lab);lab.resolutions.ocean=f.resolution;lab.configure('ocean');lab.wind=0;lab.tidesEnabled=false;lab.lunarCycle=false;lab.detail.enabled=false;lab.rain.enabled=false;lab.reactiveWaves=true;lab.enabled=true;lab.paused=false;
 return {lab,step(wind){lab.wind=wind;lab.step(f.dt,true);return outputState({...f,positions:lab.positions,velocities:lab.velocities,chem:lab.chem});}};
}
