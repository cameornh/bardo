// Four neighbors per texel; adjacent simulation invocations read adjacent
// texels. Blocks of 64 particles keep the texture below 4096 rows at 32k.
export function packNeighborTexture(source, target, count) {
 target.fill(-1);
 for (let base=0;base<count;base+=64) {
  const end=Math.min(count,base+64), tile=base/64*8192;
  for (let a=0;a<128;a+=4) {
   const row=tile+(a%32)/4*1024+Math.floor(a/32)*256;
   for (let i=base;i<end;i++) {
    const from=i*128+a,to=row+(i-base)*4;
    target[to]=source[from];target[to+1]=source[from+1];
    target[to+2]=source[from+2];target[to+3]=source[from+3];
   }
  }
 }
 return target;
}
