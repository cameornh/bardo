import {MOUSE} from 'three';

// In orbit view, a click uses the selected tool; a drag only moves the camera.
// Wind keeps its continuous left-button stroke, with right-drag available to look.
export function installOrbitToolInput({canvas,controls,firstPerson,locked,tool,ray,action,wind,requestLock,look=()=>{},lockUnavailable=()=>{},root=window}){
 let press=null,lockPending=false,lockFailed=false;
 // Embedded browsers can reject pointer lock with a Chromium internal error.
 // This is an input capability failure, never a fatal scene/graphics failure.
 const failed=()=>{lockPending=false;lockFailed=true;lockUnavailable();};
 const capture=()=>{if(lockPending||lockFailed)return;lockPending=true;try{Promise.resolve(requestLock()).then(()=>{lockPending=false;},failed);}catch{failed();}};
 controls.mouseButtons.LEFT=MOUSE.ROTATE;controls.mouseButtons.RIGHT=MOUSE.ROTATE;
 const clear=()=>{press=null;wind(false);};
 const down=e=>{
  if(e.button!==0&&!(firstPerson()&&e.button===2))return;
  canvas.focus({preventScroll:true});
  if(firstPerson()){
   if(!locked()){
    press={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false,look:true,click:lockFailed&&e.button===0};
    canvas.setPointerCapture?.(e.pointerId);if(e.button===0)capture();return;
   }
   if(e.button!==0)return;
   action(ray(e));wind(tool()==='wind');return;
  }
  if(tool()==='wind'){
   e.stopImmediatePropagation();canvas.setPointerCapture?.(e.pointerId);action(ray(e));wind(true);press={id:e.pointerId,paint:true};return;
  }
  press={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
 };
 const move=e=>{ray(e);if(press?.id!==e.pointerId)return;if(!press.paint&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>4)press.moved=true;
  if(press.look&&!locked()){look(e.clientX-press.lastX,e.clientY-press.lastY);press.lastX=e.clientX;press.lastY=e.clientY;}
 };
 const up=e=>{
  const p=press;clear();
  if(!p||p.id!==e.pointerId||p.paint||p.moved||tool()==='orbit')return;
  if(firstPerson()&&(!p.click||locked()))return;
  if(Math.hypot(e.clientX-p.x,e.clientY-p.y)<=4)action(ray(e));
 };
 canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move);
 root.addEventListener('pointerup',up);root.addEventListener('pointercancel',clear);root.addEventListener('blur',clear);
 canvas.ownerDocument?.addEventListener('pointerlockerror',failed);
 return {clear,dispose(){canvas.ownerDocument?.removeEventListener('pointerlockerror',failed);canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',clear);root.removeEventListener('blur',clear);}};
}
