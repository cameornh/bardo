import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';

// Local-only checkpoint storage survives a frozen/closed incognito window.
export function startupReportPlugin(root,{log=console.log}={}){
 const directory=join(root,'.startup'),path=join(directory,'windows-startup.json');
 let last=null,ready=readFile(path,'utf8').then(text=>{last=JSON.parse(text);}).catch(()=>{}),writes=ready;
 const middleware=async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/__bardo/startup')return next();
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(req.method==='GET'){await writes;return reply(200,last);}
  if(req.method!=='POST')return reply(405,{error:'Use GET or POST.'});
  if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)return reply(403,{error:'Same-origin checkpoints only.'});
  try{
   let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)return reply(413,{error:'Checkpoint too large.'});}
   const value=JSON.parse(text);
   if(typeof value.stage!=='string'||value.stage.length>512||typeof value.started!=='string')return reply(400,{error:'Invalid checkpoint.'});
   const task=writes.then(async()=>{
    // Ignore late beacons from an older browser attempt.
    if(last&&last.started>value.started)return;
    if(last?.started===value.started&&(last.sequence||0)>(value.sequence||0))return;
    if(last?.started!==value.started||last?.stage!==value.stage)log('[startup] '+value.stage);
    last=value;await mkdir(directory,{recursive:true});await writeFile(path+'.tmp',JSON.stringify(value,null,2));await rename(path+'.tmp',path);
   });writes=task.catch(()=>{});await task;reply(200,{saved:true});
  }catch(error){reply(400,{error:error.message});}
 };
 return {name:'bardo-startup-report',configurePreviewServer(server){server.middlewares.use(middleware);}};
}
