import * as THREE from 'three';
import {STAR_VERTEX,projectStar,starSeeingCovariance,scintillation} from '../src/sand-lab/star-gaussians.js';

// Capture the production vertex shader's actual clip positions. This detects
// whole-star wobble independently of how the covariance helper is implemented.
export function verifyStarTwinkle(renderer){
 const gl=renderer.getContext(),shaders=[],program=gl.createProgram(),vao=gl.createVertexArray(),input=gl.createBuffer(),output=gl.createBuffer(),feedback=gl.createTransformFeedback();
 const compile=(kind,source)=>{const shader=gl.createShader(kind);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));gl.attachShader(program,shader);};
 try{
  compile(gl.VERTEX_SHADER,`#version 300 es\nprecision highp float;in vec3 position;out vec4 testPosition;\n${STAR_VERTEX.replace('void main()', 'void starMain()')}\nvoid main(){starMain();testPosition=gl_Position;}`);
  compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0);}');
  gl.transformFeedbackVaryings(program,['testPosition','vRadiance'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,input);
  const corners=[[0,0],[-1,-1],[1,-1],[-1,1],[1,1]];
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(corners.flatMap(([x,y])=>[x,y,0])),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,3,gl.FLOAT,false,0,0);
  const attribute=(name,values)=>{const index=gl.getAttribLocation(program,name);if(index<0)return;gl.disableVertexAttribArray(index);values.length===2?gl.vertexAttrib2fv(index,values):gl.vertexAttrib3fv(index,values);};
  attribute('aColor',[1,1,1]);attribute('aPhotometry',[1,6]);
  const uniform=name=>gl.getUniformLocation(program,name),camera=new THREE.PerspectiveCamera(65,960/600,.01,300),projection=camera.projectionMatrix;
  gl.uniformMatrix4fv(uniform('uProjection'),false,projection.elements);gl.uniformMatrix4fv(uniform('uViewMatrix'),false,new THREE.Matrix4().elements);
  gl.uniformMatrix3fv(uniform('uCelestialRotation'),false,new THREE.Matrix3().elements);gl.uniform2f(uniform('uResolution'),960,600);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,5*7*4,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);gl.enable(gl.RASTERIZER_DISCARD);
  let maximumCenterDriftPixels=0,maximumCenterProjectionErrorPixels=0,maximumProjectionErrorPixels=0,maximumEdgeChangePixels=0,maximumBrightnessVariation=0,maximumBrightnessReferenceError=0;let samples=0;
  for(const magnitude of [0,3,6])for(const raw of [[0,.1,-1],[.6,.1,-.8],[-.3,.75,-.6]]){
   attribute('aPhotometry',[1,magnitude]);
   const direction=new THREE.Vector3(...raw).normalize().toArray().map(Math.fround);attribute('aDirection',direction);
   const focal=[projection.elements[0]*480,projection.elements[5]*300],base=projectStar(direction,...focal),seed=direction.reduce((s,v,k)=>s+v*[173.7,87.2,139.4][k],0),clip=new THREE.Vector4(...direction,0).applyMatrix4(projection),center=[clip.x/clip.w*480,clip.y/clip.w*300];let first=null;
   for(const time of [0,.2,.5,1,2,4,8]){
    gl.uniform1f(uniform('uStarTime'),time);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,5);gl.endTransformFeedback();
    const gpu=new Float32Array(35);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,gpu);
    const points=corners.map((_,i)=>[gpu[i*7]/gpu[i*7+3]*480,gpu[i*7+1]/gpu[i*7+3]*300]);
    maximumCenterProjectionErrorPixels=Math.max(maximumCenterProjectionErrorPixels,Math.hypot(points[0][0]-center[0],points[0][1]-center[1]));
    if(first)maximumCenterDriftPixels=Math.max(maximumCenterDriftPixels,Math.hypot(points[0][0]-first[0][0],points[0][1]-first[0][1]));
    const c=starSeeingCovariance(base,magnitude,direction[1],time,seed),a=Math.sqrt(c.xx),b=c.xy/a,d=Math.sqrt(c.yy-b*b);
    const flux=gpu[4]*2*Math.PI*Math.sqrt(c.det)*c.solidAngle;
    maximumBrightnessVariation=Math.max(maximumBrightnessVariation,Math.abs(flux-1));
    maximumBrightnessReferenceError=Math.max(maximumBrightnessReferenceError,Math.abs(flux-scintillation(magnitude,direction[1],time,seed,base)));
    corners.forEach(([x,y],i)=>{maximumProjectionErrorPixels=Math.max(maximumProjectionErrorPixels,Math.hypot(points[i][0]-center[0]-a*x*4,points[i][1]-center[1]-(b*x+d*y)*4));});
    if(first)for(let i=1;i<5;i++)maximumEdgeChangePixels=Math.max(maximumEdgeChangePixels,Math.hypot(points[i][0]-first[i][0],points[i][1]-first[i][1]));else first=points;
    samples++;
   }
  }
  return {samples,maximumCenterDriftPixels,maximumCenterProjectionErrorPixels,maximumProjectionErrorPixels,maximumEdgeChangePixels,maximumBrightnessVariation,maximumBrightnessReferenceError,pass:maximumCenterDriftPixels<.0001&&maximumProjectionErrorPixels<.0002&&maximumEdgeChangePixels>.01&&maximumBrightnessVariation<.0201&&maximumBrightnessReferenceError<.00001};
 }finally{
  gl.disable(gl.RASTERIZER_DISCARD);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);gl.bindVertexArray(null);
  gl.deleteTransformFeedback(feedback);gl.deleteBuffer(input);gl.deleteBuffer(output);gl.deleteVertexArray(vao);gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));renderer.resetState();
 }
}
