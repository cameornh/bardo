import {createCanvas} from '@napi-rs/canvas';
const shader=`struct Out{@builtin(position) p:vec4f,@location(0) uv:vec2f};@vertex fn vs(@builtin(vertex_index)i:u32)->Out{var v=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:Out;o.p=vec4f(v[i],0,1);o.uv=vec2f((v[i].x+1)*.5,(1-v[i].y)*.5);return o;}@group(0)@binding(0)var image:texture_2d<f32>;@fragment fn fs(i:Out)->@location(0)vec4f{return textureLoad(image,vec2i(i.uv*vec2f(textureDimensions(image))),0);}`;
function visible(el){return !el.closest('[hidden]')&&el.style?.display!=='none';}
export class NativeUI{
 constructor(dom){this.dom=dom;this.scroll=0;this.hits=[];this.dirty=true;this.last=0;this.status='Starting native wgpu…';this.textLayouts=new Map();}
 async init(device,format){this.device=device;const module=device.createShaderModule({label:'native controls',code:shader});this.pipeline=await device.createRenderPipelineAsync({label:'native controls',layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]}});}
 build(width,height){
  if(!this.canvas||this.canvas.width!==width||this.canvas.height!==height){this.canvas=createCanvas(width,height);this.dirty=true;}
  const c=this.canvas.getContext('2d'),doc=this.dom.document;this.hits=[];c.clearRect(0,0,width,height);c.font='13px sans-serif';c.textBaseline='top';
  const text=(s,x,y,w=290,color='#dce6eb')=>{const key=w+':'+String(s);let lines=this.textLayouts.get(key);if(!lines){lines=[];for(const line of String(s).split('\n')){let part='';for(const word of line.split(' ')){if(c.measureText(part+word).width>w&&part){lines.push(part);part='';}part+=word+' ';}lines.push(part);}if(this.textLayouts.size>512)this.textLayouts.clear();this.textLayouts.set(key,lines);}c.fillStyle=color;for(let i=0;i<lines.length;i++){const yy=y+i*17;if(yy>=-17&&yy<height)c.fillText(lines[i],x,yy);}return lines.length*17;};
  const box=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
  const control=(el,x,y,w,h,kind)=>{this.hits.push({el,x,y,w,h,kind});};
  const toggle=doc.getElementById('test-controls-toggle'),left=Math.max(0,width-316),panel=doc.getElementById('panel');
  box(left,8,308,28,'#213440');text(toggle?.textContent||'Test controls',left+8,14);if(toggle)control(toggle,left,8,308,28,'button');
  if(panel&&!panel.hidden){box(left,42,308,height-50,'rgba(23,36,44,.96)');c.save();c.beginPath();c.rect(left,42,308,height-50);c.clip();let y=52-this.scroll;
   const walk=(el)=>{if(!visible(el))return;const tag=el.tagName,type=el.type;
    if(tag==='INPUT'){
     if(type==='range'){const value=Number(el.value),min=Number(el.min||0),max=Number(el.max||100);box(left+12,y+9,278,3,'#64747c');box(left+12+278*(value-min)/Math.max(1e-10,max-min)-4,y+4,8,13,'#b2d3e2');control(el,left+12,y-1,278,24,'range');y+=28;return;}
     if(type==='checkbox'){box(left+12,y,14,14,el.checked?'#96c8dc':'#3f525d');const label=el.parentElement.tagName==='LABEL'?el.parentElement.textContent.trim():el.getAttribute('aria-label')||el.id;text((el.checked?'✓  ':'   ')+label,left+14,y);control(el,left+10,y,285,23,'check');y+=25;return;}
     box(left+12,y,278,24,type==='color'?el.value:'#334954');text(el.value,left+18,y+4,265,type==='color'?'#fff':'#dce6eb');control(el,left+12,y,278,24,'text');y+=30;return;
    }
    if(tag==='SELECT'){box(left+12,y,278,28,'#334954');text((el.selectedOptions[0]?.textContent||el.value)+' ▾',left+18,y+6,264);control(el,left+12,y,278,28,'select');y+=34;return;}
    if(tag==='BUTTON'||tag==='SUMMARY'){const h=Math.max(26,17*Math.ceil(c.measureText(el.textContent).width/264)+10);box(left+12,y,278,h,el.disabled||panel.inert?'#293943':'#344e5d');text(el.textContent,left+18,y+5,264);control(el,left+12,y,278,h,tag==='BUTTON'?'button':'summary');y+=h+5;return;}
    if(tag==='CANVAS'){const image=this.dom.canvasImage(el),h=278*el.height/el.width;if(image)c.drawImage(image,left+12,y,278,h);el.nativeRect={left:left+12,top:y,width:278,height:h};control(el,left+12,y,278,h,'canvas');y+=h+8;return;}
    if(['PRE','SMALL','LEGEND','HEADER','OUTPUT','A'].includes(tag)){if(tag==='OUTPUT')return;y+=text(el.textContent,left+12,y,278,tag==='LEGEND'?'#b6d8e6':'#c3d0d7')+8;return;}
    if(tag==='LABEL'&&!el.querySelector('input[type=checkbox]')){const title=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim(),out=el.querySelector('output');if(title)y+=text(title+(out?'  '+out.textContent:''),left+12,y,278)+4;}
    if(tag==='DETAILS'&&!el.open){const summary=el.querySelector('summary');if(summary)walk(summary);return;}
    for(const child of el.children)walk(child);
    if(tag==='FIELDSET')y+=12;
   };for(const child of panel.children)walk(child);this.maxScroll=Math.max(0,y+this.scroll-height+60);c.restore();
  }
  const hud=doc.getElementById('live-rate')?.textContent||this.status;box(8,height-48,Math.min(width-16,c.measureText(hud).width+16),40,'rgba(10,18,24,.75)');text(hud,14,height-43,width-28);text('Native wgpu · '+this.status,14,height-25,width-28,'#b6cbd5');
  if(!doc.getElementById('crosshair')?.hidden)text('+',width/2-4,height/2-8,20);
  if(this.popup){const p=this.popup;box(left+10,48,286,Math.min(height-110,p.options.length*27),'#263f4c');for(let i=0;i<p.options.length;i++){text((p.options[i].disabled?'× ':'')+p.options[i].textContent,left+17,54+i*27,270);control(p.el,left+10,48+i*27,286,27,'option:'+i);}}
  if(this.edit){box(16,60,Math.min(width-32,450),65,'#263f4c');text('Enter value, then Return (Escape cancels)',24,68,430);text(this.edit.value,24,93,430);}
  if(this.error){box(12,60,width-24,160,'#472829');text(this.error,20,68,width-40,'#fff');}
  return this.canvas;
 }
 async draw(context,width,height){
  const d=this.device;if(!d||!width||!height)return;
  if(this.dirty||performance.now()-this.last>700||this.width!==width||this.height!==height){this.build(width,height);this.width=width;this.height=height;this.last=performance.now();this.dirty=false;
   if(!this.texture||this.tw!==width||this.th!==height){this.texture?.destroy();this.texture=d.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});this.tw=width;this.th=height;this.group=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.texture.createView()}]});}
   const pixels=this.canvas.getContext('2d').getImageData(0,0,width,height).data;d.queue.writeTexture({texture:this.texture},pixels,{bytesPerRow:width*4},[width,height]);
  }
  const encoder=d.createCommandEncoder({label:'native controls'}),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'load',storeOp:'store'}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.group);pass.draw(3);pass.end();d.queue.submit([encoder.finish()]);
 }
 pointer(type,x,y,delta=0,props={}){
  if(this.drag){if(type==='move'||type==='up'){this.range(this.drag,x);if(type==='up'){this.dom.emit(this.drag.el,'change');this.drag=null;}return true;}}
  const hit=[...this.hits].reverse().find(h=>(y>=42||h.el.id==='test-controls-toggle')&&x>=h.x&&x<h.x+h.w&&y>=h.y&&y<h.y+h.h);
  const panel=this.dom.document.getElementById('panel'),overPanel=panel&&!panel.hidden&&x>=this.width-316;
  if(type==='wheel'&&overPanel){this.scroll=Math.min(this.maxScroll,Math.max(0,this.scroll+delta));this.popup=null;this.dirty=true;return true;}
  if(!hit)return overPanel;
  if(hit.kind==='canvas'){this.dom.emit(hit.el,type==='move'?'pointermove':type==='down'?'click':'pointerup',{...props,clientX:x,clientY:y});return true;}
  if(type!=='down')return true;
  const {el,kind}=hit;if(el.disabled||panel?.inert&&el!==this.dom.document.getElementById('test-controls-toggle'))return true;
  if(kind==='range'){this.drag=hit;this.range(hit,x);}
  else if(kind==='check'){el.checked=!el.checked;this.dom.emit(el,'input');this.dom.emit(el,'change');}
  else if(kind==='select')this.popup={el,options:[...el.options]};
  else if(kind.startsWith('option:')){const o=this.popup.options[Number(kind.split(':')[1])];if(!o.disabled){el.value=o.value;this.dom.emit(el,'input');this.dom.emit(el,'change');}this.popup=null;}
  else if(kind==='text')this.edit={el,value:el.value,selected:true};
  else if(kind==='summary')el.parentElement.open=!el.parentElement.open;
  else this.dom.emit(el,'click');
  this.dirty=true;return true;
 }
 range(hit,x){const el=hit.el,min=Number(el.min||0),max=Number(el.max||100),step=Number(el.step)||1,v=min+(max-min)*Math.max(0,Math.min(1,(x-hit.x)/hit.w));el.value=String(Math.min(max,Math.max(min,min+Math.round((v-min)/step)*step)));this.dom.emit(el,'input');this.dirty=true;}
 key(key){if(!this.edit)return false;if(key==='Escape')this.edit=null;else if(key==='Enter'){const {el,value}=this.edit;if(el.type!=='color'||/^#[\da-f]{6}$/i.test(value)){el.value=value;this.dom.emit(el,'input');this.dom.emit(el,'change');this.edit=null;}}else if(key==='Backspace'){this.edit.value=this.edit.selected?'':this.edit.value.slice(0,-1);this.edit.selected=false;}else if(key.length===1){this.edit.value=(this.edit.selected?'':this.edit.value)+key;this.edit.selected=false;}this.dirty=true;return true;}
 dispose(){this.texture?.destroy();}
}
