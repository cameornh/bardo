import * as THREE from 'three';
import {clamp} from './material-air.js';

const capacity=1536;
const vertex=`
attribute vec3 center,sigma,majorAxis;attribute vec4 tint;
uniform vec2 viewport;
varying vec2 offset;varying vec4 color;varying float glow;
void main(){
 vec4 c=viewMatrix*vec4(center,1.);float z=max(.03,-c.z);
 vec3 dx=vec3(1.,0.,c.x/z)*(projectionMatrix[0][0]*viewport.x*.5/z);
 vec3 dy=vec3(0.,1.,c.y/z)*(projectionMatrix[1][1]*viewport.y*.5/z);
 vec3 x=dx*mat3(viewMatrix),y=dy*mat3(viewMatrix);
 float r2=sigma.x*sigma.x,stretch=sigma.y*sigma.y-r2;
 float u1=dot(x,majorAxis),u2=dot(y,majorAxis);
 float a=r2*dot(x,x)+stretch*u1*u1+.25,b=r2*dot(x,y)+stretch*u1*u2,d=r2*dot(y,y)+stretch*u2*u2+.25;
 float m=(a+d)*.5,e=length(vec2((a-d)*.5,b)),angle=.5*atan(2.*b,a-d+1e-12);
 vec2 u=vec2(cos(angle),sin(angle)),v=vec2(-u.y,u.x);
 offset=position.xy*2.6;vec2 px=u*sqrt(max(.2,m+e))*offset.x+v*sqrt(max(.2,m-e))*offset.y;
 vec4 clip=projectionMatrix*c;clip.xy+=px*2./viewport*clip.w;
 gl_Position=c.z<-.03?clip:vec4(2.,2.,2.,1.);color=tint;glow=sigma.z;
}`;
const hot=[1,.11,.018],cold=[.02,.18,1],neutral=[.1,.55,.27],gold=[1,.68,.08],mist=[.78,.87,.94];
const mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);

