const $=id=>document.getElementById(id);

const PUMPS=[
 {id:"jandy_vs_27",name:"Jandy VS FloPro 2.7 HP"},
 {id:"jandy_vs_185",name:"Jandy VS FloPro 1.85 HP"},
 {id:"jandy_fhpm_10",name:"Jandy FloPro FHPM 1.0 HP"},
 {id:"jandy_vs_38",name:"Jandy VS FloPro 3.8 HP"}
];

const state={wf:[],pumps:[],curves:defaults(),selPump:null,modalPump:"jandy_vs_27"};

function defaults(){
 // Starter placeholder points (edit in “Edit Curves” for accurate manufacturer data)
 return{
  jandy_vs_27:[
   {rpm:3450,label:"3450 RPM",pts:[[0,95],[30,92],[60,86],[90,75],[120,55],[135,44]]},
   {rpm:3000,label:"3000 RPM",pts:[[0,75],[30,71],[60,63],[90,50],[120,33]]},
   {rpm:2750,label:"2750 RPM",pts:[[0,63],[30,59],[60,52],[90,38],[110,27]]},
   {rpm:2400,label:"2400 RPM",pts:[[0,49],[30,45],[60,39],[90,28],[100,19]]}
  ],
  jandy_vs_185:[
   {rpm:3450,label:"3450 RPM",pts:[[0,77],[30,75],[60,70],[90,57],[110,40],[120,33]]},
   {rpm:3000,label:"3000 RPM",pts:[[0,58],[30,55],[60,49],[90,36],[105,25]]}
  ],
  jandy_fhpm_10:[{rpm:3450,label:"High",pts:[[0,57],[30,52],[60,40],[80,25]]}],
  jandy_vs_38:[
   {rpm:3450,label:"3450 RPM",pts:[[0,103],[40,99],[80,92],[120,78],[160,50],[185,38]]},
   {rpm:3000,label:"3000 RPM",pts:[[0,77],[40,73],[80,66],[120,50],[165,22]]}
  ]
 };
}

function num(v){const n=parseFloat(v);return Number.isFinite(n)?n:0;}
function fmt(v){return (Math.round(v*10)/10).toFixed(1);}

function turnoverHrs(){
 const p=$("turnoverPreset").value;
 if(p==="custom"){const c=num($("turnoverCustom").value);return c>0?c:8;}
 return num(p)||8;
}
function calcTurnoverGpm(){
 const vol=num($("poolVolume").value); if(vol<=0) return 0;
 return vol/(turnoverHrs()*60);
}
function calcWfGpm(){return state.wf.reduce((s,r)=>s+num(r.qty)*num(r.w)*num(r.k),0);}

function renderWF(){
 const body=$("wfBody"); body.innerHTML="";
 state.wf.forEach((r,i)=>{
  const row=document.createElement("div"); row.className="tr";
  row.innerHTML=`
   <select data-i="${i}" data-k="type">
    ${["Sheer","Scupper","Rain Curtain","Bubbler","Deck Jet","Other"].map(t=>`<option ${t===r.type?"selected":""}>${t}</option>`).join("")}
   </select>
   <div class="r"><input data-i="${i}" data-k="qty" type="number" min="0" step="1" value="${r.qty}"></div>
   <div class="r"><input data-i="${i}" data-k="w" type="number" min="0" step="0.1" value="${r.w}"></div>
   <div class="r"><input data-i="${i}" data-k="k" type="number" min="0" step="0.5" value="${r.k}"></div>
   <div class="r"><b>${fmt(num(r.qty)*num(r.w)*num(r.k))}</b></div>
   <button class="x" data-del="${i}">✕</button>`;
  body.appendChild(row);
 });

 body.querySelectorAll("input,select").forEach(el=>{
  const upd=()=>{
   const i=parseInt(el.dataset.i,10),k=el.dataset.k;
   if(k==="type"){
    state.wf[i].type=el.value;
    // soft defaults (editable)
    if(el.value==="Sheer") state.wf[i].k=15;
    if(el.value==="Scupper") state.wf[i].k=10;
    if(el.value==="Rain Curtain") state.wf[i].k=12;
    if(el.value==="Bubbler") state.wf[i].k=12;
    if(el.value==="Deck Jet") state.wf[i].k=8;
   } else {
    state.wf[i][k]=num(el.value);
   }
   renderWF(); recalc();
  };
  el.addEventListener("change",upd);
  el.addEventListener("input",upd);
 });

 body.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
  state.wf.splice(parseInt(b.dataset.del,10),1); renderWF(); recalc();
 }));
}

