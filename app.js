const $ = (id) => document.getElementById(id);

const PUMPS = [
  { id: "jandy_vs_27",  name: "Jandy VS FloPro 2.7 HP" },
  { id: "jandy_vs_185", name: "Jandy VS FloPro 1.85 HP" },
  { id: "jandy_fhpm_10",name: "Jandy FloPro FHPM 1.0 HP" },
  { id: "jandy_vs_38",  name: "Jandy VS FloPro 3.8 HP" }
];

const state = {
  wf: [],
  pumps: [],
  curves: defaults(),
  selPump: null,
  modalPump: "jandy_vs_27",
  lastEval: {},
  autoTdhLast: null
};

function defaults() {
  // Placeholder curves (Edit Curves to paste manufacturer points)
  return {
    jandy_vs_27: [
      { rpm: 3450, label: "3450 RPM", pts: [[0,95],[30,92],[60,86],[90,75],[120,55],[135,44]] },
      { rpm: 3000, label: "3000 RPM", pts: [[0,75],[30,71],[60,63],[90,50],[120,33]] }
    ],
    jandy_vs_185: [
      { rpm: 3450, label: "3450 RPM", pts: [[0,77],[30,75],[60,70],[90,57],[110,40],[120,33]] },
      { rpm: 3000, label: "3000 RPM", pts: [[0,58],[30,55],[60,49],[90,36],[105,25]] }
    ],
    jandy_fhpm_10: [
      { rpm: 3450, label: "High", pts: [[0,57],[30,52],[60,40],[80,25]] }
    ],
    jandy_vs_38: [
      { rpm: 3450, label: "3450 RPM", pts: [[0,103],[40,99],[80,92],[120,78],[160,50],[185,38]] },
      { rpm: 3000, label: "3000 RPM", pts: [[0,77],[40,73],[80,66],[120,50],[165,22]] }
    ]
  };
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(v) {
  return (Math.round(v * 10) / 10).toFixed(1);
}

/* -------------------- CURVE KEY NORMALIZATION -------------------- */
/**
 * If curves were stored using long names as keys (e.g. "Jandy VS FloPro 2.7 HP"),
 * convert them to pump IDs (e.g. "jandy_vs_27") so the app can find them.
 */
function normalizeCurvesKeys(curvesObj) {
  if (!curvesObj || typeof curvesObj !== "object") return curvesObj;

  const nameToId = {};
  PUMPS.forEach(p => { nameToId[p.name] = p.id; });

  const out = { ...curvesObj };

  Object.keys(curvesObj).forEach(key => {
    if (nameToId[key] && !out[nameToId[key]]) {
      out[nameToId[key]] = curvesObj[key];
      delete out[key];
    }
  });

  return out;
}

// Always keep curves normalized
state.curves = normalizeCurvesKeys(state.curves);

/* -------------------- FLOWS -------------------- */
function poolTurnoverHours() {
  const p = $("turnoverPreset").value;
  if (p === "custom") {
    const c = num($("turnoverCustom").value);
    return c > 0 ? c : 8;
  }
  return num(p) || 8;
}

function poolTurnoverGpm() {
  const vol = num($("poolVolume").value);
  if (vol <= 0) return 0;
  return vol / (poolTurnoverHours() * 60);
}

function wfGpm() {
  return state.wf.reduce((s, r) => s + num(r.qty) * num(r.w) * num(r.k), 0);
}

function poolModeRequiredGpm() {
  // Pool mode (Spa OFF): turnover + water features
  return poolTurnoverGpm() + wfGpm();
}

function spaJetsGpm() {
  return num($("spaJets").value) * num($("gpmPerJet").value);
}

function spaTurnoverGpm() {
  const v = num($("spaVolume").value);
  const h = num($("spaTurnover").value);
  if (v > 0 && h > 0) return v / (h * 60);
  return 0;
}

function spaModeRequiredGpm() {
  // Spa Only when Spa Mode ON
  return Math.max(spaJetsGpm(), spaTurnoverGpm());
}

/* -------------------- WATER FEATURES UI -------------------- */
function renderWF() {
  const body = $("wfBody");
  body.innerHTML = "";

  state.wf.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "tr";
    row.innerHTML = `
      <select data-i="${i}" data-k="type">
        ${["Sheer","Scupper","Rain Curtain","Bubbler","Deck Jet","Other"]
          .map(t => `<option ${t===r.type?"selected":""}>${t}</option>`).join("")}
      </select>
      <div class="r"><input data-i="${i}" data-k="qty" type="number" min="0" step="1" value="${r.qty}"></div>
      <div class="r"><input data-i="${i}" data-k="w" type="number" min="0" step="0.1" value="${r.w}"></div>
      <div class="r"><input data-i="${i}" data-k="k" type="number" min="0" step="0.5" value="${r.k}"></div>
      <div class="r"><b>${fmt(num(r.qty)*num(r.w)*num(r.k))}</b></div>
      <button class="x" data-del="${i}">✕</button>
    `;
    body.appendChild(row);
  });

  body.querySelectorAll("input,select").forEach(el => {
    const upd = () => {
      const i = parseInt(el.dataset.i, 10);
      const k = el.dataset.k;

      if (k === "type") {
        state.wf[i].type = el.value;
        // soft defaults (editable)
        if (el.value === "Sheer") state.wf[i].k = 15;
        if (el.value === "Scupper") state.wf[i].k = 10;
        if (el.value === "Rain Curtain") state.wf[i].k = 12;
        if (el.value === "Bubbler") state.wf[i].k = 12;
        if (el.value === "Deck Jet") state.wf[i].k = 8;
      } else {
        state.wf[i][k] = num(el.value);
      }

      renderWF();
      recalc();
    };

    el.addEventListener("change", upd);
    el.addEventListener("input", upd);
  });

  body.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    state.wf.splice(parseInt(b.dataset.del, 10), 1);
    renderWF();
    recalc();
  }));
}

