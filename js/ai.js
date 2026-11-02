/* ============================================================
   AI LAYER — Claude drafting, AI RFP reading, revisions, history
   Falls back to the offline vault engine whenever AI is off or fails.
   ============================================================ */
"use strict";

/* ---------- device settings (never synced, never exported) ---------- */
const CFG_KEY = "grantCopilot.device";
const CFG_DEFAULT = { aiOn:true, aiMode:"direct", apiKey:"", model:"claude-sonnet-5-5",
  supaUrl:"", supaKey:"", grantsProxy:"" };
const CFG = (()=>{ try{ return Object.assign({}, CFG_DEFAULT, JSON.parse(localStorage.getItem(CFG_KEY)||"{}")); }
  catch(e){ return Object.assign({}, CFG_DEFAULT); } })();
function saveCfg(){ try{ localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); }catch(e){} }
const MODELS = [
  ["claude-sonnet-5-5","Sonnet 5.5 — fast, strong writing (recommended)"],
  ["claude-opus-5-5","Opus 5.5 — highest quality, slower, costs more"],
  ["claude-haiku-5-5","Haiku 5.5 — fastest and cheapest"]
];

/* ---------- script loader for optional libraries ---------- */
const _loaded = {};
function loadScript(src){
  if(_loaded[src]) return _loaded[src];
  return _loaded[src] = new Promise((res,rej)=>{
    const s=document.createElement("script"); s.src=src; s.async=true;
    s.onload=()=>res(); s.onerror=()=>{ delete _loaded[src]; rej(new Error("Could not load "+src)); };
    document.head.appendChild(s);
  });
}

