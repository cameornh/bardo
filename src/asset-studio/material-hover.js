// Hover is observational. Sample the last cursor position once after drawing,
// so pointer events never start a pick or interrupt a tool gesture.
export function bindMaterialHover(view, label) {
 const canvas = view.canvas;
 let pointer = null, dirty = false, nextPick = 0;
 const invalidate = () => { dirty = true; };
 const clear = () => { pointer = null; label.hidden = true; nextPick = 0; };
 const track = event => {
  if (event.pointerType === 'touch' || event.buttons) return clear();
  pointer = {clientX: event.clientX, clientY: event.clientY};
  invalidate();
 };
 const abort = new AbortController();
 const options = {capture: true, passive: true, signal: abort.signal};
 for (const type of ['pointerenter', 'pointermove', 'pointerup']) canvas.addEventListener(type, track, options);
 for (const type of ['pointerdown', 'pointerleave', 'pointercancel']) canvas.addEventListener(type, clear, options);
 window.addEventListener('blur', clear, options);
 view.controls.addEventListener('change', invalidate);
 const resize = new ResizeObserver(invalidate);
 resize.observe(canvas);
 return {
  invalidate,
  update(now, moving) {
   if (!pointer || (!dirty && !moving) || now < nextPick) return;
   nextPick = now + 100;
   dirty = false;
   const rect = canvas.getBoundingClientRect();
   const x = pointer.clientX - rect.left, y = pointer.clientY - rect.top;
   if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return clear();
   const name = view.materialAtPointer(pointer)?.name;
   label.hidden = !name;
   if (!name) return;
   if (label.textContent !== name) label.textContent = name;
   label.style.left = x + 'px';
   label.style.top = y + 'px';
   label.style.transform = 'translate(' +
    (x > rect.width / 2 ? 'calc(-100% - 12px)' : '12px') + ', ' +
    (y > rect.height / 2 ? 'calc(-100% - 10px)' : '14px') + ')';
  },
  dispose() {
   abort.abort();
   resize.disconnect();
   view.controls.removeEventListener('change', invalidate);
  }
 };
}
