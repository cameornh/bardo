import test from 'node:test';
import assert from 'node:assert/strict';
import {atmosphereSky,atmosphereScatter,atmosphereTransmission} from '../src/sand-lab/atmosphere-model.js';
import {projectSH,evaluateSH} from '../src/sh.js';
const normalize=d=>d.map(v=>v/Math.hypot(...d));

test('molecular scattering makes the daytime zenith blue and reddens low sunlight',()=>{
 const zenith=atmosphereSky([0,1,0],[0,1,0]);assert.ok(zenith[2]>zenith[0]*1.8);
 const high=atmosphereTransmission([0,.02,0],[0,1,0]),low=atmosphereTransmission([0,.02,0],normalize([1,.03,0]));
 assert.ok(high.every((v,k)=>v>low[k]&&v<=1));assert.ok(low[0]>low[2]*20);
 const sunset=atmosphereSky(normalize([1,.03,0]),normalize([1,.03,0]));assert.ok(sunset[0]>sunset[2]*10);
});
test('planet occludes direct sunlight below the horizon while lunar sky remains dim and finite',()=>{
 assert.deepEqual(atmosphereTransmission([0,.02,0],normalize([1,-.14,0])),[0,0,0]);
 const day=atmosphereSky([0,1,0],[0,1,0]),night=atmosphereSky([0,1,0],[0,-1,0]);assert.ok(night.every((v,k)=>v>0&&v<day[k]*.03));
});
test('atmospheric radiance remains finite at grazing angles, poles and twilight',()=>{
 for(const altitude of [-1,-.14,-.01,0,.001,.1,1])for(const direction of [[0,1,0],[0,-1,0],[1,0,0],[1,.000001,0],[-1,.000001,0],[0,.2,1]]){
  const sky=atmosphereSky(direction,[Math.sqrt(1-altitude*altitude),altitude,0]);assert.ok(sky.every(v=>Number.isFinite(v)&&v>=0&&v<100));
 }
});
test('scattering follows solar azimuth rather than an artist-painted horizon gradient',()=>{
 const d=normalize([1,.12,.2]),s=normalize([1,.18,0]),a=atmosphereScatter(d,s),b=atmosphereScatter([d[2],d[1],-d[0]],[s[2],s[1],-s[0]]);
 a.forEach((v,k)=>assert.ok(Math.abs(v-b[k])<1e-10));
 const away=atmosphereScatter([-d[0],d[1],-d[2]],s);assert.ok(a[0]>away[0]*1.5);
});
test('sky spherical harmonics update with time of day and contain no solar disc',()=>{
 const noon=projectSH(d=>atmosphereSky(d,[0,1,0])),night=projectSH(d=>atmosphereSky(d,[0,-1,0]));
 assert.ok(noon.every(Number.isFinite)&&night.every(Number.isFinite));
 const a=evaluateSH(noon,[0,1,0],2),b=evaluateSH(night,[0,1,0],2);assert.ok(a[2]>b[2]*20);assert.ok(Math.max(...noon)<10);
});
