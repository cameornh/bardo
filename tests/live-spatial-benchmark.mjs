import {performance} from 'node:perf_hooks';
import {SandLab} from '../src/sand-lab/lab.js';
import {SandBed} from '../src/sand-lab/sand.js';
import {shapeDistance} from '../src/sand-lab/sand-shape.js';
import {createSandUniforms,floatTexture} from '../src/sand-lab/uniforms.js';
import {IncrementalSand} from '../src/rtx-sand-lab/incremental-sand.js';
import {SandDistanceCache} from '../src/rtx-sand-lab/sand-distance-cache.js';
import {buildSandBricks} from '../src/rtx-sand-lab/sand-bricks.js';
import {nearWindow} from '../src/rtx-sand-lab/clipmap-water.js';
import {fieldLayout} from '../src/sand-lab/water-lab-field.js';
let seed=731;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
function fixture(){seed=731;const sand=new SandBed(65);sand.parcels=Array.from({length:1500},(_,id)=>({id,position:[random()*10-5,random(),random()*8-4],shapeRadius:.12,mass:.004,packing:.6,wet:.8,aspect:.7+random()*.3,anchored:true,cuts:Array.from({length:6},(_,i)=>({offset:[Math.cos(i)*.13,.06,Math.sin(i)*.13],radius:.07}))}));sand.update();const lab={sand,u:createSandUniforms(),optimizations:{sandCache:true,compactSand:true}};lab.u.uSand.value=floatTexture(sand.data,65,65);return lab;}
const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
function syncBench(incremental){const lab=fixture(),cache=new IncrementalSand(lab.sand),sync=()=>incremental?cache.update(lab):SandLab.prototype.syncSandUniforms.call(lab),times=[];sync();let rows=0;for(let i=0;i<280;i++){lab.sand.parcels[17].position[0]+=(i%2?1:-1)*.002;lab.sand.revision++;const start=performance.now();sync();const ms=performance.now()-start;if(i>=40){times.push(ms);rows+=incremental?cache.stats.uploadedRows:lab.u.uSand.value.image.height+lab.u.uSandParcels.value.image.height+lab.u.uSandBins.value.image.height;}for(const k of ['uSand','uSandParcels','uSandBins'])lab.u[k].value.clearUpdateRanges();}return {medianMs:median(times),p95Ms:times[Math.floor(times.length*.95)],meanUploadedRows:rows/times.length};}
const baseline=syncBench(false),incremental=syncBench(true);
const p={position:[0,0,0],shapeRadius:.8,mass:1,packing:.6,wet:.8,aspect:.6,cuts:Array.from({length:12},(_,i)=>({offset:[Math.cos(i)*.6,.15,Math.sin(i)*.6],radius:.32}))},points=Array.from({length:150000},()=>[random()*1.6-.8,(random()*1.6-.8)*.6,random()*1.6-.8]);
const cache=new SandDistanceCache(()=>({postMessage(){},terminate(){}}));cache.refresh([p]);const entry=cache.entries.get(p);entry.bricks=buildSandBricks(entry.shape);
function distanceBench(cached){let sum=0;const runs=[];for(let j=0;j<6;j++){if(cached)Object.defineProperty(p,'distanceCache',{value:cache,configurable:true});else delete p.distanceCache;const start=performance.now();for(const q of points)sum+=shapeDistance(p,q);if(j)runs.push(performance.now()-start);}return {medianMs:median(runs),sum};}
const exact=distanceBench(false),bricks=distanceBench(true),bounds={min:[-6,-1,-5.5],max:[6,10,5.5]},spacing=.19,full=fieldLayout(spacing,.5,bounds),coarse=fieldLayout(spacing,1,bounds),near=fieldLayout(spacing,.5,nearWindow([2,1,2],spacing,bounds));
console.log(JSON.stringify({fixture:'1500 sand parcels, one moving handful; 150000 carved-shape queries',baseline,incremental,packingSpeedup:baseline.medianMs/incremental.medianMs,exact,bricks,querySpeedup:exact.medianMs/bricks.medianMs,representativeWaterField:{referenceTexels:full.width*full.height,nestedTexels:coarse.width*coarse.height+near.width*near.height},scope:'CPU microbenchmarks and field storage; not whole-scene FPS or realtime speed'},null,2));
