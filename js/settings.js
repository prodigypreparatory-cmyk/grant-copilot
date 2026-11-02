/* ============================================================
   SETTINGS — AI, cloud account, roles, reminders, search proxy
   ============================================================ */
"use strict";

function setCfg(k,v){ CFG[k]=v; saveCfg(); }
async function testAI(){
  setBusy("aiTest",true,"Testing…");
  try{ const t=await AI.call({prompt:"Reply with exactly: Connected", maxTokens:20}); toast("AI connected: "+t.slice(0,40)); }
  catch(e){ toast("AI test failed: "+e.message,"err"); }
  setBusy("aiTest",false);
}
function cloudConnect(){
  CFG.supaUrl=document.getElementById("supaUrl").value.trim().replace(/\/$/,"");
  CFG.supaKey=document.getElementById("supaKey").value.trim(); saveCfg();
  if(!CFG.supaUrl||!CFG.supaKey){ toast("Enter both the project URL and anon key","err"); return; }
  Cloud.init().then(()=>{ render(); toast("Connected to Supabase — sign in below"); });
}
function cloudForget(){
  if(!confirm("Disconnect this browser from cloud sync? Your data stays here and in the cloud.")) return;
  if(Cloud.client) Cloud.client.auth.signOut();
  CFG.supaUrl=""; CFG.supaKey=""; saveCfg(); Cloud.session=null; Cloud.ws=null; Cloud.client=null; Cloud.status("off"); render();
}
const ROLE_HELP = { owner:"Everything, including members", writer:"Edit vault, drafts, pipeline", reviewer:"Edit, plus approve as reviewer", director:"Edit, plus approve and director sign-off" };

