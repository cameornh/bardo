// A refittable broad phase for the live CPU queries. Leaves store current
// geometry, never edit history. Exact SDF evaluation still owns every contact.
export class ParcelQueryTree {
 constructor(){this.items=[];this.nodes=[];this.leaves=[];this.root=-1;this.rebuilds=0;this.refits=0;this.visits=0;}
 refresh(items){
  const changed=items.length!==this.items.length||items.some((q,i)=>q.parcel!==this.items[i]);
  if(changed){
   this.items=items.map(q=>q.parcel);this.nodes=[];this.leaves=[];
   const build=(ids,parent=-1)=>{const at=this.nodes.length,node={parent,left:-1,right:-1,id:-1,lo:[0,0,0],hi:[0,0,0]};this.nodes.push(node);
    if(ids.length===1){node.id=ids[0];this.leaves[node.id]=at;this.bounds(node,items[node.id]);}
    else{let axis=0,extent=-Infinity;for(let k=0;k<3;k++){let lo=Infinity,hi=-Infinity;for(const i of ids){lo=Math.min(lo,items[i].position[k]);hi=Math.max(hi,items[i].position[k]);}if(hi-lo>extent){extent=hi-lo;axis=k;}}
     ids.sort((a,b)=>items[a].position[axis]-items[b].position[axis]||a-b);const mid=ids.length>>1;
     node.left=build(ids.slice(0,mid),at);node.right=build(ids.slice(mid),at);this.union(node);
    }return at;
   };
   this.root=items.length?build(items.map((_,i)=>i)):-1;this.rebuilds++;return;
  }
  for(let i=0;i<items.length;i++){
   const node=this.nodes[this.leaves[i]];if(!this.bounds(node,items[i]))continue;this.refits++;
   for(let at=node.parent;at>=0;at=this.nodes[at].parent){if(!this.union(this.nodes[at]))break;}
  }
 }
 bounds(node,q){let changed=false;for(let k=0;k<3;k++){const lo=q.position[k]-q.radius,hi=q.position[k]+q.radius;changed ||= node.lo[k]!==lo||node.hi[k]!==hi;node.lo[k]=lo;node.hi[k]=hi;}return changed;}
 union(node){const a=this.nodes[node.left],b=this.nodes[node.right];let changed=false;for(let k=0;k<3;k++){const lo=Math.min(a.lo[k],b.lo[k]),hi=Math.max(a.hi[k],b.hi[k]);changed ||= lo!==node.lo[k]||hi!==node.hi[k];node.lo[k]=lo;node.hi[k]=hi;}return changed;}
 query(p,r,out=[]){
  out.length=0;if(this.root<0)return out;const stack=[this.root];this.visits=0;r=Math.max(0,r);
  while(stack.length){const node=this.nodes[stack.pop()];this.visits++;if(p[0]+r<node.lo[0]||p[0]-r>node.hi[0]||p[1]+r<node.lo[1]||p[1]-r>node.hi[1]||p[2]+r<node.lo[2]||p[2]-r>node.hi[2])continue;
   if(node.id>=0)out.push(node.id);else stack.push(node.right,node.left);
  }
  // Smooth unions are order dependent. Spatial traversal must not reorder them.
  return out.sort((a,b)=>a-b);
 }
 refit(ids,items){
  for(const i of ids){const node=this.nodes[this.leaves[i]];if(!node||!this.bounds(node,items[i]))continue;this.refits++;
   for(let at=node.parent;at>=0;at=this.nodes[at].parent)if(!this.union(this.nodes[at]))break;
  }
 }
}
