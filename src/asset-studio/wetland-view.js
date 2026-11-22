import * as T from 'three';
import {wetlandGLSL} from './wetland.js';
import {WetlandReeds} from './wetland-reeds.js';
import {sandReliefShader} from './ground-surface.js';

// Each axis is a nested world-space lattice. Adjacent strips share their
// actual vertices, including at changes of spacing and across the origin.
function groundGrid(){
 const axis=[{offset:0,step:.375}];
 let offset=0;
 for(let level=0;level<10;level++){
  const step=.375*2**level;
  for(let i=0;i<12;i++){offset+=step;axis.push({offset,step});}
 }
 axis.push({offset:12000,step:192});
 axis.unshift(...axis.slice(1).reverse().map(v=>({...v,offset:-v.offset})));
 const positions=[],steps=[],indices=[],n=axis.length;
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  positions.push(axis[i].offset,0,axis[j].offset);steps.push(axis[i].step,axis[j].step);
  const k=j*n+i;
  if(i+1<n&&j+1<n)indices.push(k,k+n,k+1,k+1,k+n,k+n+1);
 }
 const g=new T.BufferGeometry();g.setIndex(indices);
 g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 g.setAttribute('gridStep',new T.Float32BufferAttribute(steps,2));return g;
}
const habitat=`
 varying float standCover;
 float colony(vec2 p,float h){
  float moist=smoothstep(-.68,-.10,h)*(1.-smoothstep(.18,.85,h));
  return moist*(.08+.92*smoothstep(.20,.75,landNoise((p+survey)/9.)));
 }`;
const lattice=`attribute vec2 gridStep;
 vec2 landPoint(){return floor(cameraPosition.xz/gridStep+.5)*gridStep+position.xz;}`;
