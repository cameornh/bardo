import {FieldNeighbors} from '../neighbors.js';
import {TightNeighbors,tightNeighborsAvailable} from './neighbors.js';
import {installSnapshotHeights} from './terrain-height.js';
export {tightNeighborKernelReady} from './neighbors.js';
class TrialNeighbors extends FieldNeighbors {
 constructor(lab){super();this.lab=lab;}
 build(...args){const fast=this.lab.optimizations.tightNeighbors!==false&&tightNeighborsAvailable();
  if(this.fast!==fast){this.fast=fast;this.origin=null;this.native=fast?(this.fastNative??=new TightNeighbors()):undefined;}
  return super.build(...args);
 }
}
export function installSpatialCPU(lab){
 installSnapshotHeights(lab);lab.optimizations.tightNeighbors??=true;
 if(lab.bulkFields&&!(lab.bulkFields.neighbors instanceof TrialNeighbors))lab.bulkFields.neighbors=new TrialNeighbors(lab);
}
