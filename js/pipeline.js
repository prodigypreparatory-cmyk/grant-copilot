/* ============================================================
   PIPELINE — board, compliance checks, sign-off, reminders,
   calendar export, win/loss dashboard
   ============================================================ */
"use strict";

let trackMode = (()=>{ try{ return localStorage.getItem("grantCopilot.trackMode")||"board"; }catch(e){ return "board"; } })();
function setTrackMode(m){ trackMode=m; try{ localStorage.setItem("grantCopilot.trackMode",m); }catch(e){} render(); }

/* ---------- compliance ---------- */
function isFederal(a){
  return a.source==="grants.gov" || /\b(u\.s\.|united states|federal|department of (?:health|education|agriculture|labor|justice|housing)|administration for children|hhs|usda|nofo)\b/i.test((a.funder||"")+" "+((a.parsed||{}).raw||"").slice(0,6000));
}
function compliance(a,o){
  const out=[], add=(level,label,detail)=>out.push({level,label,detail:detail||""});
  const qs=(a.parsed&&a.parsed.questions)||[];
  const dt=daysTo(a.deadline);
  if(!a.deadline) add("warn","Deadline set","No deadline entered for this application.");
  else if(dt<0) add("block","Deadline not passed",`The deadline was ${fmtD(a.deadline)}.`);
  else add(dt<=3?"warn":"ok","Deadline not passed",`${fmtD(a.deadline)} — ${dt} day${dt===1?"":"s"} left.`);

  if(!qs.length) add("warn","Questions answered","No questions on this application.");
  else {
    const empty=qs.filter(q=>!String((a.drafts||{})[q.id]||"").trim());
    add(empty.length?"block":"ok","Every question answered", empty.length?`${empty.length} of ${qs.length} have no answer: `+empty.map(q=>"#"+(qs.indexOf(q)+1)).join(", "):`${qs.length} of ${qs.length} answered.`);
    const gq=qs.filter(q=>/⟦/.test((a.drafts||{})[q.id]||""));
    add(gq.length?"block":"ok","No unresolved gaps", gq.length?"Gap markers remain in "+gq.map(q=>"#"+(qs.indexOf(q)+1)).join(", ")+".":"No ⟦NEEDS⟧ markers.");
    const over=qs.filter(q=>{ const d=String((a.drafts||{})[q.id]||""); return q.limit && (q.limitType==="chars"?d.length>q.limit:words(d)>q.limit); });
    add(over.length?"block":"ok","Within word / character limits", over.length?over.map(q=>{const d=(a.drafts||{})[q.id]||""; return "#"+(qs.indexOf(q)+1)+" is "+(q.limitType==="chars"?d.length+"/"+q.limit+" chars":words(d)+"/"+q.limit+" words");}).join("; "):"All answers fit.");
  }

  const att=(a.parsed&&a.parsed.attachments)||[];
  if(att.length){
    const missing=[], expired=[], unchecked=[];
    att.forEach(m=>{ const hit=o.docs.find(d=>fuzzyDoc(d.name,m.name));
      if(!hit||hit.status!=="have"){ if(m.required!==false) missing.push(m.name); }
      else if(hit.expires && daysTo(hit.expires)!=null && daysTo(hit.expires)<0) expired.push(m.name);
      if(!(a.attachOK||{})[m.name]) unchecked.push(m.name); });
    add(missing.length?"block":"ok","Required attachments on hand", missing.length?"Not on hand: "+missing.join(", "):`${att.length} attachment${att.length===1?"":"s"} on hand.`);
    if(expired.length) add("block","No expired attachments","Expired: "+expired.join(", "));
    add(unchecked.length?"warn":"ok","Attachments checked off", unchecked.length?unchecked.length+" not yet checked off in the attachment checklist.":"All checked off.");
  }

  const rules=(a.parsed&&a.parsed.budget)||[];
  if(rules.length){
    const un=rules.filter(r=>!(a.budgetAck||{})[r.name]);
    add(un.length?"warn":"ok","Budget rules reviewed", un.length?"Not yet confirmed: "+un.map(r=>r.name).join(", "):"All budget rules confirmed.");
  }
  if(a.amount && a.parsed && a.parsed.amountMax && +a.amount>+a.parsed.amountMax)
    add("warn","Request within award range",`Requesting ${money(a.amount)}; largest amount in the RFP is ${money(a.parsed.amountMax)}.`);

  if(isFederal(a)){
    const P=o.profile;
    add(P.uei?"ok":"block","UEI on file (federal)", P.uei?"UEI "+P.uei:"Federal applications need a UEI from SAM.gov.");
    const se=daysTo(P.samExpires);
    add(P.samExpires&&se>=0?(se<30?"warn":"ok"):"block","SAM.gov registration active", P.samExpires?(se<0?"Expired "+fmtD(P.samExpires):"Expires "+fmtD(P.samExpires)):"Add the SAM expiration date in the vault.");
  }
  if(S.settings.requireSignoff){
    const so=a.signoff||{};
    add(so.review?"ok":"block","Reviewer approval", so.review?`Approved by ${so.review.by||"reviewer"} ${fmtD((so.review.at||"").slice(0,10))}`:"Needs reviewer approval.");
    add(so.director?"ok":"block","Director sign-off", so.director?`Signed off by ${so.director.by||"director"} ${fmtD((so.director.at||"").slice(0,10))}`:"Needs director sign-off.");
  }
  return out;
}
function compSummary(c){ return {block:c.filter(x=>x.level==="block").length, warn:c.filter(x=>x.level==="warn").length, ok:c.filter(x=>x.level==="ok").length}; }
function compList(c){ return `<ul class="chk-list">${c.map(x=>`<li class="${x.level}"><span class="ic">${x.level==="ok"?"✓":x.level==="warn"?"!":"✕"}</span>
  <div><strong>${esc(x.label)}</strong> <span class="pill ${x.level==="ok"?"ok":x.level==="warn"?"warn":"bad"}">${x.level==="ok"?"pass":x.level==="warn"?"check":"fix"}</span><br><small>${esc(x.detail)}</small></div></li>`).join("")}</ul>`; }