/* -------------------- PUMPS UI -------------------- */
function renderPumps() {
  const body = $("pumpBody");
  body.innerHTML = "";

  state.pumps.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "tr pumps";
    row.innerHTML = `
      <select data-i="${i}" data-k="model">
        ${PUMPS.map(m => `<option value="${m.id}" ${m.id===p.model?"selected":""}>${m.name}</option>`).join("")}
      </select>

      <div class="r"><input data-i="${i}" data-k="qty" type="number" min="1" step="1" value="${p.qty}"></div>

      <select data-i="${i}" data-k="sys">
        ${[
          "Pool",
          "Water Features",
          "Spa",
          "Shared (Pool + Water)",
          "Shared (Pool + Spa)",
          "Shared (All)"
        ].map(s => `<option ${s===p.sys?"selected":""}>${s}</option>`).join("")}
      </select>

      <div class="r"><input data-i="${i}" data-k="tdh" type="number" min="0" step="0.5" value="${p.tdh}"></div>

      <div class="r"><span id="status_${p.id}" class="badge mid">—</span></div>

      <button class="x" data-del="${i}">✕</button>
    `;

    row.addEventListener("click", () => {
      state.selPump = p.id;
      updateChart();
    });

    body.appendChild(row);
  });

  body.querySelectorAll("input,select").forEach(el => {
    const upd = () => {
      const i = parseInt(el.dataset.i, 10);
      const k = el.dataset.k;
      state.pumps[i][k] = (k === "model" || k === "sys") ? el.value : num(el.value);
      recalc();
    };
    el.addEventListener("input", upd);
    el.addEventListener("change", upd);
  });

  body.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    state.pumps.splice(parseInt(b.dataset.del, 10), 1);
    if (state.pumps.length === 0) state.selPump = null;
    renderPumps();
    recalc();
  }));
}

