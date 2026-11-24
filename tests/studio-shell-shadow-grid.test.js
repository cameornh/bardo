import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector2,Vector3,PerspectiveCamera,OrthographicCamera} from 'three';
import {groundGrid,CoastalShadowGrid} from '../src/asset-studio/wetland-view.js';

test('shadow rings preserve every coastal triangle, winding and vertex',()=>{
 const original=groundGrid(),grid=new CoastalShadowGrid(original,null);
 const expected=original.index.array,actual=grid.mesh.geometry.index.array;
 assert.equal(actual.length,expected.length);
 assert.equal(grid.mesh.geometry.getAttribute('position'),original.getAttribute('position'));
 const side=Math.sqrt(original.getAttribute('position').count),seen=new Uint8Array((side-1)**2);
 for(let i=0;i<actual.length;i+=6){
  const k=actual[i],cell=k-Math.floor(k/side);
  assert.deepEqual(actual.subarray(i,i+6),expected.subarray(cell*6,cell*6+6));
  assert.equal(seen[cell]++,0);
 }
 assert.ok(seen.every(n=>n===1));
 grid.dispose();original.dispose();
});

test('bounded shadow draws enclose all projector corners after coastal grid snapping',()=>{
 const original=groundGrid(),grid=new CoastalShadowGrid(original,null);
 const cameras=[new OrthographicCamera(-7.5,7.5,7.5,-7.5,.5,105),new PerspectiveCamera(90,1,.025,37)];
 const eye=new Vector2(-21.38,204.91),corner=new Vector3();
 const pos=original.getAttribute('position'),steps=original.getAttribute('gridStep');
 const mid=(Math.sqrt(pos.count)-1)/2;
 const snapped=(eye,idx)=>{
  const step=steps.getX(idx),u=eye/step,f=u-Math.floor(u);
  return (Math.floor(u)+f*f*(3-2*f))*step+pos.getX(idx);
 };
 for(const camera of cameras){
  camera.position.set(eye.x-12,22,eye.y+15);camera.lookAt(eye.x,1,eye.y);camera.updateMatrixWorld();
  grid.fit(camera,eye);
  const count=grid.mesh.geometry.drawRange.count;
  assert.ok(count<original.index.count*.5);
  const rings=Math.sqrt(count/24);
  for(let z=-1;z<=1;z+=2)for(let y=-1;y<=1;y+=2)for(let x=-1;x<=1;x+=2){
   corner.set(x,y,z).unproject(camera);
   for(const [value,center] of [[corner.x,eye.x],[corner.z,eye.y]]){
    assert.ok(value>=snapped(center,mid-rings) && value<=snapped(center,mid+rings));
   }
  }
 }
 grid.dispose();original.dispose();
});
