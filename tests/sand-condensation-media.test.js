import test from 'node:test';
import assert from 'node:assert/strict';
import {beadGlassTransmission,beadTransport} from '../src/sand-lab/surface-drop-optics.js';
import {makeBody,bodyDistance} from '../src/sand-lab/objects.js';
import {SurfaceDrops} from '../src/sand-lab/surface-drops.js';
import {LabRain,rainFootprintSample} from '../src/sand-lab/water-lab-rain.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('glass tints beads behind it but not beads on its front surface; cups retain their opening',()=>{
 const b=makeBody('glass','sphere',1,[0,0,0]);b.color=[.1,.5,1];
 const behind=beadGlassTransmission([0,0,3],[0,0,-1.05],.1,[b]);assert.ok(behind[0]<behind[1]&&behind[1]<behind[2]);
 assert.deepEqual(beadGlassTransmission([0,0,3],[0,0,1.05],.1,[b]),[1,1,1,1e4]);
 assert.deepEqual(beadGlassTransmission([0,0,3],[3,0,-1],.1,[b]),[1,1,1,1e4]);
 b.shape='cup';assert.deepEqual(beadGlassTransmission([0,3,0],[0,0,0],.05,[b]),[1,1,1,1e4]);
});
test('water attenuates bead contrast, adds blue scattering to black glass, and responds to tannins',()=>{
 const segment={length:20,depth:10,incident:[1,1,1]};const clear=beadTransport([1,1,1],[segment]),black=beadTransport([0,0,0],[segment]),amber=beadTransport([1,1,1],[segment],1);
 assert.ok(clear[2]>clear[0]);assert.ok(black.every(v=>v>0));assert.ok(black[2]>black[0]);assert.ok(amber[0]>amber[2]);
 const whole=beadTransport([.2,.3,.5],[segment]),split=beadTransport([.2,.3,.5],Array.from({length:10},()=>({...segment,length:2})));
 whole.forEach((v,k)=>close(v,split[k]));
 // Glass behind the water cannot tint the foreground scattering.
 const tinted=beadTransport([0,0,0],[segment],0,0,[.1,.5,1,15]);tinted.forEach((v,k)=>close(v,black[k]));
});
test('rain covers the footprint progressively instead of repeatedly selecting a few patches',()=>{
 const cells=new Uint16Array(100);for(let i=1;i<=2000;i++){const [x,z]=rainFootprintSample(i);assert.ok(x>=-.5&&x<.5&&z>=-.5&&z<.5);cells[Math.floor((z+.5)*10)*10+Math.floor((x+.5)*10)]++;}
 assert.ok(Math.min(...cells)>=15);assert.ok(Math.max(...cells)<=25);
});
function fixture(){const b=makeBody('glass','sphere',.5,[0,.35,0]),lab={spacing:.3,spec:{scale:10},sand:{materialAt:()=>1,distance:p=>p[1]+.5},balls:[b],positions:new Float32Array(),velocities:new Float32Array(),chem:new Float32Array(),neighborCounts:new Uint16Array(),count:0,particleBudget:10000,wind:0,solid:p=>Math.min(p[1]+.5,bodyDistance(p,b)),waterAt:()=>({density:.15})};return {b,lab,d:new SurfaceDrops({lab,appendParcels(){},addWaterDeposit(){}})};}
test('exposed glass keeps rain beads despite nearby coarse water kernels; full immersion removes them',()=>{
 const {b,lab,d}=fixture();d.impact({volume:.001},{point:[0,.85,0],normal:[0,1,0],particle:-1});d.step(.3);assert.equal(d.beads().length,1);assert.equal([...d.patches.values()][0].body,b);
 lab.waterAt=()=>({density:1});d.step(.3);assert.equal(d.patches.size,0);
});
test('real rain flux reaches glass and spreads across wet sand, with conserved mass',()=>{
 const {b,lab}=fixture();lab.rain=new LabRain(lab);lab.rain.enabled=true;lab.rain.rate=120;let glass=0,sand=0;
 const impact=lab.rain.impact.bind(lab.rain);lab.rain.impact=(drop,hit)=>{if(Math.abs(bodyDistance(hit.point,b))<.008)glass++;else sand++;impact(drop,hit);};
 for(let i=0;i<150;i++)lab.rain.step(1/30);
 assert.ok(glass>=3,glass);assert.ok(sand>300,sand);assert.ok(lab.rain.surfaceDrops.beads().length>300);assert.ok([...lab.rain.surfaceDrops.patches.values()].some(p=>p.body===b&&p.beads.length));
 close(lab.rain.emitted,lab.rain.transferred+lab.rain.unresolvedVolume);
});
test('late glass transport equals correctly ordered layers without fogging the transmitted background twice',async()=>{
 const {transportGlassLayer}=await import('../src/sand-lab/glass-water-transport.js');
 const back=[.9,.4,.1],K=[.12,.3,.8],R=[.1,.2,.3],T=[.1,.4,.7],S=[.08,.2,.3],B=back.map((v,i)=>v*T[i]+S[i]),shell=B.map((v,i)=>v*K[i]+R[i]);
 const actual=transportGlassLayer(shell,B,K,T,S),expected=back.map((v,i)=>(v*K[i]+R[i])*T[i]+S[i]);actual.forEach((v,i)=>close(v,expected[i]));
});
test('spontaneous submerged reflective lobes have half diameter, independently of foam markers and simulation mass',async()=>{
 const {bubbleKernel,UNDERWATER_BUBBLE_DIAMETER}=await import('../src/sand-lab/water-lab-blob-renderer.js');
 const {blobFamily,sampleBlob}=await import('../src/sand-lab/water-lab-blobs.js');const f=blobFamily(17,[1,2,3],.3,1),half={...f,kernels:f.kernels.map(k=>bubbleKernel(k,f.position))};
 assert.equal(UNDERWATER_BUBBLE_DIAMETER,.5);
 for(const offset of [[0,0,0],[.2,-.15,.1],[-.3,.2,.25]]){const a=sampleBlob(f,f.position.map((v,k)=>v+offset[k])),b=sampleBlob(half,f.position.map((v,k)=>v+offset[k]*.5));close(a.density,b.density);}
 f.kernels.forEach((k,i)=>{close(half.kernels[i].sigma,k.sigma*.5);close(half.kernels[i].volume,k.volume);});
});