/* -------------------- CURVE MATH -------------------- */
function interp(pts, x) {
  const p = pts.slice().sort((a, b) => a[0] - b[0]);
  if (p.length === 0) return null;

  if (x <= p[0][0]) return p[0][1];
  if (x >= p[p.length - 1][0]) return p[p.length - 1][1];

  for (let i = 0; i < p.length - 1; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    if (x >= x1 && x <= x2) {
      const t = (x - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return null;
}

function curveRange(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0]);
  if (p.length === 0) return { min: 0, max: 0 };
  return { min: p[0][0], max: p[p.length - 1][0] };
}

function chooseLine(model, flow, tdh) {
  const lines = state.curves[model] || [];
  let best = null;

  for (const L of lines) {
    const h = interp(L.pts, flow);
    if (h == null) continue;
    const s = Math.abs(h - tdh);
    if (!best || s < best.s) best = { ...L, h, s, range: curveRange(L.pts) };
  }
  return best;
}

/* -------------------- REQUIRED FLOW PER SYSTEM -------------------- */
function requiredForSystem(sys) {
  const poolReq = poolModeRequiredGpm(); // turnover + features
  const wfReq = wfGpm();
  const spaReq = spaModeRequiredGpm();

  const spaOn = $("spaMode").checked;

  if (sys === "Pool") return poolReq;
  if (sys === "Water Features") return wfReq;
  if (sys === "Spa") return spaReq;

  if (sys === "Shared (Pool + Water)") return poolReq;
  if (sys === "Shared (Pool + Spa)") return spaOn ? spaReq : poolReq;
  if (sys === "Shared (All)") return spaOn ? Math.max(poolReq, spaReq) : poolReq;

  return poolReq;
}

/* -------------------- PASS/FAIL EVALUATION -------------------- */
function evalPump(p) {
  const req = requiredForSystem(p.sys);
  const perPumpFlow = req / Math.max(1, num(p.qty));
  const tdh = num(p.tdh);

  const best = chooseLine(p.model, perPumpFlow, tdh);
  if (!best) return { status: "NO CURVE", cls: "mid", best: null, perPumpFlow, tdh, req };

  // PASS if curve head >= required TDH at required flow, and flow in curve range
  const within = perPumpFlow >= best.range.min && perPumpFlow <= best.range.max;
  const headOk = best.h >= tdh;

  let status = "FAIL", cls = "bad";
  if (within && headOk) { status = "PASS"; cls = "ok"; }
  else if (within && best.h >= (tdh * 0.9)) { status = "CLOSE"; cls = "mid"; }

  return { status, cls, best, perPumpFlow, tdh, req };
}

function setBadge(el, status) {
  el.classList.remove("ok", "bad", "mid");
  if (status === "PASS") el.classList.add("ok");
  else if (status === "FAIL") el.classList.add("bad");
  else el.classList.add("mid");
  el.textContent = status;
}

function modeStatusPool() {
  const relevant = state.pumps.filter(p =>
    ["Pool", "Water Features", "Shared (Pool + Water)", "Shared (All)"].includes(p.sys)
  );
  if (relevant.length === 0) return "—";

  const anyFail = relevant.some(p => (state.lastEval[p.id]?.status === "FAIL"));
  const anyPass = relevant.some(p => (state.lastEval[p.id]?.status === "PASS"));

  if (anyFail) return "FAIL";
  if (anyPass) return "PASS";
  return "CLOSE";
}

function modeStatusSpa() {
  const spaOn = $("spaMode").checked;
  if (!spaOn) return "—";

  const setup = $("spaSetup").value; // shared/dedicated
  let relevant = [];

  if (setup === "dedicated") {
    relevant = state.pumps.filter(p => p.sys === "Spa");
  } else {
    relevant = state.pumps.filter(p => ["Pool","Shared (Pool + Spa)","Shared (All)"].includes(p.sys));
  }

  if (relevant.length === 0) return "FAIL";

  const anyFail = relevant.some(p => (state.lastEval[p.id]?.status === "FAIL"));
  const anyPass = relevant.some(p => (state.lastEval[p.id]?.status === "PASS"));

  if (anyFail && !anyPass) return "FAIL";
  if (anyPass) return "PASS";
  return "CLOSE";
}

/* -------------------- AUTO TDH (Shared pumps default) -------------------- */
function computeAutoTdh() {
  const dist = num($("equipDistance")?.value);
  const fittings = num($("fittingsEq")?.value);
  const d = num($("pipeSize")?.value);
  const C = num($("cHw")?.value) || 140;
  const elev = num($("elev")?.value);
  const equip = num($("equipHead")?.value);

  // Require minimums
  if (dist <= 0 || d <= 0) return null;

  const L = Math.max(0, dist * 2 + fittings); // round trip + fittings
  const Q = Math.max(0.01, poolModeRequiredGpm()); // baseline demand
  const hf = 4.52 * L * Math.pow(Q, 1.85) / (Math.pow(C, 1.85) * Math.pow(d, 4.87));
  const tdh = hf + elev + equip;

  if (!Number.isFinite(tdh) || tdh <= 0) return null;
  return { tdh, hf, L };
}

function applyAutoTdhIfNeeded() {
  const calc = computeAutoTdh();
  if (!calc) {
    $("tdhOut").textContent = "TDH: — (enter distance + pipe size)";
    state.autoTdhLast = null;
    return;
  }

  state.autoTdhLast = calc.tdh;
  $("tdhOut").textContent = `TDH: ${fmt(calc.tdh)} ft (Auto, L=${fmt(calc.L)} ft)`;

  // User chose Apply TDH to (default should be Shared pumps)
  const ap = $("applyTo")?.value || "shared";

  state.pumps.forEach(p => {
    if (ap === "all") p.tdh = calc.tdh;
    else if (ap === "pool" && p.sys === "Pool") p.tdh = calc.tdh;
    else if (ap === "water" && p.sys === "Water Features") p.tdh = calc.tdh;
    else if (ap === "spa" && p.sys === "Spa") p.tdh = calc.tdh;
    else if (ap === "shared" && p.sys.startsWith("Shared")) p.tdh = calc.tdh;
  });
}

/* -------------------- MAIN RECALC -------------------- */
function recalc() {
  // Normalize curves keys always (safe)
  state.curves = normalizeCurvesKeys(state.curves);

  // Apply Auto TDH (no button needed)
  if ($("equipDistance")) {
    applyAutoTdhIfNeeded();
  }

  // Compute flows
  const tg = poolTurnoverGpm();
  const wg = wfGpm();
  const poolReq = poolModeRequiredGpm();

  $("turnoverGpm").textContent = fmt(tg) + " GPM";
  $("wfGpm").textContent = fmt(wg) + " GPM";
  $("poolModeGpm").textContent = fmt(poolReq) + " GPM";

  // Spa numbers
  $("spaJetsGpm").textContent = fmt(spaJetsGpm()) + " GPM";
  $("spaTurnoverGpm").textContent = fmt(spaTurnoverGpm()) + " GPM";
  $("spaModeGpm").textContent = fmt(spaModeRequiredGpm()) + " GPM";

  // Evaluate each pump and paint its badge
  state.lastEval = {};
  state.pumps.forEach(p => {
    const ev = evalPump(p);
    state.lastEval[p.id] = ev;

    const s = $("status_" + p.id);
    if (s) {
      s.classList.remove("ok", "bad", "mid");
      s.classList.add(ev.cls);
      s.textContent = ev.status;
      const line = `Req ${fmt(ev.req)} GPM @ ${fmt(ev.tdh)} ft | Per pump ${fmt(ev.perPumpFlow)} GPM`;
      const curve = ev.best ? `${Math.round(ev.best.rpm)} RPM → ${fmt(ev.best.h)} ft` : "No curve";
      s.title = line + " | " + curve;
    }
  });

  // Mode badges
  $("poolModeLine").textContent = `Required: ${fmt(poolReq)} GPM`;
  const pb = $("poolModeBadge");
  const poolStatus = modeStatusPool();
  if (poolStatus === "—") { pb.textContent = "—"; pb.classList.remove("ok","bad","mid"); pb.classList.add("mid"); }
  else setBadge(pb, poolStatus);

  const spaOn = $("spaMode").checked;
  const spaReq = spaModeRequiredGpm();
  $("spaModeLine").textContent = spaOn ? `Required: ${fmt(spaReq)} GPM @ ${fmt(num($("spaTdh").value))} ft` : "Required: —";
  const sb = $("spaModeBadge");
  const spaStatus = modeStatusSpa();
  if (spaStatus === "—") { sb.textContent = "—"; sb.classList.remove("ok","bad","mid"); sb.classList.add("mid"); }
  else setBadge(sb, spaStatus);

  // Ensure a selected pump for chart
  if (!state.selPump && state.pumps.length) state.selPump = state.pumps[0].id;

  updateChart();
}

/* -------------------- CHART -------------------- */
let chart;
function initChart() {
  chart = new Chart($("curveChart"), {
    type: "line",
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#eaf0ff" } } },
      scales: {
        x: { title: { display: true, text: "Flow (GPM)", color: "#eaf0ff" }, ticks: { color: "#c9d4ff" }, grid: { color: "rgba(255,255,255,.08)" } },
        y: { title: { display: true, text: "TDH (ft)", color: "#eaf0ff" }, ticks: { color: "#c9d4ff" }, grid: { color: "rgba(255,255,255,.08)" } }
      }
    }
  });
}

