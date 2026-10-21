import {WETNESS_VIEW_GLSL,wetnessColor} from './wetness-view.js';
import {buildSandBins} from './sand-bins.js';
import {packSandShapes,cutShape} from './sand-shape.js';
import {LabTransportGPU} from './transport-gpu.js';
import {transportFluid} from './water-lab-transport.js';
import {QUAD_VERTEX} from '../shaders.js';
import * as THREE from 'three';
import {LabFluidGPU} from './water-lab-gpu.js';
import {LAB_GEOMETRY_GLSL,solveDensity,normalAt,collideBoundary,WATER_CONTACT_SKIN} from './water-lab-model.js';
import {bodyDistance,makeBody} from './objects.js';
import {SandBed} from './sand.js';
import {createSandUniforms,floatTexture} from './uniforms.js';
export function verifyBeachGPU(renderer,base){
 const sand=new SandBed(),body=makeBody('glass','cup',.8,[0,.6,0]);body.tilt=.42;
 const u={...base,...createSandUniforms(),uStation:{value:6},uBodyCount:{value:1},uPlayer:{value:new THREE.Vector4(0,0,0,0)},uPlayerHeight:{value:0}};
 u.uSand.value.image.data=sand.data;u.uSand.value.needsUpdate=true;const bodies=new Float32Array(256*4);bodies.set([...body.position,body.radius,0,0,0,0]);u.uBodies={value:floatTexture(bodies,256,1)};u.uBodyExtra.value.image.data.set([1,1,1,1,body.tilt,0,0,0]);u.uBodyExtra.value.needsUpdate=true;
 const solid=p=>Math.min((p[1]-sand.height(p[0],p[2]))*.65,bodyDistance(p,body),5.5-Math.abs(p[0]),4.9-Math.abs(p[2]),9-p[1]);
 const collide=p=>collideBoundary(p,.22*WATER_CONTACT_SKIN,solid);
 const data=new Float32Array(6*5*5*4);let i=0;for(let z=0;z<5;z++)for(let y=0;y<5;y++)for(let x=0;x<6;x++){data.set([x*.19-.5,y*.19-.08,z*.19-.4,i%11===0?1:0],i*4);i++;}
 const probeData=new Float32Array(64*3*4);probeData.set(data);const probe=floatTexture(probeData,64,3),target=new THREE.WebGLRenderTarget(64,3,{type:THREE.FloatType,depthBuffer:false}),scene=new THREE.Scene(),mat=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;precision highp int;out vec4 outputValue;uniform sampler2D uProbe;${LAB_GEOMETRY_GLSL}void main(){vec3 p=texelFetch(uProbe,ivec2(gl_FragCoord.xy),0).xyz;outputValue=vec4(labSolid(p),labNormal(p));}`,uniforms:{...u,uProbe:{value:probe}},depthTest:false,depthWrite:false}),geometry=new THREE.PlaneGeometry(2,2);scene.add(new THREE.Mesh(geometry,mat));const old=renderer.getRenderTarget();renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());const values=new Float32Array(probeData.length);renderer.readRenderTargetPixels(target,0,0,64,3,values);renderer.setRenderTarget(old);let sdfError=0,worst=null;for(let j=0;j<i;j++){const p=Array.from(data.subarray(j*4,j*4+3)),cpu=solid(p),error=Math.abs(cpu-values[j*4]);if(error>sdfError){sdfError=error;worst={p,cpu,gpu:values[j*4],normal:normalAt(p,solid),gpuNormal:Array.from(values.subarray(j*4+1,j*4+4))};}}for(const resource of [probe,target,mat,geometry])resource.dispose();
 const gpu=new LabFluidGPU(renderer,u),actual=gpu.solve(data,.22,collide,3,solid),expected=solveDensity(data,gpu.neighbors,.22,3,collide,solid).positions;let error=0;for(let j=0;j<data.length;j++)error=Math.max(error,Math.abs(actual[j]-expected[j]));const transport=new LabTransportGPU(renderer),chem=new Float32Array(data.length),velocity=new Float32Array(data.length);for(let j=0;j<chem.length;j++)chem[j]=(j%17)/23;const transported=transport.solve(data,actual,velocity,chem,gpu.neighbors,.22,10,1/30,data,gpu),reference=transportFluid(data,actual,velocity,chem,gpu.neighbors,.22,10,1/30,data);let transportError=0,countsEqual=true;for(const key of ['velocities','chem','metrics','activity','breakup'])for(let j=0;j<reference[key].length;j++)transportError=Math.max(transportError,Math.abs(reference[key][j]-transported[key][j]));for(let j=0;j<reference.counts.length;j++)countsEqual&&=reference.counts[j]===transported.counts[j];transport.dispose();
 const result={backend:gpu.cpu?'CPU fallback':'GPU',particles:i,transportError,countsEqual,sdfError,worst,sandAndTiltedCupMaxError:error,pass:!gpu.cpu&&Number.isFinite(error)&&error<.002&&sdfError<.00001&&transportError<.003&&countsEqual};gpu.dispose();for(const key of ['uSand','uBodyExtra','uSandParcels','uSandBins','uBodies'])u[key].value.dispose();return result;
}

export function verifySandMaterialGPU(renderer,base,n=65){
 const sand=new SandBed(n),u={...base,...createSandUniforms(),uStation:{value:6}};
 u.uSand.value.image.width=u.uSand.value.image.height=n;
 sand.wet.fill(.15);sand.update();sand.parcels=[{position:[0,1.2,0],mass:.045,packing:.62,wet:.92},{position:[.3,1.15,0],mass:.026,packing:.56,wet:0,aspect:.32},{position:[0,-.12,0],mass:.024,packing:.62,wet:.95,memory:.95}];
 sand.deposit(sand.parcels[2],sand.parcels[2].mass);
 u.uSand.value.image.data=sand.data;u.uSand.value.needsUpdate=true;u.uSandCount.value=sand.parcels.length;u.uSandMin.value.set(-1,-1,-1);u.uSandMax.value.set(1,2,1);
 const nibble=cutShape(sand.parcels[1],[.49,1.17,0],.1);if(nibble){nibble.position[2]+=.3;sand.parcels.push(nibble);u.uSandCount.value=sand.parcels.length;}sand.parcels.push(...[.15,.26].map(x=>({position:[x,.04,0],mass:.001,packing:.56,aspect:.75,wet:0,surfaceBlend:.13})));sand.parcels.push({position:[.2,1.2,0],mass:.02,packing:.56,wet:0,windborne:true});u.uSandCount.value=sand.parcels.length;const packed=packSandShapes(sand.parcels);u.uSandParcels.value.image.data.set(packed.data);
 // Hardware-linear B-spline height reads have finite interpolation precision;
 // allow 0.03% moisture error after the narrow material blend on a sloping bed.
 // Exercise real bin boundaries, flattened blend support, and a cell with
 // more than the old 16-entry capacity, rather than putting all shapes in all bins.
 for(let i=0;i<20;i++)sand.parcels.push({position:[2+(i%5)*.08,.07,1+Math.floor(i/5)*.08],mass:.0005,packing:.56,wet:0,aspect:.32,surfaceBlend:.18});
 sand.parcels.push({position:[-.1,.08,2],mass:4*Math.PI/3*.5**3*.32*.56,packing:.56,wet:0,aspect:.32,surfaceBlend:.18});
 const packedGeometry=packSandShapes(sand.parcels),rows=Math.max(1,Math.ceil(packedGeometry.data.length/1024)),shapeData=new Float32Array(rows*1024);shapeData.set(packedGeometry.data);u.uSandParcels.value.dispose();u.uSandParcels.value=floatTexture(shapeData,256,rows);u.uSandCount.value=sand.parcels.length;
 const bins=buildSandBins(sand.parcels);u.uSandBins.value.dispose();u.uSandBins.value=floatTexture(bins.data,256,bins.data.length/1024);u.uSandMin.value.fromArray(bins.min);u.uSandMax.value.fromArray(bins.max);
 const data=new Float32Array(128*4);for(let i=0;i<128;i++){
  const p=i<32?[-.4+(i%16)/15*.95,i<16?1.2:.04,0]:i<80?[1.65+(i-32)/47*1.3,.07,1.1]:[-1.3+(i-80)/47*2.5,sand.height(-1.3+(i-80)/47*2.5,2)+.015,2];data.set([...p,0],i*4);
 }
 const probe=floatTexture(data,128,1),target=new THREE.WebGLRenderTarget(128,1,{type:THREE.FloatType,depthBuffer:false}),scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;precision highp int;out vec4 outputValue;uniform sampler2D uProbe;${LAB_GEOMETRY_GLSL}${WETNESS_VIEW_GLSL}void main(){vec3 p=texelFetch(uProbe,ivec2(gl_FragCoord.xy),0).xyz;outputValue=vec4(sandWetness(p),sandDistance(p),sandHeight(p.xz),1);}`,uniforms:{...u,uProbe:{value:probe}},depthTest:false,depthWrite:false});scene.add(new THREE.Mesh(geometry,material));const old=renderer.getRenderTarget(),actual=new Float32Array(data.length);
 try{renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());renderer.readRenderTargetPixels(target,0,0,128,1,actual);let error=0,distanceError=0,heightError=0;for(let i=0;i<128;i++){const p=Array.from(data.subarray(i*4,i*4+3));error=Math.max(error,Math.abs(actual[i*4]-sand.materialAt(p)));distanceError=Math.max(distanceError,Math.abs(actual[i*4+1]-sand.distance(p)));heightError=Math.max(heightError,Math.abs(actual[i*4+2]-sand.height(p[0],p[2])));}material.fragmentShader=material.fragmentShader.replace('vec4(sandWetness(p),sandDistance(p),sandHeight(p.xz),1)','vec4(sandWetnessColor(sandWetness(p)),1)');material.needsUpdate=true;renderer.render(scene,new THREE.Camera());renderer.readRenderTargetPixels(target,0,0,128,1,actual);
 let wetnessColorError=0;for(let i=0;i<128;i++){const p=Array.from(data.subarray(i*4,i*4+3)),color=wetnessColor(sand.materialAt(p));for(let k=0;k<3;k++)wetnessColorError=Math.max(wetnessColorError,Math.abs(color[k]-actual[i*4+k]));}
 return {sandSize:n,samples:128,maxWetnessColorError:wetnessColorError,maxCellCount:bins.maxCount,maxMoistureError:error,maxDistanceError:distanceError,maxHeightInterpolationError:heightError,moistureTolerance:.0003,distanceTolerance:.0001,pass:error<.0003&&distanceError<.0001&&wetnessColorError<.0006};}
 finally{renderer.setRenderTarget(old);for(const x of [probe,target,geometry,material])x.dispose();for(const key of ['uSand','uBodyExtra','uSandParcels','uSandBins'])u[key].value.dispose();}
}
