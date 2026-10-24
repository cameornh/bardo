import * as THREE from 'three';
// Display-only water contact. A bounded world-space height image is shared by
// every falling Gaussian; it does not depend on the camera or add solver mass.
export const RAIN_CONTACT_SECONDS=.65;
export function rainContact(age,scale){
 const t=Math.max(0,Math.min(1,age/RAIN_CONTACT_SECONDS));
 const fade=Math.max(0,Math.min(1,(t-.5)/.5));
 return {offset:-.12/scale*Math.sin(2*Math.PI*t)*Math.sin(Math.PI*t),opacity:1-fade*fade*(3-2*fade)};
}
export const RAIN_CONTACT_GLSL=`
vec2 rainContact(float age,float scale){float t=clamp(age/.65,0.,1.);return vec2(-.12/scale*sin(6.283185307*t)*sin(3.141592654*t),1.-smoothstep(.5,1.,t));}
`;
export function rainSurfaceHeights(lab,data,size=128){
 data.fill(-100);const dx=11/size,dz=9.8/size,s=lab.spacing,r=s*.85;
 for(let i=0;i<lab.count;i++){
  const o=i*4,p=lab.positions;if(p[o+3])continue;
  const x0=Math.max(0,Math.ceil((p[o]-r+5.5)/dx-.5)),x1=Math.min(size-1,Math.floor((p[o]+r+5.5)/dx-.5)),z0=Math.max(0,Math.ceil((p[o+2]-r+4.9)/dz-.5)),z1=Math.min(size-1,Math.floor((p[o+2]+r+4.9)/dz-.5));
  for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
   const d2=((x+.5)*dx-5.5-p[o])**2+((z+.5)*dz-4.9-p[o+2])**2;if(d2>r*r)continue;
   const at=z*size+x;data[at]=Math.max(data[at],p[o+1]+s*.32);
  }
 }
 return data;
}
export class RainSurface {
 constructor(){this.data=new Float32Array(128*128).fill(-100);this.texture=new THREE.DataTexture(this.data,128,128,THREE.RedFormat,THREE.FloatType);this.texture.needsUpdate=true;}
 update(lab){if(this.revision===lab.revision&&this.generation===lab.generation)return;rainSurfaceHeights(lab,this.data);this.texture.needsUpdate=true;this.revision=lab.revision;this.generation=lab.generation;}
 dispose(){this.texture.dispose();}
}
