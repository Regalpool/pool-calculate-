/* ============================================================
   Pool Pump Sizing Tool - app.js (Canvas curve + UI logic)
   - Supports curve parsing: lines like "0,95" (GPM,TDH) one per line
   - Draws curves on <canvas id="curveCanvas">
   - Draws Target TDH line & Operating point
   - PASS / CLOSE status
   - Curve editor modal with tabs + add RPM + save/reset
   - No external libraries required
   ============================================================ */

(() => {
  "use strict";

  /* -----------------------------
     Helpers
  ----------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function round(v, digits = 1) {
    const p = Math.pow(10, digits);
    return Math.round(v * p) / p;
  }

  function fmt(v, digits = 1, suffix = "") {
    if (!Number.isFinite(v)) return "—";
    return `${round(v, digits).toFixed(digits)}${suffix}`;
  }

  function safeId(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function toCSVLine(a, b) {
    return `${round(a, 2)},${round(b, 2)}`;
  }

  function parsePointLine(line) {
    // Accept: "0,95" or "0, 95" or "0 95" or "0\t95"
    const cleaned = String(line).trim();
    if (!cleaned) return null;

    // Replace multiple spaces with single
    let parts = cleaned.split(",").map(s => s.trim());
    if (parts.length < 2) {
      // try spaces
      parts = cleaned.split(/[\s\t]+/).map(s => s.trim());
    }
    if (parts.length < 2) return null;

    const gpm = num(parts[0], NaN);
    const tdh = num(parts[1], NaN);
    if (!Number.isFinite(gpm) || !Number.isFinite(tdh)) return null;

    return { gpm, tdh };
  }

  function parsePointsText(text) {
    const lines = String(text || "").split(/\r?\n/);
    const pts = [];
    for (const line of lines) {
      const p = parsePointLine(line);
      if (p) pts.push(p);
    }
    // Sort by gpm ascending
    pts.sort((a, b) => a.gpm - b.gpm);
    // Remove duplicates by gpm (keep last)
    const out = [];
    const seen = new Map();
    for (const p of pts) seen.set(p.gpm, p);
    for (const [gpm, p] of [...seen.entries()].sort((a, b) => a[0] - b[0])) out.push(p);
    return out;
  }

  function pointsToText(points) {
    return (points || []).map(p => toCSVLine(p.gpm, p.tdh)).join("\n");
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function interpYAtX(points, x) {
    // points: sorted by gpm asc
    if (!points || points.length < 2) return null;
    if (x < points[0].gpm || x > points[points.length - 1].gpm) return null;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (x >= a.gpm && x <= b.gpm) {
        const t = (x - a.gpm) / (b.gpm - a.gpm || 1);
        return lerp(a.tdh, b.tdh, t);
      }
    }
    return null;
  }

  function interpXAtY(points, y) {
    // Find gpm where curve hits given TDH y (monotonic decreasing usually)
    if (!points || points.length < 2) return null;

    // We will scan segments and find where y is between endpoints (inclusive)
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const y1 = a.tdh;
      const y2 = b.tdh;

      // check if y lies between y1 and y2
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      if (y >= minY && y <= maxY) {
        const t = (y - y1) / (y2 - y1 || 1);
        return lerp(a.gpm, b.gpm, t);
      }
    }
    return null;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /* -----------------------------
     Default data (Pumps + Water feature types)
     NOTE: you can edit these inside "Edit Curves"
  ----------------------------- */

  const DEFAULT_WATER_TYPES = [
    { id: "sheer", label: "Sheer", defaultGpmPerFt: 15 },
    { id: "deck-jet", label: "Deck Jet", defaultGpmPerFt: 8 },
    { id: "rain-curtain", label: "Rain Curtain", defaultGpmPerFt: 12 },
    { id: "scupper", label: "Scupper", defaultGpmPerFt: 15 },
    { id: "laminar", label: "Laminar Jet", defaultGpmPerFt: 10 },
    { id: "bubbler", label: "Bubbler", defaultGpmPerFt: 15 },
  ];

  // Pump curves structure:
  // pumpId: { name, hpText, rpmLines: [{ rpm, label, points:[{gpm,tdh}...] }] }
  const DEFAULT_PUMPS = {
    "jandy-vs-flopro-2-7": {
      name: "Jandy VS FloPro 2.7 HP",
      hpText: "2.7 HP",
      rpmLines: [
        {
          rpm: 3450,
          label: "3450 RPM",
          // Approx from chart (you can refine inside editor)
          points: [
            { gpm: 0, tdh: 95 },
            { gpm: 30, tdh: 93 },
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
            { gpm: 110, tdh: 37 },
          ],
        },
        {
          rpm: 2750,
          label: "2750 RPM",
          points: [
            { gpm: 0, tdh: 63 },
            { gpm: 30, tdh: 59 },
            { gpm: 60, tdh: 54 },
            { gpm: 80, tdh: 44 },
            { gpm: 100, tdh: 18 },
          ],
        },
        {
          rpm: 2400,
          label: "2400 RPM",
          points: [
            { gpm: 0, tdh: 49 },
            { gpm: 30, tdh: 46 },
            { gpm: 60, tdh: 40 },
            { gpm: 80, tdh: 34 },
            { gpm: 100, tdh: 22 },
          ],
        },
        {
          rpm: 1730,
          label: "1730 RPM",
          points: [
            { gpm: 0, tdh: 25 },
            { gpm: 30, tdh: 22 },
            { gpm: 60, tdh: 16 },
            { gpm: 75, tdh: 9 },
          ],
        },
        {
          rpm: 1200,
          label: "1200 RPM",
          points: [
            { gpm: 0, tdh: 13 },
            { gpm: 30, tdh: 11 },
            { gpm: 50, tdh: 8 },
          ],
        },
        {
          rpm: 600,
          label: "600 RPM",
          points: [
            { gpm: 0, tdh: 4 },
            { gpm: 20, tdh: 2 },
            { gpm: 25, tdh: 1 },
          ],
        },
      ],
    },

    "jandy-vs-flopro-1-85": {
      name: "Jandy VS FloPro 1.85 HP",
      hpText: "1.85 HP",
      rpmLines: [
        {
          rpm: 3450,
          label: "3450 RPM",
          points: [
            { gpm: 0, tdh: 78 },
            { gpm: 30, tdh: 75 },
            { gpm: 60, tdh: 70 },
            { gpm: 80, tdh: 62 },
            { gpm: 100, tdh: 50 },
            { gpm: 120, tdh: 33 },
          ],
        },
        {
          rpm: 3000,
          label: "3000 RPM",
          points: [
            { gpm: 0, tdh: 59 },
            { gpm: 30, tdh: 55 },
            { gpm: 60, tdh: 50 },
            { gpm: 80, tdh: 42 },
            { gpm: 95, tdh: 22 },
          ],
        },
        {
          rpm: 2750,
          label: "2750 RPM",
          points: [
            { gpm: 0, tdh: 50 },
            { gpm: 30, tdh: 46 },
            { gpm: 60, tdh: 40 },
            { gpm: 80, tdh: 33 },
            { gpm: 105, tdh: 25 },
          ],
        },
        {
          rpm: 2400,
          label: "2400 RPM",
          points: [
            { gpm: 0, tdh: 38 },
            { gpm: 30, tdh: 35 },
            { gpm: 60, tdh: 28 },
            { gpm: 80, tdh: 22 },
          ],
        },
        {
          rpm: 1730,
          label: "1730 RPM",
          points: [
            { gpm: 0, tdh: 19 },
            { gpm: 30, tdh: 16 },
            { gpm: 45, tdh: 13 },
            { gpm: 60, tdh: 9 },
          ],
        },
        {
          rpm: 1200,
          label: "1200 RPM",
          points: [
            { gpm: 0, tdh: 10 },
            { gpm: 25, tdh: 9 },
            { gpm: 45, tdh: 5 },
          ],
        },
        {
          rpm: 600,
          label: "600 RPM",
          points: [
            { gpm: 0, tdh: 3 },
            { gpm: 20, tdh: 2 },
            { gpm: 25, tdh: 1 },
          ],
        },
      ],
    },

    "jandy-flopro-fhpm-1-0": {
      name: "Jandy FloPro FHPM 1.0 HP",
      hpText: "1.0 HP",
      rpmLines: [
        // This chart is multi-series by HP; for tool we treat "FHPM 1.0" as a single curve set.
        // You can add more lines if you want, or keep a typical "High speed" curve.
        {
          rpm: 3450,
          label: "High Speed",
          points: [
            { gpm: 0, tdh: 57 },
            { gpm: 30, tdh: 50 },
            { gpm: 60, tdh: 38 },
            { gpm: 80, tdh: 14 },
          ],
        },
        {
          rpm: 1725,
          label: "Low Speed",
          points: [
            { gpm: 0, tdh: 18 },
            { gpm: 30, tdh: 14 },
            { gpm: 60, tdh: 6 },
          ],
        },
      ],
    },

    "jandy-vs-flopro-3-8": {
      name: "Jandy VS FloPro 3.8 HP",
      hpText: "3.8 HP",
      rpmLines: [
        {
          rpm: 3450,
          label: "3450 RPM",
          points: [
            { gpm: 0, tdh: 102 },
            { gpm: 40, tdh: 98 },
            { gpm: 80, tdh: 92 },
            { gpm: 120, tdh: 78 },
            { gpm: 160, tdh: 49 },
            { gpm: 185, tdh: 33 },
          ],
        },
        {
          rpm: 3000,
          label: "3000 RPM",
          points: [
            { gpm: 0, tdh: 77 },
            { gpm: 40, tdh: 74 },
            { gpm: 80, tdh: 68 },
            { gpm: 120, tdh: 52 },
            { gpm: 165, tdh: 22 },
          ],
        },
        {
          rpm: 2750,
          label: "2750 RPM",
          points: [
            { gpm: 0, tdh: 65 },
            { gpm: 40, tdh: 62 },
            { gpm: 80, tdh: 56 },
            { gpm: 120, tdh: 40 },
            { gpm: 155, tdh: 18 },
          ],
        },
        {
          rpm: 2400,
          label: "2400 RPM",
          points: [
            { gpm: 0, tdh: 49 },
            { gpm: 40, tdh: 46 },
            { gpm: 80, tdh: 38 },
            { gpm: 120, tdh: 24 },
            { gpm: 140, tdh: 12 },
          ],
        },
        {
          rpm: 1730,
          label: "1730 RPM",
          points: [
            { gpm: 0, tdh: 25 },
            { gpm: 40, tdh: 22 },
            { gpm: 80, tdh: 15 },
            { gpm: 100, tdh: 6 },
          ],
        },
        {
          rpm: 1200,
          label: "1200 RPM",
          points: [
            { gpm: 0, tdh: 13 },
            { gpm: 40, tdh: 11 },
            { gpm: 70, tdh: 2 },
          ],
        },
        {
          rpm: 600,
          label: "600 RPM",
          points: [
            { gpm: 0, tdh: 4 },
            { gpm: 30, tdh: 1 },
          ],
        },
      ],
    },
  };

  const STORAGE_KEY_CURVES = "poolPumpTool.curves.v1";
  const STORAGE_KEY_STATE = "poolPumpTool.state.v1";

  function loadCurves() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CURVES);
      if (!raw) return deepClone(DEFAULT_PUMPS);
      const parsed = JSON.parse(raw);
      // minimal validation
      if (!parsed || typeof parsed !== "object") return deepClone(DEFAULT_PUMPS);
      return parsed;
    } catch {
      return deepClone(DEFAULT_PUMPS);
    }
  }

  function saveCurves(curves) {
    localStorage.setItem(STORAGE_KEY_CURVES, JSON.stringify(curves));
  }

  /* -----------------------------
     App state
  ----------------------------- */
  const state = {
    project: {
      clientName: "",
      cityState: "",
      poolVolume: 0,
      poolTurnoverHours: 6,
    },
    waterFeatures: [
      // { typeId, qty, widthFt, gpmPerFt }
    ],
    spa: {
      enabled: false,
      setup: "shared", // shared | dedicated
      spaVolume: 0,
      spaTurnoverHours: 0,
      spaJetsQty: 0,
      gpmPerJet: 0,
      spaModeTdh: 50,
    },
    pumps: [
      // { id, modelId, qty, system, tdh }
      { id: cryptoRandomId(), modelId: "jandy-vs-flopro-2-7", qty: 1, system: "shared", tdh: 50 },
    ],
    engineering: {
      equipDistance: 0, // one-way ft
      extraFittings: 60,
      pipeSize: 2.5,
      elevation: 0,
      equipmentHead: 10,
      hazenC: 140,
      applyTdhTo: "shared",
      lastEstimated: null, // { tdh, friction, L }
    },
    ui: {
      selectedPumpId: null,
      curvesModalOpen: false,
      activeCurveTab: null, // pumpId
    },
    curves: loadCurves(),
  };

  function cryptoRandomId() {
    // simple id
    return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;

      // merge carefully
      if (saved.project) Object.assign(state.project, saved.project);
      if (Array.isArray(saved.waterFeatures)) state.waterFeatures = saved.waterFeatures;
      if (saved.spa) Object.assign(state.spa, saved.spa);
      if (Array.isArray(saved.pumps) && saved.pumps.length) state.pumps = saved.pumps;
      if (saved.engineering) Object.assign(state.engineering, saved.engineering);

      // ui
      if (saved.ui) Object.assign(state.ui, saved.ui);
    } catch {
      // ignore
    }
  }

  function persistState() {
    const save = {
      project: state.project,
      waterFeatures: state.waterFeatures,
      spa: state.spa,
      pumps: state.pumps,
      engineering: state.engineering,
      ui: { selectedPumpId: state.ui.selectedPumpId }, // keep simple
    };
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(save));
  }

  /* -----------------------------
     Computations
  ----------------------------- */
  function calcPoolTurnoverFlowGpm() {
    const vol = num(state.project.poolVolume, 0);
    const hours = num(state.project.poolTurnoverHours, 0);
    if (vol <= 0 || hours <= 0) return 0;
    return vol / (hours * 60);
  }

  function calcWaterFeaturesFlowGpm() {
    let sum = 0;
    for (const wf of state.waterFeatures) {
      const qty = num(wf.qty, 0);
      const width = num(wf.widthFt, 0);
      const gpmft = num(wf.gpmPerFt, 0);
      sum += qty * width * gpmft;
    }
    return sum;
  }

  function calcPoolRequiredFlowGpm() {
    // Pool mode: turnover + water features (spa OFF)
    return calcPoolTurnoverFlowGpm() + calcWaterFeaturesFlowGpm();
  }

  function calcSpaJetsFlowGpm() {
    const jets = num(state.spa.spaJetsQty, 0);
    const per = num(state.spa.gpmPerJet, 0);
    return jets * per;
  }

  function calcSpaTurnoverFlowGpm() {
    const vol = num(state.spa.spaVolume, 0);
    const hours = num(state.spa.spaTurnoverHours, 0);
    if (vol <= 0 || hours <= 0) return 0;
    return vol / (hours * 60);
  }

  function calcSpaRequiredFlowGpm() {
    // Match your screenshot behavior: required = max(jets, turnover)
    const a = calcSpaJetsFlowGpm();
    const b = calcSpaTurnoverFlowGpm();
    return Math.max(a, b);
  }

  function getRequiredFlowForSystem(system) {
    const poolReq = calcPoolRequiredFlowGpm();
    const wfReq = calcWaterFeaturesFlowGpm();
    const spaReq = state.spa.enabled ? calcSpaRequiredFlowGpm() : 0;

    if (system === "pool") return poolReq;
    if (system === "features") return wfReq;
    if (system === "spa") return spaReq;

    // shared:
    // - if spa enabled and setup shared: shared pump must handle max(poolReq, spaReq)
    // - otherwise shared pump handles poolReq
    if (system === "shared") {
      if (state.spa.enabled && state.spa.setup === "shared") return Math.max(poolReq, spaReq);
      return poolReq;
    }

    return poolReq;
  }

  function estimateTDHForFlow(flowGpm) {
    // Hazen-Williams head loss
    // hf(ft) = 4.52 * (Q^1.85) / (C^1.85 * d^4.87) * (L/100)
    const Q = Math.max(0, num(flowGpm, 0));
    const C = Math.max(1, num(state.engineering.hazenC, 140));
    const d = Math.max(0.5, num(state.engineering.pipeSize, 2.5)); // inches
    const equipDistance = Math.max(0, num(state.engineering.equipDistance, 0));
    const extra = Math.max(0, num(state.engineering.extraFittings, 0));
    const L = Math.max(0, 2 * equipDistance + extra); // total equivalent length
    const elevation = Math.max(0, num(state.engineering.elevation, 0));
    const equipHead = Math.max(0, num(state.engineering.equipmentHead, 0));

    let friction = 0;
    if (Q > 0 && L > 0) {
      friction = 4.52 * (Math.pow(Q, 1.85) / (Math.pow(C, 1.85) * Math.pow(d, 4.87))) * (L / 100);
    }
    const tdh = elevation + equipHead + friction;
    return { tdh, friction, L };
  }

  function getPumpCurve(modelId) {
    return state.curves[modelId] || null;
  }

  function computeOperatingPoint(modelId, targetTdh, requiredFlow) {
    // choose best RPM line that can deliver requiredFlow at targetTdh
    const pump = getPumpCurve(modelId);
    if (!pump) return null;

    const lines = (pump.rpmLines || []).slice().sort((a, b) => b.rpm - a.rpm);
    let best = null;

    for (const line of lines) {
      const gpmAtTdh = interpXAtY(line.points, targetTdh);
      if (!Number.isFinite(gpmAtTdh)) continue;

      // If meets required flow
      if (gpmAtTdh >= requiredFlow) {
        // choose lowest rpm that still passes (energy friendly)
        best = { rpm: line.rpm, label: line.label, gpm: gpmAtTdh, tdh: targetTdh };
        // continue scanning lower rpm for still pass
      }
    }

    if (best) return { ...best, pass: true };

    // If no rpm meets required flow, return highest achievable gpm at target tdh for the highest rpm line
    let maxGpm = null;
    let maxLine = null;
    for (const line of lines) {
      const gpmAtTdh = interpXAtY(line.points, targetTdh);
      if (!Number.isFinite(gpmAtTdh)) continue;
      if (maxGpm === null || gpmAtTdh > maxGpm) {
        maxGpm = gpmAtTdh;
        maxLine = line;
      }
    }
    if (maxLine && maxGpm !== null) {
      return { rpm: maxLine.rpm, label: maxLine.label, gpm: maxGpm, tdh: targetTdh, pass: false };
    }

    return null;
  }

  /* -----------------------------
     DOM references
  ----------------------------- */
  const dom = {};

  function bindDom() {
    // Project
    dom.clientName = $("#clientName");
    dom.cityState = $("#cityState");
    dom.poolVolume = $("#poolVolume");
    dom.poolTurnoverHours = $("#poolTurnoverHours");

    // Water features
    dom.addWaterFeatureBtn = $("#addWaterFeatureBtn");
    dom.waterFeaturesList = $("#waterFeaturesList");
    dom.poolTurnoverFlow = $("#poolTurnoverFlow");
    dom.waterFeaturesFlow = $("#waterFeaturesFlow");
    dom.poolRequiredFlow = $("#poolRequiredFlow");

    // SPA
    dom.spaModeToggle = $("#spaModeToggle");
    dom.spaPumpSetup = $("#spaPumpSetup");
    dom.spaVolume = $("#spaVolume");
    dom.spaTurnoverHours = $("#spaTurnoverHours");
    dom.spaJetsQty = $("#spaJetsQty");
    dom.gpmPerJet = $("#gpmPerJet");
    dom.spaModeTdh = $("#spaModeTdh");

    dom.spaJetsFlow = $("#spaJetsFlow");
    dom.spaTurnoverFlow = $("#spaTurnoverFlow");
    dom.spaRequiredFlow = $("#spaRequiredFlow");

    dom.poolModeStatus = $("#poolModeStatus");
    dom.poolModeRequired = $("#poolModeRequired");
    dom.spaModeStatus = $("#spaModeStatus");
    dom.spaModeRequired = $("#spaModeRequired");

    // Pumps
    dom.addPumpBtn = $("#addPumpBtn");
    dom.pumpsList = $("#pumpsList");

    // Curve viewer
    dom.curveCanvas = $("#curveCanvas");
    dom.editCurvesBtn = $("#editCurvesBtn");

    // Engineering
    dom.equipDistance = $("#equipDistance");
    dom.extraFittings = $("#extraFittings");
    dom.pipeSize = $("#pipeSize");
    dom.elevation = $("#elevation");
    dom.equipmentHead = $("#equipmentHead");
    dom.hazenC = $("#hazenC");
    dom.applyTdhTo = $("#applyTdhTo");
    dom.estimateTdhBtn = $("#estimateTdhBtn");
    dom.tdhSummary = $("#tdhSummary");

    // JSON / Print
    dom.exportJsonBtn = $("#exportJsonBtn");
    dom.importJsonFile = $("#importJsonFile");
    dom.printBtn = $("#printBtn");

    // Curves modal
    dom.curvesModal = $("#curvesModal");
    dom.closeCurvesBtn = $("#closeCurvesBtn");
    dom.curveTabs = $("#curveTabs");
    dom.curveEditor = $("#curveEditor");
    dom.saveCurvesBtn = $("#saveCurvesBtn");
    dom.resetCurvesBtn = $("#resetCurvesBtn");
  }

  /* -----------------------------
     Rendering: Water Features
  ----------------------------- */
  function makeWaterTypeSelect(selectedId) {
    const sel = document.createElement("select");
    for (const t of DEFAULT_WATER_TYPES) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      sel.appendChild(opt);
    }
    sel.value = selectedId || DEFAULT_WATER_TYPES[0].id;
    return sel;
  }

  function renderWaterFeatures() {
    dom.waterFeaturesList.innerHTML = "";

    state.waterFeatures.forEach((wf, idx) => {
      const row = document.createElement("div");
      row.className = "wf-row";

      const typeSel = makeWaterTypeSelect(wf.typeId);
      typeSel.addEventListener("change", () => {
        wf.typeId = typeSel.value;
        const type = DEFAULT_WATER_TYPES.find(t => t.id === wf.typeId);
        // Keep user values, but if empty set defaults
        if (!Number.isFinite(num(wf.gpmPerFt, NaN)) || wf.gpmPerFt === "" || wf.gpmPerFt === null) {
          wf.gpmPerFt = type?.defaultGpmPerFt ?? 0;
        }
        updateAll();
      });

      const qty = document.createElement("input");
      qty.type = "number";
      qty.step = "1";
      qty.min = "0";
      qty.value = wf.qty ?? 0;
      qty.addEventListener("input", () => {
        wf.qty = num(qty.value, 0);
        updateAll();
      });

      const width = document.createElement("input");
      width.type = "number";
      width.step = "0.1";
      width.min = "0";
      width.value = wf.widthFt ?? 0;
      width.addEventListener("input", () => {
        wf.widthFt = num(width.value, 0);
        updateAll();
      });

      const gpmft = document.createElement("input");
      gpmft.type = "number";
      gpmft.step = "0.1";
      gpmft.min = "0";
      gpmft.value = wf.gpmPerFt ?? 0;
      gpmft.addEventListener("input", () => {
        wf.gpmPerFt = num(gpmft.value, 0);
        updateAll();
      });

      const rowGpm = document.createElement("div");
      rowGpm.className = "wf-rowgpm";
      rowGpm.textContent = fmt(num(wf.qty, 0) * num(wf.widthFt, 0) * num(wf.gpmPerFt, 0), 1, "");

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-icon";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", () => {
        state.waterFeatures.splice(idx, 1);
        updateAll();
      });

      row.appendChild(typeSel);
      row.appendChild(qty);
      row.appendChild(width);
      row.appendChild(gpmft);
      row.appendChild(rowGpm);
      row.appendChild(delBtn);

      dom.waterFeaturesList.appendChild(row);
    });
  }

  function addWaterFeatureRow() {
    const defType = DEFAULT_WATER_TYPES[0];
    state.waterFeatures.push({
      typeId: defType.id,
      qty: 1,
      widthFt: 2,
      gpmPerFt: defType.defaultGpmPerFt,
    });
    updateAll();
  }

  /* -----------------------------
     Rendering: Pumps list
  ----------------------------- */
  function renderPumpRows() {
    dom.pumpsList.innerHTML = "";

    const modelOptions = Object.entries(state.curves).map(([id, p]) => ({ id, name: p.name }));

    state.pumps.forEach((p, idx) => {
      const row = document.createElement("div");
      row.className = "pump-row";
      row.dataset.pid = p.id;

      // Model select
      const modelSel = document.createElement("select");
      for (const opt of modelOptions) {
        const o = document.createElement("option");
        o.value = opt.id;
        o.textContent = opt.name;
        modelSel.appendChild(o);
      }
      modelSel.value = p.modelId;
      modelSel.addEventListener("change", () => {
        p.modelId = modelSel.value;
        state.ui.selectedPumpId = p.id;
        updateAll();
      });

      // qty
      const qty = document.createElement("input");
      qty.type = "number";
      qty.step = "1";
      qty.min = "1";
      qty.value = p.qty ?? 1;
      qty.addEventListener("input", () => {
        p.qty = Math.max(1, num(qty.value, 1));
        updateAll();
      });

      // system
      const systemSel = document.createElement("select");
      [
        { id: "pool", label: "Pool" },
        { id: "features", label: "Water F" },
        { id: "spa", label: "Spa" },
        { id: "shared", label: "Shared" },
      ].forEach(s => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.label;
        systemSel.appendChild(o);
      });
      systemSel.value = p.system || "shared";
      systemSel.addEventListener("change", () => {
        p.system = systemSel.value;
        updateAll();
      });

      // TDH
      const tdh = document.createElement("input");
      tdh.type = "number";
      tdh.step = "0.1";
      tdh.min = "0";
      tdh.value = p.tdh ?? 50;
      tdh.addEventListener("input", () => {
        p.tdh = num(tdh.value, 0);
        updateAll();
      });

      // Status badge
      const status = document.createElement("div");
      status.className = "status-badge";
      status.textContent = "—";

      // Delete
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-icon";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", () => {
        state.pumps.splice(idx, 1);
        if (!state.pumps.length) {
          state.pumps.push({ id: cryptoRandomId(), modelId: modelOptions[0]?.id || "jandy-vs-flopro-2-7", qty: 1, system: "shared", tdh: 50 });
        }
        updateAll();
      });

      // Select row on click (for curve viewer)
      row.addEventListener("click", (e) => {
        // avoid selecting when clicking inputs
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
        if (["input", "select", "button", "option"].includes(tag)) return;
        state.ui.selectedPumpId = p.id;
        updateAll();
      });

      row.appendChild(modelSel);
      row.appendChild(qty);
      row.appendChild(systemSel);
      row.appendChild(tdh);
      row.appendChild(status);
      row.appendChild(delBtn);

      dom.pumpsList.appendChild(row);
    });

    // After rows are in DOM, update statuses
    updatePumpStatuses();
  }

  function addPumpRow() {
    const firstModelId = Object.keys(state.curves)[0] || "jandy-vs-flopro-2-7";
    state.pumps.push({
      id: cryptoRandomId(),
      modelId: firstModelId,
      qty: 1,
      system: "shared",
      tdh: 50,
    });
    state.ui.selectedPumpId = state.pumps[state.pumps.length - 1].id;
    updateAll();
  }

  function updatePumpStatuses() {
    const rows = $$(".pump-row", dom.pumpsList);
    for (const row of rows) {
      const pid = row.dataset.pid;
      const pump = state.pumps.find(x => x.id === pid);
      const badge = row.querySelector(".status-badge");
      if (!pump || !badge) continue;

      const required = getRequiredFlowForSystem(pump.system) / Math.max(1, num(pump.qty, 1));
      const tdh = num(pump.tdh, 0);

      const op = computeOperatingPoint(pump.modelId, tdh, required);
      if (!op) {
        badge.textContent = "—";
        badge.classList.remove("pass", "close");
      } else {
        badge.textContent = op.pass ? "PASS" : "CLOSE";
        badge.classList.toggle("pass", !!op.pass);
        badge.classList.toggle("close", !op.pass);
      }

      // highlight selected
      row.classList.toggle("selected", state.ui.selectedPumpId === pid);
    }
  }

  /* -----------------------------
     Rendering: Totals + statuses
  ----------------------------- */
  function renderTotals() {
    const poolTurnover = calcPoolTurnoverFlowGpm();
    const wf = calcWaterFeaturesFlowGpm();
    const poolReq = calcPoolRequiredFlowGpm();

    dom.poolTurnoverFlow.textContent = `${fmt(poolTurnover, 1)} GPM`;
    dom.waterFeaturesFlow.textContent = `${fmt(wf, 1)} GPM`;
    dom.poolRequiredFlow.textContent = `${fmt(poolReq, 1)} GPM`;

    const spaJets = calcSpaJetsFlowGpm();
    const spaTurn = calcSpaTurnoverFlowGpm();
    const spaReq = calcSpaRequiredFlowGpm();

    dom.spaJetsFlow.textContent = state.spa.enabled ? `${fmt(spaJets, 1)} GPM` : "—";
    dom.spaTurnoverFlow.textContent = state.spa.enabled ? `${fmt(spaTurn, 1)} GPM` : "—";
    dom.spaRequiredFlow.textContent = state.spa.enabled ? `${fmt(spaReq, 1)} GPM` : "—";

    // Mode pass/calc badges (summary)
    // Pool mode requires poolReq at TDH of pumps that are pool/shared/features etc.
    // We'll mark pool mode PASS if ANY pump assigned to pool/shared/features can satisfy its required flow.
    const poolModePass = systemHasPassingPump("pool") || systemHasPassingPump("features") || systemHasPassingPump("shared");
    dom.poolModeStatus.textContent = poolModePass ? "PASS" : "—";
    dom.poolModeStatus.className = "mode-status " + (poolModePass ? "pass" : "");
    dom.poolModeRequired.textContent = `Required: ${fmt(poolReq, 1)} GPM`;

    const spaModePass = state.spa.enabled ? (systemHasPassingPump("spa") || systemHasPassingPump("shared")) : false;
    dom.spaModeStatus.textContent = state.spa.enabled ? (spaModePass ? "PASS" : "—") : "—";
    dom.spaModeStatus.className = "mode-status " + (spaModePass ? "pass" : "");
    dom.spaModeRequired.textContent = state.spa.enabled ? `Required: ${fmt(spaReq, 1)} GPM @ ${fmt(num(state.spa.spaModeTdh, 0), 1)} ft` : "Required: —";
  }

  function systemHasPassingPump(system) {
    const req = getRequiredFlowForSystem(system);

    // for shared system, target TDH is the pump row TDH, not spaModeTdh.
    for (const p of state.pumps) {
      if (p.system !== system) continue;

      const perPumpReq = req / Math.max(1, num(p.qty, 1));
      const targetTdh = (system === "spa") ? num(state.spa.spaModeTdh, num(p.tdh, 0)) : num(p.tdh, 0);
      const op = computeOperatingPoint(p.modelId, targetTdh, perPumpReq);
      if (op && op.pass) return true;
    }
    return false;
  }

  /* -----------------------------
     Curve viewer (Canvas)
  ----------------------------- */
  function getSelectedPumpForViewer() {
    let pid = state.ui.selectedPumpId;
    if (!pid && state.pumps.length) pid = state.pumps[0].id;
    const p = state.pumps.find(x => x.id === pid) || state.pumps[0] || null;
    return p;
  }

  function drawCurveViewer() {
    const canvas = dom.curveCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize for crispness (devicePixelRatio)
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(300, Math.floor(rect.width * dpr));
    canvas.height = Math.max(200, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background grid (simple)
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    const gridX = 60;
    const gridY = 40;
    for (let x = 0; x <= w; x += gridX) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += gridY) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();

    const selectedPump = getSelectedPumpForViewer();
    if (!selectedPump) return;
    const pumpCurve = getPumpCurve(selectedPump.modelId);
    if (!pumpCurve) return;

    // compute bounds from points
    const allPts = [];
    for (const line of pumpCurve.rpmLines || []) {
      for (const p of line.points || []) allPts.push(p);
    }
    if (allPts.length < 2) return;

    const maxGpm = Math.max(...allPts.map(p => p.gpm));
    const maxTdh = Math.max(...allPts.map(p => p.tdh));
    const minTdh = 0;

    // padding
    const padL = 55, padR = 18, padT = 18, padB = 38;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const xToPx = (x) => padL + (x / (maxGpm || 1)) * plotW;
    const yToPx = (y) => padT + (1 - (y - minTdh) / ((maxTdh - minTdh) || 1)) * plotH;

    // Axes labels
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.9;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Arial";
    ctx.fillText("TDH (ft)", 10, 16);
    ctx.fillText("Flow (GPM)", w / 2 - 30, h - 10);
    ctx.restore();

    // Y ticks
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    const yTicks = 6;
    for (let i = 0; i <= yTicks; i++) {
      const yVal = (maxTdh * i) / yTicks;
      const py = yToPx(yVal);
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(w - padR, py);
      ctx.stroke();

      ctx.globalAlpha = 0.65;
      ctx.fillText(String(Math.round(yVal)), 18, py + 4);
      ctx.globalAlpha = 0.35;
    }
    ctx.restore();

    // X ticks
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 1;
    const xTicks = 6;
    for (let i = 0; i <= xTicks; i++) {
      const xVal = (maxGpm * i) / xTicks;
      const px = xToPx(xVal);
      ctx.beginPath();
      ctx.moveTo(px, padT);
      ctx.lineTo(px, h - padB);
      ctx.stroke();

      ctx.globalAlpha = 0.65;
      ctx.fillText(String(Math.round(xVal)), px - 8, h - 18);
      ctx.globalAlpha = 0.2;
    }
    ctx.restore();

    // Draw RPM curves
    const rpmLines = (pumpCurve.rpmLines || []).slice().sort((a, b) => b.rpm - a.rpm);

    // simple palette
    const palette = ["#4cc3ff", "#ff5a7a", "#ffb34a", "#7cffc4", "#c7a7ff", "#ffd966", "#8bd3ff"];
    rpmLines.forEach((line, i) => {
      const pts = (line.points || []).slice().sort((a, b) => a.gpm - b.gpm);
      if (pts.length < 2) return;

      ctx.save();
      ctx.strokeStyle = palette[i % palette.length];
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.95;

      ctx.beginPath();
      ctx.moveTo(xToPx(pts[0].gpm), yToPx(pts[0].tdh));
      for (let j = 1; j < pts.length; j++) {
        ctx.lineTo(xToPx(pts[j].gpm), yToPx(pts[j].tdh));
      }
      ctx.stroke();

      // label near first third point
      const labelPt = pts[Math.min(2, pts.length - 1)];
      ctx.fillStyle = palette[i % palette.length];
      ctx.font = "11px system-ui, -apple-system, Segoe UI, Arial";
      ctx.fillText(line.label || `${line.rpm} RPM`, xToPx(labelPt.gpm) + 6, yToPx(labelPt.tdh) - 6);

      ctx.restore();
    });

    // Target TDH line (uses selected pump TDH, for spa pump uses spaModeTdh)
    const requiredFlow = getRequiredFlowForSystem(selectedPump.system) / Math.max(1, num(selectedPump.qty, 1));
    const targetTdh = (selectedPump.system === "spa") ? num(state.spa.spaModeTdh, num(selectedPump.tdh, 0)) : num(selectedPump.tdh, 0);

    // horizontal target TDH
    ctx.save();
    ctx.strokeStyle = "#ffd966";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    const yLine = yToPx(targetTdh);
    ctx.beginPath();
    ctx.moveTo(padL, yLine);
    ctx.lineTo(w - padR, yLine);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffd966";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Arial";
    ctx.fillText("Target TDH", padL + 6, yLine - 6);
    ctx.restore();

    // Operating point (best RPM)
    const op = computeOperatingPoint(selectedPump.modelId, targetTdh, requiredFlow);
    if (op) {
      const px = xToPx(op.gpm);
      const py = yToPx(op.tdh);

      ctx.save();
      ctx.fillStyle = op.pass ? "#7cffc4" : "#ffb34a";
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 2;

      // dot
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();

      // label bubble
      const label = `Operating: ${fmt(op.gpm, 1)} GPM @ ${fmt(op.tdh, 1)} ft (${op.label})`;
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Arial";
      const tw = ctx.measureText(label).width;
      const bx = clamp(px + 10, padL, w - padR - tw - 14);
      const by = clamp(py - 26, padT + 8, h - padB - 8);

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      roundRect(ctx, bx - 6, by - 14, tw + 12, 22, 8);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = op.pass ? "#7cffc4" : "#ffb34a";
      ctx.fillText(label, bx, by);

      ctx.restore();
    }

    // Required flow vertical line (optional)
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    const xReq = xToPx(requiredFlow);
    ctx.beginPath();
    ctx.moveTo(xReq, padT);
    ctx.lineTo(xReq, h - padB);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Arial";
    ctx.fillText(`Required Flow: ${fmt(requiredFlow, 1)} GPM`, clamp(xReq - 70, padL, w - padR - 160), padT + 14);
    ctx.restore();

    // Title
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.9;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Arial";
    ctx.fillText(pumpCurve.name, padL, padT + 14);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* -----------------------------
     Curves modal (Editor)
  ----------------------------- */
  function openCurvesModal() {
    state.ui.curvesModalOpen = true;
    dom.curvesModal.style.display = "block";
    buildCurveTabs();
    if (!state.ui.activeCurveTab) {
      state.ui.activeCurveTab = Object.keys(state.curves)[0] || null;
    }
    renderCurveEditor();
  }

  function closeCurvesModal() {
    state.ui.curvesModalOpen = false;
    dom.curvesModal.style.display = "none";
  }

  function buildCurveTabs() {
    dom.curveTabs.innerHTML = "";
    const keys = Object.keys(state.curves);

    keys.forEach((pumpId) => {
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.textContent = state.curves[pumpId]?.name || pumpId;
      btn.classList.toggle("active", state.ui.activeCurveTab === pumpId);
      btn.addEventListener("click", () => {
        state.ui.activeCurveTab = pumpId;
        buildCurveTabs();
        renderCurveEditor();
      });
      dom.curveTabs.appendChild(btn);
    });
  }

  function renderCurveEditor() {
    dom.curveEditor.innerHTML = "";

    const pumpId = state.ui.activeCurveTab;
    if (!pumpId || !state.curves[pumpId]) return;

    const pump = state.curves[pumpId];

    // Header: Add RPM
    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.justifyContent = "flex-end";
    topRow.style.marginBottom = "10px";

    const addBtn = document.createElement("button");
    addBtn.className = "btn";
    addBtn.textContent = "+ Add RPM";
    addBtn.addEventListener("click", () => {
      pump.rpmLines = pump.rpmLines || [];
      pump.rpmLines.push({
        rpm: 3000,
        label: "3000 RPM",
        points: [{ gpm: 0, tdh: 50 }, { gpm: 50, tdh: 30 }, { gpm: 100, tdh: 10 }],
      });
      pump.rpmLines.sort((a, b) => b.rpm - a.rpm);
      renderCurveEditor();
    });

    topRow.appendChild(addBtn);
    dom.curveEditor.appendChild(topRow);

    const container = document.createElement("div");
    container.className = "rpm-lines";

    const lines = (pump.rpmLines || []).slice().sort((a, b) => b.rpm - a.rpm);

    lines.forEach((line, idx) => {
      const block = document.createElement("div");
      block.className = "rpm-block";

      const header = document.createElement("div");
      header.className = "rpm-head";

      const rpmField = document.createElement("div");
      rpmField.className = "field";
      const rpmLabel = document.createElement("label");
      rpmLabel.textContent = "RPM";
      const rpmInput = document.createElement("input");
      rpmInput.type = "number";
      rpmInput.step = "1";
      rpmInput.value = line.rpm ?? 0;
      rpmInput.addEventListener("input", () => {
        line.rpm = Math.max(0, num(rpmInput.value, 0));
      });
      rpmField.appendChild(rpmLabel);
      rpmField.appendChild(rpmInput);

      const labelField = document.createElement("div");
      labelField.className = "field";
      const lbl = document.createElement("label");
      lbl.textContent = "Label";
      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = line.label ?? "";
      labelInput.addEventListener("input", () => {
        line.label = labelInput.value;
      });
      labelField.appendChild(lbl);
      labelField.appendChild(labelInput);

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn btn-icon";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove RPM";
      removeBtn.addEventListener("click", () => {
        pump.rpmLines.splice(idx, 1);
        renderCurveEditor();
      });

      header.appendChild(rpmField);
      header.appendChild(labelField);
      header.appendChild(removeBtn);

      const pointsField = document.createElement("div");
      pointsField.className = "field";
      const ptsLabel = document.createElement("label");
      ptsLabel.textContent = "Points";
      const textarea = document.createElement("textarea");
      textarea.rows = 6;
      textarea.value = pointsToText(line.points || []);
      textarea.addEventListener("input", () => {
        // live parse to keep data updated
        const pts = parsePointsText(textarea.value);
        line.points = pts;
      });

      pointsField.appendChild(ptsLabel);
      pointsField.appendChild(textarea);

      block.appendChild(header);
      block.appendChild(pointsField);

      container.appendChild(block);
    });

    dom.curveEditor.appendChild(container);
  }

  function resetCurvesToDefaults() {
    state.curves = deepClone(DEFAULT_PUMPS);
    saveCurves(state.curves);
    buildCurveTabs();
    renderCurveEditor();
    updateAll();
  }

  function saveCurvesFromEditor() {
    // Ensure rpm lines sorted
    for (const key of Object.keys(state.curves)) {
      const p = state.curves[key];
      p.rpmLines = (p.rpmLines || []).slice().sort((a, b) => b.rpm - a.rpm);
      // ensure points sorted
      for (const line of p.rpmLines) {
        line.points = (line.points || []).slice().sort((a, b) => a.gpm - b.gpm);
      }
    }
    saveCurves(state.curves);
    updateAll();
    closeCurvesModal();
  }

  /* -----------------------------
     JSON Export / Import
  ----------------------------- */
  function exportJSON() {
    const data = {
      state: {
        project: state.project,
        waterFeatures: state.waterFeatures,
        spa: state.spa,
        pumps: state.pumps,
        engineering: state.engineering,
      },
      curves: state.curves,
      version: 1,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pool-pump-tool-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || ""));
        if (obj.curves) {
          state.curves = obj.curves;
          saveCurves(state.curves);
        }
        if (obj.state) {
          if (obj.state.project) Object.assign(state.project, obj.state.project);
          if (Array.isArray(obj.state.waterFeatures)) state.waterFeatures = obj.state.waterFeatures;
          if (obj.state.spa) Object.assign(state.spa, obj.state.spa);
          if (Array.isArray(obj.state.pumps)) state.pumps = obj.state.pumps;
          if (obj.state.engineering) Object.assign(state.engineering, obj.state.engineering);
        }
        updateAll();
      } catch (e) {
        alert("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  }

  /* -----------------------------
     TDH Apply / Estimate
  ----------------------------- */
  function applyEstimatedTDH(tdhValue) {
    const scope = state.engineering.applyTdhTo;

    for (const p of state.pumps) {
      if (scope === "all") p.tdh = tdhValue;
      else if (scope === "shared" && p.system === "shared") p.tdh = tdhValue;
      else if (scope === "pool" && p.system === "pool") p.tdh = tdhValue;
      else if (scope === "features" && p.system === "features") p.tdh = tdhValue;
      else if (scope === "spa" && p.system === "spa") p.tdh = tdhValue;
    }
  }

  function onEstimateTDH() {
    // Use required flow based on selected scope
    const scope = state.engineering.applyTdhTo;

    let flow = 0;
    if (scope === "all") {
      // use max of pool/shared/spa
      const poolReq = calcPoolRequiredFlowGpm();
      const spaReq = state.spa.enabled ? calcSpaRequiredFlowGpm() : 0;
      flow = Math.max(poolReq, spaReq);
    } else {
      flow = getRequiredFlowForSystem(scope);
    }

    const est = estimateTDHForFlow(flow);
    state.engineering.lastEstimated = est;
    const tdh = round(est.tdh, 1);

    applyEstimatedTDH(tdh);
    updateAll();
  }

  function renderTdhSummary() {
    const est = state.engineering.lastEstimated;
    if (!est) {
      dom.tdhSummary.textContent = "TDH: —";
      return;
    }
    dom.tdhSummary.textContent = `TDH: ${fmt(est.tdh, 1)} ft (friction ${fmt(est.friction, 1)} ft, L=${fmt(est.L, 0)} ft)`;
  }

  /* -----------------------------
     Wiring inputs
  ----------------------------- */
  function bindEvents() {
    // Project
    dom.clientName.addEventListener("input", () => { state.project.clientName = dom.clientName.value; persistState(); });
    dom.cityState.addEventListener("input", () => { state.project.cityState = dom.cityState.value; persistState(); });
    dom.poolVolume.addEventListener("input", () => { state.project.poolVolume = num(dom.poolVolume.value, 0); updateAll(); });
    dom.poolTurnoverHours.addEventListener("change", () => { state.project.poolTurnoverHours = num(dom.poolTurnoverHours.value, 6); updateAll(); });

    // Water features
    dom.addWaterFeatureBtn.addEventListener("click", addWaterFeatureRow);

    // Spa
    dom.spaModeToggle.addEventListener("change", () => {
      state.spa.enabled = !!dom.spaModeToggle.checked;
      updateAll();
    });
    dom.spaPumpSetup.addEventListener("change", () => { state.spa.setup = dom.spaPumpSetup.value; updateAll(); });
    dom.spaVolume.addEventListener("input", () => { state.spa.spaVolume = num(dom.spaVolume.value, 0); updateAll(); });
    dom.spaTurnoverHours.addEventListener("input", () => { state.spa.spaTurnoverHours = num(dom.spaTurnoverHours.value, 0); updateAll(); });
    dom.spaJetsQty.addEventListener("input", () => { state.spa.spaJetsQty = num(dom.spaJetsQty.value, 0); updateAll(); });
    dom.gpmPerJet.addEventListener("input", () => { state.spa.gpmPerJet = num(dom.gpmPerJet.value, 0); updateAll(); });
    dom.spaModeTdh.addEventListener("input", () => { state.spa.spaModeTdh = num(dom.spaModeTdh.value, 0); updateAll(); });

    // Pumps
    dom.addPumpBtn.addEventListener("click", addPumpRow);

    // Curves
    dom.editCurvesBtn.addEventListener("click", openCurvesModal);
    dom.closeCurvesBtn.addEventListener("click", closeCurvesModal);
    dom.saveCurvesBtn.addEventListener("click", saveCurvesFromEditor);
    dom.resetCurvesBtn.addEventListener("click", resetCurvesToDefaults);

    dom.curvesModal.addEventListener("click", (e) => {
      if (e.target === dom.curvesModal) closeCurvesModal();
    });

    // Engineering
    dom.equipDistance.addEventListener("input", () => { state.engineering.equipDistance = num(dom.equipDistance.value, 0); persistState(); });
    dom.extraFittings.addEventListener("input", () => { state.engineering.extraFittings = num(dom.extraFittings.value, 0); persistState(); });
    dom.pipeSize.addEventListener("change", () => { state.engineering.pipeSize = num(dom.pipeSize.value, 2.5); persistState(); });
    dom.elevation.addEventListener("input", () => { state.engineering.elevation = num(dom.elevation.value, 0); persistState(); });
    dom.equipmentHead.addEventListener("input", () => { state.engineering.equipmentHead = num(dom.equipmentHead.value, 0); persistState(); });
    dom.hazenC.addEventListener("input", () => { state.engineering.hazenC = num(dom.hazenC.value, 140); persistState(); });
    dom.applyTdhTo.addEventListener("change", () => { state.engineering.applyTdhTo = dom.applyTdhTo.value; persistState(); });
    dom.estimateTdhBtn.addEventListener("click", onEstimateTDH);

    // Export/Import/Print
    dom.exportJsonBtn.addEventListener("click", exportJSON);
    dom.importJsonFile.addEventListener("change", () => {
      const f = dom.importJsonFile.files && dom.importJsonFile.files[0];
      if (f) importJSON(f);
      dom.importJsonFile.value = "";
    });
    dom.printBtn.addEventListener("click", () => window.print());

    // Re-draw curve on resize
    window.addEventListener("resize", () => {
      drawCurveViewer();
    });
  }

  /* -----------------------------
     Sync inputs from state
  ----------------------------- */
  function syncInputsFromState() {
    dom.clientName.value = state.project.clientName || "";
    dom.cityState.value = state.project.cityState || "";
    dom.poolVolume.value = state.project.poolVolume || "";
    dom.poolTurnoverHours.value = String(state.project.poolTurnoverHours || 6);

    dom.spaModeToggle.checked = !!state.spa.enabled;
    dom.spaPumpSetup.value = state.spa.setup || "shared";
    dom.spaVolume.value = state.spa.spaVolume || "";
    dom.spaTurnoverHours.value = state.spa.spaTurnoverHours || "";
    dom.spaJetsQty.value = state.spa.spaJetsQty || "";
    dom.gpmPerJet.value = state.spa.gpmPerJet || "";
    dom.spaModeTdh.value = state.spa.spaModeTdh ?? 50;

    dom.equipDistance.value = state.engineering.equipDistance || "";
    dom.extraFittings.value = state.engineering.extraFittings ?? 60;
    dom.pipeSize.value = String(state.engineering.pipeSize ?? 2.5);
    dom.elevation.value = state.engineering.elevation || "";
    dom.equipmentHead.value = state.engineering.equipmentHead ?? 10;
    dom.hazenC.value = state.engineering.hazenC ?? 140;
    dom.applyTdhTo.value = state.engineering.applyTdhTo ?? "shared";
  }

  /* -----------------------------
     Main update
  ----------------------------- */
  function updateAll() {
    // Ensure selected pump exists
    if (!state.ui.selectedPumpId && state.pumps.length) {
      state.ui.selectedPumpId = state.pumps[0].id;
    }
    if (state.ui.selectedPumpId && !state.pumps.some(p => p.id === state.ui.selectedPumpId)) {
      state.ui.selectedPumpId = state.pumps[0]?.id || null;
    }

    renderWaterFeatures();
    renderPumpRows();
    renderTotals();
    renderTdhSummary();
    drawCurveViewer();
    persistState();
  }

  /* -----------------------------
     Init
  ----------------------------- */
  function init() {
    bindDom();
    loadState();
    syncInputsFromState();

    // If water features empty, add one placeholder row? (optional)
    // We'll keep empty unless user adds.

    // If selected pump not set
    if (!state.ui.selectedPumpId && state.pumps.length) {
      state.ui.selectedPumpId = state.pumps[0].id;
    }
    if (!state.ui.activeCurveTab) {
      state.ui.activeCurveTab = Object.keys(state.curves)[0] || null;
    }

    bindEvents();
    updateAll();
  }

  // start
  document.addEventListener("DOMContentLoaded", init);
})();
