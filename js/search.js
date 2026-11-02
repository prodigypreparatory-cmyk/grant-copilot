/* ============================================================
   FIND GRANTS — Grants.gov search, AI fit check, saved searches,
   manual prospects from any source
   ============================================================ */
"use strict";

const GG_SEARCH = "https://api.grants.gov/v1/api/search2";
const GG_FETCH  = "https://api.grants.gov/v1/api/fetchOpportunity";
const GG_ELIG = [["","Any eligibility"],["12","Nonprofits with 501(c)(3)"],["13","Nonprofits without 501(c)(3)"],["00","State governments"],["01","County governments"],["05","Independent school districts"],["25","Others"]];
const GG_CATS = [["","Any category"],["ED","Education"],["HL","Health"],["ISS","Income security & social services"],["CD","Community development"],["FN","Food & nutrition"],["ELT","Employment, labor & training"],["AG","Agriculture"],["HU","Humanities"],["ST","Science & technology"],["O","Other"]];
let searchState = { q:null, hits:[], count:0, loading:false, error:"", page:0, fit:{} };

function ggEndpoint(kind){
  if(CFG.grantsProxy) return CFG.grantsProxy.replace(/\/$/,"") + "/" + kind;
  if(window.Cloud && Cloud.signedIn() && CFG.supaUrl && CFG.useGrantsProxy) return CFG.supaUrl.replace(/\/$/,"")+"/functions/v1/grants-proxy/"+kind;
  return kind==="search2"?GG_SEARCH:GG_FETCH;
}
async function ggPost(kind, body){
  const url=ggEndpoint(kind), headers={"content-type":"application/json"};
  if(url.includes("/functions/v1/")){ headers.Authorization="Bearer "+(await Cloud.token()); headers.apikey=CFG.supaKey; }
  const r=await fetch(url,{method:"POST",headers,body:JSON.stringify(body)});
  if(!r.ok) throw new Error("Grants.gov returned HTTP "+r.status);
  const j=await r.json(); if(j.errorcode&&j.errorcode!==0) throw new Error(j.msg||"Grants.gov error");
  return j.data||j;
}
function ggDate(s){ const m=String(s||"").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m? m[3]+"-"+m[1].padStart(2,"0")+"-"+m[2].padStart(2,"0") : ""; }
function defaultKeywords(o){
  const P=o.profile, t=((P.programDesc||"")+" "+(P.ageGroups||"")+" "+(P.mission||"")).toLowerCase();
  if(/child|preschool|toddler|early learning|day care|childcare/.test(t)) return "early childhood education";
  return (P.populationServed||P.mission||"community services").split(/[.,;]/)[0].slice(0,60);
}

async function runSearch(page){
  const f=id=>(document.getElementById(id)||{}).value||"";
  const q = { keyword:f("gsKw").trim(), elig:f("gsElig"), cat:f("gsCat"), status:f("gsStatus")||"posted", agency:f("gsAgency").trim() };
  searchState.q=q; searchState.page=page||0; searchState.loading=true; searchState.error=""; render();
  try{
    const body={ keyword:q.keyword, oppStatuses:q.status==="both"?"forecasted|posted":q.status, rows:25, startRecordNum:searchState.page*25,
      sortBy:"closeDate|asc" };
    if(q.elig) body.eligibilities=q.elig; if(q.cat) body.fundingCategories=q.cat; if(q.agency) body.agencies=q.agency;
    const d=await ggPost("search2", body);
    searchState.hits=(d.oppHits||[]).map(h=>({ id:String(h.id), number:h.number, title:h.title, agency:h.agency||h.agencyName||h.agencyCode,
      open:ggDate(h.openDate), close:ggDate(h.closeDate), status:h.oppStatus, cfda:(h.cfdaList||[]).join(", ") }));
    searchState.count=d.hitCount||searchState.hits.length;
  }catch(e){
    searchState.hits=[]; searchState.error = /Failed to fetch|NetworkError|Load failed/i.test(e.message)
      ? "The browser blocked a direct call to Grants.gov. Set up the grants proxy in Settings (included with cloud sync), or use the Grants.gov link below."
      : e.message;
  }
  searchState.loading=false; render();
}
function saveSearch(){
  const q=searchState.q; if(!q||!q.keyword){ toast("Run a search first","err"); return; }
  S.settings.savedSearches.push(Object.assign({id:uid(), name:q.keyword, lastRun:today()}, q));
  S.settings.seenOpps[searchKey(q)]=searchState.hits.map(h=>h.id);
  save(); render(); toast("Search saved — new matches will be flagged next time");
}
function searchKey(q){ return [q.keyword,q.elig,q.cat,q.status,q.agency].join("|"); }
function runSaved(id){
  const s=S.settings.savedSearches.find(x=>x.id===id); if(!s) return;
  const set=(k,v)=>{ const el=document.getElementById(k); if(el) el.value=v||""; };
  set("gsKw",s.keyword); set("gsElig",s.elig); set("gsCat",s.cat); set("gsStatus",s.status); set("gsAgency",s.agency);
  s.lastRun=today(); runSearch(0).then(()=>{ setTimeout(()=>{ S.settings.seenOpps[searchKey(s)]=[...new Set((S.settings.seenOpps[searchKey(s)]||[]).concat(searchState.hits.map(h=>h.id)))]; save(); },50); });
}
function delSaved(id){ S.settings.savedSearches=S.settings.savedSearches.filter(x=>x.id!==id); save(); render(); }

