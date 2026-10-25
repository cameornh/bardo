import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {startupReportPlugin} from '../tools/startup-report-server.mjs';
import {chromeCandidates,chromeOpenGLArgs,openChromeOpenGL} from '../tools/chrome-opengl.mjs';

async function server(root,t){
 let middleware;startupReportPlugin(root,{log:()=>{}}).configurePreviewServer({middlewares:{use:fn=>middleware=fn}});
 const http=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>http.close(resolve)));
 return 'http://127.0.0.1:'+http.address().port;
}
test('startup checkpoints survive browser storage loss and a server restart',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bardo-checkpoint-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const url=await server(root,t),record={started:'2026-10-25T00:00:00Z',sequence:1,stage:'Compiling water surface',history:[{ms:33,stage:'Compiling water surface'}]};
 assert.equal(await (await fetch(url+'/__bardo/startup')).json(),null);
 const post=await fetch(url+'/__bardo/startup',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify(record)});assert.equal(post.status,200);
 const restarted=await server(root,t);assert.deepEqual(await (await fetch(restarted+'/__bardo/startup')).json(),record);
 const foreign=await fetch(url+'/__bardo/startup',{method:'POST',headers:{Origin:'https://example.com'},body:JSON.stringify({...record,stage:'incorrect'})});assert.equal(foreign.status,403);
 assert.deepEqual(await (await fetch(url+'/__bardo/startup')).json(),record);
});
test('an older browser attempt cannot overwrite the current startup checkpoint',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bardo-checkpoint-'));t.after(()=>rm(root,{recursive:true,force:true}));const url=await server(root,t);
 for(const started of ['2026-10-25T00:01:00Z','2026-10-25T00:00:00Z'])await fetch(url+'/__bardo/startup',{method:'POST',body:JSON.stringify({started,stage:started})});
 assert.equal((await (await fetch(url+'/__bardo/startup')).json()).started,'2026-10-25T00:01:00Z');
});
test('OpenGL launcher uses argument arrays and a separate profile without security overrides',async()=>{
 const env={ProgramFiles:'C:/Program Files',LOCALAPPDATA:'C:/Users/Test & Name/AppData/Local'},candidates=chromeCandidates(env);let launched;
 const result=await openChromeOpenGL('http://127.0.0.1:5178/graphics-health.html',{platform:'win32',env,exists:async p=>p===candidates[1],launch:(...args)=>{
  launched=args;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;
 }});
 assert.equal(result.chrome,candidates[1]);assert.match(result.profile,/Bardo-Chrome-OpenGL/);assert.ok(launched[1].includes('--use-angle=gl'));
 assert.equal(launched[2].shell,undefined);assert.doesNotMatch(launched[1].join(' '),/disable-gpu|no-sandbox|ignore-gpu|disable-web-security/);
 assert.throws(()=>chromeOpenGLArgs('test','https://example.com/'),/local HTTP/);
});
test('missing Chrome and unsupported launch hosts fail before opening a browser',async()=>{
 await assert.rejects(openChromeOpenGL('http://127.0.0.1:5178/',{platform:'darwin'}),/Windows/);
 await assert.rejects(openChromeOpenGL('http://127.0.0.1:5178/',{platform:'win32',env:{LOCALAPPDATA:'test'},exists:async()=>false}),/not found/);
});
