import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainTileJournal,terrainCoefficients,evaluateTerrain,cacheTerrainShader} from '../src/rtx-sand-lab/representation/terrain-cache.js';
import {terrainGradient} from '../src/sand-lab/terrain-gradient.js';
import {SandBed} from '../src/sand-lab/sand.js';
import {LAB_GEOMETRY_GLSL} from '../src/sand-lab/water-lab-model.js';
import {SeaFoamRenderer} from '../src/sand-lab/sea-foam-renderer.js';
import {optimizeSeaFoamShader} from '../src/rtx-sand-lab/particle-visibility.js';
import {splitFoamGeometry} from '../src/rtx-sand-lab/representation/foam-cache.js';

test('cached cubic polynomials reproduce the ground and its gradient, including boundaries',()=>{
 const bed=new SandBed(31);for(let k=0;k<bed.data.length;k+=4)bed.data[k]=.6*Math.sin(k*.13)+.15*Math.cos(k*.07);
 // Use the same positive cubic kernel as the reference, explicitly including
 // edge clamping. An ordinary bilinear height cache would fail this test.
 const weights=t=>[(1-t)**3/6,(3*t**3-6*t*t+4)/6,(-3*t**3+3*t*t+3*t+1)/6,t**3/6];
 for(let k=0;k<2000;k++){
  const qx=(k*13.743)%31,qz=(k*17.317)%31,x=Math.min(30,qx),z=Math.min(30,qz),ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,wx=weights(fx),wz=weights(fz);
  let ref=0;for(let j=0;j<4;j++)for(let i=0;i<4;i++)ref+=wx[i]*wz[j]*bed.data[(Math.max(0,Math.min(30,iz+j-1))*31+Math.max(0,Math.min(30,ix+i-1)))*4];
  const actual=evaluateTerrain(terrainCoefficients(bed.data,31,ix,iz),fx,fz),gradient=terrainGradient(bed.data,31,x/30*11-5.5,z/30*9.8-4.9,4);
  assert.ok(Math.abs(ref-actual[0])<1e-12);assert.ok(Math.abs(gradient[0]-actual[1]*30/11)<1e-12);assert.ok(Math.abs(gradient[1]-actual[2]*30/9.8)<1e-12);
 }
});

test('gradient cache insertion works without an opaque-normal consumer',()=>{
 const s=cacheTerrainShader('float sandHeight(vec2 p){return p.x;} vec2 sandHeightGradient(vec2 p){if(p.x>0.){return p;}return p.yx;} void main(){}');
 assert.ok(s.indexOf('vec2 sandHeightGradient(')>s.indexOf('vec2 referenceSandGradient('));
 assert.ok(s.indexOf('vec2 sandHeightGradient(')<s.indexOf('void main'));
});

test('foam geometry preparation retains projection, lighting and alpha code and clears empty records',()=>{
 const sea=new SeaFoamRenderer({size:96,u:{}},{}),source=optimizeSeaFoamShader(sea.material.vertexShader),{vertex,fragment}=splitFoamGeometry(source);
 // Projection/visibility/SH/scattering remain in the drawing program. Only
 // world geometry and the scalar organic term move to the preparation pass.
 assert.equal(vertex.slice(vertex.indexOf('vec3 tangent=')),source.slice(source.indexOf('vec3 tangent=')).replace(/float organic=[^;]+/,'float organic=surfaceRecord.w'));
 assert.ok(fragment.includes('outPoint=vec4(0);outNormal=vec4(0)'));
 assert.ok(fragment.includes('if(amount<.002){return;}'));
 assert.ok(!fragment.includes('gl_Position='));
 assert.ok(!fragment.includes('gl_InstanceID'));
 assert.ok(fragment.includes('point+=normal*(land?(.04+.2*amount):.025)/uScale'));
 assert.throws(()=>splitFoamGeometry('void main(){}'),/contract changed/);
 const lit=splitFoamGeometry(source,{lighting:true});
 assert.ok(lit.fragment.includes('light=light*trans+scatter;'));
 assert.ok(lit.fragment.includes('outNormal=vec4(light,0)'));
 assert.ok(lit.vertex.includes('vLight=surfaceRecord.xyz;'));
 assert.ok(lit.vertex.includes('normal=normalize(vec3(-clamp(gx'));
 assert.ok(!lit.vertex.slice(lit.vertex.indexOf('void main')).includes('soluteExtinction'));
 sea.dispose();
});

test('local changes invalidate all cubic support, but moisture and camera changes do not rebuild',()=>{
 const n=65,data=new Float32Array(n*n*4),journal=new TerrainTileJournal(),first=journal.update(data,n,1);
 assert.equal(first.length,81);assert.equal(journal.update(data,n,1).length,0);
 data[7]=.6;assert.equal(journal.update(data,n,2).length,0);
 data[(32*n+32)*4]=1;const dirty=journal.update(data,n,3);assert.equal(dirty.length,4);
 for(let z=30;z<=33;z++)for(let x=30;x<=33;x++)assert.ok(dirty.some(([a,b,w,h])=>x>=a&&x<a+w&&z>=b&&z<b+h));
 assert.equal(journal.update(data,n,3).length,0);
 const reset=data.slice();assert.equal(journal.update(reset,n,3).length,81);
});

test('repeated edits retain fixed cache storage and restore the original surface',()=>{
 const n=31,data=new Float32Array(n*n*4),journal=new TerrainTileJournal();journal.update(data,n,0);const buffer=journal.heights;
 for(let i=1;i<=5000;i++){data[16*n*4+16*4]=i%2;journal.update(data,n,i);assert.equal(journal.heights,buffer);}
 assert.equal(journal.heights[16*n+16],0);assert.equal(journal.heights.length,n*n);
});

test('shader transformation leaves parcels, cuts and the historical shader untouched',()=>{
 const modified=cacheTerrainShader(LAB_GEOMETRY_GLSL);assert.ok(modified.includes('referenceSandHeight'));assert.ok(modified.includes('uTerrainPolynomial?cachedTerrain'));
 assert.ok(!LAB_GEOMETRY_GLSL.includes('uTerrainPolynomial'));
 for(const name of ['sandParcelDistance','sandDistance','bodyDistance']){
  const body=s=>s.slice(s.indexOf('float '+name),s.indexOf('\n',s.indexOf('float '+name)));
  assert.equal(body(modified),body(LAB_GEOMETRY_GLSL));
 }
});