function addOpp(id){
  const h=searchState.hits.find(x=>x.id===id); if(!h) return;
  const o=org();
  if(o.apps.some(a=>a.oppId===id)){ toast("Already in your pipeline"); return; }
  const fit=searchState.fit[id];
  const a=newApp({ title:h.title, funder:h.agency, deadline:h.close, status:"Prospect", source:"grants.gov", oppId:id, oppNumber:h.number,
    portal:"https://www.grants.gov/search-results-detail/"+id,
    amount: fit&&fit.ceiling?fit.ceiling:"", notes:[h.number?"Opportunity "+h.number:"", h.cfda?"Assistance listing "+h.cfda:"", fit&&fit.summary?"Fit: "+fit.score+"/100 — "+fit.summary:""].filter(Boolean).join("\n") });
  if(fit&&fit.synopsis) a.parsed.raw=fit.synopsis;
  o.apps.unshift(a); save(); render(); toast("Added to pipeline as a Prospect");
}
async function fitCheck(id){
  const h=searchState.hits.find(x=>x.id===id); if(!h) return;
  if(!AI.ready()){ toast("Turn on AI in Settings to run a fit check","err"); return; }
  searchState.fit[id]={loading:true}; render();
  try{
    let syn="", ceiling="", floor="", elig="";
    try{ const d=await ggPost("fetchOpportunity",{opportunityId:+id}); const s=d.synopsis||d.forecast||{};
      syn=[s.synopsisDesc||s.forecastDesc||"", s.applicantEligibilityDesc?"Eligibility: "+s.applicantEligibilityDesc:""].join("\n").replace(/<[^>]+>/g," ");
      ceiling=s.awardCeiling||""; floor=s.awardFloor||""; elig=(s.applicantTypes||[]).map(x=>x.description).join(", "); }catch(e){ syn=""; }
    const o=org();
    const r=AI.json(await AI.call({ maxTokens:900, temperature:0,
      system:"You assess whether a nonprofit should pursue a grant opportunity. Be candid and specific. Use only the information given. Return only JSON.",
      prompt:`OPPORTUNITY: ${h.title}\nAgency: ${h.agency}\nCloses: ${h.close||"unknown"}\nAward floor/ceiling: ${floor||"?"} / ${ceiling||"?"}\nEligible applicants: ${elig||"?"}\nSynopsis: ${(syn||"(not available — judge from the title)").slice(0,12000)}\n\nAPPLICANT:\n${vaultContext(o).slice(0,8000)}\n\nReturn {"score":0-100,"summary":"one sentence verdict","reasons":["up to 3 reasons for"],"risks":["up to 3 eligibility or fit risks"]}` }));
    searchState.fit[id]={ score:+r.score||0, summary:r.summary||"", reasons:r.reasons||[], risks:r.risks||[], ceiling, synopsis:syn };
  }catch(e){ searchState.fit[id]={error:e.message}; }
  render();
}
function addProspect(){
  const g=id=>document.getElementById(id).value.trim();
  if(!g("mpTitle")&&!g("mpFunder")){ toast("Add a title or funder","err"); return; }
  const a=newApp({ title:g("mpTitle")||g("mpFunder"), funder:g("mpFunder"), deadline:g("mpDl"), amount:g("mpAmt"), portal:g("mpUrl"), status:"Prospect", source:"manual" });
  org().apps.unshift(a); save(); render(); toast("Prospect added to the pipeline");
}

