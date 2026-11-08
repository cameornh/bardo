// Preserve command order and attachment lifetime. Uploads/copies and every
// subsequent clear are barriers; only adjacent compatible draws can share a pass.
export function renderPassPlan(commands,merge=true){
 const plan=[];let active=null;
 for(const command of commands){
  if(command.type==='draw'){
   if(!merge||!active||active.state!==command.state){active={type:'render',state:command.state,color:null,depth:false,draws:[]};plan.push(active);}
   active.draws.push(command);
  }else if(command.type==='clear'){
   active={type:'render',state:command.state,color:command.color,depth:command.depth,draws:[]};plan.push(active);
   if(!merge)active=null;
  }else{active=null;plan.push(command);}
 }
 return plan;
}
