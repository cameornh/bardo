// CPU-only physics fixture: no graphics context, fine-particle draws or uploads.
import {readFile} from 'node:fs/promises';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {installFieldLocality} from '../src/rtx-sand-lab/fields/locality.js';
import {installFieldBatch,setBatchKernel} from '../src/rtx-sand-lab/fields/batch/grid.js';
import {setDensityKernel} from '../src/sand-lab/native-density.js';
import {setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
import {setTransferKernel} from '../src/rtx-sand-lab/fields/native-transfer.js';
import {setTransportKernel} from '../src/rtx-sand-lab/fields/native-transport.js';
import {setPressureKernel} from '../src/rtx-sand-lab/fields/native-pressure.js';
import {installSpatialCPU} from '../src/rtx-sand-lab/fields/spatial-cpu/install.js';
import {setTightNeighborKernel} from '../src/rtx-sand-lab/fields/spatial-cpu/neighbors.js';
import {makeBody} from '../src/sand-lab/objects.js';
for(const [set,path] of [[setDensityKernel,'sand-lab/kernels/density.wasm'],[setNeighborKernel,'sand-lab/kernels/neighbors.wasm'],[setTransferKernel,'rtx-sand-lab/fields/kernels/transfer.wasm'],[setTransportKernel,'rtx-sand-lab/fields/kernels/transport.wasm'],[setPressureKernel,'rtx-sand-lab/fields/kernels/pressure.wasm'],[setBatchKernel,'rtx-sand-lab/fields/batch/grid.wasm']])await set(await readFile(new URL('../src/'+path,import.meta.url)));
await setTightNeighborKernel(await readFile(new URL('../src/rtx-sand-lab/fields/spatial-cpu/neighbors.wasm',import.meta.url)));

export function makeSpatialFixture({heights=false,tight=false}={}){
const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});lab.resolutions.ocean=1.4;lab.configure('ocean');lab.wind=18;lab.tidesEnabled=false;lab.detail.enabled=false;lab.detail.advance=()=>{};lab.grains={advance(){},reset(){}};lab.seaFoam=null;lab.bulkFields.publishAir=()=>{};lab.rain.enabled=true;lab.rain.rate=100;
Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true});installFieldLocality(lab);installFieldBatch(lab);installSpatialCPU(lab);lab.optimizations.snapshotHeights=heights;lab.optimizations.tightNeighbors=tight;
for(let i=0;i<48;i++){const x=-3.8+(i%12)*.62,z=1.8+Math.floor(i/12)*.65,y=lab.sand.height(x,z);const chunks=lab.sand.extract([x,y,z],.18,[0,0,0],true);for(const p of chunks){p.held=false;p.position[0]+=.24;p.position[1]=lab.sand.height(p.position[0],p.position[2])+.02;p.anchored=true;p.layer=true;}lab.sand.editPolicy.maintain(lab.sand);lab.sand.update();}
lab.balls.push(makeBody('glass','cup',.24,[1,1.8,1]),makeBody('rock','sphere',.22,[-1,2,1]));
return lab;
}
