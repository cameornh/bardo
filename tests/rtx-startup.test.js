import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {installRTXGraphicsGuard} from '../src/rtx-sand-lab/graphics.js';
import {explicitTextureLevel,installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {RTXPressureGPU} from '../src/rtx-sand-lab/pressure.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';

const scene=m=>({traverse(fn){fn({material:m});}});
function fixture(){
 let lost=false,draws=0;const reports=[],gl={isContextLost:()=>lost,getShaderSource:()=>'',getProgramInfoLog:()=>'',getShaderInfoLog:()=>'',getShaderParameter:()=>false,getProgramParameter:()=>false,getError:()=>0};
 const r={debug:{},getContext:()=>gl,domElement:{addEventListener(){}},render(s){draws++;s.traverse(o=>{if(o.material?.fail)r.debug.onShaderError(gl,{}, {},{});});}};
 const guard=installRTXGraphicsGuard(r,e=>reports.push(e));
 return {r,guard,reports,get draws(){return draws;},lose(){lost=true;}};
}
test('rejected optional compute program does not blank a healthy renderer or resubmit',()=>{
 const f=fixture(),bad={name:'bounded-pressure-density',userData:{rtxOptionalCompute:true},fail:true};
 assert.throws(()=>f.r.render(scene(bad)),/bounded-pressure-density/);
 assert.equal(f.guard.failed,false);assert.equal(f.reports.length,0);
 assert.throws(()=>f.r.render(scene(bad)),/bounded-pressure-density/);assert.equal(f.draws,1);
 f.r.render(scene({name:'beach'}));assert.equal(f.draws,2);
});
test('loss of context stops optional compute and later scene draws',()=>{
 const f=fixture();f.guard.stage('GPU validation');f.lose();
 assert.throws(()=>f.r.render(scene({userData:{rtxOptionalCompute:true}})),/GPU validation/);
 assert.equal(f.guard.failed,true);assert.equal(f.draws,0);assert.equal(f.reports.length,1);
 assert.throws(()=>f.r.render(scene({})),/GPU validation/);assert.equal(f.reports.length,1);
});
test('render errors identify the pass even when shader source and driver logs vanish',()=>{
 const f=fixture(),m=new THREE.ShaderMaterial();m.fail=true;
 const s=new THREE.Scene();s.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),m));
 f.guard.label({backgroundScene:s},'render');
 assert.throws(()=>f.r.render(s),/render-backgroundScene-0/);assert.equal(f.guard.failed,true);
 assert.match(f.reports[0].message,/fragmentCompiled/);m.dispose();s.children[0].geometry.dispose();
});
test('explicit level zero preserves nested coordinates and ignores comments, bias and other textures',()=>{
 const s='// texture(a,uv)\n/* texture(a,uv) */\ntexture(a,mix(vec2(1,2),texture(b,uv).xy,.5))+texture(b,uv)+texture(a,uv,1.)+textureLod(a,uv,0.)';
 assert.equal(explicitTextureLevel(s,['a']),s.replace('texture(a,mix(vec2(1,2),texture(b,uv).xy,.5))','textureLod(a,mix(vec2(1,2),texture(b,uv).xy,.5),0.0)'));
 const nested=explicitTextureLevel('texture(a,texture(a,uv).xy)',['a']);
 assert.equal(nested,'textureLod(a,textureLod(a,uv,0.0).xy,0.0)');assert.equal(explicitTextureLevel(nested,['a']),nested);
});
test('compatibility transform composes with specialization and keeps mipmapped textures unchanged',()=>{
 const image=new THREE.DataTexture(new Float32Array(4),1,1),m=new THREE.ShaderMaterial({uniforms:{uImage:{value:image},uStation:{value:6}},fragmentShader:'uniform int uStation; void main(){vec4 p=texture(uImage,vec2(0));}',vertexShader:'void main(){}'}),compiled=[];
 const r={render(){const s={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader};m.onBeforeCompile(s,r);compiled.push([s.fragmentShader,m.customProgramCacheKey()]);}};
 installRTXShaderCompatibility(r);installProgramSpecialization(r,()=>true,{warmObjects:false});r.render(scene(m));
 assert.match(compiled[0][0],/textureLod/);assert.match(compiled[0][0],/const int uStation=6/);
 m.uniforms.uStation.value=3;r.render(scene(m));assert.match(compiled[1][0],/const int uStation=3/);assert.notEqual(compiled[0][1],compiled[1][1]);
 image.generateMipmaps=true;r.render(scene(m));assert.match(compiled[2][0],/texture\(/);assert.notEqual(compiled[1][1],compiled[2][1]);m.dispose();image.dispose();
});
test('RTX pressure is split into small geometry-free neighbor programs',()=>{
 const r={extensions:{has:()=>true},capabilities:{maxTextureSize:16384}},gpu=new RTXPressureGPU(r);
 for(const m of [gpu.densityMaterial,gpu.correctionMaterial]){assert.ok(m.fragmentShader.length<3000);assert.doesNotMatch(m.fragmentShader,/labSolid|labCollide|sandDistance/);assert.equal(m.userData.rtxOptionalCompute,true);}
 gpu.validated=true;gpu.geometryValidated=true;let calls=0,fallbacks=0;
 gpu.run=()=>{calls++;throw Error('compiler rejected the pressure pass');};gpu.cpuSolve=p=>{fallbacks++;return p.slice();};
 const p=new Float32Array([0,0,0,0]),n=new Float32Array(128).fill(-1);
 assert.deepEqual(gpu.solve(p,n,.1),p);assert.equal(calls,1);assert.equal(fallbacks,1);
 assert.deepEqual(gpu.solve(p,n,.1),p);assert.equal(calls,1);assert.equal(fallbacks,2);gpu.dispose();
});
