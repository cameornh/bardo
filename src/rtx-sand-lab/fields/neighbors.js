import {NativeNeighbors,nativeNeighborsAvailable} from '../../sand-lab/native-neighbors.js';
import {PackedNeighbors} from '../../sand-lab/packed-neighbors.js';

// This solver performs ONE capped .12s packing correction, unlike the older
// multi-iteration PBF solver. A 2.3s list covers its 2s kernel plus BOTH parcels'
// correction and .025s cached movement per parcel: 2 + .24 + .05 < 2.3.
// The margin is geometric, independent of camera, frame rate or water speed.
export class FieldNeighbors {
 build(positions,spacing,{native=true,reuse=true}={}){
  const useNative=native&&nativeNeighborsAvailable(),backend=useNative?'WebAssembly CPU':'JavaScript CPU reference';
  let rebuild=!reuse||this.backend!==backend||this.spacing!==spacing||this.origin?.length!==positions.length;
  if(!rebuild){const limit=(spacing*.025)**2;for(let o=0;o<positions.length;o+=4){const x=positions[o]-this.origin[o],y=positions[o+1]-this.origin[o+1],z=positions[o+2]-this.origin[o+2];if(x*x+y*y+z*z>limit){rebuild=true;break;}}}
  if(rebuild){
   const builder=useNative?(this.native??=new NativeNeighbors()):(this.reference??=new PackedNeighbors());
   this.result=builder.build(positions,spacing*(2.3/2.65),true);this.origin=positions.slice();this.spacing=spacing;this.backend=backend;
  }
  this.reused=!rebuild;return this.result;
 }
}
