// Match the sand stock spacing to the actual (budget-limited) water spacing.
export function sandResolutionForWater(spacing){return Math.max(17,Math.min(129,Math.ceil(11/(spacing*.9))+1));}
export function interactionRadiusRange(spacing,scale){const min=Math.max(.001,Math.floor(spacing*scale*.025*1000)/1000);return {min,step:Math.max(.001,Math.floor(min/5*1000)/1000)};}