function viewSearch(el){
  const o=org(), q=searchState.q||{keyword:defaultKeywords(o), elig:"12", cat:"", status:"posted", agency:""};
  const seen=new Set(S.settings.seenOpps[searchKey(q)]||[]), hasSeen=!!S.settings.seenOpps[searchKey(q)];
  const sel=(id,opts,v)=>`<select id="${id}">${opts.map(([k,l])=>`<option value="${k}" ${k===(v||"")?"selected":""}>${esc(l)}</option>`).join("")}</select>`;
  const ggLink="https://www.grants.gov/search-grants?keywords="+encodeURIComponent(q.keyword||"");
  el.innerHTML=`
  <div class="ch"><div><h1>Find Grants</h1><small>Search open federal opportunities on Grants.gov, check fit with AI, and add the good ones to your pipeline.</small></div></div>

  <div class="card">
    <div class="grid g4">
      <div class="f" style="grid-column:span 2"><label>Keywords</label><input id="gsKw" value="${esc(q.keyword||"")}" onkeydown="if(event.key==='Enter')runSearch(0)" placeholder="e.g. early childhood, child care, workforce"></div>
      <div class="f"><label>Eligibility</label>${sel("gsElig",GG_ELIG,q.elig)}</div>
      <div class="f"><label>Category</label>${sel("gsCat",GG_CATS,q.cat)}</div>
      <div class="f"><label>Status</label>${sel("gsStatus",[["posted","Open now"],["forecasted","Forecasted"],["both","Open + forecasted"]],q.status)}</div>
      <div class="f"><label>Agency code (optional)</label><input id="gsAgency" value="${esc(q.agency||"")}" placeholder="e.g. HHS-ACF, ED, USDA"></div>
    </div>
    <div class="btnrow"><button class="b" onclick="runSearch(0)" ${searchState.loading?"disabled":""}>${searchState.loading?'<span class="spin"></span> Searching…':"Search Grants.gov"}</button>
      ${searchState.hits.length?`<button class="b g" onclick="saveSearch()">Save this search</button>`:""}
      <a class="b g" href="${ggLink}" target="_blank" rel="noopener" style="background:#fff;color:var(--navy);border:1px solid var(--line)">Open on Grants.gov ↗</a></div>
  </div>

  ${S.settings.savedSearches.length?`<div class="card"><h3>Saved searches</h3>${S.settings.savedSearches.map(s=>`<div class="inline" style="padding:6px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1"><strong>${esc(s.name)}</strong> <small>${esc([GG_ELIG.find(x=>x[0]===s.elig)?.[1],GG_CATS.find(x=>x[0]===s.cat)?.[1]].filter(Boolean).join(" · "))} · last run ${fmtD(s.lastRun)}</small></div>
      <button class="b sm" onclick="runSaved('${s.id}')">Run</button><button class="lk dz" onclick="delSaved('${s.id}')">×</button></div>`).join("")}</div>`:""}

  ${searchState.error?`<div class="note d">${esc(searchState.error)}</div>`:""}

  ${searchState.hits.length?`<div class="card"><div class="ch"><h3>${searchState.count.toLocaleString()} result${searchState.count===1?"":"s"}</h3><div class="hspace"></div>
      <small>sorted by closing date</small></div>
    ${searchState.hits.map(h=>{ const d=daysTo(h.close), f=searchState.fit[h.id], inP=o.apps.some(a=>a.oppId===h.id), isNew=hasSeen&&!seen.has(h.id);
      return `<div class="opp ${isNew?"new":""}"><div class="ch" style="margin-bottom:6px"><div style="flex:1;min-width:240px">
          <strong style="color:var(--navy)">${esc(h.title)}</strong> ${isNew?'<span class="pill org">new</span>':""}<br>
          <small>${esc(h.agency||"")} · ${esc(h.number||"")}${h.cfda?" · ALN "+esc(h.cfda):""}</small></div>
          <div>${h.close?`<span class="pill ${d<0?"bad":d<=14?"bad":d<=30?"warn":"ok"}">${d<0?"closed":"closes "+fmtD(h.close)}</span>`:`<span class="pill neu">${esc(h.status||"")}</span>`}</div></div>
        ${f?(f.loading?`<div class="note"><span class="spin dk"></span> Checking fit…</div>`:f.error?`<div class="note d">Fit check failed: ${esc(f.error)}</div>`:
          `<div class="note ${f.score>=70?"g":f.score>=40?"w":"d"}"><strong>Fit ${f.score}/100.</strong> ${esc(f.summary)}
            ${f.reasons.length?`<br><small><b>For:</b> ${f.reasons.map(esc).join(" · ")}</small>`:""}${f.risks.length?`<br><small><b>Risks:</b> ${f.risks.map(esc).join(" · ")}</small>`:""}</div>`):""}
        <div class="btnrow">${inP?'<span class="pill ok">in pipeline</span>':`<button class="b sm" onclick="addOpp('${h.id}')">+ Add to pipeline</button>`}
          ${!f||f.error?`<button class="b n sm" onclick="fitCheck('${h.id}')"><span class="ai-badge">AI</span> Fit check</button>`:""}
          <a class="lk" href="https://www.grants.gov/search-results-detail/${encodeURIComponent(h.id)}" target="_blank" rel="noopener">View on Grants.gov ↗</a></div></div>`; }).join("")}
    <div class="btnrow">${searchState.page>0?`<button class="b g sm" onclick="runSearch(${searchState.page-1})">← Previous</button>`:""}
      ${(searchState.page+1)*25<searchState.count?`<button class="b g sm" onclick="runSearch(${searchState.page+1})">Next 25 →</button>`:""}</div>
  </div>`:(!searchState.loading&&searchState.q&&!searchState.error?`<div class="card"><div class="empty">No matches. Try broader keywords or “Any eligibility”.</div></div>`:"")}

  <div class="grid g2">
    <div class="card"><h3>Add a prospect from anywhere</h3><p><small>Foundations, corporate giving, city and state programs — anything not on Grants.gov.</small></p>
      <div class="grid g2"><div class="f"><label>Funder</label><input id="mpFunder"></div><div class="f"><label>Opportunity</label><input id="mpTitle"></div>
        <div class="f"><label>Deadline</label><input id="mpDl" type="date"></div><div class="f"><label>Amount</label><input id="mpAmt" type="number"></div></div>
      <div class="f"><label>Link</label><input id="mpUrl" placeholder="https://"></div>
      <button class="b" onclick="addProspect()">+ Add to pipeline</button></div>
    <div class="card"><h3>Other places to look</h3>
      <ul style="margin:0;padding-left:18px;line-height:1.9;font-size:.9rem">
        <li><a href="https://candid.org/find-funding" target="_blank" rel="noopener">Candid — foundation funders</a> <small>(subscription; many libraries offer free access)</small></li>
        <li><a href="https://www.philafound.org" target="_blank" rel="noopener">Philadelphia Foundation</a></li>
        <li><a href="https://sam.gov/content/assistance-listings" target="_blank" rel="noopener">SAM.gov assistance listings</a> <small>— federal programs by ALN</small></li>
        <li><a href="${ggLink}" target="_blank" rel="noopener">Grants.gov full search</a></li>
      </ul>
      <small>Paste any announcement you find into the RFP Reader to turn it into an application.</small></div>
  </div>`;
}
VIEW_FN.search = viewSearch;
