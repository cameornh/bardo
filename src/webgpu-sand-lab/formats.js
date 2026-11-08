import * as THREE from 'three';
export function sceneTextureFormat(texture,compact=true){
 // Only native channel count changes. Preserve 32-bit values, HDR, distances,
 // surface records and every render attachment's original precision.
 const channels=compact&&texture.isDataTexture?(texture.format===THREE.RedFormat?'r':texture.format===THREE.RGFormat?'rg':'rgba'):'rgba';
 return channels+(texture.type===THREE.UnsignedByteType?'8unorm':texture.type===THREE.HalfFloatType?'16float':'32float');
}
export function textureBytes(format){
 if(format==='depth32float')return 4;
 const match=/^(r|rg|rgba)(8|16|32)/.exec(format);
 if(!match)throw Error('Unknown scene texture format: '+format);
 return ({r:1,rg:2,rgba:4}[match[1]])*Number(match[2])/8;
}
export function packTextureRows(image,sourceChannels,format){
 const bytes=textureBytes(format),channels=format.startsWith('rgba')?4:format.startsWith('rg')?2:1,size=bytes/channels;
 const row=Math.ceil(image.width*bytes/256)*256,data=new Uint8Array(row*image.height),src=new Uint8Array(image.data.buffer,image.data.byteOffset,image.data.byteLength);
 if(channels===sourceChannels){for(let y=0;y<image.height;y++)data.set(src.subarray(y*image.width*bytes,(y+1)*image.width*bytes),y*row);}
 else{
  if(channels!==4||sourceChannels>channels)throw Error('Unsupported channel conversion');
  const view=new DataView(data.buffer);
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
   const at=y*row+x*bytes,offset=(y*image.width+x)*sourceChannels*size;
   data.set(src.subarray(offset,offset+sourceChannels*size),at);
   if(size===4)view.setFloat32(at+3*size,1,true);else if(size===2)view.setUint16(at+3*size,0x3c00,true);else data[at+3]=255;
  }
 }
 return {row,data};
}
