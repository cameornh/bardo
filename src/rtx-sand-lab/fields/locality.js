import {FixedGridTopology} from './research/fixed-topology.js';
import {LocalPressurePipeline} from './research/local-pressure.js';

// Explicitly installed by the live scene only. Snapshot constructors and
// earlier benchmark URLs keep their original execution policies.
export function installFieldLocality(lab){
 const fields=lab.bulkFields;if(!fields)return;
 Object.assign(lab.optimizations,{fieldTopology:true,fieldLocalPressure:true});
 fields.configureTopology=g=>{
  g.topologyBuilder=lab.optimizations.fieldTopology===false?null:(g.fixedTopology??=new FixedGridTopology());
 };
 fields.createConnectedPipeline=()=>new LocalPressurePipeline(()=>lab.optimizations.fieldLocalPressure!==false);
 if(fields.grid)fields.configureTopology(fields.grid);
}
