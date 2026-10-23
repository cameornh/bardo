import test from 'node:test';
import assert from 'node:assert/strict';
import {gaussianIntersectsView} from '../src/sand-lab/gaussian-bounds.js';

test('distant offscreen Gaussians cannot expand into the image near the camera plane',()=>{
 for(const z of [-.001,-.02,-.035,-.05,-.1,-1,0,.1])for(const [x,y] of [[4,0],[-4,0],[0,4],[0,-4]]){
  assert.equal(gaussianIntersectsView([x,y,z],.08,[1,1.6],[640,400]),false);
 }
 assert.equal(gaussianIntersectsView([0,0,1],.08,[1,1.6],[640,400]),false);
});
test('visible finite support and reconstruction pixels survive conservative view culling',()=>{
 for(const resolution of [[320,200],[1920,1080]])for(const fov of [35,65,100])for(const radius of [.001,.02,.2,1])for(const z of [.015,.1,1,10]){
  const fy=1/Math.tan(fov*Math.PI/360),focal=[fy*resolution[1]/resolution[0],fy];
  // Construct a point in the expanded view and move the center by at most r.
  // Any sphere containing this point must survive, even if its center is out.
  for(let i=0;i<80;i++){
   const x=(i%5-2)*.5,y=(Math.floor(i/5)%5-2)*.5,edge=focal.map((f,k)=>(1+3.9/resolution[k])/f),point=[x*z*edge[0],y*z*edge[1],-z];
   const a=i*2.3999632297,h=1-2*(i+.5)/80,s=Math.sqrt(1-h*h),center=point.map((v,k)=>v+radius*.999*[Math.cos(a)*s,h,Math.sin(a)*s][k]);
   assert.equal(gaussianIntersectsView(center,radius,focal,resolution),true,JSON.stringify({center,radius,fov,resolution}));
  }
 }
});