function compliancePanel(a,o){
  const c=compliance(a,o), s=compSummary(c), rules=(a.parsed&&a.parsed.budget)||[];
  const role=window.Cloud?Cloud.role():"owner", so=a.signoff||{};
  const canRev=["owner","reviewer","director"].includes(role), canDir=["owner","director"].includes(role);
  return `<div class="card"><div class="ch"><h3>Pre-submission check</h3>
      ${s.block?`<span class="pill bad">${s.block} to fix</span>`:""}${s.warn?`<span class="pill warn">${s.warn} to check</span>`:""}${!s.block&&!s.warn?'<span class="pill ok">ready to submit</span>':""}
      <div class="hspace"></div>${!CLOSED.has(a.status)?`<button class="b ${s.block?"g":"o"} sm" onclick="moveStage('${a.id}','Submitted')">Mark submitted</button>`:""}</div>
    ${compList(c)}
    ${rules.length?`<h4 style="margin-top:14px">Budget rules — confirm your budget follows each</h4>
      ${rules.map(r=>`<label class="chk" style="padding:5px 0;align-items:flex-start"><input type="checkbox" ${(a.budgetAck||{})[r.name]?"checked":""} onchange="ackBudget('${a.id}',${JSON.stringify(r.name).replace(/"/g,"&quot;")},this.checked)">
        <span><strong>${esc(r.name)}</strong><br><small>${esc((r.lines||[]).join(" … ").slice(0,260))}</small></span></label>`).join("")}`:""}
    <h4 style="margin-top:14px">Review & sign-off</h4>
    <div class="grid g2">
      <div class="rowbox"><strong>Reviewer</strong><br>${so.review?`<span class="pill ok">approved</span> <small>${esc(so.review.by||"")} · ${new Date(so.review.at).toLocaleString()}</small> <button class="lk" onclick="signoff('${a.id}','review',false)">undo</button>`
        :`<small>Not yet reviewed.</small><br>${canRev?`<button class="b g sm" style="margin-top:6px" onclick="signoff('${a.id}','review',true)">Approve as reviewer</button>`:""}`}</div>
      <div class="rowbox"><strong>Director</strong><br>${so.director?`<span class="pill ok">signed off</span> <small>${esc(so.director.by||"")} · ${new Date(so.director.at).toLocaleString()}</small> <button class="lk" onclick="signoff('${a.id}','director',false)">undo</button>`
        :`<small>Not yet signed off.</small><br>${canDir?`<button class="b g sm" style="margin-top:6px" onclick="signoff('${a.id}','director',true)">Sign off as director</button>`:""}`}</div>
    </div>
    <small>${S.settings.requireSignoff?"Sign-off is required before submitting (Settings).":"Sign-off is optional. Require it in Settings."}</small>
  </div>`;
}
function ackBudget(aid,name,v){ const a=org().apps.find(x=>x.id===aid); a.budgetAck=a.budgetAck||{}; a.budgetAck[name]=v; save(); render(); }
function signoff(aid,kind,on){
  const a=org().apps.find(x=>x.id===aid); a.signoff=a.signoff||{};
  if(on) a.signoff[kind]={by:(window.Cloud&&Cloud.email())||(org().profile.edName||"me"), at:new Date().toISOString()};
  else delete a.signoff[kind];
  if(on && kind==="review" && a.status==="Drafting") a.status="Review";
  save(); render(); toast(on?"Recorded":"Removed");
}

