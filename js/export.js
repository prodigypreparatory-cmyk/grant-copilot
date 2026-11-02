/* ============================================================
   EXPORTS — Word (.docx), PDF (print), portal copy, Markdown
   ============================================================ */
"use strict";

function appFileName(a,ext){ return (a.title||"application").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase().slice(0,60)+"."+ext; }
function appParts(aid){
  const o=org(), a=o.apps.find(x=>x.id===aid); if(!a) return null;
  const qs=(a.parsed&&a.parsed.questions)||[];
  const att=((a.parsed&&a.parsed.attachments)||[]).map(m=>{ const hit=o.docs.find(d=>fuzzyDoc(d.name,m.name));
    return {name:m.name, checked:!!(a.attachOK||{})[m.name], status: hit?(hit.status==="have"?"On hand"+(hit.loc?" — "+hit.loc:""):"NOT CONFIRMED"):"NOT IN LIBRARY"}; });
  return {o,a,qs,att};
}
function gapCount(t){ return (String(t||"").match(/⟦/g)||[]).length; }

function exportMenu(aid){
  const p=appParts(aid); if(!p) return;
  const gaps=p.qs.reduce((s,q)=>s+gapCount((p.a.drafts||{})[q.id]),0);
  App.openModal(`<div class="ch"><h2>Export application</h2><div class="hspace"></div><button class="b g sm" onclick="App.closeModal()">Close</button></div>
    ${gaps?`<div class="note d"><strong>${gaps} unresolved gap marker${gaps===1?"":"s"}.</strong> They are highlighted in red in every export so nothing slips through.</div>`:""}
    <div class="grid g2">
      <div class="rowbox"><h4>Word (.docx)</h4><p><small>Formatted document to edit, share, or attach.</small></p><button class="b" onclick="exportWord('${aid}')">Download .docx</button></div>
      <div class="rowbox"><h4>PDF</h4><p><small>Opens the print dialog — choose “Save as PDF”.</small></p><button class="b" onclick="exportPDF('${aid}')">Save as PDF</button></div>
      <div class="rowbox"><h4>Portal copy</h4><p><small>Plain text for each question, with character counts and copy buttons for online forms.</small></p><button class="b o" onclick="portalCopy('${aid}')">Open portal copy</button></div>
      <div class="rowbox"><h4>Markdown</h4><p><small>Plain-text file for Google Docs, Notion, or version control.</small></p><button class="b g" onclick="exportMD('${aid}')">Download .md</button></div>
    </div>`);
}

