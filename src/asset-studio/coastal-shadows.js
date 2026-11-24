import * as T from 'three';
import {wetlandGLSL} from './wetland.js';
import {cutMask,sandReliefShader} from './ground-surface.js';

export const SHADOW_MAP_SIZE = 1024;
export const SHADOW_NEAR_RADIUS = 7.5;
export const SHADOW_FAR_RADIUS = 44.0;
export const SHADOW_ASSET_RADIUS = 1.6;

/**
 * Shared directional shadow sampling GLSL block. Safe in both vertex and fragment
 * shaders in WebGL 2 (no derivatives or gl_FragCoord references). Assumes
 * `uniform vec3 sunDirection;` is already declared in LIGHTING.
 */
export const SHADOW_GLSL = /* glsl */`
uniform sampler2D shadowMapNear, shadowMapFar;
uniform mat4 shadowVP0, shadowVP1;
uniform vec4 shadowParams;
uniform vec2 shadowTexel;
float sampleCascadePCF(sampler2D map, mat4 vp, vec3 pBias, float depthBias, float pcfRadius){
 vec4 sc = vp * vec4(pBias, 1.0);
 vec3 ndc = sc.xyz / sc.w * 0.5 + 0.5;
 if(ndc.z <= 0.0 || ndc.z >= 1.0 || any(lessThan(ndc.xy, vec2(0.0))) || any(greaterThan(ndc.xy, vec2(1.0)))) return 1.0;
 float r = depthBias;
 vec2 o0 = vec2( 0.0000,  0.0000) * pcfRadius;
 vec2 o1 = vec2(-0.6134,  0.2962) * pcfRadius;
 vec2 o2 = vec2( 0.6540,  0.2315) * pcfRadius;
 vec2 o3 = vec2(-0.2738, -0.6420) * pcfRadius;
 vec2 o4 = vec2( 0.2542, -0.6685) * pcfRadius;
 vec2 o5 = vec2(-0.8812, -0.2640) * pcfRadius;
 vec2 o6 = vec2( 0.8695, -0.2810) * pcfRadius;
 vec2 o7 = vec2(-0.1842,  0.8925) * pcfRadius;
 vec2 o8 = vec2( 0.3420,  0.8410) * pcfRadius;
 float vis = 0.0;
 vis += step(ndc.z - r, texture2D(map, clamp(ndc.xy + o0, 0.0, 1.0)).r);
 vis += step(ndc.z - r, texture2D(map, clamp(ndc.xy + o1, 0.0, 1.0)).r);
 vis += step(ndc.z - r, texture2D(map, clamp(ndc.xy + o2, 0.0, 1.0)).r);
 vis += step(ndc.z - r, texture2D(map, clamp(ndc.xy + o3, 0.0, 1.0)).r);
 vis += step(ndc.z - r, texture2D(map, clamp(ndc.xy + o4, 0.0, 1.0)).r);
 vis += step(ndc.z - r, texture2D(map, clamp(ndc.xy + o5, 0.0, 1.0)).r);
 vis += step(ndc.z - r, texture2D(map, clamp(ndc.xy + o6, 0.0, 1.0)).r);
 vis += step(ndc.z - r, texture2D(map, clamp(ndc.xy + o7, 0.0, 1.0)).r);
 vis += step(ndc.z - r, texture2D(map, clamp(ndc.xy + o8, 0.0, 1.0)).r);
 return vis / 9.0;
}
float sampleSunShadow(vec3 worldPos, vec3 n){
 if(shadowParams.x < 0.5) return 1.0;
 vec3 l = normalize(sunDirection);
 if(l.y < 0.025) return 0.0;
 float horizFade = smoothstep(0.025, 0.12, l.y);
 float ndl = max(0.0, dot(n, l));
 float slopeScale = 1.0 - ndl;
 vec3 pBias0 = worldPos + n * (shadowTexel.x * (0.9 + 1.5 * slopeScale)) + l * (shadowTexel.x * 0.45);
 vec4 sc0 = shadowVP0 * vec4(pBias0, 1.0);
 vec2 ndc0 = sc0.xy / sc0.w;
 float edge0 = max(abs(ndc0.x), abs(ndc0.y));
 bool hasFar = shadowParams.z > shadowParams.y + 1.0;
 float vis = 1.0;
 if(!hasFar){
  if(edge0 < 0.98){
   float v0 = sampleCascadePCF(shadowMapNear, shadowVP0, pBias0, 0.00045 + 0.00095 * slopeScale, 1.45 / 1024.0);
   vis = mix(v0, 1.0, smoothstep(0.82, 0.98, edge0));
  }
 } else if(edge0 < 0.95){
  float v0 = sampleCascadePCF(shadowMapNear, shadowVP0, pBias0, 0.00045 + 0.00095 * slopeScale, 1.45 / 1024.0);
  if(edge0 > 0.78){
   vec3 pBias1 = worldPos + n * (shadowTexel.y * (1.0 + 1.8 * slopeScale)) + l * (shadowTexel.y * 0.55);
   float v1 = sampleCascadePCF(shadowMapFar, shadowVP1, pBias1, 0.00055 + 0.0011 * slopeScale, 1.35 / 1024.0);
   vis = mix(v0, v1, smoothstep(0.78, 0.95, edge0));
  } else {
   vis = v0;
  }
 } else {
  vec3 pBias1 = worldPos + n * (shadowTexel.y * (1.0 + 1.8 * slopeScale)) + l * (shadowTexel.y * 0.55);
  vec4 sc1 = shadowVP1 * vec4(pBias1, 1.0);
  vec2 ndc1 = sc1.xy / sc1.w;
  float edge1 = max(abs(ndc1.x), abs(ndc1.y));
  if(edge1 < 0.98){
   float v1 = sampleCascadePCF(shadowMapFar, shadowVP1, pBias1, 0.00055 + 0.0011 * slopeScale, 1.35 / 1024.0);
   vis = mix(v1, 1.0, smoothstep(0.84, 0.98, edge1));
  }
 }
 vis = mix(vis, 1.0, shadowParams.w * 0.45);
 return mix(1.0, vis, horizFade);
}
`;

