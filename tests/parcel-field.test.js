import test from 'node:test';
import assert from 'node:assert/strict';
import {parcelKernel,parcelDensity,parcelBricks,brickHash,PARCEL_ISO,PARCEL_BRICK} from '../src/parcel-field.js';
const parcel=(position,radius=.12,kind='sand')=>({position,radius,kind,volume:4*Math.PI/3*radius**3,wet:.4});
test('nearby Gaussian volumes have one connected implicit surface with continuous normals',()=>{
 const items=[parcel([-.1,0,0]),parcel([.1,0,0])];for(let x=-.1;x<=.1;x+=.01)assert.ok(parcelDensity(items,[x,0,0],'sand').density>PARCEL_ISO);
 const density=p=>parcelDensity(items,p,'sand');for(let x=-.3;x<.3;x+=.03){const p=[x,.09,.02],sample=density(p),e=.00001;for(let k=0;k<3;k++){const a=p.slice(),b=p.slice();a[k]+=e;b[k]-=e;assert.ok(Math.abs((density(a).density-density(b).density)/(2*e)-sample.gradient[k])<1e-5);}}
 assert.equal(parcelDensity(items,[0,0,0],'water').density,0,'materials share a kernel but not their density');
});
test('Gaussian density integrates to parcel volume at different scales',()=>{
 for(const radius of [.025,.08,.25]){const p=parcel([0,0,0],radius),{sigma,amplitude}=parcelKernel(p);assert.ok(Math.abs(amplitude*(2*Math.PI)**1.5*sigma**3-p.volume)<1e-12);}
});
test('sparse field retains every occupied brick across negative coordinates and hash collisions',()=>{
 const items=Array.from({length:90},(_,i)=>parcel([Math.sin(i)*20,i%4-2,Math.cos(i)*20]));const {bricks,table,capacity}=parcelBricks(items);for(let id=0;id<bricks.length;id++){const b=bricks[id];let slot=brickHash(...b.cell,capacity-1),count=0;while(table[slot*4+3]!==id+1){slot=(slot+1)&(capacity-1);assert.ok(++count<64,'GPU lookup limit');}assert.deepEqual(Array.from(table.slice(slot*4,slot*4+3)),b.cell);for(const p of b.items)assert.ok(p.position.every((v,k)=>v>=(b.cell[k]-1)*PARCEL_BRICK&&v<=(b.cell[k]+2)*PARCEL_BRICK));}
});
