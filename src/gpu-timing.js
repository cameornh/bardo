// Nonblocking GPU diagnostics; unavailable on browsers that omit timer queries.
export class GPUTiming{
 constructor(renderer){this.gl=renderer.getContext();this.ext=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');this.pending=[];this.ms={};}
 begin(label){if(!this.ext||this.pending.length>24||this.active)return;const g=this.gl;this.active={label,query:g.createQuery()};g.beginQuery(this.ext.TIME_ELAPSED_EXT,this.active.query);}
 end(){if(!this.active)return;this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.pending.push(this.active);this.active=null;}
 poll(){if(!this.ext)return;const g=this.gl,disjoint=g.getParameter(this.ext.GPU_DISJOINT_EXT);this.pending=this.pending.filter(p=>{if(!g.getQueryParameter(p.query,g.QUERY_RESULT_AVAILABLE))return true;if(!disjoint){const ms=g.getQueryParameter(p.query,g.QUERY_RESULT)*1e-6;this.ms[p.label]=this.ms[p.label]==null?ms:this.ms[p.label]*.8+ms*.2;}g.deleteQuery(p.query);return false;});}
}