function cross3(ax, ay, az, bx, by, bz) {
 return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/**
 * Pure texel-snapped orthographic cascade camera & view-projection builder.
 * Quantizes world center onto exact light-space texel increments to prevent shimmer.
 */
export function computeCascadeMatrix(centerX, centerY, centerZ, sunDir, radius, mapSize = SHADOW_MAP_SIZE, outCamera = null) {
 const rawX = Array.isArray(sunDir) ? sunDir[0] : (sunDir?.x ?? -0.6);
 const rawY = Array.isArray(sunDir) ? sunDir[1] : (sunDir?.y ?? 1.0);
 const rawZ = Array.isArray(sunDir) ? sunDir[2] : (sunDir?.z ?? 0.5);
 const dLen = Math.hypot(rawX, rawY, rawZ) || 1;
 const dx = rawX / dLen;
 const dy = rawY / dLen;
 const dz = rawZ / dLen;

 const upRefY = Math.abs(dy) > 0.92 ? 0 : 1;
 const upRefZ = Math.abs(dy) > 0.92 ? 1 : 0;
 let [rx, ry, rz] = cross3(0, upRefY, upRefZ, dx, dy, dz);
 const rLen = Math.hypot(rx, ry, rz) || 1;
 rx /= rLen;
 ry /= rLen;
 rz /= rLen;
 const [ux, uy, uz] = cross3(dx, dy, dz, rx, ry, rz);

 const texelSize = (2 * radius) / Math.max(1, mapSize);
 const tx = centerX * rx + centerY * ry + centerZ * rz;
 const ty = centerX * ux + centerY * uy + centerZ * uz;
 const tz = centerX * dx + centerY * dy + centerZ * dz;
 const stx = Math.round(tx / texelSize) * texelSize;
 const sty = Math.round(ty / texelSize) * texelSize;
 const stz = Math.round(tz / texelSize) * texelSize;

 const sx = rx * stx + ux * sty + dx * stz;
 const sy = ry * stx + uy * sty + dy * stz;
 const sz = rz * stx + uz * sty + dz * stz;

 const cam = outCamera || new T.OrthographicCamera(-radius, radius, radius, -radius, 0.5, radius * 6 + 60);
 cam.left = -radius;
 cam.right = radius;
 cam.top = radius;
 cam.bottom = -radius;
 cam.near = 0.5;
 cam.far = radius * 6 + 60;
 cam.updateProjectionMatrix();

 const dist = radius * 3 + 25;
 cam.position.set(sx + dx * dist, sy + dy * dist, sz + dz * dist);
 cam.up.set(ux, uy, uz);
 cam.lookAt(sx, sy, sz);
 cam.updateMatrixWorld(true);

 const viewProjection = new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
 return {
  viewMatrix: cam.matrixWorldInverse.clone(),
  projectionMatrix: cam.projectionMatrix.clone(),
  viewProjection,
  camera: cam,
  snappedCenter: {x: sx, y: sy, z: sz},
  texelSize,
  right: {x: rx, y: ry, z: rz},
  up: {x: ux, y: uy, z: uz},
  dir: {x: dx, y: dy, z: dz},
 };
}

export function createDefaultShadowUniforms(fallbackTexture = null) {
 const tex = fallbackTexture || (() => {
  const t = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat);
  t.magFilter = T.NearestFilter;
  t.minFilter = T.NearestFilter;
  t.needsUpdate = true;
  return t;
 })();
 return {
  shadowMapNear: {value: tex},
  shadowMapFar: {value: tex},
  shadowVP0: {value: new T.Matrix4()},
  shadowVP1: {value: new T.Matrix4()},
  shadowParams: {value: new T.Vector4(0, SHADOW_NEAR_RADIUS, SHADOW_FAR_RADIUS, 0)},
  shadowTexel: {value: new T.Vector2((2 * SHADOW_NEAR_RADIUS) / SHADOW_MAP_SIZE, (2 * SHADOW_FAR_RADIUS) / SHADOW_MAP_SIZE)},
 };
}

