import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {exposureStatistics,exposureTarget,adaptExposure} from '../src/water-lab-exposure.js';
import {waterExit} from '../src/water-lab-interface.js';
import {installOrbitPivot} from '../src/lab-orbit-pivot.js';
const stats=y=>exposureStatistics(new Float32Array([y,y,y,1]));
test('normal luminance has an exactly neutral exposure and extreme darkness is bounded',()=>{
 for(const y of [.04,.1,.3,1,2,10,30])assert.equal(exposureTarget(stats(y)),1);
 assert.ok(exposureTarget(stats(.001))>10);assert.equal(exposureTarget(stats(0)),12);
});
test('a tiny visible sun drives adaptation, an occluding object removes that signal',()=>{
 const pixels=new Float32Array(128*128*4).fill(.3),normal=exposureTarget(exposureStatistics(pixels));
 for(let i=0;i<4;i++)pixels.set([7000,6800,6000,1],(99+i)*4);
 assert.equal(normal,1);assert.ok(exposureTarget(exposureStatistics(pixels))<=.081);
 pixels.fill(.3);assert.equal(exposureTarget(exposureStatistics(pixels)),normal);
});
test('adaptation is continuous, frame-rate independent and never overshoots',()=>{
 for(const [initial,target] of [[1,.08],[.08,1],[1,12]]){
  let a=initial,b=initial;for(let i=0;i<15;i++)a=adaptExposure(a,target,1/15);for(let i=0;i<60;i++)b=adaptExposure(b,target,1/60);
  assert.ok(Math.abs(a-b)<1e-12);assert.ok(a>=Math.min(initial,target)&&a<=Math.max(initial,target));assert.ok(Math.abs(adaptExposure(initial,target,0)-initial)<1e-12);
 }
});
test('water exit obeys Snell, conserves unit direction and switches to internal reflection at critical angle',()=>{
 for(let degrees=0;degrees<90;degrees+=.25){const angle=degrees*Math.PI/180,ray=[Math.sin(angle),Math.cos(angle),0],r=waterExit(ray,[0,1,0]);
  assert.ok(r.fresnel>=0&&r.fresnel<=1);assert.ok(Math.abs(Math.hypot(...r.reflected)-1)<1e-12);
  if(degrees<Math.asin(1/1.333)*180/Math.PI){assert.ok(r.transmitted);assert.ok(Math.abs(r.transmitted[0]-1.333*Math.sin(angle))<1e-12);assert.ok(Math.abs(Math.hypot(...r.transmitted)-1)<1e-12);}else{assert.equal(r.transmitted,null);assert.equal(r.fresnel,1);}
 }
 assert.ok(Math.abs(waterExit([0,1,0],[0,1,0]).fresnel-((1.333-1)/(1.333+1))**2)<1e-12);
});
test('pivot slider changes rotation distance without moving the camera or its view; original distance is maximum',()=>{
 const camera=new THREE.PerspectiveCamera();camera.position.set(4,3,5);camera.lookAt(0,1,0);const listeners=[];
 const controls={target:new THREE.Vector3(0,1,0),enableDamping:true,update(){camera.lookAt(this.target);for(const fn of listeners)fn();},addEventListener:(_,fn)=>listeners.push(fn)};
 const input={},output={},position=camera.position.clone(),quaternion=camera.quaternion.clone();let enabled=true;
 const p=installOrbitPivot(camera,controls,input,output,{scale:()=>10,enabled:()=>enabled});p.reset();const maximum=Number(input.max);input.value='.5';input.oninput();
 assert.ok(camera.position.distanceTo(position)<1e-12);assert.ok(camera.quaternion.angleTo(quaternion)<1e-7);assert.ok(Math.abs(camera.position.distanceTo(controls.target)-.5)<1e-12);assert.equal(Number(input.max),maximum);assert.equal(output.textContent,'5.00 m');
 enabled=false;p.refresh();assert.equal(input.disabled,true);input.value='.2';input.oninput();assert.ok(Math.abs(camera.position.distanceTo(controls.target)-.5)<1e-12);
});
