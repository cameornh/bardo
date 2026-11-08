export function packUniforms(layout,values){
 const data=new ArrayBuffer(layout.size),f=new Float32Array(data),i=new Int32Array(data);
 for(const field of layout.fields){
  const value=values[field.name],v=value?.elements||value?.toArray?.()||value;
  if(v==null)continue;
  const flat=Array.isArray(v)&&typeof v[0]==='object'?v.flatMap(x=>x.toArray?.()||x):v;
  const dst=field.integer?i:f,base=field.offset/4;
  for(let a=0;a<(field.length||1);a++)for(let k=0;k<field.count;k++){
   const offset=base+a*(field.length?field.stride/4:0)+(field.matrix?Math.floor(k/field.matrix)*4+k%field.matrix:k);
   dst[offset]=Number(typeof flat==='number'||typeof flat==='boolean'?flat:flat[a*field.count+k]??0);
  }
 }
 return new Uint8Array(data);
}

export function cloneUniformValue(v){
 if(v==null||typeof v!=='object'||v.isTexture)return v;
 if(v.elements)return v.elements.slice();if(v.toArray)return v.toArray();
 if(ArrayBuffer.isView(v))return v.slice();if(Array.isArray(v))return v.map(cloneUniformValue);
 throw Error('Unsupported scene uniform value');
}