function makeDepthTarget() {
 const target = new T.WebGLRenderTarget(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, {
  minFilter: T.NearestFilter,
  magFilter: T.NearestFilter,
  depthBuffer: true,
  stencilBuffer: false,
 });
 target.depthTexture = new T.DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, T.UnsignedIntType);
 target.depthTexture.minFilter = T.NearestFilter;
 target.depthTexture.magFilter = T.NearestFilter;
 target.depthTexture.generateMipmaps = false;
 return target;
}

export class CoastalShadowSystem {
 constructor(view) {
  this.fallbackTex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat);
  this.fallbackTex.magFilter = T.NearestFilter;
  this.fallbackTex.minFilter = T.NearestFilter;
  this.fallbackTex.needsUpdate = true;

  this.uniforms = view?.shadowUniforms ?? createDefaultShadowUniforms(this.fallbackTex);
  this.uniforms.shadowMapNear.value = this.fallbackTex;
  this.uniforms.shadowMapFar.value = this.fallbackTex;

  this.nearTarget = makeDepthTarget();
  this.farTarget = makeDepthTarget();
  this.nearCamera = new T.OrthographicCamera();
  this.farCamera = new T.OrthographicCamera();

  this._frameIdx = 0;
  this._hasFar = false;
  this._lastFarPos = new T.Vector3(Infinity, Infinity, Infinity);
  this._lastFarSun = new T.Vector3(Infinity, Infinity, Infinity);
  this._fwd = new T.Vector3();
  this._savedClear = new T.Color();
  this._savedViewport = new T.Vector2();