/* ---------- stage moves ---------- */
function moveStage(aid,stage){
  const o=org(), a=o.apps.find(x=>x.id===aid); if(!a||a.status===stage){ render(); return; }
  if(stage==="Submitted"){
    const c=compliance(a,o), s=compSummary(c);
    if(s.block||s.warn){
      App.openModal(`<h2>Before you submit</h2>
        <div class="note ${s.block?"d":"w"}">${s.block?`<strong>${s.block} item${s.block===1?"":"s"} must be fixed</strong> and ${s.warn} to double-check.`:`<strong>${s.warn} item${s.warn===1?"":"s"} to double-check.</strong>`}</div>
        ${compList(c.filter(x=>x.level!=="ok"))}
        <div class="btnrow" style="margin-top:14px"><button class="b" onclick="App.closeModal();openApp('${aid}')">Go fix them</button>
          <button class="b dz" onclick="App.closeModal();doMove('${aid}','Submitted')">Mark submitted anyway</button></div>`);
      render(); return;
    }
  }
  if(stage==="Awarded") return awardModal(aid);
  if(stage==="Declined") return declineModal(aid);
  doMove(aid,stage);
}
function doMove(aid,stage){
  const a=org().apps.find(x=>x.id===aid); if(!a) return;
  a.status=stage; (a.history=a.history||[]).push({stage,at:new Date().toISOString()});
  if(stage==="Submitted" && !a.submitted) a.submitted=today();
  save(); render(); toast("Moved to "+stage);
}
function awardModal(aid){
  const o=org(), a=o.apps.find(x=>x.id===aid);
  const used=[...new Set(Object.values(a.draftMeta||{}).flatMap(m=>m.answerIds||[]))].map(id=>o.answers.find(x=>x.id===id)).filter(Boolean);
  App.openModal(`<h2>Awarded 🎉</h2>
    <div class="grid g2"><div class="f"><label>Award amount</label><input id="awAmt" type="number" value="${esc(nn(a.amount))}"></div>
      <div class="f"><label>First report due</label><input id="awRep" type="date" value="${esc(nn(a.reportingDue))}"></div></div>
    <label class="chk"><input type="checkbox" id="awLib" checked> Save this application's answers to the Answer Library, marked funded</label>
    ${used.length?`<p><small>Library answers used in this application (${used.length}) will also be marked funded: ${used.map(x=>esc(x.title)).join(", ")}</small></p>`:""}
    <label class="chk"><input type="checkbox" id="awHist" checked> Add to Grant history in the vault (evidence of capacity)</label>
    <div class="btnrow" style="margin-top:14px"><button class="b" onclick="confirmAward('${aid}')">Save</button><button class="b g" onclick="App.closeModal();render()">Cancel</button></div>`);
}
function confirmAward(aid){
  const o=org(), a=o.apps.find(x=>x.id===aid);
  a.awardAmount=document.getElementById("awAmt").value; a.amount=a.awardAmount||a.amount;
  a.reportingDue=document.getElementById("awRep").value; a.decidedOn=today();
  if(document.getElementById("awHist").checked) o.awards.push({id:uid(),funder:a.funder||a.title,amount:a.amount,year:String(new Date().getFullYear()),purpose:a.title,status:"Awarded"});
  if(document.getElementById("awLib").checked){
    const ids=new Set(Object.values(a.draftMeta||{}).flatMap(m=>m.answerIds||[]));
    o.answers.forEach(x=>{ if(ids.has(x.id)) x.won=true; });
    (a.parsed.questions||[]).forEach(q=>{ const t=(a.drafts||{})[q.id]; if(!t||/⟦/.test(t)) return;
      if(o.answers.some(x=>x.text===t)){ o.answers.forEach(x=>{ if(x.text===t) x.won=true; }); return; }
      o.answers.unshift({id:uid(),title:(q.topicLabel||q.text.slice(0,50)),question:q.text,text:t,tags:q.topicId||"",funder:a.funder||"",year:String(new Date().getFullYear()),won:true,fromApp:a.id}); });
  }
  App.closeModal(); doMove(aid,"Awarded");
}
function declineModal(aid){
  const a=org().apps.find(x=>x.id===aid);
  App.openModal(`<h2>Declined</h2><p><small>Recording why helps the win/loss view show what to change.</small></p>
    <div class="f"><label>Reason</label><select id="dcR">${["Not given","Outside funder priorities","Score too low","Budget / ask too large","Eligibility issue","Incomplete application","Highly competitive cycle","Other"].map(r=>`<option>${r}</option>`).join("")}</select></div>
    <div class="f"><label>Reviewer feedback or notes</label><textarea id="dcN" rows="4">${esc(nn(a.declineNotes))}</textarea></div>
    <div class="btnrow"><button class="b" onclick="confirmDecline('${aid}')">Save</button><button class="b g" onclick="App.closeModal();render()">Cancel</button></div>`);
}
function confirmDecline(aid){
  const a=org().apps.find(x=>x.id===aid);
  a.declineReason=document.getElementById("dcR").value; a.declineNotes=document.getElementById("dcN").value; a.decidedOn=today();
  App.closeModal(); doMove(aid,"Declined");
}