function renderPumps(){
 const body=$("pumpBody"); body.innerHTML="";
 state.pumps.forEach((p,i)=>{
  const row=document.createElement("div"); row.className="tr pumps";
  row.innerHTML=`
   <select data-i="${i}" data-k="model">
     ${PUMPS.map(m=>`<option value="${m.id}" ${m.id===p.model?"selected":""}>${m.name}</option>`).join("")}
   </select>
   <div class="r"><input data-i="${i}" data-k="qty" type="number" min="1" step="1" value="${p.qty}"></div>
   <select data-i="${i}" data-k="sys">
     ${["Pool","Water Feature","Shared"].map(s=>`<option ${s===p.sys?"selected":""}>${s}</option>`).join("")}
   </select>
   <div class="r"><input data-i="${i}" data-k="tdh" type="number" min="0" step="0.5" value="${p.tdh}"></div>
   <div class="r"><b id="res_${p.id}">—</b></div>
   <button class="x" data-del="${i}">✕</button>`;
  row.addEventListener("click",()=>{state.selPump=p.id; updateChart();});
  body.appendChild(row);
 });

 body.querySelectorAll("input,select").forEach(el=>{
  const upd=()=>{
   const i=parseInt(el.dataset.i,10),k=el.dataset.k;
   state.pumps[i][k]= (k==="model"||k==="sys") ? el.value : num(el.value);
   recalc();
  };
  el.addEventListener("input",upd);
  el.addEventListener("change",upd);
 });

 body.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{
  state.pumps.splice(parseInt(b.dataset.del,10),1);
  if(state.pumps.length===0) state.selPump=null;
  renderPumps(); recalc();
 }));
}

function interp(pts,x){
 const p=pts.slice().sort((a,b)=>a[0]-b[0]);
 if(x<=p[0][0]) return p[0][1];
 if(x>=p[p.length-1][0]) return p[p.length-1][1];
 for(let i=0;i<p.length-1;i++){
  const [x1,y1]=p[i],[x2,y2]=p[i+1];
  if(x>=x1 && x<=x2){
   const t=(x-x1)/(x2-x1); return y1+t*(y2-y1);
  }
 }
 return null;
}

function bestLine(model,flow,tdh){
 const lines=state.curves[model]||[]; let best=null;
 for(const L of lines){
  const h=interp(L.pts,flow); if(h==null) continue;
  const s=Math.abs(h-tdh);
  if(!best||s<best.s) best={...L,h,s};
 }
 return best;
}

function recalc(){
 const tg=calcTurnoverGpm(), wg=calcWfGpm(), total=tg+wg;
 $("turnoverGpm").textContent=fmt(tg)+" GPM";
 $("wfGpm").textContent=fmt(wg)+" GPM";
 $("totalGpm").textContent=fmt(total)+" GPM";

 const dem={ "Pool":tg, "Water Feature":wg, "Shared":total };
 state.pumps.forEach(p=>{
  const sys=dem[p.sys] ?? total;
  const per=sys/Math.max(1,num(p.qty));
  const b=bestLine(p.model,per,num(p.tdh));
  const el=$("res_"+p.id);
  if(!el) return;
  el.textContent=b ? (`${Math.round(b.rpm)} RPM | ${fmt(b.h)} ft @ ${fmt(per)} GPM`) : "No curve";
 });
 updateChart();
}

let chart;
function initChart(){
 chart=new Chart($("curveChart"),{
  type:"line",
  data:{datasets:[]},
  options:{
   responsive:true,maintainAspectRatio:false,
   plugins:{legend:{labels:{color:"#eaf0ff"}}},
   scales:{
    x:{title:{display:true,text:"Flow (GPM)",color:"#eaf0ff"},ticks:{color:"#c9d4ff"},grid:{color:"rgba(255,255,255,.08)"}},
    y:{title:{display:true,text:"TDH (ft)",color:"#eaf0ff"},ticks:{color:"#c9d4ff"},grid:{color:"rgba(255,255,255,.08)"}}
   }
  }
 });
}