/* ---------- Claude client ---------- */
const AI = {
  ready(){
    if(!CFG.aiOn) return false;
    if(CFG.aiMode==="proxy") return !!(window.Cloud && Cloud.signedIn() && CFG.supaUrl);
    return !!CFG.apiKey;
  },
  async call({system, prompt, messages, maxTokens=2000, temperature}){
    if(!AI.ready()) throw new Error("AI is not set up — add a key in Settings");
    const body = { model: CFG.model||CFG_DEFAULT.model, max_tokens: maxTokens,
      system, messages: messages || [{role:"user", content: prompt}] };
    if(temperature!=null) body.temperature = temperature;
    let url, headers = {"content-type":"application/json"};
    if(CFG.aiMode==="proxy"){
      url = CFG.supaUrl.replace(/\/$/,"") + "/functions/v1/claude-proxy";
      headers.Authorization = "Bearer " + (await Cloud.token());
      headers.apikey = CFG.supaKey;
    } else {
      url = "https://api.anthropic.com/v1/messages";
      headers["x-api-key"] = CFG.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
    let r;
    try{ r = await fetch(url, {method:"POST", headers, body: JSON.stringify(body)}); }
    catch(e){ throw new Error("Network error reaching the AI service"); }
    const j = await r.json().catch(()=>({}));
    if(!r.ok){
      const m = (j.error && (j.error.message||j.error)) || j.message || ("HTTP "+r.status);
      if(r.status===401) throw new Error("The API key was rejected — check it in Settings");
      if(r.status===429) throw new Error("Rate limited by the AI service — wait a minute and retry");
      throw new Error(String(m));
    }
    const text = (j.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
    if(j.stop_reason==="max_tokens") console.warn("AI response hit max_tokens");
    return text;
  },
  json(text){
    const t = String(text||"").replace(/^```(?:json)?\s*/i,"").replace(/```\s*$/,"");
    const i=t.indexOf("{"), j=t.lastIndexOf("}");
    if(i<0||j<i) throw new Error("AI did not return JSON");
    return JSON.parse(t.slice(i,j+1));
  }
};

/* ---------- context builders ---------- */
function vaultContext(o){
  const P=o.profile, L=[];
  Object.keys(FIELD_LABEL).forEach(k=>{ const v=String(P[k]||"").trim(); if(v) L.push(`[vault:${k}] ${FIELD_LABEL[k]}: ${v}`); });
  if(o.board.length) L.push("[vault:board] Board of Directors: "+o.board.map(b=>b.name+(b.role?" ("+b.role+")":"")+(b.affil?", "+b.affil:"")).join("; "));
  if(o.staff.length) L.push("[vault:staff] Key staff: "+o.staff.map(s=>s.name+(s.title?", "+s.title:"")+(s.cred?" ("+s.cred+")":"")+(s.bio?" — "+s.bio:"")).join("; "));
  if(o.programs.length) L.push("[vault:programs] Programs: "+o.programs.map(p=>p.name+(p.ages?" ("+p.ages+")":"")+(p.cap?", capacity "+p.cap:"")+(p.desc?" — "+p.desc:"")).join("; "));
  if(o.awards.length) L.push("[vault:awards] Grant history: "+o.awards.map(a=>(a.funder||"?")+" "+money(a.amount)+(a.year?" ("+a.year+")":"")+(a.purpose?" for "+a.purpose:"")).join("; "));
  return L.join("\n");
}
function libraryContext(o, qtext, n){
  return matchAnswers(qtext,o).slice(0,n||4).map(m=>{
    const a=m.a;
    return `[answer:${a.id}] "${a.title||"Untitled"}"${a.won?" (FUNDED)":""}${a.funder?" — written for "+a.funder:""}\nQuestion: ${a.question||"—"}\nAnswer: ${String(a.text||"").slice(0,4000)}`;
  }).join("\n\n");
}
function rfpContext(a){
  const p=a.parsed||{}, L=[];
  if(a.funder) L.push("Funder: "+a.funder);
  if(a.title) L.push("Opportunity: "+a.title);
  if(a.amount) L.push("Amount requested: "+money(a.amount));
  if(p.summary) L.push("RFP summary: "+p.summary);
  if(p.scoring&&p.scoring.length) L.push("Scoring criteria: "+p.scoring.map(s=>s.crit+" ("+s.pts+" pts)").join("; "));
  if(p.priorities&&p.priorities.length) L.push("Funder priorities: "+p.priorities.join("; "));
  if(p.eligibility&&p.eligibility.length) L.push("Eligibility: "+p.eligibility.slice(0,4).join(" | "));
  return L.join("\n");
}
const SYS_WRITER = `You are an experienced grant writer drafting answers for a nonprofit's grant application.
Rules you must follow:
- Use ONLY facts found in the VAULT and ANSWER LIBRARY provided. Never invent numbers, names, dates, partners, outcomes, or statistics.
- When a fact the answer needs is missing, insert a marker exactly like ⟦NEEDS: short description⟧ where it belongs. Do not guess.
- Prefer language from FUNDED answers when they fit, adapted to this funder and question.
- Answer the question that was asked, directly, in the funder's terms. Weight toward the scoring criteria.
- Plain professional prose. No markdown headings, no bullet symbols unless the question asks for a list. No preamble.
- Respect the length limit strictly.`;

function limitText(q){
  if(!q.limit) return "No stated limit — aim for 150 to 350 words unless the question clearly needs less.";
  return q.limitType==="chars"
    ? `HARD LIMIT: ${q.limit} characters including spaces. Aim for ${Math.round(q.limit*0.85)}–${q.limit}.`
    : `HARD LIMIT: ${q.limit} words. Aim for ${Math.round(q.limit*0.85)}–${q.limit} words.`;
}
function overLimit(q,t){
  if(!q.limit) return false;
  return q.limitType==="chars" ? t.length>q.limit : words(t)>q.limit;
}
function trimToLimit(q,text){
  if(!overLimit(q,text)) return text;
  const sents=text.split(/(?<=[.!?])\s+/), out=[];
  for(const s of sents){ const c=out.concat(s).join(" "); if(overLimit(q,c)) break; out.push(s); }
  return (out.length?out.join(" "):text)+"\n\n"+gapTok("Trimmed to fit the "+q.limit+"-"+(q.limitType==="chars"?"character":"word")+" limit — review what was cut");
}
function labelSource(o,s){
  const m=String(s).match(/^(vault|answer):(.+)$/); if(!m) return String(s);
  if(m[1]==="vault") return FIELD_LABEL[m[2]] || ({board:"Board list",staff:"Key staff",programs:"Programs",awards:"Grant history"})[m[2]] || m[2];
  const a=o.answers.find(x=>x.id===m[2]); return a?"Library: "+(a.title||"untitled")+(a.won?" (funded)":""):"Library answer";
}

async function aiDraft(a, q, o, extra){
  const prompt = `VAULT (facts about the organization):
${vaultContext(o)||"(empty)"}

ANSWER LIBRARY (closest past answers):
${libraryContext(o,q.text)||"(none matched)"}

APPLICATION CONTEXT:
${rfpContext(a)||"(none)"}

QUESTION:
${q.text}

${limitText(q)}
${extra?"\nADDITIONAL INSTRUCTION FROM THE WRITER:\n"+extra+"\n":""}
Return ONLY a JSON object:
{"draft":"the answer text","sources":["vault:fieldKey or answer:id you drew from"],"gaps":["each missing fact you marked"],"note":"one short sentence of advice for the writer, or empty"}`;
  const raw = await AI.call({system:SYS_WRITER, prompt, maxTokens: Math.min(8000, 1200 + (q.limit? (q.limitType==="chars"?q.limit/3:q.limit*2.2):1200))});
  let r; try{ r=AI.json(raw); }catch(e){ r={draft:raw, sources:[], gaps:[]}; }
  let text = String(r.draft||"").trim();
  if(!text) throw new Error("AI returned an empty draft");
  if(overLimit(q,text)){
    const shorter = await AI.call({system:SYS_WRITER, maxTokens:4000,
      prompt:`Shorten this answer to fit. ${limitText(q)} Keep every ⟦NEEDS: …⟧ marker and every fact; cut repetition first. Return only the shortened answer text.\n\n${text}`});
    if(shorter) text = shorter.trim();
    text = trimToLimit(q,text);
  }
  const srcKeys = Array.isArray(r.sources)?r.sources:[];
  return { text, ai:true, source:"AI draft ("+(CFG.model||"")+")",
    sources: srcKeys.map(s=>labelSource(o,s)),
    answerIds: srcKeys.map(s=>(String(s).match(/^answer:(.+)$/)||[])[1]).filter(Boolean),
    gaps: (text.match(/⟦NEEDS:\s*([^⟧]+)⟧/g)||[]).map(g=>g.replace(/⟦NEEDS:\s*|⟧/g,"").trim()),
    note: r.note||"" };
}

function setBusy(id,on,label){
  const b=document.getElementById(id); if(!b) return;
  if(on){ b.dataset.html=b.innerHTML; b.disabled=true; b.innerHTML=`<span class="spin"></span> ${label||"Working…"}`; }
  else { b.disabled=false; if(b.dataset.html) b.innerHTML=b.dataset.html; }
}

async function draftOne(a,q,o,extra){
  if(AI.ready()){
    try{ return await aiDraft(a,q,o,extra); }
    catch(e){
      const r=buildDraft(q,o);
      return Object.assign(r,{note:"AI unavailable ("+e.message+") — used the offline vault engine.", aiError:e.message});
    }
  }
  return buildDraft(q,o);
}
function storeDraft(a,qid,r){
  pushVersion(a,qid,"before regenerate");
  a.drafts[qid]=r.text;
  a.draftMeta=a.draftMeta||{};
  const lib = (r.source||"").startsWith("Answer library") ? matchAnswers(a.parsed.questions.find(x=>x.id===qid).text, org()).slice(0,1).map(m=>m.a.id) : [];
  a.draftMeta[qid]={source:r.source, gaps:r.gaps||[], ai:!!r.ai, sources:r.sources||[], note:r.note||"", answerIds:(r.answerIds||[]).concat(lib), at:new Date().toISOString()};
}

async function gen(aid,qid){
  const o=org(), a=o.apps.find(x=>x.id===aid); if(!a) return;
  const q=a.parsed.questions.find(x=>x.id===qid); if(!q) return;
  setBusy("gen_"+qid,true,AI.ready()?"Claude is writing…":"Drafting…");
  const r=await draftOne(a,q,o);
  storeDraft(a,qid,r); save(); render();
  if(r.aiError) toast("AI failed: "+r.aiError+" — used offline engine","err");
  else toast(r.gaps&&r.gaps.length?`Drafted with ${r.gaps.length} gap${r.gaps.length===1?"":"s"} to fill`:"Drafted");
}
async function genAll(aid){
  const o=org(), a=o.apps.find(x=>x.id===aid); if(!a) return;
  const todo=a.parsed.questions.filter(q=>!String((a.drafts||{})[q.id]||"").trim());
  if(!todo.length){ toast("Every question already has a draft"); return; }
  let n=0,g=0,err="";
  for(const q of todo){
    toast(`Drafting ${n+1} of ${todo.length}…`);
    setBusy("gen_"+q.id,true,"Queued…");
    const r=await draftOne(a,q,o); storeDraft(a,q.id,r); n++; g+=(r.gaps||[]).length; if(r.aiError) err=r.aiError;
    save();
  }
  render();
  toast(err?`Drafted ${n}; AI error on some (${err})`:`Drafted ${n} answer${n===1?"":"s"} · ${g} gap${g===1?"":"s"} flagged`, err?"err":"");
}
async function reviseDraft(aid,qid){
  const o=org(), a=o.apps.find(x=>x.id===aid); const q=a&&a.parsed.questions.find(x=>x.id===qid); if(!q) return;
  const cur=(a.drafts||{})[qid]||"";
  App.openModal(`<h2>Revise with AI</h2>
    <div class="f"><label>What should change?</label>
      <textarea id="revInstr" rows="3" placeholder="e.g. Lead with the outcomes data. Make it warmer. Tie it to the funder's literacy priority. Cut to 200 words."></textarea></div>
    <div class="btnrow" style="margin-bottom:10px">${["Tighten — cut 20%","Lead with impact and numbers","Align closer to the scoring criteria","Make the tone warmer and more community-centered"].map(s=>`<button class="b g sm" onclick="document.getElementById('revInstr').value=${JSON.stringify(s).replace(/"/g,"&quot;")}">${esc(s)}</button>`).join("")}</div>
    <div class="btnrow"><button class="b n" id="revGo" onclick="runRevise('${aid}','${qid}')"><span class="ai-badge">AI</span> Revise</button>
      <button class="b g" onclick="App.closeModal()">Cancel</button></div>`);
}
async function runRevise(aid,qid){
  const o=org(), a=o.apps.find(x=>x.id===aid); const q=a.parsed.questions.find(x=>x.id===qid);
  const instr=document.getElementById("revInstr").value.trim(); if(!instr){ toast("Say what should change","err"); return; }
  setBusy("revGo",true,"Revising…");
  try{
    const r=await aiDraft(a,q,o,"Revise this current draft rather than starting over. Keep any ⟦NEEDS: …⟧ markers that are still unresolved.\nCURRENT DRAFT:\n"+(a.drafts[qid]||"")+"\n\nREQUESTED CHANGE: "+instr);
    r.source="AI revision: "+instr.slice(0,60);
    storeDraft(a,qid,r); save(); App.closeModal(); render(); toast("Revised — the previous version is in History");
  }catch(e){ setBusy("revGo",false); toast("AI error: "+e.message,"err"); }
}
function showVersions(aid,qid){
  const a=org().apps.find(x=>x.id===aid); const L=(a.versions||{})[qid]||[];
  App.openModal(`<div class="ch"><h2>Draft history</h2><div class="hspace"></div><button class="b g sm" onclick="App.closeModal()">Close</button></div>
    <p><small>Up to 20 earlier versions are kept for each answer${window.Cloud&&Cloud.signedIn()?" and synced to your account":""}.</small></p>
    ${L.map((v,i)=>`<div class="ver"><div class="inline"><strong style="flex:1">${new Date(v.t).toLocaleString()}</strong>
      <small>${esc(v.src||"")}${v.by?" · "+esc(v.by):""} · ${words(v.text)} words</small></div>
      <pre>${esc(v.text)}</pre>
      <div class="btnrow" style="margin-top:6px"><button class="b sm" onclick="restoreVersion('${aid}','${qid}',${i})">Restore this version</button></div></div>`).join("")}`);
}
function restoreVersion(aid,qid,i){
  const a=org().apps.find(x=>x.id===aid); const v=a.versions[qid][i]; if(!v) return;
  pushVersion(a,qid,"before restore"); a.drafts[qid]=v.text; save(); App.closeModal(); render(); toast("Version restored");
}

/* ---------- AI RFP reader ---------- */
const SYS_READER = `You extract structured requirements from grant announcements, NOFOs, and RFPs. Be exact. Quote the document's own wording for questions. Never invent requirements that are not in the text. Return only JSON.`;
async function aiParse(){
  const raw=(document.getElementById("rfpIn")||{}).value||"";
  if(!raw.trim()){ toast("Paste or load the announcement first","err"); return; }
  if(!AI.ready()){ toast("AI is off — running the quick offline read. Turn AI on in Settings.","err"); return doParse(); }
  setBusy("aiParseBtn",true,"Claude is reading…");
  const o=org(), P=o.profile;
  const orgBrief=[P.legalName||o.name, P.entityType, P.serviceArea, P.populationServed||P.ageGroups, P.mission, P.annualBudget?"Budget "+money(P.annualBudget):""].filter(Boolean).join(" | ");
  const prompt=`Today is ${today()}. Read this funding announcement and return ONLY this JSON:
{
 "title":"opportunity name",
 "funder":"funding organization",
 "deadline":"YYYY-MM-DD of the application deadline, or empty",
 "deadlineLine":"the exact sentence stating the deadline",
 "amountMin":number or null, "amountMax":number or null,
 "summary":"2-3 sentences: what it funds, who is eligible, award size, period",
 "fit":"1-2 sentences on how well it fits this applicant, and any eligibility red flags: ${orgBrief.replace(/"/g,"'")}",
 "questions":[{"text":"each narrative question or prompt the applicant must answer, in order","limit":number or null,"limitType":"words" or "chars" or ""}],
 "attachments":[{"name":"required document","required":true/false,"ctx":"short quote where it is requested"}],
 "budget":[{"name":"rule e.g. Indirect cap, Match, Unallowable costs","lines":["quote"]}],
 "scoring":[{"crit":"criterion","pts":number}],
 "eligibility":["each eligibility requirement"],
 "priorities":["funder priorities or themes reviewers look for"]
}
Convert page limits to words at 500 words per single-spaced page and say so in the question text.

ANNOUNCEMENT:
${raw.slice(0,180000)}`;
  try{
    const r=AI.json(await AI.call({system:SYS_READER, prompt, maxTokens:8000, temperature:0}));
    const iso=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||""))?v:"";
    const num=v=>(v==null||v===""||isNaN(+v))?"":+v;
    lastParse={ ai:true, raw, title:r.title||"", funder:r.funder||"", deadline:iso(r.deadline), deadlineLine:r.deadlineLine||"",
      amountMin:num(r.amountMin), amountMax:num(r.amountMax), summary:r.summary||"", fit:r.fit||"",
      questions:(r.questions||[]).filter(q=>q&&q.text).map(q=>{ const c=classify(q.text);
        return {id:uid(), text:String(q.text).trim(), limit:num(q.limit), limitType:q.limit?(q.limitType==="chars"?"chars":"words"):"",
          topicId:c.topic?c.topic.id:"", topicLabel:c.topic?c.topic.label:"", conf:c.conf}; }),
      attachments:(r.attachments||[]).filter(x=>x&&x.name).map(x=>({name:x.name, required:!!x.required, ctx:x.ctx||""})),
      budget:(r.budget||[]).filter(x=>x&&x.name).map(x=>({name:x.name, lines:Array.isArray(x.lines)?x.lines:[String(x.lines||"")]})),
      scoring:(r.scoring||[]).filter(x=>x&&x.crit).map(x=>({crit:x.crit, pts:+x.pts||0})),
      eligibility:(r.eligibility||[]).map(String), priorities:(r.priorities||[]).map(String) };
    render(); toast(`AI found ${lastParse.questions.length} questions, ${lastParse.attachments.length} attachments`);
    const po=document.getElementById("parseOut"); if(po) po.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){
    setBusy("aiParseBtn",false);
    toast("AI read failed ("+e.message+") — ran the quick offline read instead","err");
    doParse();
  }
}

