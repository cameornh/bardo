import {textureBytes} from './formats.js';
// Some native wgpu adapters expose only 32 attachment bytes/sample, while the
// browser exposes 64+. Preserve full precision by writing disjoint outputs in
// separate draws. Only independent, depth-free MRT work is eligible.
export function splitWideAttachments(commands,limit){
 const states=new Map(),out=[];
 for(const c of commands){const s=c.state;if(!s||s.colors.reduce((n,t)=>n+textureBytes(t.format),0)<=limit){out.push(c);continue;}
  if(s.depth)throw Error('Cannot split a depth-bearing MRT pass without a depth replay policy');
  let parts=states.get(s);if(!parts){parts=[];let bytes=0,colors=s.colors.map(()=>null);for(let i=0;i<s.colors.length;i++){const n=textureBytes(s.colors[i].format);if(n>limit)throw Error('One render attachment exceeds the device limit');if(bytes+n>limit){parts.push({...s,colors});colors=s.colors.map(()=>null);bytes=0;}colors[i]=s.colors[i];bytes+=n;}parts.push({...s,colors});states.set(s,parts);}
  for(const state of parts)out.push({...c,state});
 }return out;
}