function updateChart(){
 const total=calcTurnoverGpm()+calcWfGpm();
 const pump=state.pumps.find(x=>x.id===state.selPump) || state.pumps[0];
 if(!pump){chart.data.datasets=[]; chart.update(); return;}

 const lines=state.curves[pump.model]||[];
 const dem={ "Pool":calcTurnoverGpm(), "Water Feature":calcWfGpm(), "Shared":total };
 const sys=dem[pump.sys] ?? total;
 const per=sys/Math.max(1,num(pump.qty));
 const tdh=num(pump.tdh);

 const ds=lines.map(L=>({
  label:L.label,
  data:L.pts.map(([x,y])=>({x,y})),
  borderWidth:2,pointRadius:0,tension:.25
 }));

 const b=bestLine(pump.model,per,tdh);
 if(b) ds.push({label:"Operating Point",data:[{x:per,y:b.h}],showLine:false,pointRadius:6});

 ds.push({label:"Target TDH",data:[{x:0,y:tdh},{x:Math.max(10,per*1.6),y:tdh}],borderDash:[6,6],pointRadius:0});
 chart.data.datasets=ds; chart.update();
}

// TDH estimate (Hazen–Williams)
function estimateTdh(){
 const Q=Math.max(.01, calcTurnoverGpm()+calcWfGpm());
 const d=num($("pipeSize").value), L=num($("pipeLength").value), C=num($("cHw").value)||140;
 const elev=num($("elev").value), equip=num($("equipHead").value);
 const hf=4.52*L*Math.pow(Q,1.85)/(Math.pow(C,1.85)*Math.pow(d,4.87));
 const tdh=hf+elev+equip;
 $("tdhOut").textContent=`TDH: ${fmt(tdh)} ft (friction ${fmt(hf)} ft)`;
 const ap=$("applyTo").value;
 state.pumps.forEach(p=>{
  if(ap==="all") p.tdh=tdh;
  else if(ap==="pool" && p.sys==="Pool") p.tdh=tdh;
  else if(ap==="water" && p.sys==="Water Feature") p.tdh=tdh;
  else if(ap==="shared" && p.sys==="Shared") p.tdh=tdh;
 });
 renderPumps(); recalc();
}

// Curves modal
function openModal(){
 $("curvesModal").setAttribute("aria-hidden","false");
 renderTabs(); renderLines();
}
function closeModal(){ $("curvesModal").setAttribute("aria-hidden","true"); }
function renderTabs(){
 const w=$("curveTabs"); w.innerHTML="";
 PUMPS.forEach(p=>{
  const b=document.createElement("button");
  b.className="tab"+(p.id===state.modalPump?" active":"");
  b.textContent=p.name;
  b.onclick=()=>{state.modalPump=p.id; renderTabs(); renderLines();};
  w.appendChild(b);
 });
}
function renderLines(){
 const w=$("curveLines"); w.innerHTML="";
 const lines=state.curves[state.modalPump]||[];
 lines.forEach((L,i)=>{
  const div=document.createElement("div"); div.className="line";
  div.innerHTML=`
   <div>
    <label>RPM<input data-rpm="${i}" type="number" value="${L.rpm}"></label>
    <label>Label<input data-lbl="${i}" value="${L.label||""}"></label>
   </div>
   <div>
    <label>Points<textarea data-pts="${i}" rows="5" spellcheck="false">${L.pts.map(p=>p.join(",")).join("\n")}</textarea></label>
   </div>
   <button class="x" data-del="${i}">✕</button>`;
  w.appendChild(div);
 });

 w.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
  const i=parseInt(b.dataset.del,10);
  (state.curves[state.modalPump]||[]).splice(i,1);
  renderLines();
 });

 w.querySelectorAll("input,textarea").forEach(el=>el.oninput=()=>{
  const lines=state.curves[state.modalPump]||[];
  w.querySelectorAll("[data-rpm]").forEach(inp=>{const i=parseInt(inp.dataset.rpm,10); if(lines[i]) lines[i].rpm=num(inp.value);});
  w.querySelectorAll("[data-lbl]").forEach(inp=>{const i=parseInt(inp.dataset.lbl,10); if(lines[i]) lines[i].label=inp.value;});
  w.querySelectorAll("[data-pts]").forEach(ta=>{const i=parseInt(ta.dataset.pts,10); if(lines[i]) lines[i].pts=parsePts(ta.value);});
 });
}
function parsePts(t){
 const pts=[];
 t.split(/\r?\n/).forEach(s=>{
  s=s.trim(); if(!s) return;
  const a=s.split(",").map(x=>x.trim()); if(a.length<2) return;
  const x=num(a[0]), y=num(a[1]);
  if(Number.isFinite(x)&&Number.isFinite(y)) pts.push([x,y]);
 });
 pts.sort((a,b)=>a[0]-b[0]);
 return pts;
}

