import {stamp} from '../src/asset-studio/model.js';
export function sculptFixture(){const s=[stamp('box','add',[0,1,0],[1,1,1],'clay',.08)];for(let i=0;i<24;i++)s.push(editStamp(i));return s;}
export function editStamp(i){return stamp(i%3===0?'box':'sphere',i%3===0?'paint':'subtract',[Math.sin(i*2.4)*.85,1+Math.cos(i*1.7)*.85,Math.cos(i*.9)*.85],[.19,.2,.18],i%2?'stone':'clay',.07);}
export const sculptSpacing=.065;
