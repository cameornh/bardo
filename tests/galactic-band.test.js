import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GALACTIC_AXIS,GALACTIC_SIDE,GALACTIC_POLE,straightGalacticBand} from '../src/sand-lab/galactic-band.js';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const direction=(longitude,latitude=0)=>GALACTIC_AXIS.map((v,i)=>(v*Math.cos(longitude)+GALACTIC_SIDE[i]*Math.sin(longitude))*Math.cos(latitude)+GALACTIC_POLE[i]*Math.sin(latitude));
test('galactic band and dark lane stay centered on one great circle at every longitude',()=>{
 for(const v of [GALACTIC_AXIS,GALACTIC_SIDE,GALACTIC_POLE])assert.ok(Math.abs(Math.hypot(...v)-1)<1e-12);
 assert.ok(Math.abs(dot(GALACTIC_AXIS,GALACTIC_POLE))<1e-12);
 for(let longitude=-Math.PI;longitude<=Math.PI;longitude+=.07){
  assert.ok(Math.abs(dot(direction(longitude),GALACTIC_POLE))<1e-12);
  for(const latitude of [.01,.03,.07,.15,.25]){
   const above=straightGalacticBand(direction(longitude,latitude)),below=straightGalacticBand(direction(longitude,-latitude));
   assert.ok(Math.abs(above-below)<1e-12);assert.ok(above>0);
  }
 }
});
test('the galactic centre line projects to a straight image line without sinusoidal displacement',()=>{
 for(const orientation of [[0,1,0],[.3,.8,.5],[-.7,.2,.6]]){
  const camera=new THREE.PerspectiveCamera(70,1.6,.01,10);camera.up.set(...orientation);camera.lookAt(new THREE.Vector3(...direction(.8)));camera.updateMatrixWorld();
  const points=[-.45,0,.45].map(offset=>new THREE.Vector3(...direction(.8+offset)).project(camera));
  const [a,b,c]=points,area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  assert.ok(Math.abs(area)<1e-12);
 }
});