/* ---------- drag & drop ---------- */
let dragId=null;
function kDrag(e,id){ dragId=id; e.dataTransfer.effectAllowed="move"; e.target.classList.add("drag"); }
function kEnd(e){ e.target.classList.remove("drag"); document.querySelectorAll(".col.over").forEach(c=>c.classList.remove("over")); }
function kOver(e){ e.preventDefault(); e.currentTarget.classList.add("over"); }
function kLeave(e){ e.currentTarget.classList.remove("over"); }
function kDrop(e,stage){ e.preventDefault(); e.currentTarget.classList.remove("over"); if(dragId) moveStage(dragId,stage); dragId=null; }

/* ---------- reminders ---------- */
function dueItems(o){
  const days=+S.settings.reminderDays||14, out=[];
  o.apps.forEach(a=>{
    const d=daysTo(a.deadline);
    if(isOpen(a) && d!=null && d>=-3 && d<=days) out.push({key:"dl:"+a.id+":"+a.deadline, kind:"Deadline", title:a.title||a.funder||"Application", date:a.deadline, d, id:a.id});
    const r=daysTo(a.reportingDue);
    if(a.reportingDue && r!=null && r>=-14 && r<=30) out.push({key:"rp:"+a.id+":"+a.reportingDue, kind:"Report due", title:a.title||a.funder, date:a.reportingDue, d:r, id:a.id});
  });
  o.docs.forEach(x=>{ const e=daysTo(x.expires); if(x.expires && e!=null && e<=30 && e>=-30) out.push({key:"doc:"+x.id+":"+x.expires, kind:e<0?"Document expired":"Document expires", title:x.name, date:x.expires, d:e}); });
  if(o.profile.samExpires){ const e=daysTo(o.profile.samExpires); if(e!=null&&e<=45) out.push({key:"sam:"+o.profile.samExpires, kind:"SAM.gov expires", title:"SAM.gov registration", date:o.profile.samExpires, d:e}); }
  return out.sort((a,b)=>a.d-b.d);
}
function checkNotifications(){
  if(!("Notification" in window) || Notification.permission!=="granted") return;
  const t=today(), n=S.settings.notified||(S.settings.notified={});
  S.orgs.forEach(o=>dueItems(o).forEach(it=>{
    const stamp=it.key+"@"+t; if(n[stamp]) return;
    if(!(it.d<=1 || it.d===3 || it.d===7 || it.d===14 || it.d<0)) return;
    n[stamp]=1;
    try{ new Notification(`${it.kind}: ${it.title}`, {body:(it.d<0?Math.abs(it.d)+" days ago":it.d===0?"Today":it.d+" days — "+fmtD(it.date))+" · "+o.name, tag:it.key}); }catch(e){}
  }));
  Object.keys(n).forEach(k=>{ if(!k.endsWith("@"+t)) delete n[k]; });
  try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){}
}
function enableNotifications(){
  if(!("Notification" in window)){ toast("This browser does not support notifications","err"); return; }
  Notification.requestPermission().then(p=>{ toast(p==="granted"?"Reminders on while Grant Copilot is open":"Notifications were blocked", p==="granted"?"":"err"); if(p==="granted") checkNotifications(); render(); });
}
function icsEscape(s){ return String(s||"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n"); }
function exportICS(){
  const o=org(), L=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Grant Copilot//EN","CALSCALE:GREGORIAN","X-WR-CALNAME:Grant deadlines — "+icsEscape(o.name)];
  const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"");
  const ev=(uidv,date,summary,desc,alarms)=>{ const d=date.replace(/-/g,"");
    const nx=new Date(+date.slice(0,4),+date.slice(5,7)-1,+date.slice(8,10)+1); const d2=nx.getFullYear()+String(nx.getMonth()+1).padStart(2,"0")+String(nx.getDate()).padStart(2,"0");
    L.push("BEGIN:VEVENT","UID:"+uidv+"@grantcopilot","DTSTAMP:"+stamp,"DTSTART;VALUE=DATE:"+d,"DTEND;VALUE=DATE:"+d2,"SUMMARY:"+icsEscape(summary),"DESCRIPTION:"+icsEscape(desc));
    alarms.forEach(x=>L.push("BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:"+icsEscape(summary),"TRIGGER:-P"+x+"D","END:VALARM"));
    L.push("END:VEVENT"); };
  let n=0;
  o.apps.forEach(a=>{
    if(a.deadline && isOpen(a)){ ev("dl-"+a.id,a.deadline,"DUE: "+(a.title||a.funder),(a.funder||"")+(a.portal?"\n"+a.portal:"")+"\nAsk: "+money(a.amount),[14,7,3,1]); n++; }
    if(a.reportingDue){ ev("rp-"+a.id,a.reportingDue,"REPORT DUE: "+(a.title||a.funder),a.funder||"",[14,3]); n++; }
  });
  o.docs.forEach(x=>{ if(x.expires){ ev("doc-"+x.id,x.expires,"EXPIRES: "+x.name,"Renew before it lapses.",[30,7]); n++; } });
  if(o.profile.samExpires){ ev("sam-"+o.id,o.profile.samExpires,"SAM.gov registration expires","Renew at sam.gov — federal awards are blocked while expired.",[45,14]); n++; }
  L.push("END:VCALENDAR");
  if(!n){ toast("No dates to export yet","err"); return; }
  dl("grant-deadlines.ics", L.join("\r\n"), "text/calendar"); toast(`Calendar file with ${n} date${n===1?"":"s"} downloaded — open it to add to your calendar`);
}
function dashExtras(o){
  const due=dueItems(o).slice(0,6);
  return due.length?`<div class="note ${due.some(x=>x.d<=3)?"d":"w"}"><strong>Coming up:</strong> ${due.map(x=>`${esc(x.kind)} — ${x.id?`<button class="lk" onclick="openApp('${x.id}')">${esc(x.title)}</button>`:esc(x.title)} (${x.d<0?Math.abs(x.d)+"d ago":x.d===0?"today":x.d+"d"})`).join(" · ")}
    <br><button class="lk" onclick="exportICS()">Add all dates to my calendar (.ics)</button>${("Notification" in window)&&Notification.permission!=="granted"?` · <button class="lk" onclick="enableNotifications()">Turn on browser reminders</button>`:""}</div>`:"";
}

