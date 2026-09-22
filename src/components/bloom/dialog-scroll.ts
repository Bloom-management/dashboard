// All Bloom dialogs share one lock so closing a nested dialog cannot unlock its parent.
let locks = 0;
let restore: (() => void) | undefined;
export function lockDialogScroll() {
  if (locks++ === 0) {
    const body = document.body, root = document.documentElement;
    const x = window.scrollX, y = window.scrollY;
    const saved = { position:body.style.position, top:body.style.top, left:body.style.left, right:body.style.right, width:body.style.width, overflow:body.style.overflow };
    const rootOverflow = root.style.overflow;
    Object.assign(body.style, {position:'fixed',top:`-${y}px`,left:`-${x}px`,right:'0',width:'100%',overflow:'hidden'});
    root.style.overflow = 'hidden';
    restore = () => { Object.assign(body.style,saved); root.style.overflow=rootOverflow; window.scrollTo({left:x,top:y,behavior:'instant'}); };
  }
  let released = false;
  return () => { if (released) return; released=true; if (--locks===0) { restore?.(); restore=undefined; } };
}