function updateChart() {
  // normalize curves always
  state.curves = normalizeCurvesKeys(state.curves);

  const pump = state.pumps.find(x => x.id === state.selPump) || state.pumps[0];
  if (!pump) { chart.data.datasets = []; chart.update(); return; }

  const ev = state.lastEval[pump.id] || evalPump(pump);
  const lines = state.curves[pump.model] || [];

  // If no curve data, show empty with quick hint
  if (!lines.length) {
    chart.data.datasets = [];
    chart.update();
    return;
  }

  const ds = lines.map(L => ({
    label: L.label,
    data: (L.pts || []).map(([x, y]) => ({ x, y })),
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.25
  }));

  // Operating point (required flow) on best line
  if (ev.best) {
    ds.push({
      label: "Operating Point",
      data: [{ x: ev.perPumpFlow, y: ev.best.h }],
      showLine: false,
      pointRadius: 6
    });

    ds.push({
      label: "Target TDH",
      data: [{ x: 0, y: ev.tdh }, { x: Math.max(10, ev.perPumpFlow * 1.6), y: ev.tdh }],
      borderDash: [6, 6],
      pointRadius: 0
    });
  }

  chart.data.datasets = ds;
  chart.update();
}

/* -------------------- CURVES MODAL -------------------- */
function openModal() {
  $("curvesModal").setAttribute("aria-hidden", "false");
  renderTabs();
  renderLines();
}
function closeModal() {
  $("curvesModal").setAttribute("aria-hidden", "true");
}