export class MaterialFieldView {
 constructor(uniforms,lighting){
  this.scene=new THREE.Scene();
  const g=new THREE.InstancedBufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));g.setIndex([0,1,2,0,2,3]);
  for(const [name,size] of [['center',3],['sigma',3],['majorAxis',3],['tint',4]])g.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size).setUsage(THREE.DynamicDrawUsage));
  const mat=new THREE.ShaderMaterial({uniforms:{viewport:uniforms.viewport,environment:uniforms.environment,sunDirection:uniforms.sunDirection,sunColor:uniforms.sunColor,debug:{value:0}},vertexShader:vertex,
   fragmentShader:lighting+`
   varying vec4 color;varying vec2 offset;varying float glow;uniform float debug;
   void main(){float r=dot(offset,offset);if(r>6.7)discard;
    vec3 n=normalize(vec3(offset.x*.32,1.,offset.y*.32));
    vec3 lit=mix(.5+env(n,1.),vec3(1.),max(debug,glow));
    float density=exp(-.5*r);
    vec3 edge=mix(vec3(1.),vec3(1.,.32,.10),glow*(1.-density));
    gl_FragColor=vec4(color.rgb*lit*edge,color.a*density);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,transparent:true,depthWrite:false});
  this.mesh=new THREE.Mesh(g,mat);this.mesh.frustumCulled=false;this.scene.add(this.mesh);
 }
 draw(renderer,camera,world,mode='natural'){
  if(!world)return;
  const g=this.mesh.geometry,m=this.mesh.material;
  const fieldChanged=world!==this.world||mode!==this.mode||world.version!==this.version;
  const visiblePlume=mode==='natural'||mode==='reaction';
  if(fieldChanged||(visiblePlume&&world.plume.version!==this.plumeVersion)){
   const debug=mode!=='natural';m.depthTest=!debug;m.uniforms.debug.value=Number(debug);
   let n=fieldChanged?0:this.fieldCount;
   const put=(x,y,z,r,h,col,alpha,ax=0,ay=1,az=0,glow=0)=>{
    if(alpha<.006||n>=capacity)return;
    g.attributes.center.setXYZ(n,x,y,z);g.attributes.sigma.setXYZ(n,r,h,glow);
    g.attributes.majorAxis.setXYZ(n,ax,ay,az);
    g.attributes.tint.setXYZW(n,...col,Math.min(.94,alpha));n++;
   };
   if(fieldChanged){
    const fromTemperature=t=>t<293?mix(neutral,cold,clamp((293-t)/40,0,1)):mix(neutral,hot,clamp((t-293)/220,0,1));
    if(debug)for(const s of world.nodes){
     const p=s.position,r=clamp(s.radius*.47,.04,.55);
     if(mode==='temperature')put(p.x,p.y,p.z,r,r,fromTemperature(s.t),.8);
     else if(mode==='fusion')put(p.x,p.y,p.z,r,r,mix([.51,.34,.19],[.08,.77,1],s.core?.melt??s.melt),.83);
     else if(mode==='charge'){
      const active=s.electrode!=null||Math.abs(s.volts)>.02||s.watts>.01;
      if(active||s.material.electricalConductivity>.01)
       put(p.x,p.y,p.z,r*.70,r*.70,mix(cold,gold,clamp(s.volts/48,0,1)),s.electrode!=null?.78:active?.42:.16);
     }
     else if(mode==='moisture'){
      const wet=clamp((s.material.waterContent*s.melt+s.water/(s.area*.12)),0,1);
      put(p.x,p.y,p.z,r*.75,r*.75,[.04,.52,1],.56*wet);
     }
    }
    for(const c of world.air.cells.values()){
     const air=world.air.read(c),x=c.x+.5,y=c.y+.5,z=c.z+.5;
     if(mode==='temperature'){const a=clamp(Math.abs(air.temperature-world.air.temperature)/160,0,.35);put(x,y,z,.46,.46,fromTemperature(air.temperature),a);}
     if(mode==='moisture')put(x,y,z,.42,.42,[.09,.57,1],Math.min(.20,Math.abs(air.humidity-world.air.humidity)*.36));
     if(mode==='natural'||mode==='reaction'){
      const fog=air.humidity>1?air.water*(1-1/air.humidity)+c.vapour:c.vapour;
      put(x,y,z,.42,.48,mist,1-Math.exp(-35*fog));
     }
    }
    this.fieldCount=n;
   }
   if(visiblePlume){
    // Overlap oriented ellipses along two successive segments of each path.
    // A bright narrow foot and a cooling, tapering tip read as one tongue.
    for(const kind of [1,0])for(const p of world.plume.particles){
     if(p.kind!==kind)continue;
     const u=p.age/p.life;
     const alpha=Math.min(1,u*12)*(1-u)**(kind?1.25:.68);
     let x=p.x,y=p.y,z=p.z;
     for(let k=0;k<2;k++){
      const end=k?p.tail:p.prev;
      const dx=x-end[0],dy=y-end[1],dz=z-end[2],d=Math.hypot(dx,dy,dz);
      if(d>.00001){
       const radius=p.size*(kind?.30+.98*u:(.31-.21*u)*(k?1:.69));
       const h=Math.min(p.size*(kind?3:2.4),radius*1.15+d*.52);
       const color=kind?mix([.21,.15,.105],[.29,.30,.32],Math.min(1,u*2)):
        mix([2.3,.87,.12],[1.35,.061,.005],Math.min(1,.12+u*.90+(k?0:.10)));
       put((x+end[0])*.5,(y+end[1])*.5,(z+end[2])*.5,radius,h,color,
        alpha*(kind?.19:.74),dx/d,dy/d,dz/d,1-kind);
      }
      [x,y,z]=end;
     }
    }
   }
   const first=fieldChanged?0:this.fieldCount;
   for(const a of ['center','sigma','majorAxis','tint']){
    const attr=g.attributes[a];attr.clearUpdateRanges();
    if(n>first){attr.addUpdateRange(first*attr.itemSize,(n-first)*attr.itemSize);attr.needsUpdate=true;}
   }
   this.plumeVersion=world.plume.version;
   g.instanceCount=n;this.world=world;this.version=world.version;this.mode=mode;
  }
  if(g.instanceCount){renderer.autoClear=false;renderer.render(this.scene,camera);}
 }
 dispose(){this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