/* ---------- load RFP from a file ---------- */
async function loadRfpFile(inp){
  const f=inp.files&&inp.files[0]; if(!f) return;
  const st=document.getElementById("rfpFileState"); if(st) st.innerHTML=`<span class="spin dk"></span> reading ${esc(f.name)}…`;
  try{
    let text="";
    if(/\.pdf$/i.test(f.name)){
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
      pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const pdf=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise;
      for(let i=1;i<=pdf.numPages;i++){
        const c=await (await pdf.getPage(i)).getTextContent();
        let line="", lastY=null, out=[];
        c.items.forEach(it=>{ const y=Math.round(it.transform[5]); if(lastY!==null&&Math.abs(y-lastY)>2){ out.push(line); line=""; } line+=it.str; lastY=y; });
        out.push(line); text+=out.join("\n")+"\n\n";
      }
      if(!text.trim()) throw new Error("this PDF has no text layer (scanned image). Copy the text another way.");
    } else if(/\.docx$/i.test(f.name)){
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
      text=(await mammoth.extractRawText({arrayBuffer:await f.arrayBuffer()})).value;
    } else text=await f.text();
    document.getElementById("rfpIn").value=text;
    if(st) st.textContent=`Loaded ${f.name} · ${words(text).toLocaleString()} words`;
  }catch(e){ if(st) st.textContent=""; toast("Could not read the file: "+e.message,"err"); }
  inp.value="";
}