function viewSettings(el){
  const signed=Cloud.signedIn(), conf=Cloud.configured(), hasClient=!!Cloud.client;
  el.innerHTML=`
  <div class="ch"><div><h1>Settings</h1><small>AI drafting, cloud account, roles, and reminders.</small></div></div>

  <div class="card"><div class="ch"><h3><span class="ai-badge">AI</span> AI drafting</h3><div class="hspace"></div>
      ${AI.ready()?'<span class="pill ok">ready</span>':'<span class="pill warn">not set up</span>'}</div>
    <label class="chk" style="margin-bottom:12px"><input type="checkbox" ${CFG.aiOn?"checked":""} onchange="setCfg('aiOn',this.checked);render()"> Use AI for drafting, RFP reading, and fit checks</label>
    <div class="grid g2">
      <div class="f"><label>Connection</label><select onchange="setCfg('aiMode',this.value);render()">
        <option value="direct" ${CFG.aiMode==="direct"?"selected":""}>My Anthropic API key, stored in this browser</option>
        <option value="proxy" ${CFG.aiMode==="proxy"?"selected":""}>Through my cloud account (key kept on the server)</option></select></div>
      <div class="f"><label>Model</label><select onchange="setCfg('model',this.value)">${MODELS.map(([v,l])=>`<option value="${v}" ${CFG.model===v?"selected":""}>${esc(l)}</option>`).join("")}
        ${MODELS.some(m=>m[0]===CFG.model)?"":`<option selected value="${esc(CFG.model)}">${esc(CFG.model)}</option>`}</select></div>
    </div>
    ${CFG.aiMode==="direct"?`<div class="f"><label>Anthropic API key</label><input type="password" autocomplete="off" value="${esc(CFG.apiKey)}" onchange="setCfg('apiKey',this.value.trim());render()" placeholder="sk-ant-…">
      <div class="hint">Create one at console.anthropic.com → API keys. It is saved only in this browser on this device — never in backups or cloud sync. Anyone using this browser profile could read it, so use the cloud option on shared computers.</div></div>`
    :`<div class="note ${signed?"g":"w"}">${signed?"AI requests go through your Supabase <code>claude-proxy</code> function, which holds the API key.":"Sign in to your cloud account below to use this option."} Setup steps are in the README.</div>`}
    <div class="btnrow"><button class="b g" id="aiTest" onclick="testAI()" ${AI.ready()?"":"disabled"}>Test connection</button></div>
    <div class="note" style="margin-top:12px">What is sent: the question, the RFP details, your vault fields, and your closest Answer Library matches. Claude is instructed to use only those facts and mark anything missing as a gap. You review and sign every answer.</div>
  </div>

  <div class="card"><div class="ch"><h3>Cloud account & sync</h3><div class="hspace"></div>
      ${signed?`<span class="pill ok">synced as ${esc(Cloud.email())}</span>`:conf?'<span class="pill warn">not signed in</span>':'<span class="pill neu">off — data stays in this browser</span>'}</div>
    ${!conf||!hasClient?`<p><small>Uses a free Supabase project for login, a database copy of everything, draft history across devices, roles, and real file storage for documents. The README walks through the 10-minute setup.</small></p>
      <div class="grid g2"><div class="f"><label>Supabase project URL</label><input id="supaUrl" value="${esc(CFG.supaUrl)}" placeholder="https://xxxx.supabase.co"></div>
        <div class="f"><label>Supabase anon (public) key</label><input id="supaKey" value="${esc(CFG.supaKey)}" placeholder="eyJ…"></div></div>
      <div class="btnrow"><button class="b" onclick="cloudConnect()">Connect</button></div>`
    : !Cloud.session?`<div class="grid g2" style="max-width:640px"><div class="f"><label>Email</label><input id="ciEmail" type="email" autocomplete="username" value="${esc(nn(org().profile.edEmail))}"></div>
        <div class="f"><label>Password</label><input id="ciPw" type="password" autocomplete="current-password"></div></div>
      <div class="btnrow"><button class="b" onclick="Cloud.signIn(ciEmail.value,ciPw.value)">Sign in</button>
        <button class="b g" onclick="Cloud.signUp(ciEmail.value,ciPw.value)">Create account</button>
        <button class="b g" onclick="Cloud.magic(ciEmail.value)">Email me a sign-in link</button>
        <button class="lk" onclick="cloudForget()">disconnect project</button></div>`
    : !signed?`<div class="note"><span class="spin dk"></span> Connecting to your workspace…</div>`
    :`<div class="kv" style="margin-bottom:12px"><dt>Signed in</dt><dd>${esc(Cloud.email())}</dd><dt>Your role</dt><dd>${esc(Cloud.role())}</dd>
        <dt>Workspace</dt><dd>${esc(Cloud.ws.name)} · revision ${Cloud.ws.rev}</dd></div>
      <div class="btnrow"><button class="b g sm" onclick="Cloud.push(true).then(()=>toast('Synced'))">Sync now</button>
        <button class="b g sm" onclick="Cloud.loadSnaps()">Show snapshots</button>
        ${Cloud.role()==="owner"?`<button class="b g sm" onclick="Cloud.loadMembers()">Manage members</button>`:""}
        <button class="b dz sm" onclick="Cloud.signOut()">Sign out</button></div>
      ${Cloud.snaps.length?`<h4 style="margin-top:14px">Snapshots</h4><p><small>Automatic copies every 30 minutes of active work, plus before any overwrite.</small></p>
        ${Cloud.snaps.map(s=>`<div class="inline" style="padding:5px 0;border-bottom:1px solid var(--line)"><div style="flex:1">${new Date(s.created_at).toLocaleString()} <small>${esc(s.note||"")} ${s.created_by?"· "+esc(s.created_by):""}</small></div>
          <button class="lk" onclick="Cloud.restoreSnap(${s.id})">restore</button></div>`).join("")}`:""}
      ${Cloud.members.length?`<h4 style="margin-top:14px">Members & roles</h4>
        ${Cloud.members.map(m=>`<div class="inline" style="padding:5px 0;border-bottom:1px solid var(--line)"><div style="flex:1">${esc(m.email)} <span class="pill neu">${esc(m.role)}</span> <small>${esc(ROLE_HELP[m.role]||"")}</small></div>
          ${m.email!==Cloud.email().toLowerCase()?`<button class="lk dz" onclick="Cloud.removeMember('${esc(m.email)}')">remove</button>`:""}</div>`).join("")}
        <div class="grid g3" style="margin-top:10px"><div class="f"><label>Email</label><input id="mbEmail" type="email"></div>
          <div class="f"><label>Role</label><select id="mbRole">${["writer","reviewer","director","owner"].map(r=>`<option value="${r}">${r} — ${ROLE_HELP[r]}</option>`).join("")}</select></div>
          <div class="f"><label>&nbsp;</label><button class="b" onclick="Cloud.addMember(mbEmail.value,mbRole.value)">Add member</button></div></div>`:""}`}
  </div>

  <div class="card"><h3>Pipeline, reminders & compliance</h3>
    <div class="grid g3">
      <div class="f"><label>Remind me about deadlines within</label><select onchange="S.settings.reminderDays=+this.value;save();render()">
        ${[7,14,21,30,45].map(n=>`<option value="${n}" ${+S.settings.reminderDays===n?"selected":""}>${n} days</option>`).join("")}</select></div>
      <div class="f"><label>Browser notifications</label>${("Notification" in window)?(Notification.permission==="granted"?'<div class="pill ok" style="margin-top:8px">on</div>':`<button class="b g" onclick="enableNotifications()">Turn on</button>`):"<small>Not supported here</small>"}
        <div class="hint">Fire at 14, 7, 3 and 1 days while the app is open.</div></div>
      <div class="f"><label>Calendar</label><button class="b g" onclick="exportICS()">Download .ics</button><div class="hint">Phone/Outlook/Google alerts even when the app is closed. Re-download after adding deadlines.</div></div>
    </div>
    <label class="chk"><input type="checkbox" ${S.settings.requireSignoff?"checked":""} onchange="S.settings.requireSignoff=this.checked;save();render()"> Require reviewer approval and director sign-off before an application can pass the pre-submission check</label>
  </div>

  <div class="card"><h3>Grant search</h3>
    <p><small>Grants.gov is searched directly from your browser. If the browser blocks it, route searches through the <code>grants-proxy</code> function in your Supabase project, or any proxy URL that forwards <code>/search2</code> and <code>/fetchOpportunity</code>.</small></p>
    <label class="chk" style="margin-bottom:10px"><input type="checkbox" ${CFG.useGrantsProxy?"checked":""} onchange="setCfg('useGrantsProxy',this.checked)" ${conf?"":"disabled"}> Use my Supabase grants-proxy function</label>
    <div class="f" style="max-width:520px"><label>Custom proxy base URL (optional)</label><input value="${esc(CFG.grantsProxy)}" onchange="setCfg('grantsProxy',this.value.trim())" placeholder="https://…"></div>
  </div>`;
}
VIEW_FN.settings = viewSettings;
