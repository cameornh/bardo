// Carry only fractional fixed-step time. Whole missed steps are overload,
// not a debt to replay faster when the machine becomes available again.
export function simulationAllowance(accumulator,elapsed,speed,step){
 const added=Math.min(.25,Math.max(0,elapsed))*Math.max(0,speed);
 if(speed<=0)return {time:0,added:0,dropped:accumulator};
 const fraction=accumulator%step;
 return {time:fraction+added,added,dropped:accumulator-fraction};
}
