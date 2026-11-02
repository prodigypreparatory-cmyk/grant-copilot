/* ---------- boot ---------- */
"use strict";
load();
if(location.hash && VIEWS.some(v=>v.id===location.hash.slice(1))) cur = location.hash.slice(1);
window.addEventListener("hashchange",()=>{ const h=location.hash.slice(1); if(h&&h!==cur&&VIEWS.some(v=>v.id===h)){ cur=h; render(); } });
render();
Cloud.init();
checkNotifications();
setInterval(checkNotifications, 60*60*1000);