export class WetlandView{
 constructor(view,lighting){
  this.view=view;this.geometry=groundGrid();
  this.uniforms={...view.groundMaterial.uniforms,survey:{value:new T.Vector2()},windClock:{value:0},flow:{value:new T.Vector2()},waterTint:{value:new T.Color()},rings:{value:Array.from({length:8},()=>new T.Vector4())}};
  const bed=view.groundMaterial;
  this.terrain=new T.ShaderMaterial({uniforms:this.uniforms,
   vertexShader:wetlandGLSL+habitat+lattice+'varying vec2 duneSlope;\n'+bed.vertexShader
    .replace('worldPosition=(modelMatrix*vec4(position,1.)).xyz;', 'vec2 p0=landPoint();float h=landHeight(p0);worldPosition=vec3(p0.x,h,p0.y);duneSlope=vec2(h-landHeight(p0+vec2(.3,0)),h-landHeight(p0+vec2(0,.3)))/.3;standCover=colony(p0,h);'),
   fragmentShader:'varying vec2 duneSlope; varying float standCover;\n'+bed.fragmentShader.replace('vec3 prior=n;',`
    n=normalize(vec3(duneSlope.x+n.x/n.y,1.,duneSlope.y+n.z/n.y));
    float damp=1.-smoothstep(-.12,.84,p.y);
    base*=mix(vec3(1.),vec3(.51,.53,.44),damp);
    float remote=smoothstep(24.,66.,length(cameraPosition-p));
    base=mix(base,vec3(.11,.145,.055),standCover*(.17+.62*remote));
    vec3 prior=n;`)});
  this.waterMaterial=new T.ShaderMaterial({uniforms:this.uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,forceSinglePass:true,
   vertexShader:'#define SAND_VERTEX\n'+sandReliefShader+wetlandGLSL+habitat+lattice+`
    varying vec3 point;varying float depth;void main(){vec2 p=landPoint();point=vec3(p.x,0.,p.y);
    float h=landHeight(p),nearby=1.-smoothstep(25.,65.,length(cameraPosition.xz-p));
    if(nearby>0.)h+=nearby*(sandHeight(p)+localSurface(p).x);
    depth=-h;standCover=colony(p,h);
    gl_Position=projectionMatrix*viewMatrix*vec4(point,1.);}`,
   fragmentShader:lighting+`
    uniform vec2 flow;uniform float windClock;uniform vec3 waterTint;
    varying vec3 point;varying float depth,standCover;uniform vec4 rings[8];
    void main(){
     if(depth<=0.)discard;
     float speed=length(flow);vec2 d=speed>.001?flow/speed:vec2(1.,0.);
     vec2 q=vec2(dot(point.xz,d),dot(point.xz,vec2(-d.y,d.x)));
     float t=windClock*sqrt(speed+.01)*.6;
     float detail=1.-smoothstep(.05,.7,length(fwidth(q)));
     vec2 wave=vec2(cos(q.x*3.2+.67*sin(q.y*1.14)-t)+.38*cos(q.x*7.1+q.y*2.8-1.7*t),
      .41*cos(q.y*2.3-q.x*4.5+t));
     vec2 slope=(wave.x*d+wave.y*vec2(-d.y,d.x))*detail*min(.07,.005*speed);
     for(int i=0;i<8;i++){vec2 delta=point.xz-rings[i].xy;float age=windClock-rings[i].z;
      if(rings[i].w>0.&&age>=0.&&age<3.){float r=length(delta),crest=r-age*1.45;
       slope+=detail*rings[i].w*delta/max(.06,r)*sin(crest*18.)*exp(-6.*crest*crest-age*1.2);}}
     vec3 n=normalize(vec3(slope.x,1.,slope.y)),v=normalize(cameraPosition-point);
     float fres=.025+.975*pow(1.-abs(dot(n,v)),5.);
     vec3 sky=env(reflect(-v,n),0.);
     float glint=pow(max(0.,dot(reflect(normalize(vec3(.6,-1.,-.5)),n),v)),120.);
     float trans=exp(-max(.03,depth)*1.4/max(.30,abs(v.y)));
     float opacity=1.-(1.-fres)*trans;
     vec3 deep=mix(waterTint*vec3(.24,.46,.33),vec3(.08,.15,.065),standCover*.30);
     vec3 water=(deep*(1.-trans)*(1.-fres)+sky*fres)/max(.001,opacity)+vec3(.9,.83,.65)*glint;
     gl_FragColor=vec4(mix(water,vec3(.38,.45,.48),1.-exp(-.004*length(cameraPosition-point))),opacity);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
    }`});
  this.waterScene=new T.Scene();this.water=new T.Mesh(this.geometry,this.waterMaterial);this.water.frustumCulled=false;this.waterScene.add(this.water);
  this.reeds=new WetlandReeds(view,lighting);
 }
 configure(land,library){
  this.land=land;this.uniforms.survey.value.set(land.x,land.z);
  this.uniforms.waterTint.value.set(library.materials.find(m=>m.id==='water')?.color??'#668d92');
  const clumps=library.families.find(f=>f.id==='example-rushes')?.members??[];
  const assets=clumps.map(m=>library.assets.find(a=>a.id===m.assetId)).filter(a=>a?.parts.every(p=>p.stamps[0]?.shape==='capsule'&&p.marks));
  const placed=library.world.instances.filter(i=>assets.some(a=>a.id===i.assetId));
  this.reeds.configure(assets,library.materials,placed.map(i=>i.transform.position));
 }
 update(view,wind,time){
  const u=this.uniforms,heading=wind.heading*Math.PI/180;u.flow.value.set(Math.cos(heading),Math.sin(heading)).multiplyScalar(wind.speed);
  u.windClock.value=time;this.reeds.update(this.land,view.camera,wind,time);
 }
 splash(x,z,time,force){
  const rings=this.uniforms.rings.value;this.nextRing=((this.nextRing??-1)+1)%rings.length;
  rings[this.nextRing].set(x,z,time,Math.min(.38,.08+Math.sqrt(force)*.0015));
 }
 drawWater(renderer,camera){renderer.autoClear=false;renderer.render(this.waterScene,camera);}
 dispose(){this.geometry.dispose();this.terrain.dispose();this.waterMaterial.dispose();this.reeds.dispose();}
}
