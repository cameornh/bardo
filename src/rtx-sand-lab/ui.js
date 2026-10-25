// Bundle the UI styles into the same module that creates the overlays. The
// panel and HUD must not depend on a separately loaded dynamic CSS chunk.
import labStyle from '../sand-lab/style.css?inline';

const overlayStyle=`
body{overflow:hidden;min-height:100vh}
#view{position:fixed;inset:0;z-index:0;display:block;width:100vw;height:100vh}
#panel{position:fixed;right:8px;top:42px;z-index:20;width:min(286px,calc(100vw - 16px));max-height:calc(100vh - 50px);overflow:auto}
#panel[hidden]{display:none!important}
#panel .panel-title{font-weight:600;margin-bottom:10px}
#test-controls-toggle{position:fixed;right:8px;top:8px;z-index:21}
#hint{position:fixed;left:12px;bottom:8px;z-index:20;pointer-events:none}
#live-rate{display:block;color:#fff;font-variant-numeric:tabular-nums;font-size:13px;text-shadow:0 1px 3px #000}
`;

export function installLabUI(doc=document){
 let style=doc.getElementById('rtx-lab-ui-style');
 if(!style){style=doc.createElement('style');style.id='rtx-lab-ui-style';doc.head.append(style);}
 style.textContent=labStyle+'\n'+overlayStyle;
 const panel=doc.getElementById('panel'),button=doc.getElementById('test-controls-toggle'),hud=doc.getElementById('live-rate');
 function showControls(visible){
  panel.hidden=!visible;panel.style.setProperty('display',visible?'block':'none','important');
  panel.setAttribute('aria-hidden',String(!visible));button.setAttribute('aria-expanded',String(visible));
  button.textContent=visible?'Hide test controls':'Show test controls';
 }
 button.onclick=()=>showControls(panel.hidden);
 function updateRates({fps=0,simRate=0,paused=false}={}){
  const f=Number.isFinite(fps)?Math.max(0,fps):0,r=paused?0:Number.isFinite(simRate)?Math.max(0,simRate):0;
  hud.textContent=`FPS: ${f.toFixed(1)} · Simulation: ${r.toFixed(2)}× realtime${paused?' · paused':''}`;
 }
 showControls(true);updateRates();
 return {showControls,updateRates};
}
