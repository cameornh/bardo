// NSWindowOcclusionStateVisible is bit 1. Other flags (e.g. 8192 in the
// recorded failures) do not imply visibility. An inactive app can still draw.
export function nativeWindowVisible(status,mac){
 return !!status[0]&&!!(mac?(status[1]&2):status[1]);
}
