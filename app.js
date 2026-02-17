/* ============================================================
   Pool Pump Sizing Tool - app.js (FULL WORKING)
   - Pumps + Water Features + SPA calculations
   - PASS/CLOSE per pump + overall Pool/Spa mode badges
   - Curve editor (points: GPM,TDH per line)
   - Canvas curve drawing (no external libraries)
   - Optional TDH estimator (Hazen–Williams approx)
   ============================================================ */

(() => {
  "use strict";

  /* -----------------------------
     Helpers
  ----------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const num = (v, d = 0) => {
    const x = parseFloat(String(v ?? "").trim());
    return Number.isFinite(x) ? x : d;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
  const id8 = () => Math.random().toString(36).slice(2, 10);

  function parsePoints(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const pts = [];
    for (const line of lines) {
      const parts = line.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const gpm = num(parts[0], NaN);
      const tdh = num(parts[1], NaN);
      if (!Number.isFinite(gpm) || !Number.isFinite(tdh)) continue;
      pts.push({ gpm, tdh });
    }
    pts.sort((a, b) => a.gpm - b.gpm);
    return pts;
  }

  function pointsToText(points) {
    return (points || []).map((p) => `${p.gpm},${p.tdh}`).join("\n");
  }

  function gpmAtTDH(points, targetTDH) {
    if (!points || points.length < 2) return 0;

    const maxTDH = Math.max(...points.map((p) => p.tdh));
    const minTDH = Math.min(...points.map((p) => p.tdh));

    if (targetTDH > maxTDH) return 0;
    if (targetTDH < minTDH) return points[points.length - 1].gpm;

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      const t1 = a.tdh, t2 = b.tdh;
      const crosses =
        (targetTDH <= t1 && targetTDH >= t2) ||
        (targetTDH >= t1 && targetTDH <= t2);

      if (!crosses) continue;

      const denom = (t2 - t1);
      if (Math.abs(denom) < 1e-9) return a.gpm;
      const u = (targetTDH - t1) / denom;
      const g = a.gpm + u * (b.gpm - a.gpm);
      return clamp(g, Math.min(a.gpm, b.gpm), Math.max(a.gpm, b.gpm));
    }
    return 0;
  }

  /* -----------------------------
     Default Data
  ----------------------------- */
  const WATER_FEATURE_TYPES = [
    { id: "Sheer", label: "Sheer" },
    { id: "Deck Jet", label: "Deck Jet" },
    { id: "Rain Curtain", label: "Rain Curtain" },
    { id: "Scupper", label: "Scupper" },
    { id: "Bubbler", label: "Bubbler" },
  ];

  const DEFAULT_CURVES = {
    "Jandy VS FloPro 2.7 HP": {
      modelLabel: "Jandy VS FloPro 2.7 HP",
      rpmLines: [
        { rpm: 3450, label: "3450 RPM", points: [{gpm:0,tdh:95},{gpm:30,tdh:92},{gpm:60,tdh:86},{gpm:90,tdh:75},{gpm:120,tdh:55},{gpm:135,tdh:44}] },
        { rpm: 3000, label: "3000 RPM", points: [{gpm:0,tdh:75},{gpm:30,tdh:71},{gpm:60,tdh:63},{gpm:90,tdh:50},{gpm:120,tdh:33}] },
        { rpm: 2750, label: "2750 RPM", points: [{gpm:0,tdh:63},{gpm:30,tdh:59},{gpm:60,tdh:54},{gpm:90,tdh:40},{gpm:110,tdh:26}] },
      ],
    },
    "Jandy VS FloPro 1.85 HP": {
      modelLabel: "Jandy VS FloPro 1.85 HP",
      rpmLines: [
        { rpm: 3450, label: "3450 RPM", points: [{gpm:0,tdh:78},{gpm:30,tdh:74},{gpm:60,tdh:68},{gpm:90,tdh:58},{gpm:110,tdh:45},{gpm:120,tdh:32}] },
        { rpm: 3000, label: "3000 RPM", points: [{gpm:0,tdh:58},{gpm:30,tdh:55},{gpm:60,tdh:50},{gpm:90,tdh:38},{gpm:105,tdh:25}] },
      ],
    },
    "Jandy FloPro FHPM 1.0 HP": {
      modelLabel: "Jandy FloPro FHPM 1.0 HP",
      rpmLines: [
        { rpm: 3450, label: "3450 RPM", points: [{gpm:0,tdh:56},{gpm:25,tdh:52},{gpm:50,tdh:44},{gpm:70,tdh:33},{gpm:85,tdh:22}] },
        { rpm: 2400, label: "2400 RPM", points: [{gpm:0,tdh:28},{gpm:25,tdh:25},{gpm:50,tdh:18},{gpm:60,tdh:12}] },
      ],
    },
    "Jandy VS FloPro 3.8 HP": {
      modelLabel: "Jandy VS FloPro 3.8 HP",
      rpmLines: [
        { rpm: 3450, label: "3450 RPM", points: [{gpm:0,tdh:102},{gpm:40,tdh:98},{gpm:80,tdh:92},{gpm:120,tdh:78},{gpm:160,tdh:50},{gpm:185,tdh:38}] },
        { rpm: 3000, label: "3000 RPM", points: [{gpm:0,tdh:76},{gpm:40,tdh:74},{gpm:80,tdh:69},{gpm:120,tdh:56},{gpm:160,tdh:30}] },
      ],
    },
  };

  /* -----------------------------
     State
  ----------------------------- */
  const LS_KEY = "ppst_state_v1";
  const LS_CURVES = "ppst_curves_v1";

  let curves = structuredClone(DEFAULT_CURVES);

  const state = {
    project: { client: "", city: "", poolVol: 18000, turnoverH: 6, turnoverCustom: "" },
    waterFeatures: [{ id: id8(), type: "Sheer", qty: 3, width: 2, gpmPerFt: 15 }],
    spa: { enabled: false, setup: "shared", spaVol: 600, spaTurnH: 6, jetsQty: 8, gpmPerJet: 12, spaTDH: 50 },
    pumps: [
      { id: id8(), model: "Jandy VS FloPro 2.7 HP", qty: 1, system: "Shared", tdh: 50 },
      { id: id8(), model: "Jandy VS FloPro 2.7 HP", qty: 1, system: "Water", tdh: 50 },
    ],
    ui: { selectedPumpIndex: 0, curvesModalOpen: false, curvesActiveModel: "Jandy VS FloPro 2.7 HP" },
    engineering: { eqDist: "", fitAllow: 60, pipeIn: 2.5, elev: "", equipHead: 10, C: 140, estimatedTDH: NaN, estimatedFriction: 0, estimatedL: 0 },
  };

  /* -----------------------------
     DOM
  ----------------------------- */
  const el = {
    btnExport: $("#btnExport"),
    btnImport: $("#btnImport"),
    btnRecalc: $("#btnRecalc"),
    fileImport: $("#fileImport"),
    btnPrint: $("#btnPrint"),

    inClient: $("#inClient"),
    inCity: $("#inCity"),
    inPoolVol: $("#inPoolVol"),
    selTurnover: $("#selTurnover"),
    inTurnCustom: $("#inTurnoverCustom"),

    btnAddWF: $("#btnAddWF"),
    wfList: $("#wfList"),
    outPoolTurn: $("#outPoolTurn"),
    outWFFlow: $("#outWFFlow"),
    outPoolReq: $("#outPoolReq"),

    chkSpaMode: $("#chkSpaMode"),
    selSpaSetup: $("#selSpaSetup"),
    inSpaVol: $("#inSpaVol"),
    inSpaTurnH: $("#inSpaTurnH"),
    inSpaJetsQty: $("#inSpaJetsQty"),
    inGpmPerJet: $("#inGpmPerJet"),
    inSpaTDH: $("#inSpaTDH"),
    outSpaJets: $("#outSpaJets"),
    outSpaTurn: $("#outSpaTurn"),
    outSpaReq: $("#outSpaReq"),
    badgePoolMode: $("#badgePoolMode"),
    badgeSpaMode: $("#badgeSpaMode"),
    outPoolNeedLine: $("#outPoolNeedLine"),
    outSpaNeedLine: $("#outSpaNeedLine"),

    btnAddPump: $("#btnAddPump"),
    pumpsList: $("#pumpsList"),

    canvas: $("#curveCanvas"),
    btnEditCurves: $("#btnEditCurves"),

    inEqDist: $("#inEqDist"),
    inFitAllow: $("#inFitAllow"),
    selPipeIn: $("#selPipeIn"),
    inElev: $("#inElev"),
    inEquipHead: $("#inEquipHead"),
    inC: $("#inC"),
    selApplyTDH: $("#selApplyTDH"),
    btnEstimateTDH: $("#btnEstimateTDH"),
    tdhBadge: $("#tdhBadge"),

    curvesModal: $("#curvesModal"),
    btnCloseCurves: $("#btnCloseCurves"),
    curveTabs: $("#curveTabs"),
    curveEditorBody: $("#curveEditorBody"),
    btnAddRPM: $("#btnAddRPM"),
    btnResetCurves: $("#btnResetCurves"),
    btnSaveCurves: $("#btnSaveCurves"),
  };

  const ctx = el.canvas?.getContext?.("2d") || null;

  /* -----------------------------
     Load / Save
  ----------------------------- */
  function loadAll() {
    try {
      const s = localStorage.getItem(LS_KEY);
      if (s) {
        const parsed = JSON.parse(s);
        Object.assign(state.project, parsed.project || {});
        state.waterFeatures = Array.isArray(parsed.waterFeatures) ? parsed.waterFeatures : state.waterFeatures;
        Object.assign(state.spa, parsed.spa || {});
        state.pumps = Array.isArray(parsed.pumps) ? parsed.pumps : state.pumps;
        Object.assign(state.engineering, parsed.engineering || {});
        Object.assign(state.ui, parsed.ui || {});
      }
    } catch {}

    try {
      const c = localStorage.getItem(LS_CURVES);
      if (c) curves = JSON.parse(c);
    } catch {}
  }

  function saveAll() {
    localStorage.setItem(LS_KEY, JSON.stringify({
      project: state.project,
      waterFeatures: state.waterFeatures,
      spa: state.spa,
      pumps: state.pumps,
      engineering: state.engineering,
      ui: state.ui,
    }));
    localStorage.setItem(LS_CURVES, JSON.stringify(curves));
  }

  /* -----------------------------
     Calculations
  ----------------------------- */
  function getTurnoverHours() {
    const custom = num(state.project.turnoverCustom, NaN);
    if (Number.isFinite(custom) && custom > 0) return custom;
    return num(state.project.turnoverH, 6) || 6;
  }

  function calcPoolTurnoverFlowGPM() {
    const vol = num(state.project.poolVol, 0);
    const hours = getTurnoverHours();
    if (!vol || !hours) return 0;
    return (vol / hours) / 60;
  }

  function calcWaterFeaturesFlowGPM() {
    return state.waterFeatures.reduce((sum, wf) => {
      const row = (num(wf.qty, 0) * num(wf.width, 0) * num(wf.gpmPerFt, 0));
      return sum + row;
    }, 0);
  }

  function calcPoolRequiredFlowGPM() {
    return calcPoolTurnoverFlowGPM() + calcWaterFeaturesFlowGPM();
  }

  function calcSpaJetsFlowGPM() {
    return num(state.spa.jetsQty, 0) * num(state.spa.gpmPerJet, 0);
  }

  function calcSpaTurnoverFlowGPM() {
    const vol = num(state.spa.spaVol, 0);
    const hrs = num(state.spa.spaTurnH, 0);
    if (!vol || !hrs) return 0;
    return (vol / hrs) / 60;
  }

  function calcSpaRequiredFlowGPM() {
    return Math.max(calcSpaJetsFlowGPM(), calcSpaTurnoverFlowGPM());
  }

  function systemRequiredFlow(system) {
    if (system === "Pool") return calcPoolTurnoverFlowGPM();
    if (system === "Water") return calcWaterFeaturesFlowGPM();
    if (system === "Spa") return calcSpaRequiredFlowGPM();
    return calcPoolRequiredFlowGPM(); // Shared
  }

  function pickBestRPMLine(modelKey, targetTDH, reqFlow) {
    const model = curves[modelKey];
    if (!model || !Array.isArray(model.rpmLines) || model.rpmLines.length === 0) return null;

    const candidates = model.rpmLines
      .map((line) => ({ line, gpm: gpmAtTDH(line.points || [], targetTDH) }))
      .filter((x) => x.gpm > 0);

    if (candidates.length === 0) return null;

    const ok = candidates.filter((x) => x.gpm >= reqFlow);
    if (ok.length) {
      ok.sort((a, b) => (a.line.rpm || 0) - (b.line.rpm || 0));
      return ok[0];
    }

    candidates.sort((a, b) => b.gpm - a.gpm);
    return candidates[0];
  }

  /* -----------------------------
     TDH Estimator (approx)
  ----------------------------- */
  function estimateTDHForFlow(flowGPM) {
    const eqDist = num(state.engineering.eqDist, 0);
    const fitAllow = num(state.engineering.fitAllow, 0);
    const elev = num(state.engineering.elev, 0);
    const equipHead = num(state.engineering.equipHead, 0);
    const C = clamp(num(state.engineering.C, 140), 80, 160);
    const d = clamp(num(state.engineering.pipeIn, 2.5), 1.0, 6.0);

    const L = Math.max(0, (eqDist * 2) + fitAllow);
    const Q = Math.max(0, flowGPM);

    const friction = (Q <= 0 || L <= 0)
      ? 0
      : 4.52 * L * Math.pow(Q, 1.85) / (Math.pow(C, 1.85) * Math.pow(d, 4.87));

    const tdh = friction + elev + equipHead;

    state.engineering.estimatedL = L;
    state.engineering.estimatedFriction = friction;
    state.engineering.estimatedTDH = tdh;

    return tdh;
  }

  function applyEstimatedTDHToPumps(tdh) {
    const mode = el.selApplyTDH?.value || "all";

    state.pumps.forEach((p) => {
      const sys = p.system;
      const match =
        mode === "all" ||
        (mode === "shared" && sys === "Shared") ||
        (mode === "pool" && sys === "Pool") ||
        (mode === "water" && sys === "Water") ||
        (mode === "spa" && sys === "Spa");
      if (match) p.tdh = round1(tdh);
    });
  }

  /* -----------------------------
     Rendering
  ----------------------------- */
  function renderProject() {
    el.inClient.value = state.project.client || "";
    el.inCity.value = state.project.city || "";
    el.inPoolVol.value = state.project.poolVol ?? "";
    el.selTurnover.value = String(state.project.turnoverH ?? 6);
    el.inTurnCustom.value = state.project.turnoverCustom ?? "";
  }

  function renderWaterFeatures() {
    el.wfList.innerHTML = "";
    state.waterFeatures.forEach((wf) => {
      const rowGpm = round1(num(wf.qty, 0) * num(wf.width, 0) * num(wf.gpmPerFt, 0));
      const row = document.createElement("div");
      row.className = "wfRow";
      row.innerHTML = `
        <div>
          <select data-k="type">
            ${WATER_FEATURE_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join("")}
          </select>
        </div>
        <div><input data-k="qty" type="number" min="0" step="1" /></div>
        <div><input data-k="width" type="number" min="0" step="0.1" /></div>
        <div><input data-k="gpmPerFt" type="number" min="0" step="0.5" /></div>
        <div style="text-align:right;font-weight:800">${rowGpm}</div>
        <div style="display:flex;justify-content:flex-end"><button class="xbtn" data-act="rm">✕</button></div>
      `;
      const selType = row.querySelector('select[data-k="type"]');
      const inQty = row.querySelector('input[data-k="qty"]');
      const inW = row.querySelector('input[data-k="width"]');
      const inG = row.querySelector('input[data-k="gpmPerFt"]');
      const btnRm = row.querySelector('button[data-act="rm"]');

      selType.value = wf.type;
      inQty.value = wf.qty;
      inW.value = wf.width;
      inG.value = wf.gpmPerFt;

      selType.addEventListener("change", () => { wf.type = selType.value; persistAndRecalc(); });
      inQty.addEventListener("input", () => { wf.qty = num(inQty.value, 0); persistAndRecalc(); });
      inW.addEventListener("input", () => { wf.width = num(inW.value, 0); persistAndRecalc(); });
      inG.addEventListener("input", () => { wf.gpmPerFt = num(inG.value, 0); persistAndRecalc(); });

      btnRm.addEventListener("click", () => {
        state.waterFeatures = state.waterFeatures.filter(x => x.id !== wf.id);
        persistAndRecalc();
      });

      el.wfList.appendChild(row);
    });
  }

  function renderSpa() {
    el.chkSpaMode.checked = !!state.spa.enabled;
    el.selSpaSetup.value = state.spa.setup || "shared";
    el.inSpaVol.value = state.spa.spaVol ?? "";
    el.inSpaTurnH.value = state.spa.spaTurnH ?? "";
    el.inSpaJetsQty.value = state.spa.jetsQty ?? 0;
    el.inGpmPerJet.value = state.spa.gpmPerJet ?? 0;
    el.inSpaTDH.value = state.spa.spaTDH ?? 50;
  }

  function setBadge(elm, text, kind) {
    if (!elm) return;
    elm.textContent = text;
    elm.classList.remove("pass", "close", "fail", "badge");
    elm.classList.add("badge");
    if (kind) elm.classList.add(kind);
  }

  function pumpPass(pump, tdh, req) {
    const best = pickBestRPMLine(pump.model, tdh, req);
    return !!best && best.gpm >= req && best.gpm > 0;
  }

  function anyPumpPassForPoolMode() {
    const poolReq = calcPoolRequiredFlowGPM();
    const poolTurn = calcPoolTurnoverFlowGPM();
    const wf = calcWaterFeaturesFlowGPM();
    let ok = false;

    state.pumps.forEach((p) => {
      const tdh = num(p.tdh, 0);
      if (p.system === "Shared") ok = ok || pumpPass(p, tdh, poolReq);
      else if (p.system === "Pool") ok = ok || pumpPass(p, tdh, poolTurn);
      else if (p.system === "Water") ok = ok || pumpPass(p, tdh, wf);
    });
    return ok;
  }

  function anyPumpPassForSpaMode() {
    if (!state.spa.enabled) return false;
    const spaReq = calcSpaRequiredFlowGPM();
    const spaTDH = num(state.spa.spaTDH, 50);

    if (state.spa.setup === "shared") {
      return state.pumps.some((p) => p.system === "Shared" && pumpPass(p, spaTDH, spaReq));
    }
    return state.pumps.some((p) => p.system === "Spa" && pumpPass(p, spaTDH, spaReq));
  }

  function renderSummary() {
    const poolTurn = round1(calcPoolTurnoverFlowGPM());
    const wfFlow = round1(calcWaterFeaturesFlowGPM());
    const poolReq = round1(calcPoolRequiredFlowGPM());

    el.outPoolTurn.textContent = `${poolTurn} GPM`;
    el.outWFFlow.textContent = `${wfFlow} GPM`;
    el.outPoolReq.textContent = `${poolReq} GPM`;

    const spaJets = round1(calcSpaJetsFlowGPM());
    const spaTurn = round1(calcSpaTurnoverFlowGPM());
    const spaReq = round1(calcSpaRequiredFlowGPM());

    el.outSpaJets.textContent = `${spaJets} GPM`;
    el.outSpaTurn.textContent = `${spaTurn} GPM`;
    el.outSpaReq.textContent = `${spaReq} GPM`;

    el.outPoolNeedLine.textContent = `Required: ${poolReq} GPM`;
    el.outSpaNeedLine.textContent = state.spa.enabled
      ? `Required: ${spaReq} GPM @ ${round1(num(state.spa.spaTDH, 50))} ft`
      : `Required: —`;

    const poolModePass = anyPumpPassForPoolMode();
    setBadge(el.badgePoolMode, poolModePass ? "PASS" : "CLOSE", poolModePass ? "pass" : "close");

    const spaModePass = anyPumpPassForSpaMode();
    if (!state.spa.enabled) setBadge(el.badgeSpaMode, "—", "close");
    else setBadge(el.badgeSpaMode, spaModePass ? "PASS" : "CLOSE", spaModePass ? "pass" : "close");

    if (el.tdhBadge) {
      const tdh = state.engineering.estimatedTDH;
      if (Number.isFinite(tdh)) {
        el.tdhBadge.textContent =
          `TDH: ${round1(tdh)} ft (friction ${round1(state.engineering.estimatedFriction || 0)} ft, L=${round1(state.engineering.estimatedL || 0)} ft)`;
      } else {
        el.tdhBadge.textContent = `TDH: —`;
      }
    }
  }

  function renderPumps() {
    el.pumpsList.innerHTML = "";
    const modelKeys = Object.keys(curves);

    state.pumps.forEach((p, idx) => {
      const reqFlow = systemRequiredFlow(p.system);
      const best = pickBestRPMLine(p.model, num(p.tdh, 0), reqFlow);
      const canMeet = !!best && best.gpm >= reqFlow && best.gpm > 0;

      const row = document.createElement("div");
      row.className = "pumpRow";
      row.innerHTML = `
        <div>
          <select data-k="model">
            ${modelKeys.map(k => `<option value="${k}">${curves[k].modelLabel || k}</option>`).join("")}
          </select>
        </div>
        <div><input data-k="qty" type="number" min="1" step="1" /></div>
        <div>
          <select data-k="system">
            <option value="Pool">Pool</option>
            <option value="Water">Water Features</option>
            <option value="Spa">Spa</option>
            <option value="Shared">Shared</option>
          </select>
        </div>
        <div><input data-k="tdh" type="number" min="0" step="0.5" /></div>
        <div style="display:flex;gap:8px;align-items:center;justify-content:flex-end">
          <span class="badge ${canMeet ? "pass" : "close"}">${canMeet ? "PASS" : "CLOSE"}</span>
        </div>
        <div style="display:flex;justify-content:flex-end"><button class="xbtn" data-act="rm">✕</button></div>
      `;

      const selModel = row.querySelector('select[data-k="model"]');
      const inQty = row.querySelector('input[data-k="qty"]');
      const selSys = row.querySelector('select[data-k="system"]');
      const inTDH = row.querySelector('input[data-k="tdh"]');
      const btnRm = row.querySelector('button[data-act="rm"]');

      selModel.value = p.model;
      inQty.value = p.qty;
      selSys.value = p.system;
      inTDH.value = p.tdh;

      selModel.addEventListener("change", () => { p.model = selModel.value; state.ui.selectedPumpIndex = idx; persistAndRecalc(); });
      inQty.addEventListener("input", () => { p.qty = Math.max(1, Math.round(num(inQty.value, 1))); persistAndRecalc(); });
      selSys.addEventListener("change", () => { p.system = selSys.value; persistAndRecalc(); });
      inTDH.addEventListener("input", () => { p.tdh = num(inTDH.value, 0); persistAndRecalc(); });

      row.addEventListener("click", (e) => {
        if (e.target && (e.target.tagName === "SELECT" || e.target.tagName === "INPUT" || e.target.tagName === "BUTTON")) return;
        state.ui.selectedPumpIndex = idx;
        renderCurveViewer();
      });

      btnRm.addEventListener("click", () => {
        state.pumps = state.pumps.filter(x => x.id !== p.id);
        state.ui.selectedPumpIndex = clamp(state.ui.selectedPumpIndex, 0, Math.max(0, state.pumps.length - 1));
        persistAndRecalc();
      });

      const bestRpm = best?.line?.rpm ? `${best.line.rpm}` : "—";
      const bestGpm = best?.gpm ? round1(best.gpm) : 0;
      const tdh = round1(num(p.tdh, 0));
      const extra = document.createElement("div");
      extra.style.cssText = "margin:-2px 0 6px 0;color:rgba(255,255,255,.75);font-size:12px;padding-left:4px";
      extra.textContent = best ? `${bestRpm} RPM | ${tdh} ft @ ${bestGpm} GPM` : "—";

      el.pumpsList.appendChild(row);
      el.pumpsList.appendChild(extra);
    });
  }

  /* -----------------------------
     Curve Viewer (Canvas)
  ----------------------------- */
  function clearCanvas() {
    if (!ctx || !el.canvas) return;
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
  }

  function drawAxes(bounds) {
    const { left, top, w, h } = bounds;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, w, h);

    const xGrid = 6, yGrid = 6;
    for (let i = 1; i < xGrid; i++) {
      const x = left + (w * i) / xGrid;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + h); ctx.stroke();
    }
    for (let i = 1; i < yGrid; i++) {
      const y = top + (h * i) / yGrid;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + w, y); ctx.stroke();
    }
    ctx.restore();
  }

  function renderCurveViewer() {
    if (!ctx || !el.canvas) return;
    clearCanvas();

    const pump = state.pumps[state.ui.selectedPumpIndex] || state.pumps[0];
    if (!pump) return;

    const model = curves[pump.model];
    if (!model || !model.rpmLines?.length) return;

    const allPts = model.rpmLines.flatMap(l => l.points || []);
    const maxG = Math.max(10, ...allPts.map(p => p.gpm));
    const maxT = Math.max(10, ...allPts.map(p => p.tdh));

    const padL = 46, padR = 16, padT = 18, padB = 34;
    const bounds = { left: padL, top: padT, w: el.canvas.width - padL - padR, h: el.canvas.height - padT - padB };

    const xToPx = (gpm) => bounds.left + (clamp(gpm, 0, maxG) / maxG) * bounds.w;
    const yToPx = (tdh) => bounds.top + bounds.h - (clamp(tdh, 0, maxT) / maxT) * bounds.h;

    drawAxes(bounds);

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 14px system-ui";
    ctx.fillText(model.modelLabel || pump.model, 16, 16);
    ctx.restore();

    const palette = [
      "rgba(86, 204, 242, 0.95)",
      "rgba(242, 86, 144, 0.95)",
      "rgba(255, 176, 59, 0.95)",
      "rgba(144, 238, 144, 0.95)",
      "rgba(180, 140, 255, 0.95)",
    ];

    model.rpmLines.forEach((line, i) => {
      const pts = line.points || [];
      if (pts.length < 2) return;

      ctx.save();
      ctx.strokeStyle = palette[i % palette.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xToPx(pts[0].gpm), yToPx(pts[0].tdh));
      for (let k = 1; k < pts.length; k++) ctx.lineTo(xToPx(pts[k].gpm), yToPx(pts[k].tdh));
      ctx.stroke();

      const mid = pts[Math.floor(pts.length / 2)];
      ctx.fillStyle = palette[i % palette.length];
      ctx.font = "12px system-ui";
      ctx.fillText(line.label || `${line.rpm} RPM`, xToPx(mid.gpm) + 6, yToPx(mid.tdh) - 6);
      ctx.restore();
    });

    const targetTDH = num(pump.tdh, 0);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(255, 220, 120, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bounds.left, yToPx(targetTDH));
    ctx.lineTo(bounds.left + bounds.w, yToPx(targetTDH));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 220, 120, 0.95)";
    ctx.font = "12px system-ui";
    ctx.fillText(`Target TDH: ${round1(targetTDH)} ft`, bounds.left + 8, yToPx(targetTDH) - 8);
    ctx.restore();

    const req = systemRequiredFlow(pump.system);
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(xToPx(req), bounds.top);
    ctx.lineTo(xToPx(req), bounds.top + bounds.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "12px system-ui";
    ctx.fillText(`Required: ${round1(req)} GPM`, xToPx(req) + 6, bounds.top + 18);
    ctx.restore();

    const best = pickBestRPMLine(pump.model, targetTDH, req);
    if (best && best.line && best.line.points?.length >= 2) {
      const opGpm = gpmAtTDH(best.line.points, targetTDH);
      ctx.save();
      ctx.fillStyle = "rgba(255, 176, 59, 0.95)";
      ctx.beginPath();
      ctx.arc(xToPx(opGpm), yToPx(targetTDH), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "12px system-ui";
      ctx.fillText(`Operating: ${round1(opGpm)} @ ${round1(targetTDH)} ft (${best.line.label || best.line.rpm})`,
        xToPx(opGpm) + 8, yToPx(targetTDH) - 10);
      ctx.restore();
    }
  }

  /* -----------------------------
     Curves Modal
  ----------------------------- */
  function openCurvesModal() {
    el.curvesModal.classList.remove("hidden");
    state.ui.curvesModalOpen = true;
    const pump = state.pumps[state.ui.selectedPumpIndex] || state.pumps[0];
    if (pump && curves[pump.model]) state.ui.curvesActiveModel = pump.model;
    renderCurvesModal();
  }

  function closeCurvesModal() {
    el.curvesModal.classList.add("hidden");
    state.ui.curvesModalOpen = false;
  }

  function renderCurvesModal() {
    const modelKeys = Object.keys(curves);
    if (!modelKeys.length) return;
    if (!curves[state.ui.curvesActiveModel]) state.ui.curvesActiveModel = modelKeys[0];

    el.curveTabs.innerHTML = "";
    modelKeys.forEach((k) => {
      const b = document.createElement("button");
      b.className = "tab" + (k === state.ui.curvesActiveModel ? " active" : "");
      b.textContent = curves[k].modelLabel || k;
      b.addEventListener("click", () => { state.ui.curvesActiveModel = k; renderCurvesModal(); });
      el.curveTabs.appendChild(b);
    });

    const model = curves[state.ui.curvesActiveModel];
    el.curveEditorBody.innerHTML = "";

    (model.rpmLines || []).forEach((line, idx) => {
      const card = document.createElement("div");
      card.className = "rpmCard";
      card.innerHTML = `
        <div class="rpmHeader">
          <div class="grow">
            <label>RPM</label>
            <input data-k="rpm" type="number" min="0" step="1" value="${line.rpm ?? ""}">
          </div>
          <div class="grow">
            <label>Label</label>
            <input data-k="label" type="text" value="${line.label ?? ""}">
          </div>
          <div style="display:flex;justify-content:flex-end;align-items:end">
            <button class="xbtn" data-act="rm">✕</button>
          </div>
        </div>
        <div style="margin-top:10px">
          <label>Points</label>
          <textarea data-k="pts" spellcheck="false">${pointsToText(line.points || [])}</textarea>
          <div class="hint">Example lines: <b>0,95</b> or <b>30,92</b></div>
        </div>
      `;

      const inRpm = card.querySelector('input[data-k="rpm"]');
      const inLabel = card.querySelector('input[data-k="label"]');
      const taPts = card.querySelector('textarea[data-k="pts"]');
      const btnRm = card.querySelector('button[data-act="rm"]');

      inRpm.addEventListener("input", () => { line.rpm = Math.round(num(inRpm.value, 0)); });
      inLabel.addEventListener("input", () => { line.label = inLabel.value; });
      taPts.addEventListener("input", () => { line.points = parsePoints(taPts.value); });

      btnRm.addEventListener("click", () => {
        model.rpmLines = model.rpmLines.filter((_, i) => i !== idx);
        renderCurvesModal();
      });

      el.curveEditorBody.appendChild(card);
    });
  }

  function addRPMLine() {
    const model = curves[state.ui.curvesActiveModel];
    if (!model) return;
    model.rpmLines = model.rpmLines || [];
    model.rpmLines.push({
      rpm: 2400,
      label: "2400 RPM",
      points: [{ gpm: 0, tdh: 40 }, { gpm: 50, tdh: 25 }, { gpm: 90, tdh: 10 }],
    });
    renderCurvesModal();
  }

  function resetCurves() {
    curves = structuredClone(DEFAULT_CURVES);
    state.ui.curvesActiveModel = Object.keys(curves)[0];
    renderCurvesModal();
    persistAndRecalc();
  }

  function saveCurvesAndClose() {
    for (const k of Object.keys(curves)) {
      curves[k].rpmLines = (curves[k].rpmLines || []).map((l) => ({
        rpm: Math.round(num(l.rpm, 0)),
        label: String(l.label ?? `${l.rpm} RPM`),
        points: Array.isArray(l.points) ? l.points : [],
      }));
    }
    persistAndRecalc();
    closeCurvesModal();
  }

  /* -----------------------------
     Bind + RenderAll
  ----------------------------- */
  function persistAndRecalc() {
    saveAll();
    renderAll();
  }

  function bind() {
    // Project
    el.inClient.addEventListener("input", () => { state.project.client = el.inClient.value; persistAndRecalc(); });
    el.inCity.addEventListener("input", () => { state.project.city = el.inCity.value; persistAndRecalc(); });
    el.inPoolVol.addEventListener("input", () => { state.project.poolVol = num(el.inPoolVol.value, 0); persistAndRecalc(); });
    el.selTurnover.addEventListener("change", () => { state.project.turnoverH = num(el.selTurnover.value, 6); persistAndRecalc(); });
    el.inTurnCustom.addEventListener("input", () => { state.project.turnoverCustom = el.inTurnCustom.value; persistAndRecalc(); });

    // Water features
    el.btnAddWF.addEventListener("click", () => {
      state.waterFeatures.push({ id: id8(), type: "Sheer", qty: 1, width: 2, gpmPerFt: 15 });
      persistAndRecalc();
    });

    // SPA
    el.chkSpaMode.addEventListener("change", () => { state.spa.enabled = !!el.chkSpaMode.checked; persistAndRecalc(); });
    el.selSpaSetup.addEventListener("change", () => { state.spa.setup = el.selSpaSetup.value; persistAndRecalc(); });
    el.inSpaVol.addEventListener("input", () => { state.spa.spaVol = num(el.inSpaVol.value, 0); persistAndRecalc(); });
    el.inSpaTurnH.addEventListener("input", () => { state.spa.spaTurnH = num(el.inSpaTurnH.value, 0); persistAndRecalc(); });
    el.inSpaJetsQty.addEventListener("input", () => { state.spa.jetsQty = num(el.inSpaJetsQty.value, 0); persistAndRecalc(); });
    el.inGpmPerJet.addEventListener("input", () => { state.spa.gpmPerJet = num(el.inGpmPerJet.value, 0); persistAndRecalc(); });
    el.inSpaTDH.addEventListener("input", () => { state.spa.spaTDH = num(el.inSpaTDH.value, 50); persistAndRecalc(); });

    // Pumps
    el.btnAddPump.addEventListener("click", () => {
      const firstModel = Object.keys(curves)[0] || "Jandy VS FloPro 2.7 HP";
      state.pumps.push({ id: id8(), model: firstModel, qty: 1, system: "Shared", tdh: 50 });
      state.ui.selectedPumpIndex = state.pumps.length - 1;
      persistAndRecalc();
    });

    // Curves
    el.btnEditCurves.addEventListener("click", openCurvesModal);
    el.btnCloseCurves.addEventListener("click", closeCurvesModal);
    el.btnAddRPM.addEventListener("click", addRPMLine);
    el.btnResetCurves.addEventListener("click", resetCurves);
    el.btnSaveCurves.addEventListener("click", saveCurvesAndClose);

    // Engineering
    el.inEqDist.addEventListener("input", () => { state.engineering.eqDist = el.inEqDist.value; saveAll(); });
    el.inFitAllow.addEventListener("input", () => { state.engineering.fitAllow = num(el.inFitAllow.value, 0); saveAll(); });
    el.selPipeIn.addEventListener("change", () => { state.engineering.pipeIn = num(el.selPipeIn.value, 2.5); saveAll(); });
    el.inElev.addEventListener("input", () => { state.engineering.elev = el.inElev.value; saveAll(); });
    el.inEquipHead.addEventListener("input", () => { state.engineering.equipHead = num(el.inEquipHead.value, 0); saveAll(); });
    el.inC.addEventListener("input", () => { state.engineering.C = num(el.inC.value, 140); saveAll(); });

    el.btnEstimateTDH.addEventListener("click", () => {
      const flow = calcPoolRequiredFlowGPM();
      const tdh = estimateTDHForFlow(flow);
      applyEstimatedTDHToPumps(tdh);
      persistAndRecalc();
    });

    // Export / Import / Print
    el.btnExport.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ state, curves }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pool-pump-sizing.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    el.btnImport.addEventListener("click", () => el.fileImport.click());
    el.fileImport.addEventListener("change", async () => {
      const f = el.fileImport.files?.[0];
      if (!f) return;
      const txt = await f.text();
      try {
        const parsed = JSON.parse(txt);
        if (parsed.state) {
          Object.assign(state.project, parsed.state.project || {});
          state.waterFeatures = Array.isArray(parsed.state.waterFeatures) ? parsed.state.waterFeatures : state.waterFeatures;
          Object.assign(state.spa, parsed.state.spa || {});
          state.pumps = Array.isArray(parsed.state.pumps) ? parsed.state.pumps : state.pumps;
          Object.assign(state.engineering, parsed.state.engineering || {});
          Object.assign(state.ui, parsed.state.ui || {});
        }
        if (parsed.curves) curves = parsed.curves;
        persistAndRecalc();
      } catch (e) {
        alert("Invalid JSON file");
      } finally {
        el.fileImport.value = "";
      }
    });

    // ✅ NEW: Refresh button
    if (el.btnRecalc) el.btnRecalc.addEventListener("click", () => persistAndRecalc());

    el.btnPrint.addEventListener("click", () => window.print());
  }

  function renderEngineeringInputs() {
    el.inEqDist.value = state.engineering.eqDist ?? "";
    el.inFitAllow.value = state.engineering.fitAllow ?? 60;
    el.selPipeIn.value = String(state.engineering.pipeIn ?? 2.5);
    el.inElev.value = state.engineering.elev ?? "";
    el.inEquipHead.value = state.engineering.equipHead ?? 10;
    el.inC.value = state.engineering.C ?? 140;
  }

  function renderAll() {
    renderProject();
    renderWaterFeatures();
    renderSpa();
    renderPumps();
    renderEngineeringInputs();
    renderSummary();
    renderCurveViewer();
    if (state.ui.curvesModalOpen) renderCurvesModal();
  }

  /* -----------------------------
     Init
  ----------------------------- */
  loadAll();
  bind();
  renderAll();

})();