  // Terrain depth-only shadow caster matching WetlandView world-space landPoint() & sand relief
  const shadowBedUniforms = {
   survey: view?.wetland?.uniforms?.survey ?? {value: new T.Vector2()},
   landEye: view?.wetland?.uniforms?.landEye ?? {value: new T.Vector2()},
   granular: view?.wetland?.uniforms?.granular ?? {value: false},
   sandBed: view?.wetland?.uniforms?.sandBed ?? {value: null},
   localBed: view?.wetland?.uniforms?.localBed ?? {value: null},
   localOrigin: view?.wetland?.uniforms?.localOrigin ?? {value: new T.Vector2()},
   localExtent: view?.wetland?.uniforms?.localExtent ?? {value: new T.Vector4(1, 1, -1, -1)},
  };
  this.terrainShadowMat = new T.ShaderMaterial({
   colorWrite: false,
   depthWrite: true,
   depthTest: true,
   side: T.FrontSide,
   polygonOffset: true,
   polygonOffsetFactor: 2.0,
   polygonOffsetUnits: 2.0,
   uniforms: shadowBedUniforms,
   vertexShader: wetlandGLSL + sandReliefShader + /* glsl */`
    attribute vec2 gridStep;
    uniform vec2 landEye;
    vec2 landPoint(){
     vec2 cell = landEye / gridStep;
     return (floor(cell) + smoothstep(vec2(0.0), vec2(1.0), fract(cell))) * gridStep + position.xz;
    }
    void main(){
     vec2 p0 = landPoint();
     float h = landHeight(p0);
     if(granular){
      float fade = 1.0 - smoothstep(25.0, 65.0, length(landEye - p0));
      h += (sandHeight(p0) + localSurface(p0).x) * fade;
     }
     gl_Position = projectionMatrix * viewMatrix * vec4(p0.x, h, p0.y, 1.0);
    }
   `,
   fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }',
  });
  this.sandPatchShadowMat = new T.ShaderMaterial({
   colorWrite: false,
   depthWrite: true,
   depthTest: true,
   side: T.FrontSide,
   polygonOffset: true,
   polygonOffsetFactor: 2.0,
   polygonOffsetUnits: 2.0,
   uniforms: shadowBedUniforms,
   vertexShader: wetlandGLSL + sandReliefShader + /* glsl */`
    uniform vec2 landEye;
    void main(){
     vec2 p0 = position.xz;
     float h = landHeight(p0);
     if(granular){
      float fade = 1.0 - smoothstep(25.0, 65.0, length(landEye - p0));
      h += (sandHeight(p0) + position.y) * fade;
     }
     gl_Position = projectionMatrix * viewMatrix * vec4(p0.x, h, p0.y, 1.0);
    }
   `,
   fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }',
  });

  // Orthographic EWA depth-only shadow caster for studioGeometry surflets & fibres
  this.assetShadowMat = new T.ShaderMaterial({
   colorWrite: false,
   depthWrite: true,
   depthTest: true,
   side: T.DoubleSide,
   uniforms: {
    matterPlaying: view?.uniforms?.matterPlaying ?? {value: 0},
   },
   vertexShader: /* glsl */`
    attribute vec3 center, surfaceNormal;
    attribute float radius, fiberLength;
    attribute vec4 properties;
    attribute vec2 phaseId;
    uniform float matterPlaying;
    varying vec2 vG;
    void main(){
     if(properties.z < 0.12 || phaseId.x > 1.5 || (matterPlaying > 0.5 && phaseId.x > 0.5)){
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vG = vec2(9.0);
      return;
     }
     vec3 cW = center + surfaceNormal * fiberLength * 0.46;
     vec3 cV = (modelViewMatrix * vec4(cW, 1.0)).xyz;
     float r = max(radius, 0.008);
     float ext = max(r, fiberLength * 0.55);
     vec2 g = position.xy * 1.4;
     vG = g;
     // Project the oriented local footprint with the complete instance scale.
     vec3 localN=normalize(surfaceNormal);
     vec3 ref=abs(localN.z)>.9?vec3(1.,0.,0.):vec3(0.,0.,1.);
     vec3 localT=normalize(cross(ref,localN)), localB=cross(localN,localT);
     vec3 vPos=cV+mat3(modelViewMatrix)*((fiberLength>0.?localN*ext:localT*r)*g.x+localB*r*g.y);
     gl_Position = projectionMatrix * vec4(vPos, 1.0);
    }
   `,
   fragmentShader: `
    varying vec2 vG;
    void main(){
     if(dot(vG, vG) > 1.55) discard;
     gl_FragColor = vec4(0.0);
    }
   `,
  });

  // Fallback shadow caster for plain non-liveStudio or procedural meshes
  this.plainShadowMat = new T.ShaderMaterial({
   colorWrite: false,
   depthWrite: true,
   depthTest: true,
   side: T.DoubleSide,
   vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
   fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }',
  });
 }

 _drawAssetScene(view, shadowCamera) {
  if (!view.groups?.size) return;
  const renderer = view.renderer;
  const swaps = [];
  const mask=shadowCamera.layers.mask;shadowCamera.layers.enable(2);
  view.assetScene.traverseVisible(child=>{
   if (!child.isMesh || !child.layers.test(shadowCamera.layers)) return;
   swaps.push([child,child.material]);
   child.material=child.geometry.attributes.center?this.assetShadowMat:this.plainShadowMat;
  });
  try { if(swaps.length)renderer.render(view.assetScene, shadowCamera); }
  finally { shadowCamera.layers.mask=mask;for (const [m,orig] of swaps) m.material=orig; }
 }

 _renderCascade(view, shadowCamera, target, includeTerrain, maxDistWorld) {
  const renderer = view.renderer;
  renderer.setRenderTarget(target);
  renderer.autoClear = true;
  renderer.clear(true, true, true);
  renderer.autoClear = false;

  this.drawCasters(view,shadowCamera,includeTerrain,maxDistWorld);
 }
 drawCasters(view,shadowCamera,includeTerrain,maxDistWorld,emitter=null){
  const renderer=view.renderer;
  if (includeTerrain && view.garden) {
   const gu = view.garden.uniforms;
   const tu = this.terrainShadowMat.uniforms;
   tu.survey = gu.survey;
   tu.landEye = gu.landEye;
   if (gu.granular) tu.granular = gu.granular;
   if (gu.sandBed) tu.sandBed = gu.sandBed;
   if (gu.localBed) tu.localBed = gu.localBed;
   if (gu.localOrigin) tu.localOrigin = gu.localOrigin;
   if (gu.localExtent) tu.localExtent = gu.localExtent;
   const grid=view.garden.shadowGrid;
   grid.fit(shadowCamera,gu.landEye.value);
   renderer.render(grid.mesh,shadowCamera);
   if (view.garden.sandPatch?.visible) {
    const patch = view.garden.sandPatch;
    const origP = patch.material;
    patch.material = this.sandPatchShadowMat;
    renderer.render(patch, shadowCamera);
    patch.material = origP;
   }
  }

  if(emitter&&!view.garden&&view.ground.visible){
   // Ground relief and excavations use the same vertices and cut mask in both passes.
   this.floorShadowMat??=new T.ShaderMaterial({side:T.DoubleSide,colorWrite:false,
    uniforms:view.groundMaterial.uniforms,vertexShader:view.groundMaterial.vertexShader,
    fragmentShader:`varying vec3 worldPosition;${cutMask} void main(){discardCut(worldPosition.xz);gl_FragColor=vec4(0.);}`});
   const floor=view.ground,material=floor.material;
   floor.material=this.floorShadowMat;
   try{renderer.render(floor,shadowCamera);}finally{floor.material=material;}
   const patch=view.groundEdits.patch;
   if(patch.visible){
    const prior=patch.material;patch.material=this.plainShadowMat;
    try{renderer.render(patch,shadowCamera);}finally{patch.material=prior;}
   }
  }
  this._drawAssetScene(view, shadowCamera);
  view.implicit?.drawShadows?.(renderer, shadowCamera,emitter);
  if(emitter){
   for(const collection of [view.groundEdits?.meshes,view.matterView?.meshes]){
    for(const mesh of collection?.values()??[]){
     if(!mesh.visible||!mesh.layers.test(shadowCamera.layers))continue;
     const original=mesh.material;mesh.material=this.plainShadowMat;
     try{renderer.render(mesh,shadowCamera);}finally{mesh.material=original;}
    }
   }
  }
  view.paintView?.drawShadows?.(renderer, shadowCamera);

  if (view.garden) {
   view.garden.reeds?.drawShadows?.(renderer, shadowCamera, maxDistWorld);
   view.garden.props?.drawShadows?.(renderer, shadowCamera);
   view.garden.fauna?.drawShadows?.(renderer, shadowCamera);
  }
 }

 update(view) {
  const u = this.uniforms;
  const active = Boolean(
   view?.liveStudio &&
   (view.garden || (view.mode === 'asset' && Number.isInteger(view.library?.world?.wetlandSeed)))
  );
  if (!active) {
   u.shadowParams.value.set(0, SHADOW_NEAR_RADIUS, SHADOW_FAR_RADIUS, 0);
   u.shadowMapNear.value = this.fallbackTex;
   u.shadowMapFar.value = this.fallbackTex;
   return;
  }

  const sun = view.uniforms.sunDirection.value;
  if ((sun.y ?? 1) < 0.02) {
   u.shadowParams.value.set(0, SHADOW_NEAR_RADIUS, SHADOW_FAR_RADIUS, 0);
   u.shadowMapNear.value = this.fallbackTex;
   u.shadowMapFar.value = this.fallbackTex;
   return;
  }

  const renderer = view.renderer;
  const camera = view.camera;
  camera.updateMatrixWorld();

  // Temporarily disable shadow sampling & bind safe dummy textures during shadow caster passes
  u.shadowParams.value.x = 0;
  u.shadowMapNear.value = this.fallbackTex;
  u.shadowMapFar.value = this.fallbackTex;

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const prevClearAlpha = renderer.getClearAlpha();
  renderer.getClearColor(this._savedClear);
  const prevCamWorld = view.uniforms.cameraWorld.value;
  this._savedViewport.copy(view.uniforms.viewport.value);
  view.uniforms.viewport.value.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);

  const isWorld = view.mode === 'world' && !!view.garden;
  const nearRadius = isWorld ? SHADOW_NEAR_RADIUS : SHADOW_ASSET_RADIUS;
  const farRadius = isWorld ? SHADOW_FAR_RADIUS : 0;

  let nearCX = 0, nearCY = 0.25, nearCZ = 0;
  if (isWorld) {
   const target = view.controls?.target;
   const hDist = target ? Math.hypot(target.x - camera.position.x, target.z - camera.position.z) : 999;
   if (target && hDist < 16) {
    nearCX = target.x;
    nearCZ = target.z;
   } else {
    camera.getWorldDirection(this._fwd);
    const hLen = Math.hypot(this._fwd.x, this._fwd.z) || 1;
    const fx = this._fwd.x / hLen;
    const fz = this._fwd.z / hLen;
    const dist = target ? hDist : 12.0;
    const reach = Math.min(7.5, Math.max(2.5, dist * 0.5));
    nearCX = camera.position.x + fx * reach;
    nearCZ = camera.position.z + fz * reach;
   }
   nearCY = Math.max(-2.5, Math.min(8.0, view.garden.land?.height?.(nearCX, nearCZ) ?? camera.position.y * 0.5));
  }

  const res0 = computeCascadeMatrix(nearCX, nearCY, nearCZ, sun, nearRadius, SHADOW_MAP_SIZE, this.nearCamera);
  u.shadowVP0.value.copy(res0.viewProjection);
  view.uniforms.cameraWorld.value = this.nearCamera.matrixWorld;
  this._renderCascade(view, this.nearCamera, this.nearTarget, isWorld, 18.0);

  if (isWorld) {
   camera.getWorldDirection(this._fwd);
   const hLen = Math.hypot(this._fwd.x, this._fwd.z) || 1;
   const fx = this._fwd.x / hLen;
   const fz = this._fwd.z / hLen;
   const farCX = camera.position.x + fx * 14.0;
   const farCZ = camera.position.z + fz * 14.0;
   const farCY = nearCY;

   this._frameIdx++;
   const movedFar = Math.hypot(camera.position.x - this._lastFarPos.x, camera.position.y - this._lastFarPos.y, camera.position.z - this._lastFarPos.z) > 0.35;
   const sunChanged = Math.hypot(sun.x - this._lastFarSun.x, sun.y - this._lastFarSun.y, sun.z - this._lastFarSun.z) > 1e-4;
   if (!this._hasFar || movedFar || sunChanged || (this._frameIdx % 4) === 0) {
    const res1 = computeCascadeMatrix(farCX, farCY, farCZ, sun, farRadius, SHADOW_MAP_SIZE, this.farCamera);
    u.shadowVP1.value.copy(res1.viewProjection);
    view.uniforms.cameraWorld.value = this.farCamera.matrixWorld;
    this._renderCascade(view, this.farCamera, this.farTarget, true, 62.0);
    this._lastFarPos.copy(camera.position);
    this._lastFarSun.copy(sun);
    this._hasFar = true;
   }
  } else {
   this._hasFar = false;
  }

  // Restore exact renderer & studio uniforms state
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(this._savedClear, prevClearAlpha);
  renderer.autoClear = prevAutoClear;
  view.uniforms.viewport.value.copy(this._savedViewport);
  view.uniforms.cameraWorld.value = prevCamWorld;

  const cloudSoft = view.garden?.land?.climate?.cloudCover ?? view.library?.world?.climate?.cloudCover ?? 0.15;
  u.shadowMapNear.value = this.nearTarget.depthTexture;
  u.shadowMapFar.value = isWorld ? this.farTarget.depthTexture : this.fallbackTex;
  u.shadowParams.value.set(1, nearRadius, farRadius, cloudSoft);
  u.shadowTexel.value.set((2 * nearRadius) / SHADOW_MAP_SIZE, isWorld ? (2 * farRadius) / SHADOW_MAP_SIZE : (2 * nearRadius) / SHADOW_MAP_SIZE);
 }

 dispose() {
  this.nearTarget.depthTexture?.dispose();
  this.farTarget.depthTexture?.dispose();
  this.nearTarget.dispose();
  this.farTarget.dispose();
  this.fallbackTex.dispose();
  this.terrainShadowMat.dispose();
  this.sandPatchShadowMat.dispose();
  this.assetShadowMat.dispose();
  this.plainShadowMat.dispose();
  this.floorShadowMat?.dispose();
 }
}
