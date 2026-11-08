import {BeachFieldGrid,AIR,WATER} from '../src/rtx-sand-lab/fields/grid.js';
import {FixedGridTopology} from '../src/rtx-sand-lab/fields/research/fixed-topology.js';
const phases=Array.from({length:60},(_,t)=>Uint8Array.from({length:3553},(_,i)=>i%17<2?0:Math.floor(i/17)%11<4+((i+t)%23===0)?WATER:AIR)),blocks=[];
for(const optimized of [false,true,true,false]){
 const g=new BeachFieldGrid({dims:[17,11,19],h:1});if(optimized)g.topologyBuilder=new FixedGridTopology();
 for(let j=0;j<20;j++)g.setPhase(phases[j]);const start=performance.now();for(const p of phases)g.setPhase(p);blocks.push({optimized,ms:(performance.now()-start)/phases.length});
}
console.log(JSON.stringify({note:'Topology rebuild microbenchmark, not full-scene throughput',cells:3553,frames:60,blocks},null,2));
