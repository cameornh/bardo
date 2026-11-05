import {FluidFields, AIR, WATER, SOLID} from './model.js';
import {pressureRHS, residual, rms, solveSORReference} from './pressure.js';

const VERTEX = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`;
const FRAGMENT = `#version 300 es
precision highp float;precision highp int;
uniform sampler2D previous, data;uniform ivec3 size;uniform int color;out vec4 result;
ivec2 pixel(ivec3 c){return ivec2(c.x+c.z*size.x,c.y);}
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);ivec3 c=ivec3(uv.x%size.x,uv.y,uv.x/size.x);
 vec4 cell=texelFetch(data,uv,0);float p=texelFetch(previous,uv,0).r;
 if(cell.b<.5){result=vec4(0);return;}
 if(((c.x+c.y+c.z)&1)!=color){result=vec4(p,0,0,1);return;}
 float sum=cell.r;
 for(int k=0;k<6;k++){
  ivec3 q=c;int a=k/2;q[a]+=(k%2==0?-1:1);
  if(any(lessThan(q,ivec3(0)))||any(greaterThanEqual(q,size)))continue;
  ivec2 v=pixel(q);if(texelFetch(data,v,0).g==cell.g)sum+=texelFetch(previous,v,0).r;
 }
 result=vec4(p+1.65*(sum/cell.b-p),0,0,1);
}`;

// Only a six-neighbor stencil; no beach SDFs, kernels, dynamic shader variants,
// or scene renderer. At most 8 sweeps (16 small draws) may be outstanding.
export class FieldPressureGPU {
  constructor(canvas = document.createElement('canvas')) {
    this.canvas = canvas; this.busy = false; this.failed = false; this.disposed = false;
    const gl = canvas.getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw Error('Float WebGL 2 unavailable; CPU reference selected.');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', e => {e.preventDefault(); this.failed = true;});
    const shader = (type, source) => {
      const s = gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s);
      if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) {const message=gl.getShaderInfoLog(s); gl.deleteShader(s); throw Error('Field stencil shader: '+message);}
      return s;
    };
    const v = shader(gl.VERTEX_SHADER,VERTEX), f = shader(gl.FRAGMENT_SHADER,FRAGMENT), p = gl.createProgram();
    gl.attachShader(p,v); gl.attachShader(p,f); gl.linkProgram(p); gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p,gl.LINK_STATUS)) {const message=gl.getProgramInfoLog(p); gl.deleteProgram(p); throw Error('Field stencil linking: '+message);}
    this.program = p; this.vao = gl.createVertexArray();
    this.uniforms = Object.fromEntries(['previous','data','size','color'].map(k=>[k,gl.getUniformLocation(p,k)]));
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    this.device = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }
  releaseTargets() {
    const gl=this.gl;
    for (const t of this.targets||[]) {gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.framebuffer);}
    if (this.data) gl.deleteTexture(this.data);
    this.targets=null; this.data=null;
  }
  allocate(grid) {
    const gl=this.gl, width=grid.dims[0]*grid.dims[2], height=grid.dims[1];
    if (width===this.width && height===this.height) return;
    this.releaseTargets(); this.width=width; this.height=height;
    const texture = () => {
      const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,null); return t;
    };
    this.data=texture(); this.targets=[0,1].map(()=>{
      const t=texture(), framebuffer=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw Error('Field float target incomplete');
      return {texture:t,framebuffer};
    });
    this.packed=new Float32Array(width*height*4); this.pixels=new Float32Array(width*height*4);
  }
  async fence() {
    const gl=this.gl, sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0), start=performance.now(); gl.flush();
    try {
      for (;;) {
        if (this.failed || this.disposed || gl.isContextLost()) throw Error('Field GPU context unavailable');
        const state=gl.clientWaitSync(sync,0,0);
        if (state===gl.ALREADY_SIGNALED || state===gl.CONDITION_SATISFIED) return;
        if (state===gl.WAIT_FAILED || performance.now()-start>2000) {this.failed=true; throw Error('Field compute stopped: fence exceeded its time budget');}
        await new Promise(resolve=>setTimeout(resolve,2));
      }
    } finally {gl.deleteSync(sync);}
  }
  async solve(grid, rhs, sweeps = 80) {
    if (this.busy || this.failed || this.disposed) throw Error('Field GPU unavailable or already busy');
    if (grid.count>32768 || !Number.isInteger(sweeps) || sweeps<1 || sweeps>96) throw Error('Field compute budget exceeded');
    this.busy=true;
    try {
      this.allocate(grid); const gl=this.gl, [nx,ny,nz]=grid.dims;
      this.packed.fill(0);
      for (let z=0;z<nz;z++) for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) {
        const i=x+nx*(y+ny*z), t=4*(x+nx*z+this.width*y);
        this.packed[t]=rhs[i]; this.packed[t+1]=grid.phase[i]; this.packed[t+2]=grid.degree[i];
      }
      gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0,0,this.width,this.height); gl.uniform3i(this.uniforms.size,nx,ny,nz);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,this.data); gl.uniform1i(this.uniforms.data,1);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,this.width,this.height,gl.RGBA,gl.FLOAT,this.packed);
      gl.uniform1i(this.uniforms.previous,0); gl.clearColor(0,0,0,0);
      for (const t of this.targets) {gl.bindFramebuffer(gl.FRAMEBUFFER,t.framebuffer); gl.clear(gl.COLOR_BUFFER_BIT);}
      let read=0;
      for (let s=0;s<sweeps;s++) {
        for (let color=0;color<2;color++) {
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.targets[read].texture);
          gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[1-read].framebuffer); gl.uniform1i(this.uniforms.color,color);
          gl.drawArrays(gl.TRIANGLES,0,3); read=1-read;
        }
        if ((s+1)%8===0) await this.fence();
      }
      await this.fence();
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[read].framebuffer);
      gl.readPixels(0,0,this.width,this.height,gl.RGBA,gl.FLOAT,this.pixels);
      if (gl.getError()!==gl.NO_ERROR || !this.pixels.every(Number.isFinite)) throw Error('Invalid field GPU readback');
      const potential=new Float64Array(grid.count);
      for (let z=0;z<nz;z++) for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) potential[x+nx*(y+ny*z)]=this.pixels[4*(x+nx*z+this.width*y)];
      grid.removeMean(potential);
      return {potential,iterations:sweeps,relativeResidual:residual(grid,potential,rhs)/Math.max(1e-12,rms(rhs)),backend:'GPU pressure stencil'};
    } catch (error) {this.failed=true; throw error;}
    finally {this.busy=false;}
  }
  dispose() {
    this.disposed=true;
    this.releaseTargets(); this.gl.deleteVertexArray(this.vao); this.gl.deleteProgram(this.program);
  }
}

export async function validateFieldGPU(gpu) {
  const cases=[];
  for (const obstacle of [false,true]) {
    const grid=new FluidFields({dims:[8,6,6],cellSize:.5,waterLevel:1.5,phaseAt:p=>obstacle&&p[0]>1.5&&p[0]<2.5?SOLID:p[1]<1.5?WATER:AIR});
    grid.impulse([1,1,1.5],.8,[1.4,.6,-.3]); grid.impulse([3,2,1.5],.9,[-.5,.8,.4]);
    const rhs=pressureRHS(grid), ref=solveSORReference(grid,rhs,64), actual=await gpu.solve(grid,rhs,64);
    let maximumError=0, maximumGradientError=0;
    for (let i=0;i<grid.count;i++) maximumError=Math.max(maximumError,Math.abs(actual.potential[i]-ref[i]));
    for (const f of grid.faces) for (let i=0;i<f.phase.length;i++) if (f.phase[i]) {
      const a=f.a[i], b=f.b[i]; maximumGradientError=Math.max(maximumGradientError,Math.abs((actual.potential[b]-actual.potential[a])-(ref[b]-ref[a]))/grid.h);
    }
    const before=rms(grid.divergence()); grid.applyProjection(actual.potential,1/30); const after=rms(grid.divergence());
    cases.push({obstacle,components:grid.components.length,maximumError,maximumGradientError,divergenceBefore:before,divergenceAfter:after,relativeResidual:actual.relativeResidual,
      pass:maximumError<2e-5&&maximumGradientError<2e-5&&after<before*.001});
  }
  return {pass:cases.every(c=>c.pass),device:gpu.device,algorithm:'3D red/black pressure SOR compared with independent FP64 CPU reference',tolerance:2e-5,cases};
}
