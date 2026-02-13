/* ============================================================
   Pool Pump Sizing Tool - app.js (FULL WORKING)
   - Pumps + Water Features + SPA calculations
   - PASS/CLOSE status per pump
   - Curve editor (points: GPM,TDH per line)
   - Canvas curve drawing (no external libs)
   - Robust: if expected HTML not found, it builds a full UI.
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

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const round1 = (v) => Math.round(v * 10) / 10;

  function safeId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function parsePoints(text) {
    // Supports:
    // 0,95
    // 0 , 95
    // 0 95
    // 0;95
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

  // Linear interpolation helper: y at x (points sorted by x asc)
  function yAtX(points, x, xKey = "gpm", yKey = "tdh") {
    if (!points || points.length < 2) return NaN;
    const xs = points.map((p) => p[xKey]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    if (x <= minX) return points[0][yKey];
    if (x >= maxX) return points[points.length - 1][yKey];

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const x1 = a[xKey], x2 = b[xKey];
      if (x >= Math.min(x1, x2) && x <= Math.max(x1, x2)) {
        const denom = (x2 - x1);
        if (Math.abs(denom) < 1e-9) return a[yKey];
        const u = (x - x1) / denom;
        return a[yKey] + u * (b[yKey] - a[yKey]);
      }
    }
    return NaN;
  }

  // Find GPM at a target TDH by interpolating between curve points
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

  // Curves: model -> rpmLines -> points
  // NOTE: these are starter defaults; you can edit them via "Edit Curves".
  const DEFAULT_CURVES = {
    "Jandy VS FloPro 2.7 HP": {
      modelLabel: "Jandy VS FloPro 2.7 HP",
      rpmLines: [
        {
          rpm: 3450,
          label: "3450 RPM",
          points: [
            { gpm: 0, tdh: 95 },
            { gpm: 30, tdh: 92 },
            { gpm: 60, tdh: 86 },
            { gpm: 90, tdh: 75 },
            { gpm: 120, tdh: 55 },
            { gpm: 135, tdh: 44 },
          ],
        },
        {
          rpm: 3000,
          label: "3000 RPM",
          points: [
            { gpm: 0, tdh: 75 },
            { gpm: 30, tdh: 71 },
            { gpm: 60, tdh: 63 },
            { gpm: 90, tdh: 50 },
            { gpm: 120, tdh: 33 },
          ],
        },
      ],
    },

    "Jandy VS FloPro 1.85 HP": {
      modelLabel: "Jandy VS FloPro 1.85 HP",
      rpmLines: [
        {
          rpm: 3450,
          label: "3450 RPM",
          points: [
            { gpm: 0, tdh: 78 },
            { gpm: 30, tdh: 75 },
            { gpm: 60, tdh: 69 },
            { gpm: 90, tdh: 57 },
            { gpm: 120, tdh: 33 },
          ],
        },
        {
          rpm: 3000,
          label: "3000 RPM",
          points: [
            { gpm: 0, tdh: 59 },
            { gpm: 30, tdh: 56 },
            { gpm: 60, tdh: 51 },
            { gpm: 90, tdh: 38 },
            { gpm: 105, tdh: 26 },
          ],
        },
      ],
    },

    "Jandy FloPro FHPM 1.0 HP": {
      modelLabel: "Jandy FloPro FHPM 1.0 HP",
      rpmLines: [
        {
          rpm: 3450,
          label: "High (approx)",
          points: [
            { gpm: 0, tdh: 57 },
            { gpm: 30, tdh: 50 },
            { gpm: 60, tdh: 36 },
            { gpm: 80, tdh: 15 },
          ],
        },
        {
          rpm: 1725,
          label: "Low (approx)",
          points: [
            { gpm: 0, tdh: 20 },
            { gpm: 20, tdh: 17 },
            { gpm: 40, tdh: 10 },
            { gpm: 55, tdh: 4 },
          ],
        },
      ],
    },

    "Jandy VS FloPro 3.8 HP": {
      modelLabel: "Jandy VS FloPro 3.8 HP",
      rpmLines: [
        {
          rpm: 3450,
          label: "3450 RPM",
          points: [
            { gpm: 0, tdh: 102 },
            { gpm: 30, tdh: 99 },
            { gpm: 60, tdh: 95 },
            { gpm: 90, tdh: 88 },
            { gpm: 120, tdh: 75 },
            { gpm: 150, tdh: 55 },
            { gpm: 185, tdh: 33 },
          ],
        },
        {
          rpm: 3000,
          label: "3000 RPM",
          points: [
            { gpm: 0, tdh: 77 },
            { gpm: 30, tdh: 74 },
            { gpm: 60, tdh: 71 },
            { gpm: 90, tdh: 63 },
            { gpm: 120, tdh: 50 },
            { gpm: 150, tdh: 32 },
          ],
        },
      ],
    },
  };

  /* -----------------------------
     Storage
  ----------------------------- */
  const LS_KEY = "regal_pool_pump_tool_v1";
  const LS_CURVES_KEY = "regal_pool_pump_curves_v1";

  function loadCurves() {
    try {
      const raw = localStorage.getItem(LS_CURVES_KEY);
      if (!raw) return structuredClone(DEFAULT_CURVES);
      const parsed = JSON.parse(raw);
      // basic shape validation
      if (!parsed || typeof parsed !== "object") return structuredClone(DEFAULT_CURVES);
      return parsed;
    } catch {
      return structuredClone(DEFAULT_CURVES);
    }
  }

  function saveCurves(curves) {
    try {
      localStorage.setItem(LS_CURVES_KEY, JSON.stringify(curves));
    } catch {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {}
  }

  /* -----------------------------
     App State
  ----------------------------- */
  const state = {
    project: {
      client: "",
      city: "",
      poolVolume: 10000,
      turnoverHours: 6,
      turnoverCustom: "",
    },
    waterFeatures: [
      { id: safeId(), type: "Sheer", qty: 3, width: 2, gpmPerFt: 15 },
    ],
    spa: {
      enabled: false,
      setup: "shared_valve",
      volume: 600,
      turnoverHours: 6,
      jetsQty: 8,
      gpmPerJet: 12,
      modeTDH: 50,
    },
    engineering: {
      equipDistance: 60, // one way
      extraFittings: 60, // equivalent length add
      pipeSize: 2.5,
      elevation: 0,
      equipmentHead: 10,
      hazenC: 140,
      applyTDHTo: "shared",
      estimatedTDH: null,
      estimatedFriction: null,
      estimatedL: null,
    },
    pumps: [
      { id: safeId(), model: "Jandy VS FloPro 2.7 HP", qty: 1, system: "Shared", tdh: 50 },
    ],
    ui: {
      selectedPumpIndex: 0,
      curvesModalOpen: false,
      curvesActiveModel: "Jandy VS FloPro 2.7 HP",
    },
  };

  let curves = loadCurves();

  // Merge saved state (if exists)
  const saved = loadState();
  if (saved && typeof saved === "object") {
    try {
      Object.assign(state, saved);
      // keep fallback defaults for missing nested structures
      state.project = { ...state.project, ...(saved.project || {}) };
      state.spa = { ...state.spa, ...(saved.spa || {}) };
      state.engineering = { ...state.engineering, ...(saved.engineering || {}) };
      state.waterFeatures = Array.isArray(saved.waterFeatures) ? saved.waterFeatures : state.waterFeatures;
      state.pumps = Array.isArray(saved.pumps) ? saved.pumps : state.pumps;
      state.ui = { ...state.ui, ...(saved.ui || {}) };
    } catch {}
  }

  /* -----------------------------
     Build UI (if not present)
  ----------------------------- */

  function ensureUI() {
    // If their index.html already has elements, we keep it.
    // Otherwise we create a full UI.
    const alreadyHas = $("#ppst_root") || $("#curveCanvas") || $(".ppst");
    if (alreadyHas) return;

    const wrap = document.createElement("div");
    wrap.id = "ppst_root";
    wrap.className = "ppst";
    wrap.innerHTML = `
      <div class="ppst-topbar">
        <div class="ppst-title">Pool Pump Sizing Tool</div>
        <div class="ppst-actions">
          <button id="btnExport">Export JSON</button>
          <button id="btnImport">Import JSON</button>
          <button id="btnPrint">Print</button>
        </div>
      </div>

      <div class="ppst-grid">
        <div class="ppst-card">
          <h2>Project</h2>
          <div class="ppst-row">
            <label>Client / Project Name</label>
            <input id="projectClient" placeholder="e.g., Johnson Residence">
          </div>
          <div class="ppst-row">
            <label>City / State</label>
            <input id="projectCity" placeholder="e.g., Houston, TX">
          </div>
          <div class="ppst-row">
            <label>Pool Volume (gallons)</label>
            <input id="poolVolume" type="number" min="0" step="1">
          </div>
          <div class="ppst-row">
            <label>Pool Turnover (hours)</label>
            <div class="ppst-inline">
              <select id="turnoverHours">
                <option value="6">6</option>
                <option value="8">8</option>
                <option value="10">10</option>
                <option value="12">12</option>
              </select>
              <input id="turnoverCustom" placeholder="Custom" type="number" min="1" step="0.5">
            </div>
          </div>

          <h2 style="margin-top:16px;">Water Features</h2>
          <div id="wfList"></div>
          <button id="btnAddWF" class="ppst-add">+ Add</button>

          <div class="ppst-summary">
            <div><span>Pool Turnover Flow</span><b id="poolTurnoverFlow">—</b></div>
            <div><span>Water Features Flow</span><b id="wfFlow">—</b></div>
            <div><span>Pool Mode Required Flow</span><b id="poolRequiredFlow">—</b></div>
          </div>

          <h2 style="margin-top:16px;">SPA</h2>
          <div class="ppst-row ppst-inline">
            <label style="flex:1;">Spa Mode</label>
            <input id="spaEnabled" type="checkbox">
          </div>

          <div class="ppst-row">
            <label>Spa Pump Setup</label>
            <select id="spaSetup">
              <option value="shared_valve">Shared with Pool Pump (Valve Mode)</option>
              <option value="separate_pump">Separate Spa Pump</option>
            </select>
          </div>

          <div class="ppst-row">
            <label>Spa Volume (gallons) (optional)</label>
            <input id="spaVolume" type="number" min="0" step="1">
          </div>

          <div class="ppst-row">
            <label>Spa Turnover (hours) (optional)</label>
            <input id="spaTurnoverHours" type="number" min="1" step="0.5">
          </div>

          <div class="ppst-row">
            <label>Spa Jets (Qty)</label>
            <input id="spaJetsQty" type="number" min="0" step="1">
          </div>

          <div class="ppst-row">
            <label>GPM per Jet</label>
            <input id="spaGpmPerJet" type="number" min="0" step="0.5">
          </div>

          <div class="ppst-row">
            <label>Spa Mode TDH (ft)</label>
            <input id="spaModeTDH" type="number" min="0" step="0.5">
          </div>

          <div class="ppst-summary">
            <div><span>Spa Jets Flow</span><b id="spaJetsFlow">—</b></div>
            <div><span>Spa Turnover Flow</span><b id="spaTurnoverFlow">—</b></div>
            <div><span>Spa Mode Required Flow</span><b id="spaRequiredFlow">—</b></div>
          </div>
        </div>

        <div class="ppst-card">
          <div class="ppst-header-row">
            <h2>Pumps</h2>
            <button id="btnAddPump" class="ppst-add">+ Add Pump</button>
          </div>

          <div id="pumpsList"></div>

          <div class="ppst-header-row" style="margin-top:14px;">
            <h2>Curve Viewer</h2>
            <button id="btnEditCurves">Edit Curves</button>
          </div>

          <canvas id="curveCanvas" width="900" height="360" style="width:100%; height:320px; border-radius:12px; background:rgba(0,0,0,0.12)"></canvas>

          <details open style="margin-top:14px;">
            <summary><b>Engineering Inputs (optional TDH estimator)</b></summary>
            <div class="ppst-row">
              <label>Equipment distance (one-way) (ft)</label>
              <input id="equipDistance" type="number" min="0" step="1">
            </div>
            <div class="ppst-row">
              <label>Extra fittings allowance (ft)</label>
              <input id="extraFittings" type="number" min="0" step="1">
            </div>
            <div class="ppst-row">
              <label>Pipe size (in)</label>
              <select id="pipeSize">
                <option value="2">2.0</option>
                <option value="2.5">2.5</option>
                <option value="3">3.0</option>
              </select>
            </div>
            <div class="ppst-row">
              <label>Elevation (ft)</label>
              <input id="elevation" type="number" step="0.5">
            </div>
            <div class="ppst-row">
              <label>Equipment head (ft)</label>
              <input id="equipmentHead" type="number" step="0.5">
            </div>
            <div class="ppst-row">
              <label>C (Hazen-Williams)</label>
              <input id="hazenC" type="number" step="1">
            </div>
            <div class="ppst-row">
              <label>Apply TDH to</label>
              <select id="applyTDHTo">
                <option value="all">All pumps</option>
                <option value="shared">Shared pumps</option>
                <option value="pool">Pool</option>
                <option value="water">Water Features</option>
                <option value="spa">Spa</option>
              </select>
            </div>
            <div class="ppst-inline" style="gap:10px; margin-top:8px;">
              <button id="btnEstimateTDH">Estimate TDH</button>
              <div id="tdhBadge" class="ppst-tdh">TDH: —</div>
            </div>
          </details>
        </div>
      </div>

      <div id="curvesModal" class="ppst-modal hidden">
        <div class="ppst-modal-card">
          <div class="ppst-modal-head">
            <div>
              <h2 style="margin:0;">Pump Curves</h2>
              <div class="ppst-muted">Paste points: <b>GPM,TDH</b> (one per line)</div>
            </div>
            <button id="btnCloseCurves">Close</button>
          </div>

          <div class="ppst-tabs" id="curveTabs"></div>

          <div class="ppst-modal-actions">
            <button id="btnResetCurves">Reset Defaults</button>
            <div style="flex:1;"></div>
            <button id="btnAddRPM">+ Add RPM</button>
            <button id="btnSaveCurves" class="ppst-primary">Save</button>
          </div>

          <div id="curveEditorBody"></div>
        </div>
      </div>
    `;

    // minimal inline CSS if their style.css is missing
    const style = document.createElement("style");
    style.textContent = `
      .ppst { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; color: #e9eefc; padding: 18px; background: radial-gradient(1200px 600px at 20% 0%, #111a2c, #0a0f1a); min-height: 100vh; box-sizing: border-box; }
      .ppst-topbar{display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;}
      .ppst-title{font-weight:700; font-size:18px;}
      .ppst-actions button{margin-left:8px;}
      button{background:#1b2743; border:1px solid rgba(255,255,255,0.08); color:#e9eefc; padding:8px 10px; border-radius:10px; cursor:pointer;}
      button:hover{filter:brightness(1.08);}
      .ppst-primary{background:#244a8f;}
      .ppst-grid{display:grid; grid-template-columns: 1.1fr 1fr; gap:14px;}
      @media (max-width: 1100px){ .ppst-grid{grid-template-columns:1fr;}}
      .ppst-card{background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); border-radius:16px; padding:14px;}
      h2{font-size:16px;}
      label{display:block; font-size:12px; opacity:0.85; margin-bottom:6px;}
      input, select, textarea{
        width:100%; background:rgba(0,0,0,0.25); color:#e9eefc; border:1px solid rgba(255,255,255,0.08);
        border-radius:12px; padding:10px; outline:none; box-sizing:border-box;
      }
      textarea{min-height:120px; resize:vertical;}
      .ppst-row{margin-bottom:10px;}
      .ppst-inline{display:flex; gap:10px; align-items:center;}
      .ppst-header-row{display:flex; align-items:center; justify-content:space-between;}
      .ppst-add{white-space:nowrap;}
      .ppst-summary{margin-top:10px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.12);}
      .ppst-summary > div{display:flex; justify-content:space-between; padding:6px 0;}
      .ppst-muted{font-size:12px; opacity:0.75;}
      .ppst-tdh{padding:8px 10px; border-radius:999px; border:1px solid rgba(255,255,255,0.08); background:rgba(0,0,0,0.20);}
      .ppst-badge{padding:6px 10px; border-radius:999px; font-weight:700; font-size:12px;}
      .ppst-pass{background:rgba(46, 204, 113, 0.18); border:1px solid rgba(46,204,113,0.35);}
      .ppst-close{background:rgba(241, 196, 15, 0.18); border:1px solid rgba(241,196,15,0.35);}
      .ppst-pumpRow{display:grid; grid-template-columns: 1.6fr .5fr .9fr .7fr .6fr .35fr; gap:10px; align-items:center; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:14px; margin-bottom:10px; background:rgba(0,0,0,0.12);}
      .ppst-pumpRow .ppst-result{font-size:12px; opacity:0.9;}
      .ppst-modal{position:fixed; inset:0; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:18px;}
      .ppst-modal.hidden{display:none;}
      .ppst-modal-card{width:min(1100px, 96vw); max-height: 90vh; overflow:auto; background:rgba(12,18,32,0.96); border:1px solid rgba(255,255,255,0.09); border-radius:18px; padding:14px;}
      .ppst-modal-head{display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:10px;}
      .ppst-modal-actions{display:flex; gap:10px; align-items:center; margin:10px 0;}
      .ppst-tabs{display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;}
      .ppst-tab{padding:8px 10px; border-radius:999px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); cursor:pointer;}
      .ppst-tab.active{background:rgba(36,74,143,0.35); border-color:rgba(36,74,143,0.55);}
      .ppst-rpmCard{border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:10px; margin-bottom:10px; background:rgba(0,0,0,0.18);}
      .ppst-rpmHead{display:flex; gap:10px; align-items:center; justify-content:space-between;}
      .ppst-rpmHead .left{display:flex; gap:10px; align-items:center; flex:1;}
      .ppst-rpmRemove{white-space:nowrap;}
      .ppst-wfRow{display:grid; grid-template-columns: 1.2fr .5fr .6fr .6fr .7fr .25fr; gap:10px; align-items:center; padding:10px; border:1px solid rgba(255,255,255,0.06); border-radius:14px; margin-bottom:10px; background:rgba(0,0,0,0.12);}
    `;
    document.head.appendChild(style);
    document.body.innerHTML = "";
    document.body.appendChild(wrap);
  }

  ensureUI();

  /* -----------------------------
     DOM References
  ----------------------------- */
  // Project
  const elClient = $("#projectClient") || $("#clientName") || $("#client");
  const elCity = $("#projectCity") || $("#cityState") || $("#city");
  const elPoolVol = $("#poolVolume");
  const elTurnover = $("#turnoverHours");
  const elTurnoverCustom = $("#turnoverCustom");

  // Water features
  const elWfList = $("#wfList");
  const btnAddWF = $("#btnAddWF");

  // Summary
  const elPoolTurnoverFlow = $("#poolTurnoverFlow");
  const elWfFlow = $("#wfFlow");
  const elPoolReqFlow = $("#poolRequiredFlow");

  // SPA
  const elSpaEnabled = $("#spaEnabled");
  const elSpaSetup = $("#spaSetup");
  const elSpaVolume = $("#spaVolume");
  const elSpaTurnover = $("#spaTurnoverHours");
  const elSpaJetsQty = $("#spaJetsQty");
  const elSpaGpmPerJet = $("#spaGpmPerJet");
  const elSpaModeTDH = $("#spaModeTDH");
  const elSpaJetsFlow = $("#spaJetsFlow");
  const elSpaTurnoverFlow = $("#spaTurnoverFlow");
  const elSpaReqFlow = $("#spaRequiredFlow");

  // Pumps
  const elPumpsList = $("#pumpsList");
  const btnAddPump = $("#btnAddPump");

  // Curves viewer
  const canvas = $("#curveCanvas");
  const ctx = canvas?.getContext ? canvas.getContext("2d") : null;
  const btnEditCurves = $("#btnEditCurves");

  // Engineering
  const elEquipDist = $("#equipDistance");
  const elExtraFit = $("#extraFittings");
  const elPipeSize = $("#pipeSize");
  const elElevation = $("#elevation");
  const elEquipHead = $("#equipmentHead");
  const elHazenC = $("#hazenC");
  const elApplyTDHTo = $("#applyTDHTo");
  const btnEstimateTDH = $("#btnEstimateTDH");
  const elTdhBadge = $("#tdhBadge");

  // Export / import / print
  const btnExport = $("#btnExport");
  const btnImport = $("#btnImport");
  const btnPrint = $("#btnPrint");

  // Curves modal
  const curvesModal = $("#curvesModal");
  const btnCloseCurves = $("#btnCloseCurves");
  const btnSaveCurves = $("#btnSaveCurves");
  const btnResetCurves = $("#btnResetCurves");
  const btnAddRPM = $("#btnAddRPM");
  const elCurveTabs = $("#curveTabs");
  const elCurveEditorBody = $("#curveEditorBody");

  /* -----------------------------
     Calculations
  ----------------------------- */

  function getTurnoverHours() {
    const sel = num(elTurnover?.value, state.project.turnoverHours);
    const custom = num(elTurnoverCustom?.value, 0);
    return custom > 0 ? custom : sel;
  }

  function calcPoolTurnoverFlowGPM() {
    const vol = num(elPoolVol?.value, state.project.poolVolume);
    const hrs = getTurnoverHours();
    if (vol <= 0 || hrs <= 0) return 0;
    return vol / (hrs * 60);
  }

  function calcWaterFeaturesFlowGPM() {
    let total = 0;
    for (const wf of state.waterFeatures) {
      const qty = num(wf.qty, 0);
      const width = num(wf.width, 0);
      const gpmft = num(wf.gpmPerFt, 0);
      total += qty * width * gpmft;
    }
    return total;
  }

  function calcPoolRequiredFlowGPM() {
    return calcPoolTurnoverFlowGPM() + calcWaterFeaturesFlowGPM();
  }

  function calcSpaJetsFlowGPM() {
    const jets = num(elSpaJetsQty?.value, state.spa.jetsQty);
    const gpj = num(elSpaGpmPerJet?.value, state.spa.gpmPerJet);
    return Math.max(0, jets * gpj);
  }

  function calcSpaTurnoverFlowGPM() {
    const vol = num(elSpaVolume?.value, state.spa.volume);
    const hrs = num(elSpaTurnover?.value, state.spa.turnoverHours);
    if (vol <= 0 || hrs <= 0) return 0;
    return vol / (hrs * 60);
  }

  function calcSpaRequiredFlowGPM() {
    return Math.max(calcSpaJetsFlowGPM(), calcSpaTurnoverFlowGPM());
  }

  function systemRequiredFlow(system) {
    const poolReq = calcPoolRequiredFlowGPM();
    const wfReq = calcWaterFeaturesFlowGPM();
    const spaReq = calcSpaRequiredFlowGPM();

    const spaOn = !!elSpaEnabled?.checked;

    switch (system) {
      case "Pool":
        return poolReq;
      case "Water":
      case "Water Features":
        return wfReq;
      case "Spa":
        return spaOn ? spaReq : 0;
      case "Shared":
      default:
        if (!spaOn) return poolReq;
        return Math.max(poolReq, spaReq);
    }
  }

  function pickBestRPMLine(modelKey, targetTDH, requiredFlow) {
    const model = curves[modelKey];
    if (!model || !Array.isArray(model.rpmLines)) return null;

    // Sort ascending RPM so we choose the lowest RPM that passes
    const lines = [...model.rpmLines].sort((a, b) => num(a.rpm) - num(b.rpm));
    for (const line of lines) {
      const g = gpmAtTDH(line.points, targetTDH);
      if (g >= requiredFlow && g > 0) return { line, gpm: g };
    }

    // If none pass, still show the best (highest gpm) as info
    let best = null;
    for (const line of lines) {
      const g = gpmAtTDH(line.points, targetTDH);
      if (!best || g > best.gpm) best = { line, gpm: g };
    }
    return best;
  }

  /* -----------------------------
     TDH Estimator (simple)
     - Hazen-Williams approx
  ----------------------------- */

  const PIPE_ID_IN = {
    2.0: 2.067,
    2.5: 2.469,
    3.0: 3.068,
  };

  function hazenWilliamsHeadLossFt(flowGPM, lengthFt, diameterIn, C) {
    // h_f = 4.52 * L * (Q^1.85) / (C^1.85 * d^4.87)
    // Q in gpm, d in inches, L in feet => head loss in feet of water
    const Q = Math.max(0, flowGPM);
    const L = Math.max(0, lengthFt);
    const d = Math.max(0.1, diameterIn);
    const c = Math.max(1, C);
    return 4.52 * L * Math.pow(Q, 1.85) / (Math.pow(c, 1.85) * Math.pow(d, 4.87));
  }

  function estimateTDHForFlow(flowGPM) {
    const equipDist = num(elEquipDist?.value, state.engineering.equipDistance);
    const extraFit = num(elExtraFit?.value, state.engineering.extraFittings);
    const pipeSize = num(elPipeSize?.value, state.engineering.pipeSize);
    const elevation = num(elElevation?.value, state.engineering.elevation);
    const equipHead = num(elEquipHead?.value, state.engineering.equipmentHead);
    const C = num(elHazenC?.value, state.engineering.hazenC);

    const oneWay = Math.max(0, equipDist);
    const totalLength = 2 * oneWay + Math.max(0, extraFit); // supply+return + fittings allowance

    const dIn = PIPE_ID_IN[pipeSize] ?? pipeSize;
    const friction = hazenWilliamsHeadLossFt(flowGPM, totalLength, dIn, C);
    const tdh = friction + Math.max(0, elevation) + Math.max(0, equipHead);

    return { tdh, friction, totalLength };
  }

  function applyEstimatedTDH() {
    const applyTo = elApplyTDHTo?.value || "shared";

    // choose representative required flow for estimating TDH
    // if applyTo shared -> shared required; else use system's required
    let flowForCalc = 0;
    if (applyTo === "all") {
      // use max required among all pumps
      flowForCalc = Math.max(...state.pumps.map(p => systemRequiredFlow(p.system)));
    } else if (applyTo === "shared") {
      flowForCalc = Math.max(...state.pumps.filter(p => p.system === "Shared").map(p => systemRequiredFlow(p.system)), 0);
    } else if (applyTo === "pool") {
      flowForCalc = calcPoolRequiredFlowGPM();
    } else if (applyTo === "water") {
      flowForCalc = calcWaterFeaturesFlowGPM();
    } else if (applyTo === "spa") {
      flowForCalc = calcSpaRequiredFlowGPM();
    }

    const est = estimateTDHForFlow(flowForCalc);
    state.engineering.estimatedTDH = est.tdh;
    state.engineering.estimatedFriction = est.friction;
    state.engineering.estimatedL = est.totalLength;

    // apply to pumps
    for (const pump of state.pumps) {
      if (applyTo === "all") pump.tdh = round1(est.tdh);
      else if (applyTo === "shared" && pump.system === "Shared") pump.tdh = round1(est.tdh);
      else if (applyTo === "pool" && pump.system === "Pool") pump.tdh = round1(est.tdh);
      else if ((applyTo === "water") && (pump.system === "Water" || pump.system === "Water Features")) pump.tdh = round1(est.tdh);
      else if (applyTo === "spa" && pump.system === "Spa") pump.tdh = round1(est.tdh);
    }
  }

  /* -----------------------------
     Renderers
  ----------------------------- */

  function renderWaterFeatures() {
    if (!elWfList) return;
    elWfList.innerHTML = "";

    for (const wf of state.waterFeatures) {
      const row = document.createElement("div");
      row.className = "ppst-wfRow";
      const rowGpm = round1(num(wf.qty, 0) * num(wf.width, 0) * num(wf.gpmPerFt, 0));

      row.innerHTML = `
        <div>
          <label>Type</label>
          <select data-k="type">
            ${WATER_FEATURE_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Qty</label>
          <input data-k="qty" type="number" min="0" step="1">
        </div>
        <div>
          <label>Width (ft)</label>
          <input data-k="width" type="number" min="0" step="0.5">
        </div>
        <div>
          <label>GPM / ft</label>
          <input data-k="gpmPerFt" type="number" min="0" step="0.5">
        </div>
        <div style="text-align:right;">
          <label>Row GPM</label>
          <div style="padding:10px 8px;"><b>${rowGpm}</b></div>
        </div>
        <div style="text-align:right;">
          <label>&nbsp;</label>
          <button title="Remove" data-act="rm">✕</button>
        </div>
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

      elWfList.appendChild(row);
    }
  }

  function renderPumps() {
    if (!elPumpsList) return;
    elPumpsList.innerHTML = "";

    const modelKeys = Object.keys(curves);

    state.pumps.forEach((p, idx) => {
      const row = document.createElement("div");
      row.className = "ppst-pumpRow";

      const reqFlow = systemRequiredFlow(p.system);
      const best = pickBestRPMLine(p.model, num(p.tdh, 0), reqFlow);
      const pass = best && best.gpm >= reqFlow && best.gpm > 0;

      const statusText = pass ? "PASS" : "CLOSE";
      const statusCls = pass ? "ppst-badge ppst-pass" : "ppst-badge ppst-close";
      const bestRpm = best?.line?.rpm ? `${best.line.rpm}` : "—";
      const bestGpm = best?.gpm ? round1(best.gpm) : 0;
      const tdh = round1(num(p.tdh, 0));
      const resultText = best ? `${bestRpm} RPM | ${tdh} ft @ ${bestGpm} GPM` : "—";

      row.innerHTML = `
        <div>
          <label>Pump Model</label>
          <select data-k="model">
            ${modelKeys.map(k => `<option value="${k}">${curves[k].modelLabel || k}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Qty</label>
          <input data-k="qty" type="number" min="1" step="1">
        </div>
        <div>
          <label>System</label>
          <select data-k="system">
            <option value="Pool">Pool</option>
            <option value="Water">Water Features</option>
            <option value="Spa">Spa</option>
            <option value="Shared">Shared</option>
          </select>
        </div>
        <div>
          <label>TDH (ft)</label>
          <input data-k="tdh" type="number" min="0" step="0.5">
        </div>
        <div>
          <label>Status</label>
          <div class="${statusCls}">${statusText}</div>
          <div class="ppst-result">${resultText}</div>
        </div>
        <div style="text-align:right;">
          <label>&nbsp;</label>
          <button title="Remove" data-act="rm">✕</button>
        </div>
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
      selSys.addEventListener("change", () => { p.system = selSys.value === "Water" ? "Water" : selSys.value; persistAndRecalc(); });
      inTDH.addEventListener("input", () => { p.tdh = num(inTDH.value, 0); persistAndRecalc(); });

      row.addEventListener("click", (e) => {
        // ignore clicks on controls
        if (e.target && (e.target.tagName === "SELECT" || e.target.tagName === "INPUT" || e.target.tagName === "BUTTON")) return;
        state.ui.selectedPumpIndex = idx;
        renderCurveViewer();
      });

      btnRm.addEventListener("click", () => {
        state.pumps = state.pumps.filter(x => x.id !== p.id);
        state.ui.selectedPumpIndex = clamp(state.ui.selectedPumpIndex, 0, Math.max(0, state.pumps.length - 1));
        persistAndRecalc();
      });

      elPumpsList.appendChild(row);
    });
  }

  function renderSummary() {
    const pt = round1(calcPoolTurnoverFlowGPM());
    const wf = round1(calcWaterFeaturesFlowGPM());
    const pr = round1(calcPoolRequiredFlowGPM());

    if (elPoolTurnoverFlow) elPoolTurnoverFlow.textContent = `${pt} GPM`;
    if (elWfFlow) elWfFlow.textContent = `${wf} GPM`;
    if (elPoolReqFlow) elPoolReqFlow.textContent = `${pr} GPM`;

    const spaJets = round1(calcSpaJetsFlowGPM());
    const spaTurn = round1(calcSpaTurnoverFlowGPM());
    const spaReq = round1(calcSpaRequiredFlowGPM());

    if (elSpaJetsFlow) elSpaJetsFlow.textContent = `${spaJets} GPM`;
    if (elSpaTurnoverFlow) elSpaTurnoverFlow.textContent = `${spaTurn} GPM`;
    if (elSpaReqFlow) elSpaReqFlow.textContent = `${spaReq} GPM`;

    if (elTdhBadge) {
      const tdh = state.engineering.estimatedTDH;
      if (Number.isFinite(tdh)) {
        elTdhBadge.textContent = `TDH: ${round1(tdh)} ft (friction ${round1(state.engineering.estimatedFriction || 0)} ft, L=${round1(state.engineering.estimatedL || 0)} ft)`;
      } else {
        elTdhBadge.textContent = `TDH: —`;
      }
    }
  }

  /* -----------------------------
     Canvas Drawing
  ----------------------------- */

  function clearCanvas() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawAxes(bounds) {
    const { left, top, w, h } = bounds;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;

    // border
    ctx.strokeRect(left, top, w, h);

    // grid lines
    const xGrid = 6;
    const yGrid = 6;
    for (let i = 1; i < xGrid; i++) {
      const x = left + (w * i) / xGrid;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + h);
      ctx.stroke();
    }
    for (let i = 1; i < yGrid; i++) {
      const y = top + (h * i) / yGrid;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + w, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  function renderCurveViewer() {
    if (!ctx || !canvas) return;
    clearCanvas();

    const pump = state.pumps[state.ui.selectedPumpIndex] || state.pumps[0];
    if (!pump) return;

    const model = curves[pump.model];
    if (!model || !model.rpmLines?.length) return;

    // Determine plot extents from curves
    const allPts = model.rpmLines.flatMap(l => l.points || []);
    const maxG = Math.max(10, ...allPts.map(p => p.gpm));
    const maxT = Math.max(10, ...allPts.map(p => p.tdh));

    const pad = 42;
    const bounds = { left: pad, top: 18, w: canvas.width - pad - 18, h: canvas.height - 18 - 46 };

    const xToPx = (gpm) => bounds.left + (clamp(gpm, 0, maxG) / maxG) * bounds.w;
    const yToPx = (tdh) => bounds.top + bounds.h - (clamp(tdh, 0, maxT) / maxT) * bounds.h;

    drawAxes(bounds);

    // Title
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 14px system-ui";
    ctx.fillText(model.modelLabel || pump.model, 18, 18);
    ctx.restore();

    // Draw curves (use a palette but keep simple)
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
      for (let k = 1; k < pts.length; k++) {
        ctx.lineTo(xToPx(pts[k].gpm), yToPx(pts[k].tdh));
      }
      ctx.stroke();

      // small label near mid
      const mid = pts[Math.floor(pts.length / 2)];
      ctx.fillStyle = palette[i % palette.length];
      ctx.font = "12px system-ui";
      ctx.fillText(line.label || `${line.rpm} RPM`, xToPx(mid.gpm) + 6, yToPx(mid.tdh) - 6);

      ctx.restore();
    });

    // Target TDH line
    const targetTDH = num(pump.tdh, 0);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(255, 220, 120, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bounds.left, yToPx(targetTDH));
    ctx.lineTo(bounds.left + bounds.w, yToPx(targetTDH));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 220, 120, 0.9)";
    ctx.font = "12px system-ui";
    ctx.fillText(`Target TDH: ${round1(targetTDH)} ft`, bounds.left + 8, yToPx(targetTDH) - 8);
    ctx.restore();

    // Operating required flow (vertical line)
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
    ctx.fillText(`Required Flow: ${round1(req)} GPM`, xToPx(req) + 6, bounds.top + 18);
    ctx.restore();

    // Operating point: pick best RPM line and plot intersection at TDH
    const best = pickBestRPMLine(pump.model, targetTDH, req);
    if (best && best.line && best.line.points?.length >= 2) {
      const opGpm = gpmAtTDH(best.line.points, targetTDH);
      ctx.save();
      ctx.fillStyle = "rgba(255, 176, 59, 0.95)";
      ctx.beginPath();
      ctx.arc(xToPx(opGpm), yToPx(targetTDH), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "12px system-ui";
      ctx.fillText(`Operating: ${round1(opGpm)} GPM @ ${round1(targetTDH)} ft (${best.line.label || best.line.rpm} )`, xToPx(opGpm) + 8, yToPx(targetTDH) - 10);
      ctx.restore();
    }

    // Axes labels
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "12px system-ui";
    ctx.fillText("Flow (GPM)", bounds.left + bounds.w / 2 - 30, canvas.height - 10);
    ctx.save();
    ctx.translate(12, bounds.top + bounds.h / 2 + 30);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("TDH (ft)", 0, 0);
    ctx.restore();

    ctx.restore();
  }

  /* -----------------------------
     Curves Modal
  ----------------------------- */

  function openCurvesModal() {
    if (!curvesModal) return;
    curvesModal.classList.remove("hidden");
    state.ui.curvesModalOpen = true;

    // active model = selected pump model by default
    const pump = state.pumps[state.ui.selectedPumpIndex] || state.pumps[0];
    if (pump && curves[pump.model]) state.ui.curvesActiveModel = pump.model;

    renderCurvesModal();
  }

  function closeCurvesModal() {
    if (!curvesModal) return;
    curvesModal.classList.add("hidden");
    state.ui.curvesModalOpen = false;
  }

  function renderCurvesModal() {
    if (!elCurveTabs || !elCurveEditorBody) return;

    const modelKeys = Object.keys(curves);
    if (!modelKeys.length) return;

    if (!curves[state.ui.curvesActiveModel]) {
      state.ui.curvesActiveModel = modelKeys[0];
    }

    // Tabs
    elCurveTabs.innerHTML = "";
    modelKeys.forEach((k) => {
      const tab = document.createElement("button");
      tab.className = "ppst-tab" + (k === state.ui.curvesActiveModel ? " active" : "");
      tab.textContent = curves[k].modelLabel || k;
      tab.addEventListener("click", () => {
        state.ui.curvesActiveModel = k;
        renderCurvesModal();
      });
      elCurveTabs.appendChild(tab);
    });

    // Body
    const model = curves[state.ui.curvesActiveModel];
    elCurveEditorBody.innerHTML = "";

    (model.rpmLines || []).forEach((line, idx) => {
      const card = document.createElement("div");
      card.className = "ppst-rpmCard";

      card.innerHTML = `
        <div class="ppst-rpmHead">
          <div class="left">
            <div style="min-width:120px;">
              <label>RPM</label>
              <input data-k="rpm" type="number" min="0" step="1">
            </div>
            <div style="flex:1;">
              <label>Label</label>
              <input data-k="label" type="text">
            </div>
          </div>
          <button class="ppst-rpmRemove" data-act="rm">Remove</button>
        </div>

        <div style="margin-top:10px;">
          <label>Points</label>
          <textarea data-k="points" placeholder="0,95&#10;30,92&#10;60,86"></textarea>
        </div>
      `;

      const inRpm = card.querySelector('input[data-k="rpm"]');
      const inLabel = card.querySelector('input[data-k="label"]');
      const taPts = card.querySelector('textarea[data-k="points"]');
      const btnRm = card.querySelector('button[data-act="rm"]');

      inRpm.value = line.rpm ?? "";
      inLabel.value = line.label ?? "";
      taPts.value = pointsToText(line.points || []);

      inRpm.addEventListener("input", () => { line.rpm = Math.round(num(inRpm.value, line.rpm || 0)); });
      inLabel.addEventListener("input", () => { line.label = inLabel.value; });
      taPts.addEventListener("input", () => { line.pointsText = taPts.value; });

      btnRm.addEventListener("click", () => {
        model.rpmLines.splice(idx, 1);
        renderCurvesModal();
      });

      elCurveEditorBody.appendChild(card);
    });
  }

  function commitCurvesModalEdits() {
    const model = curves[state.ui.curvesActiveModel];
    if (!model) return;

    // For each rpmLine, parse pointsText if present
    (model.rpmLines || []).forEach((line) => {
      if (typeof line.pointsText === "string") {
        const pts = parsePoints(line.pointsText);
        line.points = pts;
        delete line.pointsText;
      } else if (!Array.isArray(line.points)) {
        line.points = [];
      }
      line.rpm = Math.round(num(line.rpm, 0));
      line.label = String(line.label || (line.rpm ? `${line.rpm} RPM` : "RPM"));
    });

    // Sort lines by RPM desc (nicer viewing)
    model.rpmLines.sort((a, b) => num(b.rpm) - num(a.rpm));
  }

  /* -----------------------------
     Persist & Recalc
  ----------------------------- */
  function persistAndRecalc() {
    // update project fields from inputs
    if (elClient) state.project.client = elClient.value || "";
    if (elCity) state.project.city = elCity.value || "";
    if (elPoolVol) state.project.poolVolume = num(elPoolVol.value, state.project.poolVolume);
    if (elTurnover) state.project.turnoverHours = num(elTurnover.value, state.project.turnoverHours);
    if (elTurnoverCustom) state.project.turnoverCustom = elTurnoverCustom.value || "";

    // spa inputs
    if (elSpaEnabled) state.spa.enabled = !!elSpaEnabled.checked;
    if (elSpaSetup) state.spa.setup = elSpaSetup.value || state.spa.setup;
    if (elSpaVolume) state.spa.volume = num(elSpaVolume.value, state.spa.volume);
    if (elSpaTurnover) state.spa.turnoverHours = num(elSpaTurnover.value, state.spa.turnoverHours);
    if (elSpaJetsQty) state.spa.jetsQty = Math.max(0, Math.round(num(elSpaJetsQty.value, state.spa.jetsQty)));
    if (elSpaGpmPerJet) state.spa.gpmPerJet = num(elSpaGpmPerJet.value, state.spa.gpmPerJet);
    if (elSpaModeTDH) state.spa.modeTDH = num(elSpaModeTDH.value, state.spa.modeTDH);

    // engineering inputs
    if (elEquipDist) state.engineering.equipDistance = num(elEquipDist.value, state.engineering.equipDistance);
    if (elExtraFit) state.engineering.extraFittings = num(elExtraFit.value, state.engineering.extraFittings);
    if (elPipeSize) state.engineering.pipeSize = num(elPipeSize.value, state.engineering.pipeSize);
    if (elElevation) state.engineering.elevation = num(elElevation.value, state.engineering.elevation);
    if (elEquipHead) state.engineering.equipmentHead = num(elEquipHead.value, state.engineering.equipmentHead);
    if (elHazenC) state.engineering.hazenC = num(elHazenC.value, state.engineering.hazenC);
    if (elApplyTDHTo) state.engineering.applyTDHTo = elApplyTDHTo.value || state.engineering.applyTDHTo;

    saveState(state);

    // Render everything
    renderWaterFeatures();
    renderPumps();
    renderSummary();
    renderCurveViewer();
  }

  /* -----------------------------
     Bind Inputs
  ----------------------------- */
  function bindInputs() {
    // init inputs with state values
    if (elClient) elClient.value = state.project.client || "";
    if (elCity) elCity.value = state.project.city || "";
    if (elPoolVol) elPoolVol.value = state.project.poolVolume ?? 10000;

    if (elTurnover) elTurnover.value = String(state.project.turnoverHours ?? 6);
    if (elTurnoverCustom) elTurnoverCustom.value = state.project.turnoverCustom || "";

    if (elSpaEnabled) elSpaEnabled.checked = !!state.spa.enabled;
    if (elSpaSetup) elSpaSetup.value = state.spa.setup || "shared_valve";
    if (elSpaVolume) elSpaVolume.value = state.spa.volume ?? 600;
    if (elSpaTurnover) elSpaTurnover.value = state.spa.turnoverHours ?? 6;
    if (elSpaJetsQty) elSpaJetsQty.value = state.spa.jetsQty ?? 8;
    if (elSpaGpmPerJet) elSpaGpmPerJet.value = state.spa.gpmPerJet ?? 12;
    if (elSpaModeTDH) elSpaModeTDH.value = state.spa.modeTDH ?? 50;

    if (elEquipDist) elEquipDist.value = state.engineering.equipDistance ?? 60;
    if (elExtraFit) elExtraFit.value = state.engineering.extraFittings ?? 60;
    if (elPipeSize) elPipeSize.value = String(state.engineering.pipeSize ?? 2.5);
    if (elElevation) elElevation.value = state.engineering.elevation ?? 0;
    if (elEquipHead) elEquipHead.value = state.engineering.equipmentHead ?? 10;
    if (elHazenC) elHazenC.value = state.engineering.hazenC ?? 140;
    if (elApplyTDHTo) elApplyTDHTo.value = state.engineering.applyTDHTo ?? "shared";

    const onAnyInput = () => persistAndRecalc();

    [elClient, elCity, elPoolVol, elTurnover, elTurnoverCustom].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", onAnyInput);
      el.addEventListener("change", onAnyInput);
    });

    [elSpaEnabled, elSpaSetup, elSpaVolume, elSpaTurnover, elSpaJetsQty, elSpaGpmPerJet, elSpaModeTDH].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", onAnyInput);
      el.addEventListener("change", onAnyInput);
    });

    [elEquipDist, elExtraFit, elPipeSize, elElevation, elEquipHead, elHazenC, elApplyTDHTo].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", onAnyInput);
      el.addEventListener("change", onAnyInput);
    });

    if (btnAddWF) {
      btnAddWF.addEventListener("click", () => {
        state.waterFeatures.push({ id: safeId(), type: "Sheer", qty: 1, width: 2, gpmPerFt: 15 });
        persistAndRecalc();
      });
    }

    if (btnAddPump) {
      btnAddPump.addEventListener("click", () => {
        const firstModel = Object.keys(curves)[0] || "Jandy VS FloPro 2.7 HP";
        state.pumps.push({ id: safeId(), model: firstModel, qty: 1, system: "Shared", tdh: 50 });
        state.ui.selectedPumpIndex = state.pumps.length - 1;
        persistAndRecalc();
      });
    }

    if (btnEditCurves) btnEditCurves.addEventListener("click", openCurvesModal);
    if (btnCloseCurves) btnCloseCurves.addEventListener("click", () => { closeCurvesModal(); });

    if (btnAddRPM) {
      btnAddRPM.addEventListener("click", () => {
        const model = curves[state.ui.curvesActiveModel];
        if (!model) return;
        model.rpmLines = model.rpmLines || [];
        model.rpmLines.unshift({
          rpm: 3450,
          label: "3450 RPM",
          points: [
            { gpm: 0, tdh: 50 },
            { gpm: 50, tdh: 40 },
            { gpm: 100, tdh: 20 },
          ],
        });
        renderCurvesModal();
      });
    }

    if (btnSaveCurves) {
      btnSaveCurves.addEventListener("click", () => {
        commitCurvesModalEdits();
        saveCurves(curves);
        closeCurvesModal();
        persistAndRecalc();
      });
    }

    if (btnResetCurves) {
      btnResetCurves.addEventListener("click", () => {
        curves = structuredClone(DEFAULT_CURVES);
        saveCurves(curves);
        renderCurvesModal();
        persistAndRecalc();
      });
    }

    if (btnEstimateTDH) {
      btnEstimateTDH.addEventListener("click", () => {
        applyEstimatedTDH();
        persistAndRecalc();
      });
    }

    if (btnExport) {
      btnExport.addEventListener("click", () => {
        const data = { state, curves };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "pool-pump-sizing-export.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      });
    }

    if (btnImport) {
      btnImport.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          const text = await file.text();
          try {
            const parsed = JSON.parse(text);
            if (parsed?.state) {
              // shallow merge
              Object.assign(state, parsed.state);
              state.project = { ...state.project, ...(parsed.state.project || {}) };
              state.spa = { ...state.spa, ...(parsed.state.spa || {}) };
              state.engineering = { ...state.engineering, ...(parsed.state.engineering || {}) };
              state.waterFeatures = Array.isArray(parsed.state.waterFeatures) ? parsed.state.waterFeatures : state.waterFeatures;
              state.pumps = Array.isArray(parsed.state.pumps) ? parsed.state.pumps : state.pumps;
              state.ui = { ...state.ui, ...(parsed.state.ui || {}) };
            }
            if (parsed?.curves) {
              curves = parsed.curves;
              saveCurves(curves);
            }
            saveState(state);
            bindInputs(); // re-init inputs with new values
            persistAndRecalc();
          } catch (e) {
            alert("Invalid JSON file.");
          }
        };
        input.click();
      });
    }

    if (btnPrint) {
      btnPrint.addEventListener("click", () => window.print());
    }
  }

  /* -----------------------------
     Init
  ----------------------------- */
  bindInputs();
  persistAndRecalc();

})(); // IMPORTANT: close IIFE properly
