// Deno 2.9.8 polls wgpu synchronously inside onSubmittedWorkDone(), despite
// returning a Promise. Defer entering that binding until the renderer's
// synchronous CPU-only overlap callback has run. The frame is already submitted
// and immutable; this does not queue another frame or skip its completion fence.
// Keep the timeout around this Promise so CPU work also consumes the budget.
export function deferredQueueCompletion(queue){
 return Promise.resolve().then(()=>queue.onSubmittedWorkDone());
}
