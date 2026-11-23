import {Euler,Vector3} from 'three';

const EYE=1.62;
export class StudioWalk {
 constructor(view){this.view=view;this.angle=new Euler(0,0,0,'YXZ');this.forward=new Vector3();this.speedY=0;}
 get enabled(){return !!this.saved;}
 enter(){
  if(this.enabled)return;
  const {camera,controls}=this.view;
  this.saved={position:camera.position.clone(),target:controls.target.clone()};
  this.angle.setFromQuaternion(camera.quaternion,'YXZ');this.angle.x=Math.max(-.55,Math.min(.55,this.angle.x));this.speedY=0;this.space=false;
  const {bed,water}=this.surfaces(camera.position);
  camera.position.y=Math.max(bed+EYE,Number.isFinite(water)?water+.14:-Infinity);
  this.view.firstPerson=true;controls.enabled=false;this.aim();
 }
 exit(){
  if(!this.enabled)return;
  const {camera,controls}=this.view;
  camera.position.copy(this.saved.position);controls.target.copy(this.saved.target);
  this.view.firstPerson=false;controls.enabled=true;controls.update();this.saved=null;
 }
 surfaces(p){
  const v=this.view,sim=v.activePhysics;
  const bed=(sim?.sandTerrain??v.sand)?.height(p.x,p.z)??(v.sea?-40:sim?.cuts?.offset(p.x,p.z)??0);
  const water=v.sea?.height(p.x,p.z)??-Infinity;
  return {bed,water};
 }
 look(dx,dy){
  if(!this.enabled)return;
  this.angle.y-=dx*.0025;this.angle.x=Math.max(-1.53,Math.min(1.53,this.angle.x-dy*.0025));this.aim();
 }
 aim(){
  const {camera,controls}=this.view;
  camera.quaternion.setFromEuler(this.angle);camera.getWorldDirection(this.forward);
  controls.target.copy(camera.position).addScaledVector(this.forward,2);
 }
 step(dt,keys){
  const p=this.view.camera.position,yaw=this.angle.y;
  const strafe=Number(keys.has('KeyD'))-Number(keys.has('KeyA')),ahead=Number(keys.has('KeyW'))-Number(keys.has('KeyS'));
  const step=(keys.has('ShiftLeft')||keys.has('ShiftRight')?5.4:2.6)*dt/Math.max(1,Math.hypot(strafe,ahead));
  p.x+=(Math.cos(yaw)*strafe-Math.sin(yaw)*ahead)*step;p.z+=(-Math.sin(yaw)*strafe-Math.cos(yaw)*ahead)*step;
  const {bed,water}=this.surfaces(p),jump=keys.has('Space'),waterborne=water>bed+.30&&p.y<water+.36;
  if(waterborne){
   const target=water+(jump ? .28 : .12);
   this.speedY+=(12*(target-p.y)-6*this.speedY)*dt;
  }else if(jump&&!this.space&&p.y<=bed+EYE+.035)this.speedY=4.8;
  else this.speedY-=9.81*dt;
  p.y+=this.speedY*dt;
  if(p.y<=bed+EYE){p.y=bed+EYE;this.speedY=Math.max(0,this.speedY);}
  this.space=jump;this.aim();
 }
}

// Pointer lock sends relative mouse motion to the canvas even without a button.
// A captured drag is a different browser mode and is illegal during pointer lock.
export function bindWalkMouse(canvas,walk,{onLocked,onUnlocked}){
 const doc=canvas.ownerDocument,events=new AbortController(),options={signal:events.signal};
 let hadLock=false,pending=false,retriedOnCanvas=false,drag=null;
 function request(){
  if(!walk.enabled||pending||doc.pointerLockElement||!canvas.requestPointerLock)return;
  pending=true;
  const refused=()=>{pending=false;};
  try{canvas.requestPointerLock()?.catch(refused);}catch{refused();}
 }
 function changed(){
  const locked=doc.pointerLockElement===canvas,wasLocked=hadLock;
  hadLock=locked;pending=false;
  if(locked){
   drag=null;
   if(walk.enabled)onLocked();else doc.exitPointerLock();
  }else if(wasLocked&&walk.enabled)onUnlocked();
 }
 doc.addEventListener('pointerlockchange',changed,options);
 doc.addEventListener('pointerlockerror',()=>{pending=false;},options);
 doc.addEventListener('mousemove',e=>{
  if(walk.enabled&&doc.pointerLockElement===canvas)walk.look(e.movementX,e.movementY);
 },options);
 canvas.addEventListener('pointerdown',e=>{
  if(!walk.enabled||doc.pointerLockElement||(e.button!==2&&e.pointerType!=='touch'))return;
  drag={id:e.pointerId,x:e.clientX,y:e.clientY};
  // A canvas gesture may be accepted even when the checkbox gesture was refused.
  if(e.button===2&&!pending&&!retriedOnCanvas){retriedOnCanvas=true;request();}
 },options);
 doc.addEventListener('pointermove',e=>{
  if(!walk.enabled||doc.pointerLockElement||drag?.id!==e.pointerId)return;
  if(e.pointerType!=='touch'&&!(e.buttons&2)){drag=null;return;}
  walk.look(e.clientX-drag.x,e.clientY-drag.y);
  drag.x=e.clientX;drag.y=e.clientY;
 },options);
 const finish=e=>{if(drag?.id===e.pointerId)drag=null;};
 doc.addEventListener('pointerup',finish,options);
 doc.addEventListener('pointercancel',finish,options);
 doc.defaultView.addEventListener('blur',()=>{drag=null;},options);
 canvas.addEventListener('contextmenu',e=>{if(walk.enabled)e.preventDefault();},options);
 return {
  request,
  captureToolDrag(id){
   if(walk.enabled||doc.pointerLockElement||!canvas.isConnected)return;
   try{canvas.setPointerCapture(id);}
   catch(e){if(e.name!=='NotFoundError'&&e.name!=='InvalidStateError')throw e;}
  },
  release(){
   drag=null;hadLock=false;pending=false;retriedOnCanvas=false;
   if(doc.pointerLockElement===canvas)doc.exitPointerLock();
  },
  dispose(){events.abort();this.release();}
 };
}