// Export/Import
function exportJson(){
 const data={
  project:{
    clientName:$("clientName").value,
    location:$("location").value,
    poolVolume:num($("poolVolume").value),
    turnoverPreset:$("turnoverPreset").value,
    turnoverCustom:$("turnoverCustom").value
  },
  wf:state.wf,
  pumps:state.pumps,
  curves:state.curves,
  eng:{
    pipeSize:$("pipeSize").value,
    pipeLength:$("pipeLength").value,
    elev:$("elev").value,
    equipHead:$("equipHead").value,
    cHw:$("cHw").value,
    applyTo:$("applyTo").value
  }
 };
 const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
 const a=document.createElement("a");
 a.href=URL.createObjectURL(blob);
 a.download="regal-pool-pump-tool.json";
 a.click();
}

function importJson(ev){
 const f=ev.target.files?.[0]; if(!f) return;
 const r=new FileReader();
 r.onload=()=>{try{
  const d=JSON.parse(r.result);
  if(d.project){
   $("clientName").value=d.project.clientName||"";
   $("location").value=d.project.location||"";
   $("poolVolume").value=d.project.poolVolume ?? "";
   $("turnoverPreset").value=d.project.turnoverPreset || "8";
   $("turnoverCustom").value=d.project.turnoverCustom || "";
   $("turnoverCustom").disabled = $("turnoverPreset").value !== "custom";
  }
  state.wf=Array.isArray(d.wf)?d.wf:state.wf;
  state.pumps=Array.isArray(d.pumps)?d.pumps:state.pumps;
  state.curves=d.curves||state.curves;

  if(d.eng){
   $("pipeSize").value=d.eng.pipeSize||"2.5";
   $("pipeLength").value=d.eng.pipeLength||"";
   $("elev").value=d.eng.elev||"";
   $("equipHead").value=d.eng.equipHead||"10";
   $("cHw").value=d.eng.cHw||"140";
   $("applyTo").value=d.eng.applyTo||"shared";
  }

  state.selPump=state.pumps?.[0]?.id||null;
  renderWF(); renderPumps(); recalc();
 }catch(e){alert("Invalid JSON");}};
 r.readAsText(f);
}

// Hooks
$("turnoverPreset").onchange=()=>{
 const c=$("turnoverCustom");
 c.disabled = $("turnoverPreset").value !== "custom";
 if(c.disabled) c.value="";
 recalc();
};
["clientName","location","poolVolume","turnoverCustom"].forEach(id=>$(id).oninput=recalc);

$("addWF").onclick=()=>{
 state.wf.push({type:"Sheer",qty:1,w:2,k:15});
 renderWF(); recalc();
};

$("addPump").onclick=()=>{
 const p={id:"P"+String(state.pumps.length+1).padStart(2,"0"),model:"jandy_vs_27",qty:1,sys:"Shared",tdh:50};
 state.pumps.push(p);
 if(!state.selPump) state.selPump=p.id;
 renderPumps(); recalc();
};

$("btnEditCurves").onclick=openModal;
$("btnCloseCurves").onclick=closeModal;
$("btnSaveCurves").onclick=()=>{closeModal(); recalc();};
$("btnResetCurves").onclick=()=>{state.curves=defaults(); renderTabs(); renderLines(); recalc();};
$("btnAddCurveLine").onclick=()=>{
 (state.curves[state.modalPump] ??= []).push({rpm:3000,label:"RPM",pts:[[0,50],[50,40],[100,25]]});
 renderLines();
};

$("btnEstimateTdh").onclick=estimateTdh;
$("btnExport").onclick=exportJson;
$("fileImport").onchange=importJson;
$("btnPrint").onclick=()=>window.print();

initChart();
$("addWF").click();
$("addPump").click();
