/* ============================================================
   CLOUD — optional Supabase accounts, sync, roles, snapshots,
   and document file storage. Off until configured in Settings.
   ============================================================ */
"use strict";

const SYNC_KEY = "grantCopilot.sync";
const SUPA_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js";

const Cloud = {
  client:null, session:null, ws:null, role_:"owner", applying:false, timer:null, lastSnap:0, members:[], snaps:[],
  meta: (()=>{ try{ return JSON.parse(localStorage.getItem(SYNC_KEY)||"{}"); }catch(e){ return {}; } })(),
  saveMeta(){ try{ localStorage.setItem(SYNC_KEY, JSON.stringify(this.meta)); }catch(e){} },
  configured(){ return !!(CFG.supaUrl && CFG.supaKey); },
  signedIn(){ return !!(this.session && this.ws); },
  email(){ return (this.session && this.session.user && this.session.user.email) || ""; },
  role(){ return this.signedIn() ? this.role_ : "owner"; },
  async token(){ const {data}=await this.client.auth.getSession(); return data.session && data.session.access_token; },

  status(state, text){
    const el=document.getElementById("syncState"); if(!el) return;
    el.className="sync "+(state||""); el.innerHTML=state==="off"?"":`<i></i>${esc(text||"")}`;
  },

  async init(){
    if(!this.configured()){ this.status("off"); return; }
    try{
      await loadScript(SUPA_LIB);
      this.client = supabase.createClient(CFG.supaUrl, CFG.supaKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
      const {data}=await this.client.auth.getSession(); this.session=data.session;
      this.client.auth.onAuthStateChange((ev,sess)=>{
        const had=!!this.session; this.session=sess;
        if(ev==="SIGNED_IN" && !had) this.afterSignIn();
        if(ev==="SIGNED_OUT"){ this.ws=null; this.status("", "Signed out"); render(); }
      });
      if(this.session) await this.afterSignIn(); else this.status("", "Not signed in");
      window.addEventListener("focus", ()=>this.pullIfNewer());
    }catch(e){ console.error(e); this.status("err","Cloud error"); }
  },

  async afterSignIn(){
    this.status("busy","Connecting…");
    try{
      const me=this.email().toLowerCase();
      const {data:mem,error}=await this.client.from("workspace_members").select("workspace_id,role").eq("email",me);
      if(error) throw error;
      let wsId=null;
      if(mem && mem.length){
        const pick=mem.find(m=>m.workspace_id===this.meta.wsId)||mem[0]; wsId=pick.workspace_id; this.role_=pick.role;
      } else {
        const {data:id,error:e2}=await this.client.rpc("create_workspace",{p_name:org().name||"Grant Copilot", p_data:S});
        if(e2) throw e2; wsId=id; this.role_="owner";
        this.meta={wsId, rev:1, dirty:false}; this.saveMeta();
      }
      const {data:row,error:e3}=await this.client.from("workspaces").select("id,name,rev,updated_at,updated_by,data").eq("id",wsId).single();
      if(e3) throw e3;
      this.ws={id:row.id,name:row.name,rev:row.rev,updated_at:row.updated_at,updated_by:row.updated_by};
      if(this.meta.wsId!==row.id){
        this.conflict(row, "first");
      } else if(row.rev>(this.meta.rev||0)){
        if(this.meta.dirty) this.conflict(row, "both"); else this.adopt(row);
      } else if(this.meta.dirty){ this.push(true); }
      this.status("on","Synced"); render();
    }catch(e){ console.error(e); this.status("err","Sync error"); toast("Cloud sync: "+(e.message||e),"err"); }
  },

  adopt(row){
    this.applying=true;
    S=row.data; S.orgs.forEach(normalizeOrg); normalizeState();
    if(!S.orgs.some(o=>o.id===S.activeId)) S.activeId=S.orgs[0].id;
    save(); this.applying=false;
    this.meta={wsId:row.id, rev:row.rev, dirty:false}; this.saveMeta();
    this.ws.rev=row.rev; render(); toast("Loaded your cloud workspace");
  },
  conflict(row, kind){
    window._cloudRow=row;
    const when=new Date(row.updated_at).toLocaleString();
    App.openModal(`<h2>${kind==="first"?"Connect this browser to your cloud workspace":"Changes on two devices"}</h2>
      <div class="note w">${kind==="first"
        ?`Your cloud workspace already has data (last saved ${esc(when)}${row.updated_by?" by "+esc(row.updated_by):""}). This browser also has data. Choose which to keep.`
        :`The cloud copy changed (${esc(when)}${row.updated_by?" by "+esc(row.updated_by):""}) while this browser had unsynced edits. Choose which to keep. The other version is saved as a snapshot so nothing is lost.`}</div>
      <div class="btnrow"><button class="b" onclick="Cloud.resolve('cloud')">Use the cloud version</button>
        <button class="b o" onclick="Cloud.resolve('local')">Keep this browser's version</button></div>`);
  },
  async resolve(which){
    const row=window._cloudRow; App.closeModal();
    if(which==="cloud"){ await this.snapshot(S,"This browser before loading cloud"); this.adopt(row); }
    else { await this.snapshot(row.data,"Cloud before overwrite"); this.meta={wsId:row.id, rev:row.rev, dirty:true}; this.saveMeta(); this.ws.rev=row.rev; await this.push(true); }
  },

  onSave(){
    if(this.applying || !this.signedIn()) return;
    this.meta.dirty=true; this.saveMeta();
    this.status("busy","Saving…");
    clearTimeout(this.timer); this.timer=setTimeout(()=>this.push(), 1500);
  },
  async push(force){
    if(!this.signedIn()) return;
    if(!force && !this.meta.dirty) return;
    try{
      const next=(this.ws.rev||0)+1;
      const {data,error}=await this.client.from("workspaces")
        .update({data:S, rev:next, updated_at:new Date().toISOString(), updated_by:this.email()})
        .eq("id",this.ws.id).eq("rev",this.ws.rev).select("rev,updated_at");
      if(error) throw error;
      if(!data || !data.length){
        const {data:row}=await this.client.from("workspaces").select("id,name,rev,updated_at,updated_by,data").eq("id",this.ws.id).single();
        this.conflict(row,"both"); this.status("err","Conflict"); return;
      }
      this.ws.rev=data[0].rev; this.ws.updated_at=data[0].updated_at;
      this.meta={wsId:this.ws.id, rev:this.ws.rev, dirty:false}; this.saveMeta();
      this.status("on","Synced");
      if(Date.now()-this.lastSnap>30*60*1000){ this.lastSnap=Date.now(); this.snapshot(S,"Auto"); }
    }catch(e){ console.error(e); this.status("err","Not saved — retrying"); clearTimeout(this.timer); this.timer=setTimeout(()=>this.push(),15000); }
  },
  async pullIfNewer(){
    if(!this.signedIn() || this.meta.dirty) return;
    const {data}=await this.client.from("workspaces").select("rev").eq("id",this.ws.id).single();
    if(data && data.rev>this.ws.rev){
      const {data:row}=await this.client.from("workspaces").select("id,name,rev,updated_at,updated_by,data").eq("id",this.ws.id).single();
      if(row) this.adopt(row);
    }
  },
  async snapshot(data,note){
    if(!this.ws) return;
    try{ await this.client.from("workspace_snapshots").insert({workspace_id:this.ws.id, data, note, created_by:this.email()}); }catch(e){ console.warn(e); }
  },
  async loadSnaps(){
    const {data}=await this.client.from("workspace_snapshots").select("id,created_at,created_by,note").eq("workspace_id",this.ws.id).order("created_at",{ascending:false}).limit(25);
    this.snaps=data||[]; render();
  },
  async restoreSnap(id){
    if(!confirm("Replace the current workspace with this snapshot? The current state is snapshotted first.")) return;
    const {data}=await this.client.from("workspace_snapshots").select("data").eq("id",id).single();
    if(!data) return;
    await this.snapshot(S,"Before restore");
    S=data.data; S.orgs.forEach(normalizeOrg); normalizeState(); save(); render(); toast("Snapshot restored");
  },

  /* auth */
  async signIn(email,pw){ const {error}=await this.client.auth.signInWithPassword({email,password:pw}); if(error) toast(error.message,"err"); },
  async signUp(email,pw){ const {error}=await this.client.auth.signUp({email,password:pw,options:{emailRedirectTo:location.href.split("#")[0]}});
    toast(error?error.message:"Check your email to confirm the account", error?"err":""); },
  async magic(email){ const {error}=await this.client.auth.signInWithOtp({email,options:{emailRedirectTo:location.href.split("#")[0]}});
    toast(error?error.message:"Sign-in link sent — open it on this device", error?"err":""); },
  async signOut(){ await this.push(); await this.client.auth.signOut(); this.session=null; this.ws=null; this.status("","Signed out"); render(); },

  /* members & roles */
  async loadMembers(){ const {data}=await this.client.from("workspace_members").select("email,role,added_at").eq("workspace_id",this.ws.id); this.members=data||[]; render(); },
  async addMember(email,role){
    email=String(email||"").trim().toLowerCase(); if(!/@/.test(email)){ toast("Enter an email","err"); return; }
    const {error}=await this.client.from("workspace_members").upsert({workspace_id:this.ws.id,email,role});
    if(error) toast(error.message,"err"); else { toast("Added — they sign in with that email"); this.loadMembers(); }
  },
  async removeMember(email){
    if(email===this.email().toLowerCase()){ toast("You can't remove yourself","err"); return; }
    const {error}=await this.client.from("workspace_members").delete().eq("workspace_id",this.ws.id).eq("email",email);
    if(error) toast(error.message,"err"); else this.loadMembers();
  },

  /* files */
  async upload(docId, input){
    const f=input.files&&input.files[0]; if(!f) return;
    if(f.size>50*1024*1024){ toast("Files over 50 MB are not supported","err"); return; }
    const d=org().docs.find(x=>x.id===docId); if(!d) return;
    toast("Uploading "+f.name+"…");
    const path=`${this.ws.id}/${docId}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g,"_")}`;
    const {error}=await this.client.storage.from("documents").upload(path,f,{upsert:false,contentType:f.type||undefined});
    if(error){ toast("Upload failed: "+error.message,"err"); return; }
    if(d.file && d.file.path) this.client.storage.from("documents").remove([d.file.path]);
    d.file={path,name:f.name,size:f.size,at:new Date().toISOString()};
    if(d.status!=="have") d.status="have";
    save(); render(); toast("Stored in your cloud document library");
  },
  async openFile(docId){
    const d=org().docs.find(x=>x.id===docId); if(!d||!d.file) return;
    const w=window.open("about:blank","_blank");
    const {data,error}=await this.client.storage.from("documents").createSignedUrl(d.file.path,300,{download:false});
    if(error){ if(w) w.close(); toast(error.message,"err"); return; }
    if(w) w.location=data.signedUrl; else location.href=data.signedUrl;
  }
};
window.Cloud = Cloud;
SAVE_HOOKS.push(()=>Cloud.onSave());

function docCloudHTML(d){
  if(!Cloud.signedIn()) return "";
  return `<div style="margin-top:4px;font-size:.78rem">${d.file?`<button class="lk" style="padding:0" onclick="Cloud.openFile('${d.id}')">📎 ${esc(d.file.name)}</button> · `:""}
    <label class="lk" style="display:inline;text-transform:none;letter-spacing:0;font-weight:400;cursor:pointer;color:var(--green-d);text-decoration:underline">${d.file?"replace":"upload file"}
      <input type="file" style="display:none" onchange="Cloud.upload('${d.id}',this)"></label></div>`;
}
function docsBanner(){
  return Cloud.signedIn()
    ? `<div class="note g"><strong>Cloud file storage is on.</strong> Upload each document under its Location field. Files are private to your workspace members and open through short-lived links.</div>`
    : `<div class="note">This tracks the <em>status and location</em> of each document. <button class="lk" onclick="App.go('settings')">Turn on cloud sync</button> to store the files themselves; otherwise paste a link to your own drive in the Location column.</div>`;
}
