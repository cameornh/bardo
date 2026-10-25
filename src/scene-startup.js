// Keep loading failures outside the large scene module graph and GPU setup.
export async function loadScene(params,boot,load){
 if(params.get('startup')==='report'){boot.report();return 'report';}
 const scene=params.get('scene'),kind=(!scene||scene==='sand-lab')?(params.get('profile')==='safe'?'safe':'rtx'):'snapshot';
 boot.mark('Loading '+(kind==='rtx'?'GPU sand lab':kind==='safe'?'safe sand lab':'historical scene')+' modules');
 try{
  const module=await load(kind);
  if(kind==='rtx')await module.startRTXApp(boot);
  else boot.watchLegacy();
  return kind;
 }catch(error){boot.fail(error);return 'failed';}
}