function renderTabs() {
  const w = $("curveTabs");
  w.innerHTML = "";
  PUMPS.forEach(p => {
    const b = document.createElement("button");
    b.className = "tab" + (p.id === state.modalPump ? " active" : "");
    b.textContent = p.name;
    b.onclick = () => { state.modalPump = p.id; renderTabs(); renderLines(); };
    w.appendChild(b);
  });
}

function parsePts(t) {
  const pts = [];
  t.split(/\r?\n/).forEach(s => {
    s = s.trim();
    if (!s) return;
    const a = s.split(",").map(x => x.trim());
    if (a.length < 2) return;
    const x = num(a[0]), y = num(a[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
  });
  pts.sort((a, b) => a[0] - b[0]);
  return pts;
}

function renderLines() {
  const w = $("curveLines");
  w.innerHTML = "";
  const lines = state.curves[state.modalPump] || [];

  lines.forEach((L, i) => {
    const div = document.createElement("div");
    div.className = "line";
    div.innerHTML = `
      <div>
        <label>RPM<input data-rpm="${i}" type="number" value="${L.rpm}"></label>
        <label>Label<input data-lbl="${i}" value="${L.label || ""}"></label>
      </div>
      <div>
        <label>Points<textarea data-pts="${i}" rows="5" spellcheck="false">${(L.pts||[]).map(p=>p.join(",")).join("\n")}</textarea></label>
      </div>
      <button class="x" data-del="${i}">✕</button>
    `;
    w.appendChild(div);
  });

  w.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    const i = parseInt(b.dataset.del, 10);
    (state.curves[state.modalPump] || []).splice(i, 1);
    renderLines();
  });

  // live update
  w.querySelectorAll("input,textarea").forEach(() => {
    const lines = state.curves[state.modalPump] || [];
    w.querySelectorAll("[data-rpm]").forEach(inp => {
      const i = parseInt(inp.dataset.rpm, 10);
      if (lines[i]) lines[i].rpm = num(inp.value);
    });
    w.querySelectorAll("[data-lbl]").forEach(inp => {
      const i = parseInt(inp.dataset.lbl, 10);
      if (lines[i]) lines[i].label = inp.value;
    });
    w.querySelectorAll("[data-pts]").forEach(ta => {
      const i = parseInt(ta.dataset.pts, 10);
      if (lines[i]) lines[i].pts = parsePts(ta.value);
    });
  });
}

