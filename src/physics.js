import { Vector3, Quaternion } from 'three';

export class Probe {
  constructor(world){this.world=world;this.radius=.43;this.mass=1;this.inverseInertia=1/(.4*this.mass*this.radius**2);this.reset();}
  reset(){this.position=new Vector3(0,3.8,1.7);this.velocity=new Vector3();this.angularVelocity=new Vector3();this.rotation=new Quaternion();this.active=false;this.contacts=0;this.sync();}
  sync(){this.world.objects[5].center=this.position.toArray();}
  setMass(mass){this.mass=mass;this.inverseInertia=1/(.4*mass*this.radius**2);}
  impulse(force,offset=new Vector3()){
    this.velocity.addScaledVector(force,1/this.mass);
    this.angularVelocity.add(new Vector3().crossVectors(offset,force).multiplyScalar(this.inverseInertia));
    this.active=true;
  }
  drop(){this.reset();this.active=true;this.velocity.set(-.7,0,-.25);this.angularVelocity.set(0,2,1.2);}
  dropAt(point){this.drop();this.position.fromArray(point);this.sync();}
  step(dt,gravity=9.81){
    if(!this.active)return;
    this.velocity.y-=gravity*dt;
    this.position.addScaledVector(this.velocity,dt);
    // Small fixed steps bound penetration. Static SDFs absorb contact impulses.
    for(let iteration=0;iteration<4;iteration++){
      const s=this.world.collisionSample(this.position.toArray(),5);
      if(s.distance>=this.radius)break;
      const n=new Vector3(...this.world.normal(s.id,this.position.toArray()));
      this.position.addScaledVector(n,this.radius-s.distance+.0001);
      const offset=n.clone().multiplyScalar(-this.radius);
      const contactVelocity=this.velocity.clone().add(new Vector3().crossVectors(this.angularVelocity,offset));
      const vn=contactVelocity.dot(n);
      if(vn<0){
        const restitution=vn<-.5?.52:0;
        const normalImpulse=-(1+restitution)*vn*this.mass;
        this.velocity.addScaledVector(n,normalImpulse/this.mass);
        const tangent=contactVelocity.clone().addScaledVector(n,-vn);
        const speed=tangent.length();
        if(speed>1e-8){
          tangent.divideScalar(speed);
          const denominator=1/this.mass+this.radius**2*this.inverseInertia;
          const jt=Math.min(speed/denominator,.48*normalImpulse);
          const friction=tangent.multiplyScalar(-jt);
          this.velocity.addScaledVector(friction,1/this.mass);
          this.angularVelocity.add(new Vector3().crossVectors(offset,friction).multiplyScalar(this.inverseInertia));
        }
        this.contacts++;
      }
    }
    const angularSpeed=this.angularVelocity.length();
    if(angularSpeed>1e-8){const q=new Quaternion().setFromAxisAngle(this.angularVelocity.clone().divideScalar(angularSpeed),angularSpeed*dt);this.rotation.premultiply(q).normalize();}
    if(this.position.y < -80 || this.position.y > 200)this.reset();
    this.sync();
  }
}

export class FixedStepper {
  constructor(step=1/120,maxSteps=12){this.step=step;this.maxSteps=maxSteps;this.accumulator=0;this.droppedTime=0;}
  advance(elapsed,callback){
    this.accumulator+=Math.max(0,elapsed);let n=0;
    while(this.accumulator>=this.step&&n<this.maxSteps){callback(this.step);this.accumulator-=this.step;n++;}
    if(this.accumulator>=this.step){const dropped=this.accumulator-this.accumulator%this.step;this.droppedTime+=dropped;this.accumulator%=this.step;}
    return n;
  }
}
