import {buildNeighbors,collideBoundary,WATER_CONTACT_SKIN} from './water-lab-model.js';
import {makeBody,bodyDistance} from './objects.js';

export function pressureFixtures(){
 const spacing=.14,positions=new Float32Array(175*4);
 for(let i=0;i<175;i++)positions.set([(i%7-3)*.115,.04+(Math.floor(i/7)%5)*.115,(Math.floor(i/35)-2)*.115,i%23===0?1:0],i*4);
 const cup=makeBody('glass','cup',.22,[.16,.12,0]);cup.tilt=.63;cup.pitch=.34;
 const ground=p=>Math.min((p[1]+.03-.18*p[0])*.65,bodyDistance(p,cup));
 const sparse=positions.slice();for(let i=0;i<175;i++){sparse[i*4]*=3;sparse[i*4+1]*=2;sparse[i*4+2]*=3;}
 return [
  {name:'Dense free water and held points',positions},
  {name:'Tilted cup and sloping ground',positions,boundary:ground,collide:p=>collideBoundary(p,spacing*WATER_CONTACT_SKIN,ground)},
  {name:'Sparse surface water',positions:sparse},
 ].map(f=>({...f,spacing,neighbors:buildNeighbors(f.positions,spacing).data}));
}
