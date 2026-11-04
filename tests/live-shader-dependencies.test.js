import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {shaderUniforms,liveProgramConstants} from '../src/rtx-sand-lab/shader-dependencies.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';

function fixture(fixed=true){
 const keys=new Set(),sources=new Set(),rows=[];
 const r={extensions:{has:()=>false},getContext:()=>({getExtension:()=>null}),initRenderTarget(){},copyTextureToTexture(){},
  compile(s){const materials=new Set();s.traverse(o=>{if(!o.material)return;const m=o.material,shader={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader};m.onBeforeCompile(shader,r);keys.add(m.customProgramCacheKey());sources.add(JSON.stringify(shader));rows.push({...shader,key:m.customProgramCacheKey()});materials.add(m);});return materials;},render(s){return this.compile(s);}};
 const lab=new LiveSandLab(r),field={renderer:r,camera:new THREE.PerspectiveCamera(),uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}},draw=new LiveWaterRenderer(field,lab);
 installRTXShaderCompatibility(r,{declaredOnly:fixed});installProgramSpecialization(r,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:fixed?liveProgramConstants:null});
 return {r,draw,keys,sources,rows};
}
function transitions(f){
 for(let i=0;i<32;i++){
  const u=f.draw.u;u.uSandCount.value=i&1;u.uSandMax.value.y=i&1;u.uBodyCount.value=(i>>1)&1;u.uFieldSkipping.value=!!(i&4);u.uFieldLinear.value=!!(i&8);u.uReuseSurfaceLight.value=!!(i&16);
  f.r.render(f.draw.mergeScene);
 }
}
test('live merge has one program across simulation state changes; snapshot behavior stays unchanged',()=>{
 const old=fixture(false);transitions(old);assert.equal(old.keys.size,32);assert.equal(old.sources.size,1);
 const live=fixture();transitions(live);assert.equal(live.keys.size,1);assert.equal(live.sources.size,1);
 assert.deepEqual([...live.sources],[...old.sources]);
});
test('allocating unrelated simulation textures cannot recompile merge or image copy',()=>{
 const f=fixture(),u=f.draw.u;
 u.uSimulationScratch={value:null};f.r.compile(f.draw.mergeScene);f.r.render(f.draw.copyScene);
 const before=f.keys.size;
 u.uSimulationScratch.value=new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType);
 // Actual scene fields are also shared by these simple display materials.
 for(const name of ['uLabField','uMediumTransport','uRainObjects','uSandParcels'])u[name].value=u.uSimulationScratch.value;
 f.r.render(f.draw.mergeScene);f.r.render(f.draw.copyScene);assert.equal(f.keys.size,before);
 u.uSimulationScratch.value.dispose();
});
test('declared constants and actual sampler filtering still select distinct programs',()=>{
 const f=fixture(),m=new THREE.ShaderMaterial({uniforms:{uStation:{value:6},uImage:{value:null}},vertexShader:'void main(){}',fragmentShader:'uniform int uStation;uniform sampler2D uImage;void main(){vec4 c=texture(uImage,vec2(0));}'}),s=new THREE.Scene();s.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),m));
 f.r.compile(s);const first=f.rows.at(-1);assert.match(first.fragmentShader,/const int uStation=6/);assert.match(first.fragmentShader,/textureLod/);
 m.uniforms.uImage.value=new THREE.DataTexture(new Float32Array(4),1,1);f.r.render(s);assert.equal(first.key,f.rows.at(-1).key);
 m.uniforms.uStation.value=3;f.r.render(s);assert.notEqual(first.key,f.rows.at(-1).key);assert.match(f.rows.at(-1).fragmentShader,/const int uStation=3/);
 const prior=f.rows.at(-1);m.uniforms.uImage.value.generateMipmaps=true;f.r.render(s);assert.notEqual(prior.key,f.rows.at(-1).key);assert.match(f.rows.at(-1).fragmentShader,/texture\(/);
 m.uniforms.uImage.value.dispose();m.dispose();s.children[0].geometry.dispose();
});
test('uniform dependency parsing excludes comments and refreshes when shader sources change',()=>{
 const m={vertexShader:'uniform highp vec3 a[16], b; // uniform bool ignored;\n',fragmentShader:'/* uniform bool notHere; */ uniform int c,d;void main(){}'};
 assert.deepEqual([...shaderUniforms(m)].sort(),['a','b','c','d']);assert.equal(shaderUniforms(m),shaderUniforms(m));
 m.fragmentShader='uniform bool added;';assert.equal(shaderUniforms(m).has('added'),true);assert.equal(shaderUniforms(m).has('c'),false);
});