/* ---------- win / loss ---------- */
function winLoss(o){
  const won=o.apps.filter(a=>a.status==="Awarded"||a.status==="Reporting"), lost=o.apps.filter(a=>a.status==="Declined");
  const sub=o.apps.filter(a=>CLOSED.has(a.status)), pending=o.apps.filter(a=>a.status==="Submitted");
  const decided=won.length+lost.length, rate=decided?Math.round(won.length/decided*100):null;
  const req=sub.reduce((s,a)=>s+(+a.amount||0),0), got=won.reduce((s,a)=>s+(+(a.awardAmount||a.amount)||0),0);
  const funders={};
  sub.forEach(a=>{ const k=(a.funder||"Unknown").trim(); const f=funders[k]=funders[k]||{name:k,applied:0,won:0,lost:0,amt:0};
    f.applied++; if(won.includes(a)){ f.won++; f.amt+=+(a.awardAmount||a.amount)||0; } if(lost.includes(a)) f.lost++; });
  const fl=Object.values(funders).sort((a,b)=>b.amt-a.amt||b.won-a.won||b.applied-a.applied);
  const maxAmt=Math.max(1,...fl.map(f=>f.amt));
  const reasons={}; lost.forEach(a=>{ const r=a.declineReason||"Not recorded"; reasons[r]=(reasons[r]||0)+1; });
  const useCount={}, winCount={};
  sub.forEach(a=>{ const ids=new Set(Object.values(a.draftMeta||{}).flatMap(m=>m.answerIds||[])); ids.forEach(id=>{ useCount[id]=(useCount[id]||0)+1; if(won.includes(a)) winCount[id]=(winCount[id]||0)+1; }); });
  const ans=Object.keys(useCount).map(id=>({a:o.answers.find(x=>x.id===id),u:useCount[id],w:winCount[id]||0})).filter(x=>x.a).sort((x,y)=>y.w-x.w||y.u-x.u).slice(0,8);
  return `<div class="card"><div class="ch"><h3>Win / loss</h3><div class="hspace"></div><small>${decided} decided · ${pending.length} awaiting a decision</small></div>
    <div class="grid g4" style="margin-bottom:12px">
      <div class="stat"><div class="n">${rate==null?"—":rate+"%"}</div><div class="l">Win rate</div><small>${won.length} won · ${lost.length} declined</small></div>
      <div class="stat"><div class="n" style="font-size:1.3rem">${money(got)}</div><div class="l">Awarded</div></div>
      <div class="stat"><div class="n" style="font-size:1.3rem">${money(req)}</div><div class="l">Requested (submitted)</div></div>
      <div class="stat"><div class="n">${req?Math.round(got/req*100)+"%":"—"}</div><div class="l">Dollars won ÷ asked</div></div>
    </div>
    ${fl.length?`<h4>By funder <small>— bar shows dollars awarded</small></h4>
      ${fl.slice(0,10).map(f=>`<div class="hbar-row" title="${esc(f.name)}: applied ${f.applied}, won ${f.won}, declined ${f.lost}, ${money(f.amt)} awarded">
        <div>${esc(f.name)}<br><small>${f.won}/${f.applied} won${f.lost?` · ${f.lost} declined`:""}</small></div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${f.amt?Math.max(2,f.amt/maxAmt*100):0}%"></div></div>
        <div style="text-align:right;font-weight:600">${f.amt?money(f.amt):"—"}</div></div>`).join("")}`
      :`<div class="empty">Submit applications and record outcomes to see which funders and answers work.</div>`}
    ${ans.length?`<h4 style="margin-top:16px">Answers that win</h4><div class="tw"><table><thead><tr><th>Library answer</th><th class="r">Used</th><th class="r">In funded apps</th></tr></thead><tbody>
      ${ans.map(x=>`<tr><td>${esc(x.a.title)} ${x.a.won?'<span class="pill ok">funded</span>':""}</td><td class="r">${x.u}</td><td class="r"><strong>${x.w}</strong></td></tr>`).join("")}</tbody></table></div>`:""}
    ${lost.length?`<h4 style="margin-top:16px">Why applications were declined</h4>${Object.entries(reasons).sort((a,b)=>b[1]-a[1]).map(([r,n])=>`<span class="tag">${esc(r)} · ${n}</span>`).join("")}`:""}
  </div>`;
}

