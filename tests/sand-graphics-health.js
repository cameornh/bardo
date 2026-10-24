import {requestLabContext} from '../src/sand-lab/graphics-health.js';
const result=document.querySelector('#result');
let gl;
try{
 gl=requestLabContext(document.querySelector('#view'));
 gl.clearColor(.25,.5,.75,1);gl.clear(gl.COLOR_BUFFER_BIT);
 const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
 const error=gl.getError(),pass=error===gl.NO_ERROR&&[64,128,191,255].every((v,i)=>Math.abs(v-pixel[i])<=1);
 result.textContent=JSON.stringify({check:'WebGL 2 context and pixel readback only',pass,pixel:[...pixel],error,floatRenderTargets:!!gl.getExtension('EXT_color_buffer_float'),version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(gl.RENDERER)},null,2);
}catch(error){result.textContent=error.message;}
finally{gl?.getExtension('WEBGL_lose_context')?.loseContext();}
