import {readFile,writeFile,mkdir,rename,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {validateLibrary} from '../../src/asset-studio/model.js';
// Fixed, ignored path: requests never choose a filesystem location. Only the
// same local origin may write. JSON validation precedes an atomic replacement.
export function studioLibraryPlugin(root=process.cwd()){
 const folder=path.join(root,'.local','asset-studio'),file=path.join(folder,'library.json');let write=Promise.resolve();
 const middleware=async(req,res,next)=>{if(req.url!=='/__asset-studio/library')return next();res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 const reply=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
 try{if(req.method==='GET'){try{return reply(200,{library:JSON.parse(await readFile(file,'utf8'))});}catch(e){if(e.code==='ENOENT')return reply(200,{library:null});throw e;}}
 if(req.method!=='PUT')return reply(405,{error:'Use GET or PUT'});
 if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return reply(403,{error:'Same-origin writes only'});
 if(req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'Cross-site writes refused'});
 if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'JSON required'});
 const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>8*1024*1024)return reply(413,{error:'Library exceeds 8 MiB'});chunks.push(Buffer.from(chunk));}const text=Buffer.concat(chunks).toString('utf8');
 const library=validateLibrary(JSON.parse(text));
 const job=write.catch(()=>{}).then(async()=>{await mkdir(folder,{recursive:true});try{await copyFile(file,file+'.backup');}catch(e){if(e.code!=='ENOENT')throw e;}const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(library,null,2));await rename(tmp,file);});write=job;await job;reply(200,{saved:true});
 }catch(e){reply(400,{error:e.message});}};
 return {name:'studio-local-library',configureServer(server){server.middlewares.use(middleware);},configurePreviewServer(server){server.middlewares.use(middleware);}};
}