/* ---------- view ---------- */
function viewTrack(el){
  const o=org();
  const by=s=>o.apps.filter(a=>a.status===s).sort((a,b)=>(a.deadline||"9999").localeCompare(b.deadline||"9999"));
  const due=dueItems(o);
  const card=a=>{ const d=daysTo(a.deadline), pr=appProgress(a), cs=compSummary(compliance(a,o));
    return `<div class="kc" draggable="true" ondragstart="kDrag(event,'${a.id}')" ondragend="kEnd(event)">
      <div class="t"><button class="lk" style="padding:0;text-align:left;color:var(--navy);text-decoration:none;font-weight:600;font-size:.88rem" onclick="openApp('${a.id}')">${esc(a.title||"Untitled")}</button></div>
      <small>${esc(a.funder||"—")}</small>
      <div class="m">${a.amount?`<span class="tag">${money(a.amount)}</span>`:""}
        ${a.deadline&&isOpen(a)?`<span class="pill ${d<0?"bad":d<=7?"bad":d<=21?"warn":"ok"}">${d<0?"past":d===0?"today":d+"d"}</span>`:a.deadline?`<small>${fmtD(a.deadline)}</small>`:""}
        ${pr.total&&isOpen(a)?`<small>${pr.complete}/${pr.total} done</small>`:""}
        ${isOpen(a)&&a.status!=="Prospect"&&(cs.block)?`<span class="pill bad" title="Pre-submission check">${cs.block} to fix</span>`:""}
        ${a.status==="Reporting"&&a.reportingDue?`<small>report ${fmtD(a.reportingDue)}</small>`:""}</div>
      <select onchange="moveStage('${a.id}',this.value)" aria-label="Move to stage">${STAGES.map(s=>`<option ${s===a.status?"selected":""}>${s}</option>`).join("")}</select>
    </div>`; };

  el.innerHTML=`
  <div class="ch"><div><h1>Pipeline</h1><small>Drag cards between stages. Moving to Submitted runs the pre-submission check.</small></div>
    <div class="hspace"></div><div class="btnrow">
      <button class="b ${trackMode==="board"?"n":"g"} sm" onclick="setTrackMode('board')">Board</button>
      <button class="b ${trackMode==="table"?"n":"g"} sm" onclick="setTrackMode('table')">Table</button>
      <button class="b g sm" onclick="exportICS()">Calendar (.ics)</button>
      <button class="b o" onclick="App.go('search')">Find grants</button>
      <button class="b" onclick="manualApp()">+ Application</button></div></div>

  ${due.length?`<div class="card"><div class="ch"><h3>Reminders</h3><div class="hspace"></div>
      ${("Notification" in window)?(Notification.permission==="granted"?'<span class="pill ok">browser reminders on</span>':`<button class="b g sm" onclick="enableNotifications()">Turn on browser reminders</button>`):""}</div>
    <div class="tw"><table><tbody>${due.map(x=>`<tr><td><span class="pill ${x.d<=3?"bad":x.d<=7?"warn":"neu"}">${x.d<0?Math.abs(x.d)+"d ago":x.d===0?"today":x.d+"d"}</span></td>
      <td>${esc(x.kind)}</td><td>${x.id?`<button class="lk" onclick="openApp('${x.id}')">${esc(x.title)}</button>`:esc(x.title)}</td><td>${fmtD(x.date)}</td></tr>`).join("")}</tbody></table></div>
    <small>Showing deadlines within ${S.settings.reminderDays} days, reports within 30, and expiring documents. For reminders when this page is closed, add the .ics calendar file.</small></div>`:""}

  ${trackMode==="board"?`<div class="board">${STAGES.map(s=>{ const L=by(s);
      return `<div class="col" ondragover="kOver(event)" ondragleave="kLeave(event)" ondrop="kDrop(event,'${s}')">
        <h4>${s}<span class="cnt">${L.length}</span></h4>${L.map(card).join("")||'<small style="color:var(--mut);padding:4px">—</small>'}</div>`; }).join("")}</div>`
  :`<div class="card pad0"><div class="tw"><table>
    <thead><tr><th>Application</th><th>Funder</th><th class="r">Ask</th><th>Deadline</th><th class="r">Days</th><th>Stage</th><th>Check</th><th>Portal</th><th></th></tr></thead>
    <tbody>${o.apps.length?[...o.apps].sort((a,b)=>STAGES.indexOf(a.status)-STAGES.indexOf(b.status)||(a.deadline||"9").localeCompare(b.deadline||"9")).map(a=>{
      const d=daysTo(a.deadline), cs=compSummary(compliance(a,o));
      return `<tr><td><button class="lk" onclick="openApp('${a.id}')"><strong>${esc(a.title||"Untitled")}</strong></button></td>
      <td><small>${esc(a.funder||"—")}</small></td><td class="r">${money(a.amount)}</td><td>${fmtD(a.deadline)}</td>
      <td class="r">${d==null||!isOpen(a)?"—":`<span class="pill ${d<0?"bad":d<=14?"bad":d<=30?"warn":"ok"}">${d<0?"past":d}</span>`}</td>
      <td><select onchange="moveStage('${a.id}',this.value)">${STAGES.map(s=>`<option ${s===a.status?"selected":""}>${s}</option>`).join("")}</select></td>
      <td>${isOpen(a)?(cs.block?`<span class="pill bad">${cs.block} fix</span>`:cs.warn?`<span class="pill warn">${cs.warn} check</span>`:'<span class="pill ok">ready</span>'):"—"}</td>
      <td>${a.portal?`<a href="${esc(a.portal)}" target="_blank" rel="noopener">open</a>`:"—"}</td>
      <td><button class="lk dz" onclick="delApp('${a.id}')">×</button></td></tr>`;}).join("")
      :`<tr><td colspan="9"><div class="empty">Nothing tracked yet.</div></td></tr>`}</tbody></table></div></div>`}

  ${winLoss(o)}

  <div class="card"><h3>Post-award reporting</h3>
    <div class="note">Missed reports are the most common way an organization loses the next award. Set the first report date as soon as a grant is awarded.</div>
    ${o.apps.filter(a=>a.status==="Awarded"||a.status==="Reporting").map(a=>{ const d=daysTo(a.reportingDue);
      return `<div class="rowbox"><div class="ch"><h4>${esc(a.title||a.funder)}</h4><div class="hspace"></div>
        ${a.reportingDue?`<span class="pill ${d<0?"bad":d<=30?"warn":"ok"}">${d<0?"past due":d+" days"}</span>`:'<span class="pill bad">no date set</span>'}</div>
        <div class="grid g3"><div class="f"><label>Report due</label><input type="date" value="${esc(nn(a.reportingDue))}" onchange="setApp('${a.id}','reportingDue',this.value);render()"></div>
          <div class="f"><label>Award amount</label><input type="number" value="${esc(nn(a.awardAmount||a.amount))}" onchange="setApp('${a.id}','awardAmount',this.value);render()"></div>
          <div class="f"><label>Report notes</label><input value="${esc(nn(a.reportNotes))}" onchange="setApp('${a.id}','reportNotes',this.value)"></div></div></div>`;}).join("")||"<small>No awarded grants tracked yet.</small>"}
  </div>`;
}
VIEW_FN.track = viewTrack;
