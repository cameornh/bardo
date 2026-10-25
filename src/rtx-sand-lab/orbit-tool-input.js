import {MOUSE} from 'three';

// In orbit view, a click uses the selected tool; a drag only moves the camera.
// Wind keeps its continuous left-button stroke, with right-drag available to look.
export function installOrbitToolInput({canvas,controls,firstPerson,locked,tool,ray,action,wind,requestLock,root=window}){
 let press=null;
 controls.mouseButtons.LEFT=MOUSE.ROTATE;controls.mouseButtons.RIGHT=MOUSE.ROTATE;
 const clear=()=>{press=null;wind(false);};
 const down=e=>{
  if(e.button!==0)return;
  canvas.focus({preventScroll:true});
  if(firstPerson()){
   if(!locked()){requestLock();return;}
   action(ray(e));wind(tool()==='wind');return;
  }
  if(tool()==='wind'){
   e.stopImmediatePropagation();canvas.setPointerCapture?.(e.pointerId);action(ray(e));wind(true);press={id:e.pointerId,paint:true};return;
  }
  press={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
 };
 const move=e=>{ray(e);if(press?.id===e.pointerId&&!press.paint&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>4)press.moved=true;};
 const up=e=>{
  const p=press;clear();
  if(!p||p.id!==e.pointerId||p.paint||p.moved||firstPerson()||tool()==='orbit')return;
  if(Math.hypot(e.clientX-p.x,e.clientY-p.y)<=4)action(ray(e));
 };
 canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move);
 root.addEventListener('pointerup',up);root.addEventListener('pointercancel',clear);root.addEventListener('blur',clear);
 return {clear,dispose(){canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',clear);root.removeEventListener('blur',clear);}};
}