/* -------------------- EXPORT / IMPORT -------------------- */
function exportJson() {
  const data = {
    project: {
      clientName: $("clientName").value,
      location: $("location").value,
      poolVolume: num($("poolVolume").value),
      turnoverPreset: $("turnoverPreset").value,
      turnoverCustom: $("turnoverCustom").value
    },
    spa: {
      spaMode: $("spaMode").checked,
      spaSetup: $("spaSetup").value,
      spaVolume: num($("spaVolume").value),
      spaTurnover: num($("spaTurnover").value),
      spaJets: num($("spaJets").value),
      gpmPerJet: num($("gpmPerJet").value),
      spaTdh: num($("spaTdh").value)
    },
    wf: state.wf,
    pumps: state.pumps,
    curves: state.curves,
    eng: {
      equipDistance: num($("equipDistance")?.value),
      fittingsEq: num($("fittingsEq")?.value),
      pipeSize: $("pipeSize")?.value,
      elev: num($("elev")?.value),
      equipHead: num($("equipHead")?.value),
      cHw: num($("cHw")?.value),
      applyTo: $("applyTo")?.value
    }
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pool-pump-tool.json";
  a.click();
}

function importJson(ev) {
  const f = ev.target.files?.[0];
  if (!f) return;

  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);

      if (d.project) {
        $("clientName").value = d.project.clientName || "";
        $("location").value = d.project.location || "";
        $("poolVolume").value = d.project.poolVolume ?? "";
        $("turnoverPreset").value = d.project.turnoverPreset || "8";
        $("turnoverCustom").value = d.project.turnoverCustom || "";
        $("turnoverCustom").disabled = $("turnoverPreset").value !== "custom";
      }

      if (d.spa) {
        $("spaMode").checked = !!d.spa.spaMode;
        $("spaSetup").value = d.spa.spaSetup || "shared";
        $("spaVolume").value = d.spa.spaVolume ?? "";
        $("spaTurnover").value = d.spa.spaTurnover ?? "";
        $("spaJets").value = d.spa.spaJets ?? 0;
        $("gpmPerJet").value = d.spa.gpmPerJet ?? 12;
        $("spaTdh").value = d.spa.spaTdh ?? 50;
      }

      state.wf = Array.isArray(d.wf) ? d.wf : state.wf;
      state.pumps = Array.isArray(d.pumps) ? d.pumps : state.pumps;

      state.curves = normalizeCurvesKeys(d.curves) || state.curves;

      if (d.eng) {
        if ($("equipDistance")) $("equipDistance").value = d.eng.equipDistance ?? "";
        if ($("fittingsEq")) $("fittingsEq").value = d.eng.fittingsEq ?? 60;
        if ($("pipeSize")) $("pipeSize").value = d.eng.pipeSize || "2.5";
        if ($("elev")) $("elev").value = d.eng.elev ?? "";
        if ($("equipHead")) $("equipHead").value = d.eng.equipHead ?? 10;
        if ($("cHw")) $("cHw").value = d.eng.cHw ?? 140;
        if ($("applyTo")) $("applyTo").value = d.eng.applyTo || "shared";
      }

      renderWF();
      renderPumps();

      if (!state.selPump && state.pumps.length) state.selPump = state.pumps[0].id;

      recalc();
      updateChart();
    } catch {
      alert("Invalid JSON file");
    }
  };
  r.readAsText(f);
}

/* -------------------- HOOKS / INIT -------------------- */
$("turnoverPreset").onchange = () => {
  const c = $("turnoverCustom");
  c.disabled = $("turnoverPreset").value !== "custom";
  if (c.disabled) c.value = "";
  recalc();
};

["clientName","location","poolVolume","turnoverCustom"].forEach(id => $(id).oninput = recalc);

$("addWF").onclick = () => {
  state.wf.push({ type: "Sheer", qty: 1, w: 2, k: 15 });
  renderWF();
  recalc();
};

$("addPump").onclick = () => {
  const p = {
    id: "P" + String(state.pumps.length + 1).padStart(2, "0"),
    model: "jandy_vs_27",
    qty: 1,
    sys: "Shared (Pool + Water)",
    tdh: 50
  };
  state.pumps.push(p);
  if (!state.selPump) state.selPump = p.id;
  renderPumps();
  recalc();
  updateChart();
};

["spaMode","spaSetup","spaVolume","spaTurnover","spaJets","gpmPerJet","spaTdh"].forEach(id => $(id).oninput = recalc);
$("spaMode").onchange = recalc;
$("spaSetup").onchange = recalc;

$("btnEditCurves").onclick = openModal;
$("btnCloseCurves").onclick = closeModal;
$("btnSaveCurves").onclick = () => { closeModal(); recalc(); };
$("btnResetCurves").onclick = () => {
  state.curves = normalizeCurvesKeys(defaults());
  renderTabs(); renderLines(); recalc();
};
$("btnAddCurveLine").onclick = () => {
  (state.curves[state.modalPump] ??= []).push({ rpm: 3000, label: "RPM", pts: [[0,50],[50,40],[100,25]] });
  renderLines();
};

$("btnExport").onclick = exportJson;
$("fileImport").onchange = importJson;
$("btnPrint").onclick = () => window.print();

// Auto TDH: re-run when engineering inputs change
["equipDistance","fittingsEq","pipeSize","elev","equipHead","cHw","applyTo"].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("input", recalc);
  el.addEventListener("change", recalc);
});

initChart();
$("addWF").click();
$("addPump").click();