/* ---------- Word ---------- */
async function exportWord(aid){
  const p=appParts(aid); if(!p) return; const {o,a,qs,att}=p;
  toast("Building Word document…");
  try{ await loadScript("https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js"); }
  catch(e){ toast("Could not load the Word library — check your connection","err"); return; }
  const {Document,Packer,Paragraph,TextRun,HeadingLevel,AlignmentType,Footer,PageNumber}=docx;
  const runs=(t,opts)=>{ const out=[]; String(t).split(/(⟦[^⟧]*⟧)/).forEach(seg=>{ if(!seg) return;
    if(seg.startsWith("⟦")) out.push(new TextRun(Object.assign({text:seg,bold:true,color:"C0392B",highlight:"yellow"},opts||{})));
    else out.push(new TextRun(Object.assign({text:seg},opts||{}))); }); return out; };
  const para=t=>String(t||"").split(/\n{2,}/).map(block=>new Paragraph({spacing:{after:160,line:300},
    children: block.split("\n").flatMap((ln,i)=>i?[new TextRun({break:1}),...runs(ln)]:runs(ln))}));
  const meta=(k,v)=>new Paragraph({spacing:{after:40},children:[new TextRun({text:k+": ",bold:true}),new TextRun(String(v||"—"))]});
  const kids=[
    new Paragraph({heading:HeadingLevel.TITLE,children:[new TextRun(a.title||"Grant application")]}),
    meta("Organization",o.profile.legalName||o.name), meta("Funder",a.funder), meta("Amount requested",money(a.amount)),
    meta("Deadline",fmtD(a.deadline)), meta("Prepared",fmtD(today())), new Paragraph("")
  ];
  qs.forEach((q,i)=>{
    const d=(a.drafts||{})[q.id]||"⟦NOT DRAFTED⟧";
    kids.push(new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:280,after:80},children:[new TextRun(`${i+1}. ${q.text}`)]}));
    if(q.limit) kids.push(new Paragraph({spacing:{after:100},children:[new TextRun({text:`Limit: ${q.limit} ${q.limitType} · This answer: ${q.limitType==="chars"?d.length+" characters":words(d)+" words"}`,italics:true,size:18,color:"6B7488"})]}));
    kids.push(...para(d));
  });
  if(att.length){
    kids.push(new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:320},children:[new TextRun("Required attachments")]}));
    att.forEach(m=>kids.push(new Paragraph({spacing:{after:60},children:[new TextRun((m.checked?"☑ ":"☐ ")+m.name+" — "),new TextRun({text:m.status,bold:m.status!=="On hand"&&!m.status.startsWith("On hand"),color:m.status.startsWith("On hand")?"4A9439":"C0392B"})]})));
  }
  const doc=new Document({creator:"Grant Copilot",title:a.title||"Grant application",
    styles:{default:{document:{run:{font:"Calibri",size:22}}}},
    sections:[{properties:{page:{margin:{top:1440,bottom:1440,left:1440,right:1440}}},
      footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:(o.profile.legalName||o.name)+" · page ",size:16,color:"6B7488"}),new TextRun({children:[PageNumber.CURRENT],size:16,color:"6B7488"})]})]})},
      children:kids}]});
  const blob=await Packer.toBlob(doc);
  const u=URL.createObjectURL(blob), el=document.createElement("a"); el.href=u; el.download=appFileName(a,"docx");
  document.body.appendChild(el); el.click(); el.remove(); setTimeout(()=>URL.revokeObjectURL(u),3000);
  toast("Word document downloaded");
}

