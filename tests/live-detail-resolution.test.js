import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector2} from 'three';
import {installDetailResolution} from '../src/rtx-sand-lab/detail-resolution.js';
test('soft Gaussian resolution changes only its own passes and can be disabled',()=>{
 const full={value:new Vector2(641,361)},u={uResolution:full},draw={lab:{optimizations:{}},uniforms:u,material:{uniforms:{...u}},opticalMaterial:{uniforms:{...u}},reconstruct:{uniforms:{...u}},render(){return this.uniforms.uResolution.value.toArray();}};
 installDetailResolution(draw);assert.deepEqual(draw.render(),[321,181]);assert.deepEqual(full.value.toArray(),[641,361]);
 assert.notEqual(draw.uniforms,u);assert.equal(draw.material.uniforms.uResolution,draw.reconstruct.uniforms.uResolution);
 draw.lab.optimizations.fineParticleResolution=false;assert.deepEqual(draw.render(),[641,361]);
 full.value.set(1,1);draw.lab.optimizations.fineParticleResolution=true;assert.deepEqual(draw.render(),[1,1]);
});
