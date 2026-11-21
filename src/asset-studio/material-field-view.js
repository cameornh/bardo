import * as THREE from 'three';
import {clamp} from './material-air.js';

const capacity=1536;
const vertex=`
attribute vec3 center,sigma;attribute vec4 tint;
uniform vec2 viewport;
varying vec2 offset;varying vec4 color;
void main(){
 vec4 c=viewMatrix*vec4(center,1.);float z=max(.03,-c.z);
 vec3 dx=vec3(1.,0.,c.x/z)*(projectionMatrix[0][0]*viewport.x*.5/z);
 vec3 dy=vec3(0.,1.,c.y/z)*(projectionMatrix[1][1]*viewport.y*.5/z);
 vec3 x=(dx*mat3(viewMatrix))*sigma,y=(dy*mat3(viewMatrix))*sigma;
 float a=dot(x,x)+.25,b=dot(x,y),d=dot(y,y)+.25;
 float m=(a+d)*.5,e=length(vec2((a-d)*.5,b)),angle=.5*atan(2.*b,a-d+1e-12);
 vec2 u=vec2(cos(angle),sin(angle)),v=vec2(-u.y,u.x);
 offset=position.xy*2.6;vec2 px=u*sqrt(max(.2,m+e))*offset.x+v*sqrt(max(.2,m-e))*offset.y;
 vec4 clip=projectionMatrix*c;clip.xy+=px*2./viewport*clip.w;
 gl_Position=c.z<-.03?clip:vec4(2.,2.,2.,1.);color=tint;
}`;
const hot=[1,.11,.018],cold=[.02,.18,1],neutral=[.1,.55,.27],gold=[1,.68,.08],smoke=[.10,.115,.12],mist=[.78,.87,.94];
const mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);

export class MaterialFieldView {
 constructor(uniforms,lighting){
  this.scene=new THREE.Scene();
  const g=new THREE.InstancedBufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));g.setIndex([0,1,2,0,2,3]);
  for(const [name,size] of [['center',3],['sigma',3],['tint',4]])g.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size).setUsage(THREE.DynamicDrawUsage));
  const mat=new THREE.ShaderMaterial({uniforms:{viewport:uniforms.viewport,environment:uniforms.environment,debug:{value:0}},vertexShader:vertex,
   fragmentShader:lighting+`
   varying vec4 color;varying vec2 offset;uniform float debug;
   void main(){float r=dot(offset,offset);if(r>6.7)discard;
    vec3 n=normalize(vec3(offset.x*.32,1.,offset.y*.32));
    vec3 lit=mix(.5+env(n,1.),vec3(1.),debug);
    gl_FragColor=vec4(color.rgb*lit,color.a*exp(-.5*r));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,transparent:true,depthWrite:false});
  this.mesh=new THREE.Mesh(g,mat);this.mesh.frustumCulled=false;this.scene.add(this.mesh);
 }
 draw(renderer,camera,world,mode='natural'){
  if(!world)return;
  const g=this.mesh.geometry,m=this.mesh.material;
  if(world!==this.world||mode!==this.mode||world.version!==this.version){
   const debug=mode!=='natural';m.depthTest=!debug;m.uniforms.debug.value=Number(debug);
   let n=0;
   const put=(x,y,z,r,h,col,alpha)=>{
    if(alpha<.008||n>=capacity)return;
    g.attributes.center.setXYZ(n,x,y,z);g.attributes.sigma.setXYZ(n,r,h,r);
    g.attributes.tint.setXYZW(n,...col,Math.min(.94,alpha));n++;
   };
   const fromTemperature=t=>t<293?mix(neutral,cold,clamp((293-t)/40,0,1)):mix(neutral,hot,clamp((t-293)/220,0,1));
   for(const s of world.nodes){
    const p=s.position,r=clamp(s.radius*.47,.04,.55);
    if(s.i!=null&&mode==='natural'&&s.finish>.015)put(p.x,p.y+.006,p.z,r,.008,[.07,.055,.043],s.finish);
    if(mode==='temperature')put(p.x,p.y,p.z,r,r,fromTemperature(s.t),.8);
    else if(mode==='charge')put(p.x,p.y,p.z,r,r,mix(cold,gold,clamp(s.volts/48,0,1)),s.electrode==null?.66:.94);
    else if(mode==='moisture'){
     const wet=clamp((s.material.waterContent*s.melt+s.water/(s.area*.12)),0,1);
     put(p.x,p.y,p.z,r,r,mix([.43,.19,.06],[.04,.52,1],wet),.74);
    }else if(s.burning>0){
     const intensity=clamp(s.burning/(s.area*.045),.03,1),top=p.y+(s.record||s.group?r:0);
     put(p.x,top+r*.7,p.z,r*.7,r*(1+intensity),hot,.84);
     put(p.x,top+r*.24,p.z,r*.44,r*.64,gold,.88);
    }
   }
   for(const c of world.air.cells.values()){
    const air=world.air.read(c),x=c.x+.5,y=c.y+.5,z=c.z+.5;
    if(mode==='temperature'){const a=clamp(Math.abs(air.temperature-world.air.temperature)/160,0,.35);put(x,y,z,.46,.46,fromTemperature(air.temperature),a);}
    if(mode==='moisture')put(x,y,z,.42,.42,[.09,.57,1],Math.min(.45,Math.abs(air.humidity-world.air.humidity)*.7));
    if(mode==='natural'||mode==='reaction'){
     put(x,y,z,.4,.52,smoke,1-Math.exp(-100*c.smoke));
     const fog=air.humidity>1?air.water*(1-1/air.humidity)+c.vapour:c.vapour;
     put(x,y,z,.42,.48,mist,1-Math.exp(-35*fog));
    }
   }
   for(const a of ['center','sigma','tint']){const attr=g.attributes[a];attr.clearUpdateRanges();attr.addUpdateRange(0,n*attr.itemSize);attr.needsUpdate=true;}
   g.instanceCount=n;this.world=world;this.version=world.version;this.mode=mode;
  }
  if(g.instanceCount){renderer.autoClear=false;renderer.render(this.scene,camera);}
 }
 dispose(){this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
