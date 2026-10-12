import * as THREE from 'three';
import { MATERIALS } from './world.js';
import { sampleSurface, sampleGround } from './sampling.js';
import { buildGaussianHierarchy, FLOATS_PER_SPLAT, TEXELS_PER_SPLAT } from './gaussians.js';
import { materialSH } from './sh.js';
import { MotionDetail, projectedMotion, allocateBudget, sameViewMatrix } from './lod.js';
import { GrassRenderer } from './grass-renderer.js';
import { FluidRenderer } from './fluid-renderer.js';
import { SoftRenderer } from './soft-renderer.js';
import { OpticsRenderer } from './optics-renderer.js';
import { LightTransportRenderer } from './light-transport-renderer.js';
import { TerrainProxies, TERRAIN_FADE_START, TERRAIN_FADE_END } from './terrain-proxy.js';
import { GAUSSIAN_VERTEX, GAUSSIAN_FRAGMENT, GAUSSIAN_DEPTH_FRAGMENT, TERRAIN_DEPTH_FRAGMENT, COPY_TERRAIN_DEPTH_FRAGMENT, QUAD_VERTEX, BACKGROUND_FRAGMENT, GLASS_FRAGMENT, TONEMAP_FRAGMENT, REFERENCE_FRAGMENT } from './shaders.js';

const MAX_DRAW=64000;
class GaussianPool {
  constructor(){this.capacity=0;this.free=[];this.grow();}
  grow(){
    const old=this.capacity;this.capacity=Math.max(32768,old*2);
    const data=new Float32Array(this.capacity*FLOATS_PER_SPLAT);if(this.data)data.set(this.data);
    this.data=data;this.texture?.dispose();
    this.width=TEXELS_PER_SPLAT*64;
    this.texture=new THREE.DataTexture(data,this.width,this.capacity/64,THREE.RGBAFormat,THREE.FloatType);
    this.texture.minFilter=this.texture.magFilter=THREE.NearestFilter;this.texture.generateMipmaps=false;this.dirtyRows=new Set();this.fullUpload=true;
    for(let i=this.capacity-1;i>=old;i--)this.free.push(i);this.dirty=true;
  }
  add(packed){
    const count=packed.length/FLOATS_PER_SPLAT;while(this.free.length<count)this.grow();
    const slots=new Uint32Array(count);
    for(let i=0;i<count;i++){const slot=this.free.pop();slots[i]=slot;this.data.set(packed.subarray(i*FLOATS_PER_SPLAT,(i+1)*FLOATS_PER_SPLAT),slot*FLOATS_PER_SPLAT);this.mark(slot);}
    this.dirty=true;return slots;
  }
  remove(slots){for(const slot of slots)this.free.push(slot);}
  mark(slot){this.dirty=true;this.dirtyRows.add(Math.floor(slot/64));}
  flush(){
    if(!this.dirty)return;
    this.texture.clearUpdateRanges();
    if(!this.fullUpload)for(const row of this.dirtyRows)this.texture.addUpdateRange(row*this.width*4,this.width*4);
    this.texture.needsUpdate=true;this.fullUpload=false;this.dirty=false;this.dirtyRows.clear();
  }
}

