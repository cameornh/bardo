import {AIR, WATER, SOLID, MATERIAL, ATMOSPHERE, relativeHumidity, index3} from './model.js';
export const VIEWS = {
  temperature: {label:'Temperature',unit:'°C',range:[10,34]},
  pressure: {label:'Dynamic pressure',unit:'Pa',range:[-100,100],diverging:true,auto:true},
  gauge: {label:'Total gauge pressure',unit:'Pa',range:[-100,24000],auto:true},
  speed: {label:'Velocity magnitude',unit:'m/s',range:[0,3]},
  humidity: {label:'Specific humidity · air only',unit:'g/kg',range:[0,20]},
  rh: {label:'Relative humidity · air only',unit:'%',range:[0,100]},
  divergence: {label:'Velocity divergence',unit:'1/s',range:[-.001,.001],diverging:true,auto:true},
};
const clamp = v=>Math.max(0,Math.min(1,v));
function color(t, diverging) {
  t=clamp(t);
  const stops=diverging?[[47,107,176],[226,232,233],[195,64,43]]:[[27,36,89],[32,115,151],[50,177,149],[208,218,109],[249,156,65]];
  const p=t*(stops.length-1), i=Math.min(stops.length-2,Math.floor(p)), f=p-i;
  return stops[i].map((v,k)=>Math.round(v+(stops[i+1][k]-v)*f));
}
export function fieldValues(grid, key) {
  if(key==='divergence')return grid.divergence();
  return Float64Array.from(grid.phase,(phase,i)=>{
    if(!phase || (['humidity','rh'].includes(key)&&phase!==AIR))return NaN;
    if(key==='temperature')return grid.temperature[i]-273.15;
    if(key==='pressure')return grid.pressure[i];
    if(key==='gauge')return grid.absolutePressure(i)-ATMOSPHERE;
    if(key==='speed')return Math.hypot(...grid.centerVelocity(i));
    if(key==='humidity')return grid.humidity[i]*1000;
    return relativeHumidity(grid.humidity[i],grid.temperature[i],grid.absolutePressure(i))*100;
  });
}
export class FieldSliceView {
  constructor(canvas, legend) {
    this.canvas=canvas;this.legend=legend;this.context=canvas.getContext('2d');this.key='temperature';this.axis=2;this.slice=.5;this.phase=0;this.arrows=true;this.hover=-1;
  }
  cellFromEvent(event,grid) {
    if(!this.layout)return -1;
    const rect=this.canvas.getBoundingClientRect(), x=(event.clientX-rect.left)*this.canvas.width/rect.width, y=(event.clientY-rect.top)*this.canvas.height/rect.height;
    const {left,top,cw,ch,a,b,nx,ny,slice}=this.layout, ix=Math.floor((x-left)/cw), iy=ny-1-Math.floor((y-top)/ch);
    if(ix<0||iy<0||ix>=nx||iy>=ny)return -1;
    const c=[0,0,0];c[a]=ix;c[b]=iy;c[this.axis]=slice;
    return index3(grid.dims,...c);
  }
  draw(grid) {
    const canvas=this.canvas, ctx=this.context, spec=VIEWS[this.key], values=fieldValues(grid,this.key);
    const axes=this.axis===0?[2,1]:[0,1,2].filter(k=>k!==this.axis), [a,b]=axes, nx=grid.dims[a], ny=grid.dims[b];
    const slice=Math.round(this.slice*(grid.dims[this.axis]-1));
    const left=62, top=56, availableWidth=canvas.width-92, availableHeight=canvas.height-108;
    const cw=Math.min(availableWidth/nx,availableHeight/ny), ch=cw, width=cw*nx,height=ch*ny;
    this.layout={left,top,cw,ch,a,b,nx,ny,slice};
    let [low,high]=spec.range;
    if(spec.auto) {
      low=Infinity;high=-Infinity;
      for(let i=0;i<grid.count;i++)if(grid.phase[i]&&(!this.phase||grid.phase[i]===this.phase)&&Number.isFinite(values[i])){low=Math.min(low,values[i]);high=Math.max(high,values[i]);}
      if(spec.diverging){high=Math.max(Math.abs(low),Math.abs(high),this.key==='divergence'?1e-7:.01);low=-high;}
      if(!Number.isFinite(low)){[low,high]=spec.range;}else if(high-low<1e-9)high=low+1;
    }
    ctx.fillStyle='#101a21';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.font='18px system-ui';ctx.fillStyle='#e4edf0';ctx.fillText(spec.label,left,28);
    ctx.font='12px system-ui';ctx.fillStyle='#9bb3bf';ctx.fillText(`${['X','Y','Z'][this.axis]} = ${((slice+.5)*grid.h).toFixed(2)} m · cell width ${grid.h.toFixed(2)} m`,left,46);
    const cell=[0,0,0];cell[this.axis]=slice;
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++) {
      cell[a]=x;cell[b]=y;const i=index3(grid.dims,...cell), phase=grid.phase[i], valid=phase&&(!this.phase||phase===this.phase)&&Number.isFinite(values[i]);
      ctx.fillStyle=!phase?'#485058':valid?`rgb(${color((values[i]-low)/(high-low),spec.diverging).join(',')})`:'#172731';
      ctx.fillRect(left+x*cw,top+(ny-1-y)*ch,cw+.3,ch+.3);
      if(phase) {
        for(const [da,db] of [[1,0],[0,1]]) {
          if(x+da>=nx||y+db>=ny)continue;
          const next=[...cell];next[a]+=da;next[b]+=db;
          if(grid.phase[index3(grid.dims,...next)]===phase)continue;
          ctx.strokeStyle='#e5d7a9';ctx.lineWidth=1.6;ctx.beginPath();
          if(da){ctx.moveTo(left+(x+1)*cw,top+(ny-y-1)*ch);ctx.lineTo(left+(x+1)*cw,top+(ny-y)*ch);}
          else{ctx.moveTo(left+x*cw,top+(ny-y-1)*ch);ctx.lineTo(left+(x+1)*cw,top+(ny-y-1)*ch);}
          ctx.stroke();
        }
      }
      if(this.arrows&&valid&&x%2===0&&y%2===0) {
        const v=grid.centerVelocity(i), speed=Math.hypot(v[a],v[b]);
        if(speed>.002){const factor=cw*.8/Math.max(.8,speed), dx=v[a]*factor,dy=-v[b]*factor, px=left+(x+.5)*cw,py=top+(ny-y-.5)*ch;
          const angle=Math.atan2(dy,dx),tip=[px+dx*.5,py+dy*.5];ctx.lineWidth=1.4;ctx.strokeStyle='rgba(255,255,255,.85)';ctx.beginPath();ctx.moveTo(px-dx*.5,py-dy*.5);ctx.lineTo(...tip);ctx.moveTo(tip[0]-4*Math.cos(angle-.5),tip[1]-4*Math.sin(angle-.5));ctx.lineTo(...tip);ctx.lineTo(tip[0]-4*Math.cos(angle+.5),tip[1]-4*Math.sin(angle+.5));ctx.stroke();}
      }
      if(i===this.hover){ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(left+x*cw+1,top+(ny-1-y)*ch+1,cw-2,ch-2);}
    }
    ctx.font='13px system-ui';ctx.fillStyle='#beced5';ctx.fillText(`${['X','Y','Z'][a]} (m)  0`,left,top+height+22);ctx.fillText((nx*grid.h).toFixed(1),left+width-24,top+height+22);
    ctx.fillText(`${['X','Y','Z'][b]} (m)`,6,top+12);ctx.fillText((ny*grid.h).toFixed(1),22,top+32);ctx.fillText('0',36,top+height);
    const lg=this.legend.getContext('2d');for(let x=0;x<this.legend.width;x++){lg.fillStyle=`rgb(${color(x/(this.legend.width-1),spec.diverging).join(',')})`;lg.fillRect(x,0,1,this.legend.height);}
    return {low,high,unit:spec.unit,slice};
  }
  readout(grid,i) {
    if(i<0)return 'Hover over the slice for exact field values. Click to inspect or apply the selected probe.';
    const phase=grid.phase[i];if(phase===SOLID)return 'Solid obstacle · impermeable, insulated boundary';
    const p=grid.position(i), v=grid.centerVelocity(i), rh=phase===AIR?relativeHumidity(grid.humidity[i],grid.temperature[i],grid.absolutePressure(i)):null;
    return `${MATERIAL[phase].name} · cell ${i} at ${p.map(v=>v.toFixed(2)).join(', ')} m\nVelocity: [${v.map(v=>v.toFixed(4)).join(', ')}] m/s\nDynamic pressure: ${grid.pressure[i].toFixed(5)} Pa\nAbsolute pressure: ${grid.absolutePressure(i).toFixed(2)} Pa\nTemperature: ${(grid.temperature[i]-273.15).toFixed(3)} °C (${grid.temperature[i].toFixed(3)} K)\n${rh===null?'Humidity: not defined in water':`Specific humidity: ${(grid.humidity[i]*1000).toFixed(4)} g/kg\nRelative humidity: ${(rh*100).toFixed(2)}%`}`;
  }
}
