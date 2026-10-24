export function waterFixture(n=12,s=.2){
 const items=[];for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++)items.push({sourceIndex:items.length,kind:'water',position:[x,y,z].map(v=>(v+.5)*s),radius:s*.8,volume:s**3,dye:.2,tannin:.1,sediment:.03});
 return {items,lab:{generation:1,spacing:s,spec:{scale:10},velocities:new Float32Array(items.length*4)}};
}
