// A background preview restored by HMR must not compile a second full scene
// while the visible preview is testing it. Resume naturally when selected.
export function waitForVisible(document){
 if(!document.hidden)return Promise.resolve();
 return new Promise(resolve=>{
  const visible=()=>{if(!document.hidden){document.removeEventListener('visibilitychange',visible);resolve();}};
  document.addEventListener('visibilitychange',visible);visible();
 });
}