/* ---------- PDF via print ---------- */
function exportPDF(aid){
  const p=appParts(aid); if(!p) return; const {o,a,qs,att}=p;
  const body=t=>esc(t).replace(/⟦([^⟧]*)⟧/g,'<mark>⟦$1⟧</mark>').split(/\n{2,}/).map(b=>"<p>"+b.replace(/\n/g,"<br>")+"</p>").join("");
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.title||"Application")}</title><style>
    @page{margin:1in} body{font:11pt/1.5 Georgia,"Times New Roman",serif;color:#111}
    h1{font:700 20pt/1.2 -apple-system,Segoe UI,Arial,sans-serif;color:#1F2A44;margin:0 0 8pt}
    h2{font:700 12pt/1.3 -apple-system,Segoe UI,Arial,sans-serif;color:#1F2A44;margin:18pt 0 4pt;page-break-after:avoid}
    .meta{font:10pt/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#444;border-bottom:2px solid #5FB54A;padding-bottom:8pt;margin-bottom:10pt}
    .lim{font:italic 9pt Arial,sans-serif;color:#6b7488;margin:0 0 4pt} mark{background:#fdecea;color:#c0392b;font-weight:700}
    p{margin:0 0 8pt} li{margin-bottom:3pt}</style></head><body>
    <h1>${esc(a.title||"Grant application")}</h1>
    <div class="meta"><b>Organization:</b> ${esc(o.profile.legalName||o.name)} &nbsp;·&nbsp; <b>Funder:</b> ${esc(a.funder||"—")}<br>
      <b>Amount requested:</b> ${money(a.amount)} &nbsp;·&nbsp; <b>Deadline:</b> ${fmtD(a.deadline)}</div>
    ${qs.map((q,i)=>{const d=(a.drafts||{})[q.id]||"⟦NOT DRAFTED⟧";
      return `<h2>${i+1}. ${esc(q.text)}</h2>${q.limit?`<div class="lim">Limit ${q.limit} ${q.limitType} · ${q.limitType==="chars"?d.length+" characters":words(d)+" words"}</div>`:""}${body(d)}`;}).join("")}
    ${att.length?`<h2>Required attachments</h2><ul>${att.map(m=>`<li>${m.checked?"☑":"☐"} ${esc(m.name)} — ${esc(m.status)}</li>`).join("")}</ul>`:""}
    </body></html>`;
  const f=document.createElement("iframe"); f.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(()=>{ f.contentWindow.focus(); f.contentWindow.print(); setTimeout(()=>f.remove(),60000); },300);
}

/* ---------- portal copy ---------- */
function portalText(t){
  return String(t||"").replace(/\r/g,"").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
function portalCopy(aid){
  const p=appParts(aid); if(!p) return; const {a,qs}=p;
  window._portal=qs.map(q=>portalText((a.drafts||{})[q.id]));
  App.openModal(`<div class="ch"><h2>Portal copy</h2><div class="hspace"></div>
      <button class="b g sm" onclick="copyPortal(-1)">Copy all</button><button class="b g sm" onclick="App.closeModal()">Close</button></div>
    <div class="note">Paste each answer into the matching box on the funder's portal. Most portals count characters including spaces — the count below does the same.</div>
    ${qs.map((q,i)=>{ const t=window._portal[i]; const g=gapCount(t);
      const over=q.limit&&(q.limitType==="chars"?t.length>q.limit:words(t)>q.limit);
      return `<div class="rowbox"><div class="ch"><h4 style="flex:1">${i+1}. ${esc(q.text)}</h4>
        <button class="b sm" onclick="copyPortal(${i})" ${g?'title="Has unresolved gaps"':""}>Copy</button></div>
        <div class="draftbox" style="max-height:200px;overflow:auto">${t?renderDraftText(t):'<small>Not drafted.</small>'}</div>
        <div class="wc ${over?"over":""}">${words(t)} words · ${t.length} characters${q.limit?` · limit ${q.limit} ${q.limitType}`:""}${g?` · <span style="color:var(--red);font-weight:700">${g} gap${g===1?"":"s"} — resolve before pasting</span>`:""}</div></div>`;}).join("")}`);
}
function copyPortal(i){
  const p=window._portal||[];
  const t=i<0?p.map((x,k)=>`${k+1}. `+(((appParts(curApp)||{}).qs||[])[k]||{text:""}).text+"\n\n"+x).join("\n\n---\n\n"):p[i];
  navigator.clipboard.writeText(t||"").then(()=>toast(gapCount(t)?"Copied — but it still has gap markers":"Copied"));
}

/* ---------- Markdown (original exporter) ---------- */
function exportMD(aid){
  const p=appParts(aid); if(!p) return; const {o,a,qs,att}=p;
  const L=["# "+(a.title||"Grant application"),"","**Organization:** "+(o.profile.legalName||o.name),"**Funder:** "+(a.funder||"—"),
    "**Amount requested:** "+money(a.amount),"**Deadline:** "+fmtD(a.deadline),"**Stage:** "+(a.status||"—"),"","---"];
  qs.forEach((q,i)=>{ const d=(a.drafts||{})[q.id]||"_Not drafted._";
    L.push("","## "+(i+1)+". "+q.text); if(q.limit) L.push("*Limit: "+q.limit+" "+q.limitType+"*");
    L.push("",d,"","*Words: "+words(d)+(q.limit&&q.limitType==="words"?" / "+q.limit:"")+"*"); });
  if(att.length){ L.push("","---","","## Required attachments"); att.forEach(m=>L.push("- ["+(m.checked?"x":" ")+"] "+m.name+" — "+m.status)); }
  if(a.notes) L.push("","## Notes",a.notes);
  L.push("","---","","Generated by Grant Copilot on "+fmtD(today())+". Resolve every ⟦NEEDS: …⟧ marker before submission.");
  dl(appFileName(a,"md"), L.join("\n"), "text/markdown"); toast("Exported as Markdown");
}