export class FieldRenderer {
  constructor(canvas,world,camera){
    this.world=world;this.camera=camera;this.error=null;this.scale=.85;this.batches=[];
    this.motion=new MotionDetail();this.minPixelSigma=2;this.budget=16000;this.pixelTarget=2;this.previousCamera=null;
    this.visibleSplats=0;this.byMaterial=new Uint32Array(7);this.pool=new GaussianPool();
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
    this.renderer.debug.onShaderError=(gl,program,vs,fs)=>{this.error=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vs),gl.getShaderInfoLog(fs)].join('\n');console.error(this.error);};
    if(!this.renderer.extensions.has('EXT_color_buffer_float'))throw new Error('WebGL 2 floating-point render targets are required.');
    this.renderer.setPixelRatio(1);this.renderer.autoClear=false;
    this.resolution=new THREE.Vector2(1,1);
    this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
    this.glassTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});
    this.terrainDepthTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});this.depthCamera=new THREE.Matrix4();this.depthRevision=-1;this.depthValid=false;
    this.empty=new THREE.DataTexture(new Uint8Array(4),1,1);this.empty.needsUpdate=true;
    this.uniforms={
      uSplatData:{value:this.pool.texture},uDataWidth:{value:this.pool.width},uResolution:{value:this.resolution},uSHDegree:{value:3},uLayer:{value:0},uProjection:{value:camera.projectionMatrix},uViewMatrix:{value:camera.matrixWorldInverse},uProbeRotation:{value:new THREE.Matrix3()},
      uInverseProjection:{value:camera.projectionMatrixInverse},uCameraMatrix:{value:camera.matrixWorld},uEye:{value:camera.position},
      uLight:{value:new THREE.Vector3(-3,6,4)},uTime:{value:0},uView:{value:0},uReflections:{value:true},uShowChunks:{value:false},
      uTerrainMode:{value:world.terrainEnabled},uShowcase:{value:world.showcaseEnabled},uTerrainEditCount:{value:0},uTerrainEdits:{value:Array.from({length:64},()=>new THREE.Vector4())},uTerrainEditModes:{value:new Float32Array(64)},
      uCenters:{value:world.objects.map(o=>new THREE.Vector3(...o.center))},uEdits:{value:Array.from({length:12},()=>new THREE.Vector4())},uEditCount:{value:0},
      uColors:{value:MATERIALS.map(m=>new THREE.Vector3(...m.color))},uMaterials:{value:MATERIALS.map(m=>new THREE.Vector4(m.roughness,m.metal,m.transmission,m.scatter))},
      uPositionTexture:{value:this.empty},uNormalTexture:{value:this.empty},uColorTexture:{value:this.empty},uMaterialTexture:{value:this.empty},
      uGlassTexture:{value:this.glassTarget.texture},
      uTerrainDepthTexture:{value:this.terrainDepthTarget.texture},uTerrainFade:{value:new THREE.Vector2(TERRAIN_FADE_START,TERRAIN_FADE_END)},
    };
    const quad=fragmentShader=>{
      const scene=new THREE.Scene();const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader,uniforms:this.uniforms,depthTest:false,depthWrite:false});
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));return scene;
    };
    this.quadCamera=new THREE.Camera();this.background=quad(BACKGROUND_FRAGMENT);this.reference=quad(REFERENCE_FRAGMENT);this.glass=quad(GLASS_FRAGMENT);
    this.terrainDepth=quad(TERRAIN_DEPTH_FRAGMENT);
    this.copyTerrainDepth=quad(COPY_TERRAIN_DEPTH_FRAGMENT);Object.assign(this.copyTerrainDepth.children[0].material,{depthTest:true,depthWrite:true,colorWrite:false});
    this.output=quad(TONEMAP_FRAGMENT);this.output.children[0].material.uniforms={uImage:{value:this.target.texture}};
    this.geometry=new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));this.geometry.setIndex([0,1,2,0,2,3]);
    this.drawSlots=new Float32Array(MAX_DRAW);this.drawWeights=new Float32Array(MAX_DRAW);
    this.slotAttribute=new THREE.InstancedBufferAttribute(this.drawSlots,1).setUsage(THREE.DynamicDrawUsage);
    this.weightAttribute=new THREE.InstancedBufferAttribute(this.drawWeights,1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aSlot',this.slotAttribute);this.geometry.setAttribute('aWeight',this.weightAttribute);
    this.gaussianMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:GAUSSIAN_VERTEX,fragmentShader:GAUSSIAN_FRAGMENT,uniforms:this.uniforms,
      depthTest:false,depthWrite:false,transparent:true,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});
    this.depthMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:GAUSSIAN_VERTEX,fragmentShader:GAUSSIAN_DEPTH_FRAGMENT,uniforms:this.uniforms,depthTest:true,depthWrite:true,colorWrite:false,side:THREE.DoubleSide});
    this.scene=new THREE.Scene();const mesh=new THREE.Mesh(this.geometry,this.gaussianMaterial);mesh.frustumCulled=false;this.scene.add(mesh);
    this.slots=new Uint32Array(MAX_DRAW);this.weights=new Float32Array(MAX_DRAW);this.depths=new Float32Array(MAX_DRAW);this.order=new Uint32Array(MAX_DRAW);
    this.frustum=new THREE.Frustum();this.matrix=new THREE.Matrix4();this.point=new THREE.Vector3();this.sphere=new THREE.Sphere();
    this.grass=new GrassRenderer(this.uniforms);
    this.soft=new SoftRenderer(this.uniforms);this.optics=new OpticsRenderer(this.uniforms);this.lightTest=new LightTransportRenderer(this.uniforms);
    this.water=new FluidRenderer(this.uniforms);this.fluid=null;this.grains=new FluidRenderer(this.uniforms,{granular:true});this.granular=null;this.proxies=new TerrainProxies(this);this.terrainReady=new Map();
    this.addBatch(sampleGround(),6,0);
    for(let id=0;id<world.objects.length;id++)this.rebuild(id);
  }
  addBatch(samples,id,level=0,options={}){
    const data=samples.hierarchy||buildGaussianHierarchy(samples,MATERIALS[id]);
    const packed=data.packed;
    if(data.materialKey!==JSON.stringify(MATERIALS[id]))for(let i=0;i<packed.length;i+=FLOATS_PER_SPLAT){
      const sh=materialSH(Array.from(packed.subarray(i+4,i+7)),MATERIALS[id]);for(let k=0;k<16;k++)packed.set(sh.subarray(k*3,k*3+3),i+20+k*4);
    }
    for(let i=0;i<packed.length;i+=FLOATS_PER_SPLAT){packed[i+3]=id;packed[i+11]=(options.terrain?1:0)+(options.edited?2:0)+(options.proxy?4:0);if(options.bounds)packed.set(options.bounds,i+16);}
    const slots=this.pool.add(packed);
    const bounds=new THREE.Box3(new THREE.Vector3(...data.min),new THREE.Vector3(...data.max));
    const batch={id,slots,levels:data.levels,count:data.count,sphere:bounds.getBoundingSphere(new THREE.Sphere()),byteLength:packed.byteLength,...options};
    batch.blend=options.terrain&&!options.proxy?0:1;this.batches.push(batch);if(options.terrain&&!options.proxy)this.grass.addChunk(options.key,samples.grass);return batch;
  }
  removeBatch(batch){if(batch.terrain&&!batch.proxy)this.grass.removeChunk(batch.key);this.pool.remove(batch.slots);const index=this.batches.indexOf(batch);if(index>=0)this.batches.splice(index,1);}
  rebuild(id){
    const start=performance.now();for(const b of [...this.batches])if(b.id===id)this.removeBatch(b);
    this.addBatch(sampleSurface(this.world,id,id===5?.075:.10),id);
    this.lastRebuildMs=performance.now()-start;
  }
  resize(width,height){
    const ratio=Math.min(Math.min(window.devicePixelRatio,1.5)*this.scale,Math.sqrt(1400000/(width*height)));
    this.renderer.setSize(Math.round(width*ratio),Math.round(height*ratio),false);this.resolution.set(this.renderer.domElement.width,this.renderer.domElement.height);this.target.setSize(this.resolution.x,this.resolution.y);
    this.glassTarget.setSize(this.resolution.x,this.resolution.y);
    this.terrainDepthTarget.setSize(this.resolution.x,this.resolution.y);this.depthValid=false;
    this.camera.aspect=width/height;this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(43/2))*Math.max(1,1.05/this.camera.aspect)));this.camera.updateProjectionMatrix();this.previousCamera=null;
  }
  setMaterial(id){
    const m=MATERIALS[id];this.uniforms.uMaterials.value[id].set(m.roughness,m.metal,m.transmission,m.scatter);
    for(const batch of this.batches)if(batch.id===id)for(const slot of batch.slots){
      const offset=slot*FLOATS_PER_SPLAT,sh=materialSH(Array.from(this.pool.data.subarray(offset+4,offset+7)),m);
      for(let k=0;k<16;k++)this.pool.data.set(sh.subarray(k*3,k*3+3),offset+20+k*4);
      this.pool.mark(slot);
    }
    this.pool.dirty=true;
  }
  prepare(dt,adaptive,focusDistance,probe){
    const camera=this.camera,view=camera.matrixWorldInverse.elements,focal=this.resolution.y*camera.projectionMatrix.elements[5]*.5;
    const current={position:camera.position.toArray(),quaternion:camera.quaternion.toArray()};
    const speed=projectedMotion(this.previousCamera,current,dt,focal,focusDistance);this.previousCamera=current;
    const requested=this.minPixelSigma*this.motion.update(speed,dt,adaptive);
    this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    this.terrainReady.clear();
    for(const batch of this.batches)if(batch.terrain&&!batch.proxy){batch.blend=Math.min(1,batch.blend+Math.min(dt,.1)/.45);this.terrainReady.set(batch.key,batch.blend);}
    const items=[];
    for(const batch of this.batches){
      if(batch.id<5&&!this.world.showcaseEnabled)continue;
      if(batch.id===6&&!!batch.terrain!==this.world.terrainEnabled)continue;
      batch.drawBlend=batch.proxy?1-(this.terrainReady.get(batch.key)||0):batch.blend;
      if(batch.drawBlend<.0001)continue;
      this.sphere.copy(batch.sphere);if(batch.id===5)this.sphere.center.applyQuaternion(probe.rotation);if(batch.id<6)this.sphere.center.add(this.uniforms.uCenters.value[batch.id]);
      if(!this.frustum.intersectsSphere(this.sphere))continue;
      this.point.copy(this.sphere.center).applyMatrix4(camera.matrixWorldInverse);
      const depth=Math.max(1,-this.point.z-this.sphere.radius*.15);
      if(!batch.visibleSlots){batch.visibleSlots=new Uint32Array(batch.slots.length);batch.visibleDepths=new Float32Array(batch.slots.length);}
      const visibleLevels=[];let written=0;
      for(const level of batch.levels){
        const offset=written;
        for(let i=0;i<level.count;i++){
          const slot=batch.slots[level.offset+i],o=slot*FLOATS_PER_SPLAT,data=this.pool.data;
          this.point.fromArray(data,o);if(batch.id===5)this.point.applyQuaternion(probe.rotation);if(batch.id<6)this.point.add(this.uniforms.uCenters.value[batch.id]);
          const d=-(view[2]*this.point.x+view[6]*this.point.y+view[10]*this.point.z+view[14]);
          if(d<=.1)continue;
          this.sphere.center.copy(this.point);this.sphere.radius=data[o+15]*Math.sqrt(data[o+8]+data[o+12]+data[o+14]);
          if(!this.frustum.intersectsSphere(this.sphere))continue;
          batch.visibleSlots[written]=slot;batch.visibleDepths[written]=d;written++;
        }
        visibleLevels.push({offset,count:written-offset,sigma:level.sigma});
      }
      if(!written)continue;
      // A coarse Gaussian's tail can enter the view before its children do.
      // Preserve a conservative monotone cost curve for the budget search.
      const levels=visibleLevels.map(l=>({...l}));
      for(let i=levels.length-2;i>=0;i--)levels[i].count=Math.max(levels[i].count,levels[i+1].count);
      const importance=batch.id===6?(batch.edited?.7:.35):1;
      items.push({batch,levels,visibleLevels,scale:focal/depth*importance});
    }
    const budget=Math.min(MAX_DRAW,Math.max(1000,this.budget));
    const needed=allocateBudget(items,requested,budget).target;
    this.pixelTarget+=(needed-this.pixelTarget)*(1-Math.exp(-Math.min(dt,.1)/(needed>this.pixelTarget?.065:.5)));
    const allocation=allocateBudget(items,this.pixelTarget,budget);this.effectivePixelTarget=allocation.target;
    this.byMaterial.fill(0);let count=0;
    for(let b=0;b<items.length;b++){
      const {batch,visibleLevels}=items[b],choice=allocation.choices[b];
      const parts=choice.a===choice.b?[[choice.a,1]]:[[choice.a,1-choice.t],[choice.b,choice.t]];
      for(const [level,weight] of parts){
        if(weight<.0001)continue;
        const info=visibleLevels[level];
        for(let i=0;i<info.count;i++){
          const j=info.offset+i;
          if(count>=budget)throw new Error('Gaussian budget allocator exceeded its bound');
          this.slots[count]=batch.visibleSlots[j];this.weights[count]=weight*batch.drawBlend;this.depths[count]=batch.visibleDepths[j];this.order[count]=count;count++;this.byMaterial[batch.id]++;
        }
      }
    }
    const sortStart=performance.now();
    this.order.subarray(0,count).sort((a,b)=>this.depths[b]-this.depths[a]||this.slots[a]-this.slots[b]);
    for(let i=0;i<count;i++){const j=this.order[i];this.drawSlots[i]=this.slots[j];this.drawWeights[i]=this.weights[j];}
    this.sortMs=performance.now()-sortStart;this.visibleSplats=count;this.geometry.instanceCount=count;
    this.slotAttribute.clearUpdateRanges();this.slotAttribute.addUpdateRange(0,count);this.slotAttribute.needsUpdate=true;
    this.weightAttribute.clearUpdateRanges();this.weightAttribute.addUpdateRange(0,count);this.weightAttribute.needsUpdate=true;
  }
  render({lightAngle,probe,dt=1/60,adaptive=true,focusDistance=15}){
    this.uniforms.uShowcase.value=this.world.showcaseEnabled;
    this.uniforms.uLight.value.set(Math.cos(lightAngle)*5,6,Math.sin(lightAngle)*5);
    this.uniforms.uEditCount.value=this.world.edits.length;this.uniforms.uTerrainMode.value=this.world.terrainEnabled;this.uniforms.uTerrainEditCount.value=this.world.terrain.edits.length;
    this.world.terrain.edits.forEach((e,i)=>{this.uniforms.uTerrainEdits.value[i].fromArray(e);this.uniforms.uTerrainEditModes.value[i]=e[4];});
    this.world.edits.forEach((e,i)=>this.uniforms.uEdits.value[i].fromArray(e));this.world.objects.forEach((o,i)=>this.uniforms.uCenters.value[i].fromArray(o.center));
    this.uniforms.uProbeRotation.value.setFromMatrix4(this.matrix.makeRotationFromQuaternion(probe.rotation));this.camera.updateMatrixWorld();
    if(this.lightTest.enabled)return this.lightTest.render(this,{dt,adaptive,focusDistance});
    this.lightTest.count=0;
    if(this.optics.enabled)return this.optics.render(this,{lightAngle,dt,adaptive,focusDistance});
    this.optics.count=0;this.prepare(dt,adaptive,focusDistance,probe);
    this.grass.prepare(this.camera,probe,this.motion.factor,dt);
    this.water.prepare(this.fluid,this.camera,probe,this.motion.factor);
    this.grains.prepare(this.granular,this.camera,probe,this.motion.factor);
    this.soft.prepare(this.fabrics,this.fibers,this.camera,probe,this.motion.factor,dt,this.minPixelSigma);
    this.pool.flush();
    this.uniforms.uSplatData.value=this.pool.texture;
    this.renderer.setClearColor(0,0);
    if(this.uniforms.uView.value===3){this.renderer.setRenderTarget(null);this.renderer.clear();this.renderer.render(this.reference,this.quadCamera);return !this.error;}
    const depthRevision=`${this.world.terrain.revision}:${this.world.revision}:${this.world.showcaseEnabled}`;
    const exactDepth=this.world.terrainEnabled;
    if(exactDepth&&(!this.depthValid||!sameViewMatrix(this.depthCamera,this.camera.matrixWorld)||this.depthRevision!==depthRevision)){
      this.renderer.setRenderTarget(this.terrainDepthTarget);this.renderer.setClearColor(0xffffff,1);this.renderer.clear();this.renderer.render(this.terrainDepth,this.quadCamera);
      this.depthCamera.copy(this.camera.matrixWorld);this.depthRevision=depthRevision;this.depthValid=true;this.renderer.setClearColor(0,0);
    }
    this.renderer.setRenderTarget(this.glassTarget);this.renderer.clear();if(this.byMaterial[3]&&this.uniforms.uView.value===0)this.renderer.render(this.glass,this.quadCamera);
    this.renderer.setRenderTarget(this.target);this.renderer.clear();this.renderer.render(this.background,this.quadCamera);
    // Large terrain kernels straddle object depths. Treat solid ground as a
    // support layer; sorting their centers together would paint floor through
    // foreground objects. Color still uses Gaussian alpha, never opaque quads.
    this.uniforms.uLayer.value=0;this.gaussianMaterial.depthTest=false;this.gaussianMaterial.depthWrite=false;this.gaussianMaterial.uniformsNeedUpdate=true;this.renderer.render(this.scene,this.camera);
    if(exactDepth)this.renderer.render(this.copyTerrainDepth,this.quadCamera);
    else {this.scene.children[0].material=this.depthMaterial;this.depthMaterial.uniformsNeedUpdate=true;this.renderer.render(this.scene,this.camera);}
    this.scene.children[0].material=this.gaussianMaterial;this.uniforms.uLayer.value=1;this.gaussianMaterial.depthTest=true;this.gaussianMaterial.uniformsNeedUpdate=true;this.renderer.render(this.scene,this.camera);
    this.grass.render(this.renderer,this.camera);
    this.soft.render(this.renderer,this.camera);
    this.grains.render(this.renderer,this.camera,this.target);
    this.water.render(this.renderer,this.camera,this.target);
    this.renderer.setRenderTarget(null);this.renderer.clear();this.renderer.render(this.output,this.quadCamera);return !this.error;
  }
  dispose(){this.lightTest.dispose();this.optics.dispose();this.soft.dispose();this.proxies.dispose();this.water.dispose();this.grains.dispose();this.grass.dispose();this.terrainDepthTarget.dispose();this.pool.texture.dispose();this.target.dispose();this.glassTarget.dispose();this.empty.dispose();this.geometry.dispose();this.gaussianMaterial.dispose();this.depthMaterial.dispose();for(const s of [this.background,this.reference,this.output,this.glass,this.terrainDepth,this.copyTerrainDepth])for(const m of s.children){m.geometry.dispose();m.material.dispose();}this.renderer.dispose();}
}
