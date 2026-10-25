import {access} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

export function chromeCandidates(env){
 return [env.ProgramFiles,env['ProgramFiles(x86)'],env.LOCALAPPDATA].filter(Boolean).map(root=>join(root,'Google','Chrome','Application','chrome.exe'));
}
export function chromeOpenGLArgs(profile,url){
 const target=new URL(url);if(target.protocol!=='http:'||target.hostname!=='127.0.0.1')throw Error('The test launcher only opens local HTTP pages.');
 return ['--user-data-dir='+profile,'--use-gl=angle','--use-angle=gl','--no-first-run',target.href];
}
export async function openChromeOpenGL(url,{platform=process.platform,env=process.env,exists=async p=>{try{await access(p);return true;}catch{return false;}},launch=spawn}={}){
 if(platform!=='win32')throw Error('The separate OpenGL Chrome launcher is for Windows.');
 if(!env.LOCALAPPDATA)throw Error('Windows LOCALAPPDATA is unavailable.');
 let chrome;for(const candidate of chromeCandidates(env))if(await exists(candidate)){chrome=candidate;break;}
 if(!chrome)throw Error('Google Chrome was not found in its standard installation folders.');
 const profile=join(env.LOCALAPPDATA,'Bardo-Chrome-OpenGL'),args=chromeOpenGLArgs(profile,url);
 const child=launch(chrome,args,{detached:true,stdio:'ignore'});
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});child.unref();
 return {chrome,profile};
}
