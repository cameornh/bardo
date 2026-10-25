// A fractional deadline avoids accidentally capping 144 Hz displays at 48 FPS
// when limiting presentation to 60. Physics jobs keep their independent queue.
export class FramePacer{
 constructor(hz=60){this.period=1000/hz;this.next=null;}
 shouldRender(time){
  if(!Number.isFinite(time))return false;
  if(this.next===null){this.next=time+this.period;return true;}
  if(time+.01<this.next)return false;
  this.next+=this.period;
  // A missed deadline permits one fresh frame, never a catch-up burst.
  if(this.next<=time)this.next=time+this.period;
  return true;
 }
}
