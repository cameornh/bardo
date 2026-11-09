export function openWindow({width=960,height=600}={}){
 const mac=Deno.build.os==='darwin';if(!mac&&Deno.build.os!=='windows')throw Error('Native window host currently supports macOS and Windows');
 const path=new URL(mac?'../.native/window.dylib':'../.native/window.dll',import.meta.url);
 const library=Deno.dlopen(path,{bardo_open:{parameters:['i32','i32'],result:'i32'},bardo_window:{parameters:[],result:'pointer'},bardo_display:{parameters:[],result:'pointer'},bardo_title:{parameters:['buffer'],result:'void'},bardo_lock:{parameters:['i32'],result:'void'},bardo_poll:{parameters:['buffer'],result:'i32'},bardo_close:{parameters:[],result:'void'},bardo_status:{parameters:['buffer'],result:'void'}});
 const s=library.symbols;if(!s.bardo_open(width,height))throw Error('Could not open native window');
 const surface=new Deno.UnsafeWindowSurface({system:mac?'cocoa':'win32',windowHandle:s.bardo_window(),displayHandle:s.bardo_display(),width,height});
 const data=new Float64Array(8);
 return {status:()=>{const b=new Float64Array(8);s.bardo_status(b);return Array.from(b);},surface,mac,width,height,lock:value=>s.bardo_lock(+value),title:text=>s.bardo_title(new TextEncoder().encode(text+'\0')),poll:fn=>{for(let i=0;i<128&&s.bardo_poll(data);i++)fn(data);},close:()=>s.bardo_close()};
}
