import * as THREE from 'three';
import {MAX_PARCELS,TILE_METRES} from './ocean.js';
import {medium,interfaceOptics} from './water-optics.js';

const NEIGHBORS=12,ROWS=3+NEIGHBORS/4;
// Each parcel supplies an anisotropic Gaussian. Overlapping kernels and the bulk
// surface share one density threshold. Only pixels inside a support box trace it.
export class LiquidParcels{
 constructor(scene,shared,wave,lighting){
  this.data=new Float32Array(MAX_PARCELS*ROWS*4);
  this.texture=new THREE.DataTexture(this.data,MAX_PARCELS,ROWS,THREE.RGBAFormat,THREE.FloatType);
  const uniforms={...shared,parcels:{value:this.texture}};
  const geometry=new THREE.BoxGeometry(2,2,2);
  this.ids=new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARCELS*9),1);
  geometry.setAttribute('parcelId',this.ids);
  this.offsets=new THREE.InstancedBufferAttribute(new Float32Array(2*MAX_PARCELS*9),2);
  geometry.setAttribute('tileOffset',this.offsets);
  this.mesh=new THREE.InstancedMesh(geometry,new THREE.ShaderMaterial({defines:{PARCEL_OPTICS:1},uniforms,side:THREE.BackSide,
   vertexShader:`attribute float parcelId;attribute vec2 tileOffset;flat varying vec2 tile;flat varying int id;flat varying vec3 center,extent;varying vec3 world;
   void main(){tile=tileOffset;id=int(parcelId);center=instanceMatrix[3].xyz;extent=vec3(instanceMatrix[0].x,instanceMatrix[1].y,instanceMatrix[2].z);
    world=center+extent*position;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,
   fragmentShader:wave+lighting+medium+interfaceOptics+`
   uniform highp sampler2D parcels;flat varying int id;flat varying vec2 tile;flat varying vec3 center,extent;varying vec3 world;
   vec4 row(int i,int y){return texelFetch(parcels,ivec2(i,y),0);}
   // Restrict each world-space Gaussian to this ray once. Subsequent density
   // evaluations are scalar quadratics and never fetch the volume again.
   vec3 profiles[${NEIGHBORS}];
   float density(float t,int count){
    float sum=0.;for(int i=0;i<${NEIGHBORS};i++){if(i>=count)break;
     vec3 g=profiles[i];float d=t-g.x;sum+=g.z*exp(-2.*g.y*d*d);
    }return sum;
   }
   void main(){
    vec3 ray=normalize(world-cameraPosition),safeRay=mix(vec3(.0000001),ray,greaterThan(abs(ray),vec3(.0000001)));
    vec3 a=(center-extent-cameraPosition)/safeRay,b=(center+extent-cameraPosition)/safeRay;
    vec3 nearT=min(a,b);float start=max(0.,max(nearT.x,max(nearT.y,nearT.z))),end=length(world-cameraPosition)-start;
    vec4 info=row(id,2);float lod=info.z>.5?1.-smoothstep(25.,56.,length(center.xz-cameraPosition.xz)):1.;
    if(lod<.01)discard;
    vec3 entry=cameraPosition+start*ray;int count=int(info.y);
    float first=end,last=0.,solid=end,iso=.13533528;
    for(int k=0;k<${NEIGHBORS};k++){if(k>=count)break;
     int i=int(row(id,3+k/4)[k%4]);vec4 ball=row(i,0),axis=row(i,1);
     vec3 d=entry-ball.xyz-vec3(tile.x,0.,tile.y);
     float invRadius=1./(ball.w*ball.w),f=1./(axis.w*axis.w)-axis.w;
     vec3 rd=(ray*axis.w+axis.xyz*(dot(ray,axis.xyz)*f))*invRadius;
     float A=dot(ray,rd),peak=-dot(d,rd)/A;vec3 q=d+peak*ray;
     float qmin=max(0.,(dot(q,q)*axis.w+(dot(q,axis.xyz)*dot(q,axis.xyz))*f)*invRadius);
     profiles[k]=vec3(peak,A,lod*exp(-2.*qmin));
     float span=sqrt(max(0.,3.8-qmin)/A);
     if(qmin<3.8){first=min(first,peak-span);last=max(last,peak+span);}
     if(qmin<1.)solid=min(solid,peak-sqrt((1.-qmin)/A));
    }
    first=max(0.,first);last=min(end,last);if(last<=first)discard;
    float level=elevation(center.xz);vec2 slope=waterSlope(center.xz);
    vec3 seaN=vec3(-slope.x,1.,-slope.y);
    float gap=entry.y-level-dot(slope,entry.xz-center.xz),rate=dot(seaN,ray);
    float previous=first,t=first;bool hit=false;
    float stop=min(last,max(first,solid))+.0001;
    for(int step=0;step<=10;step++){
     t=mix(first,stop,float(step)*.1);
     float bulk=iso*exp(clamp(-22.*(gap+t*rate),-18.,4.));
     if(density(t,count)+bulk>=iso){hit=true;break;}previous=t;
    }
    if(!hit)discard;
    for(int step=0;step<4;step++){
     float m=.5*(previous+t),bulk=iso*exp(clamp(-22.*(gap+m*rate),-18.,4.));
     if(density(m,count)+bulk>=iso)t=m;else previous=m;
    }
    vec3 p=entry+t*ray,gradient=vec3(0.);float weight=0.,radius=0.,foam=0.;
    for(int k=0;k<${NEIGHBORS};k++){if(k>=count)break;
     int i=int(row(id,3+k/4)[k%4]);vec4 ball=row(i,0),axis=row(i,1);
     vec3 d=p-ball.xyz-vec3(tile.x,0.,tile.y),g=profiles[k];float w=g.z*exp(-2.*g.y*((t-g.x)*(t-g.x)));
     gradient+=4.*w*(d*axis.w+axis.xyz*dot(d,axis.xyz)*(1./(axis.w*axis.w)-axis.w))/(ball.w*ball.w);
     weight+=w;radius+=w*ball.w;foam+=w*row(i,2).x;
    }
    if(weight<.005)discard;
    float bulk=iso*exp(clamp(-22.*(gap+t*rate),-18.,4.));
    vec3 n=normalize(gradient+22.*bulk*seaN);
    float cover=smoothstep(.005,iso,weight);
    vec3 radiance=opticalSurface(p,n,mix(-1.,2.*radius/weight,smoothstep(.005,.12,weight)),foam/weight*cover);
    vec4 clip=projectionMatrix*viewMatrix*vec4(p,1.);gl_FragDepth=.5+.5*clip.z/clip.w;
    gl_FragColor=vec4(radiance,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`}),MAX_PARCELS*9);
  this.mesh.name='Studio connected water parcels';this.mesh.count=0;this.mesh.frustumCulled=false;
  this.mesh.renderOrder=1;scene.add(this.mesh);this.matrix=new THREE.Matrix4();
  this.near=[];this.bounds=new Float32Array(MAX_PARCELS*3);
 }
 update(sea,camera){
  const drops=sea.drops,data=this.data;
  let instances=0;
  for(let i=0;i<drops.length;i++){
   const d=drops[i],v=Math.hypot(d.vx,d.vy,d.vz),stretch=d.crest?1.85:d.held?1.15:1+Math.min(1.05,v*.16);
   const axis=d.crest?[d.tangentX,0,d.tangentZ]:v>.001?[d.vx/v,d.vy/v,d.vz/v]:[0,1,0];
   data.set([d.x,d.y,d.z,d.r],4*i);data.set([...axis,stretch],4*(MAX_PARCELS+i));
   for(let k=0;k<3;k++)this.bounds[i*3+k]=1.85*d.r*Math.sqrt(1/stretch+axis[k]**2*(stretch**2-1/stretch))+.045;
  }
  const used=new Uint8Array(drops.length);
  for(let i=0;i<drops.length;i++){
   if(used[i])continue;
   const d=drops[i],near=this.near;near.length=0;near.push(i);used[i]=1;
   const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
   // Connected handfuls and sheets normally fit in a single raster box.
   for(let k=0;k<near.length;k++){
    const j=near[k],at=4*j,r=3*j;
    for(let axis=0;axis<3;axis++){lo[axis]=Math.min(lo[axis],data[at+axis]-this.bounds[r+axis]);hi[axis]=Math.max(hi[axis],data[at+axis]+this.bounds[r+axis]);}
    if(near.length>=NEIGHBORS)continue;
    for(let m=i+1;m<drops.length&&near.length<NEIGHBORS;m++){
     if(used[m]||!!drops[m].periodic!==!!d.periodic)continue;
     const connected=[0,1,2].every(axis=>Math.abs(data[4*m+axis]-data[at+axis])<this.bounds[3*m+axis]+this.bounds[r+axis]);
     if(connected){used[m]=1;near.push(m);}
    }
   }
   const center=lo.map((a,k)=>(a+hi[k])*.5),extent=lo.map((a,k)=>(hi[k]-a)*.5);
   for(const j of near)data.set([drops[j].foam||0,near.length,d.periodic?1:0,0],4*(2*MAX_PARCELS+j));
   for(let k=0;k<near.length;k++)data[4*((3+(k>>2))*MAX_PARCELS+i)+(k%4)]=near[k];
   const repeat=d.periodic?1:0;
   const tileX=d.periodic?Math.round((camera.position.x-center[0])/TILE_METRES):0;
   const tileZ=d.periodic?Math.round((camera.position.z-center[2])/TILE_METRES):0;
   for(let tz=-repeat;tz<=repeat;tz++)for(let tx=-repeat;tx<=repeat;tx++){
    const dx=(tileX+tx)*TILE_METRES,dz=(tileZ+tz)*TILE_METRES,x=center[0]+dx,z=center[2]+dz;
    if(d.periodic&&Math.hypot(x-camera.position.x,z-camera.position.z)>57)continue;
    this.matrix.makeScale(...extent).setPosition(x,center[1],z);this.mesh.setMatrixAt(instances,this.matrix);
    this.offsets.setXY(instances,dx,dz);this.ids.setX(instances++,i);
   }
  }
  this.mesh.count=instances;
  if(instances){this.texture.needsUpdate=this.mesh.instanceMatrix.needsUpdate=this.ids.needsUpdate=this.offsets.needsUpdate=true;}
 }
 dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();this.mesh.dispose();this.texture.dispose();}
}
