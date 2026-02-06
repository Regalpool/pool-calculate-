/* ============================================================
   Pool Pump Sizing Tool - app.js (Curve drawing FIX)
   - Fixes curve parsing: supports lines like "0,95" (GPM,TDH)
   - Draws curves on <canvas id="curveCanvas">
   - Draws Target TDH line & Operating point
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

  function toNum(x, fallback = 0) {
    if (typeof x === "number" && Number.isFinite(x)) return x;
    if (typeof x !== "string") return fallback;

    // allow comma decimal like 10,5 -> 10.5
    const s = x.trim().replace(/\u00A0/g, " ").replace(/,/g, (m, idx, str) => {
      // IMPORTANT: we cannot blindly replace all commas to dots,
      // because points are "GPM,TDH".
      // This function is used for single numbers only; safe to replace comma-decimal to dot.
      // But if string contains multiple numbers separated by comma, caller shouldn't use toNum.
      return ".";
    });

    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * Parse points text (one per line)
   * Accepts:
   *  - "0,95"
   *  - "0 , 95"
   *  - "0 95"
   *  - "0;95"
   *  - "0\t95"
   */
  function parsePointsText(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const pts = [];

    for (const line of lines) {
      // remove extra spaces
      const clean = line.replace(/\u00A0/g, " ").trim();

      // Detect separator:
      // If contains comma -> treat as pair separator (NOT decimal)
      // Else split on whitespace or semicolon
      let a, b;

      if (clean.includes(",")) {
        const parts = clean.split(",").map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          a = parts[0];
          b = parts[1];
        } else {
          continue;
        }
      } else if (clean.includes(";")) {
        const parts = clean.split(";").map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          a = parts[0];
          b = parts[1];
        } else {
          continue;
        }
      } else {
        const parts = clean.split(/\s+/).map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          a = parts[0];
          b = parts[1];
        } else {
          continue;
        }
      }

      // Now a and b should be single numbers; allow comma-decimal inside them
      const gpm = Number(String(a).replace(",", "."));
      const tdh = Number(String(b).replace(",", "."));

      if (Number.isFinite(gpm) && Number.isFinite(tdh)) {
        pts.push({ gpm, tdh });
      }
    }

    // sort by GPM asc
    pts.sort((p1, p2) => p1.gpm - p2.gpm);
    return pts;
  }

  /**
   * Linear interpolation along a curve:
   * Given TDH target, returns GPM at that TDH (approx) by scanning segments.
   * Assumes curve is decreasing in TDH as GPM increases (typical pump curve).
   */
  function gpmAtTDH(points, targetTDH) {
    if (!points || points.length < 2) return null;

    // Find segment where TDH crosses target
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      const t1 = p1.tdh;
      const t2 = p2.tdh;

      const minT = Math.min(t1, t2);
      const maxT = Math.max(t1, t2);

      if (targetTDH >= minT && targetTDH <= maxT) {
        // interpolate between p1 and p2
        const dt = (t2 - t1);
        if (dt === 0) return p1.gpm;
        const r = (targetTDH - t1) / dt; // 0..1
        const g = p1.gpm + r * (p2.gpm - p1.gpm);
        return g;
      }
    }

    return null; // out of range
  }

  /* -----------------------------
     Default Curves (editable)
     NOTE: You can replace these with your exact points.
  ----------------------------- */

  const DEFAULT_CURVES = {
    "jandy-vsflo-pro-2.7": {
      label: "Jandy VS FloPro 2.7 HP",
      lines: [
        {
          rpm: 3450,
          label: "3450 RPM",
          // Sample points; you can paste exact from datasheet
          pointsText: `0,95
30,92
60,86
90,75
120,55
135,44`
        },
        {
          rpm: 3000,
          label: "3000 RPM",
          pointsText: `0,75
30,71
60,63
90,50
120,33`
        }
      ]
    },
    "jandy-vsflo-pro-1.85": {
      label: "Jandy VS FloPro 1.85 HP",
      lines: [
        {
          rpm: 3450,
          label: "3450 RPM",
          pointsText: `0,78
30,76
60,70
90,58
120,33`
        },
        {
          rpm: 3000,
          label: "3000 RPM",
          pointsText: `0,58
30,56
60,50
90,38
105,25`
        }
      ]
    },
    "jandy-fhpm-1.0": {
      label: "Jandy FloPro FHPM 1.0 HP",
      lines: [
        {
          rpm: 3450,
          label: "FHPM 1.0 (Hi)",
          pointsText: `0,57
20,50
40,40
60,26
80,14`
        }
      ]
    },
    "jandy-vsflo-pro-3.8": {
      label: "Jandy VS FloPro 3.8 HP",
      lines: [
        {
          rpm: 3450,
          label: "3450 RPM",
          pointsText: `0,102
30,100
60,97
90,90
120,75
150,52
180,33`
        },
        {
          rpm: 3000,
          label: "3000 RPM",
          pointsText: `0,77
30,75
60,72
90,65
120,52
160,22`
        }
      ]
    }
  };

  /* -----------------------------
     State
  ----------------------------- */

  const state = {
    // curve data normalized (points parsed)
    curves: normalizeCurves(DEFAULT_CURVES),

    // chart inputs (what to draw)
    selectedPumpKey: Object.keys(DEFAULT_CURVES)[0],
    targetTDH: 50,          // ft
    operatingFlow: 94.2,    // GPM

    // which RPM lines to show (null = show all)
    visibleRPMs: null
  };

  function normalizeCurves(curvesObj) {
    const out = {};
    for (const [key, pump] of Object.entries(curvesObj)) {
      out[key] = {
        label: pump.label || key,
        lines: (pump.lines || []).map((ln) => ({
          rpm: ln.rpm,
          label: ln.label || `${ln.rpm} RPM`,
          points: Array.isArray(ln.points)
            ? ln.points.slice().sort((a, b) => a.gpm - b.gpm)
            : parsePointsText(ln.pointsText || "")
        }))
      };
    }
    return out;
  }

  /* -----------------------------
     Canvas Chart Renderer
  ----------------------------- */

  function renderCurveChart() {
    const canvas = $("#curveCanvas");
    if (!canvas) return; // if your HTML uses a different id, change it here

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // handle high-DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // background clear
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 58, r: 16, t: 18, b: 42 };

    // get selected pump data
    const pump = state.curves[state.selectedPumpKey];
    if (!pump) {
      drawText(ctx, "No pump curves found", 16, 24, "#fff");
      return;
    }

    const lines = pump.lines
      .filter((ln) => ln.points && ln.points.length >= 2)
      .filter((ln) => {
        if (!state.visibleRPMs) return true;
        return state.visibleRPMs.includes(ln.rpm);
      });

    if (!lines.length) {
      drawText(ctx, "No curve points to draw", 16, 24, "#fff");
      return;
    }

    // compute bounds across all lines
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const ln of lines) {
      for (const p of ln.points) {
        minX = Math.min(minX, p.gpm);
        maxX = Math.max(maxX, p.gpm);
        minY = Math.min(minY, p.tdh);
        maxY = Math.max(maxY, p.tdh);
      }
    }

    // add padding to bounds
    const xPad = (maxX - minX) * 0.08 || 10;
    const yPad = (maxY - minY) * 0.10 || 10;
    minX = Math.max(0, minX - xPad);
    maxX = maxX + xPad;
    minY = Math.max(0, minY - yPad);
    maxY = maxY + yPad;

    // ensure target TDH visible
    if (Number.isFinite(state.targetTDH)) {
      minY = Math.min(minY, state.targetTDH - 10);
      maxY = Math.max(maxY, state.targetTDH + 10);
      minY = Math.max(0, minY);
    }

    // coordinate transforms
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const xToPx = (x) => pad.l + ((x - minX) / (maxX - minX)) * plotW;
    const yToPx = (y) => pad.t + plotH - ((y - minY) / (maxY - minY)) * plotH;

    // Draw grid
    drawGrid(ctx, w, h, pad, minX, maxX, minY, maxY, xToPx, yToPx);

    // Axis labels
    drawText(ctx, "Flow (GPM)", pad.l + plotW / 2, h - 12, "#cbd5e1", "center");
    drawText(ctx, "TDH (ft)", 18, pad.t + plotH / 2, "#cbd5e1", "center", true);

    // Draw curves
    const palette = [
      "#38bdf8", // cyan
      "#fb7185", // rose
      "#f59e0b", // amber
      "#a78bfa", // violet
      "#34d399"  // green
    ];

    lines.forEach((ln, idx) => {
      const color = palette[idx % palette.length];
      drawPolyline(ctx, ln.points.map(p => ({ x: xToPx(p.gpm), y: yToPx(p.tdh) })), color, 2.5);

      // label near first point
      const p0 = ln.points[Math.min(1, ln.points.length - 1)];
      drawTag(ctx, ln.label, xToPx(p0.gpm) + 6, yToPx(p0.tdh) - 6, color);
    });

    // Target TDH line (horizontal)
    if (Number.isFinite(state.targetTDH)) {
      const y = yToPx(state.targetTDH);
      ctx.save();
      ctx.strokeStyle = "#fbbf24"; // amber-ish
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + plotW, y);
      ctx.stroke();
      ctx.restore();

      drawTag(ctx, `Target TDH: ${round1(state.targetTDH)} ft`, pad.l + plotW - 8, y - 8, "#fbbf24", "right");
    }

    // Operating point: where curve meets target TDH for best (highest) RPM by default
    // Find first line where target TDH is within range, then compute gpm
    let op = null;
    if (Number.isFinite(state.targetTDH)) {
      const sorted = lines.slice().sort((a, b) => (b.rpm || 0) - (a.rpm || 0));
      for (const ln of sorted) {
        const gpm = gpmAtTDH(ln.points, state.targetTDH);
        if (gpm != null && Number.isFinite(gpm)) {
          op = { gpm, tdh: state.targetTDH, rpmLabel: ln.label };
          break;
        }
      }
    }

    // If you want operating point to be at required flow instead, use operatingFlow with curve TDH:
    // But typical UX: show required flow vertical + target TDH horizontal. We'll show both.

    // Required flow line (vertical)
    if (Number.isFinite(state.operatingFlow)) {
      const x = xToPx(state.operatingFlow);
      ctx.save();
      ctx.strokeStyle = "#94a3b8"; // slate
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + plotH);
      ctx.stroke();
      ctx.restore();
      drawTag(ctx, `Required Flow: ${round1(state.operatingFlow)} GPM`, x + 8, pad.t + 14, "#94a3b8");
    }

    // Operating point marker
    if (op) {
      const px = xToPx(op.gpm);
      const py = yToPx(op.tdh);
      drawDot(ctx, px, py, "#f59e0b");
      drawTag(ctx, `Operating: ${round1(op.gpm)} GPM @ ${round1(op.tdh)} ft (${op.rpmLabel})`, px + 10, py - 10, "#f59e0b");
    }

    // Title
    drawText(ctx, pump.label, pad.l, 16, "#e5e7eb", "left");
  }

  function drawText(ctx, text, x, y, color, align = "left", rotate = false) {
    ctx.save();
    ctx.fillStyle = color || "#fff";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    if (rotate) {
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
    } else {
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  function drawGrid(ctx, w, h, pad, minX, maxX, minY, maxY, xToPx, yToPx) {
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    // background
    ctx.save();
    ctx.fillStyle = "rgba(2,6,23,0.25)"; // subtle
    ctx.fillRect(pad.l, pad.t, plotW, plotH);
    ctx.restore();

    // grid lines
    const xTicks = 6;
    const yTicks = 6;

    ctx.save();
    ctx.strokeStyle = "rgba(148,163,184,0.18)";
    ctx.lineWidth = 1;

    for (let i = 0; i <= xTicks; i++) {
      const x = pad.l + (plotW * i) / xTicks;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + plotH);
      ctx.stroke();

      const val = minX + ((maxX - minX) * i) / xTicks;
      drawText(ctx, round0(val), x, pad.t + plotH + 16, "#94a3b8", "center");
    }

    for (let i = 0; i <= yTicks; i++) {
      const y = pad.t + (plotH * i) / yTicks;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + plotW, y);
      ctx.stroke();

      const val = maxY - ((maxY - minY) * i) / yTicks;
      drawText(ctx, round0(val), pad.l - 10, y, "#94a3b8", "right");
    }

    // axes
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, pad.t + plotH);
    ctx.lineTo(pad.l + plotW, pad.t + plotH);
    ctx.stroke();

    ctx.restore();
  }

  function drawPolyline(ctx, pts, color, width = 2) {
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color || "#fff";
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawDot(ctx, x, y, color) {
    ctx.save();
    ctx.fillStyle = color || "#fff";
    ctx.beginPath();
    ctx.arc(x, y, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTag(ctx, text, x, y, color, align = "left") {
    ctx.save();
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textBaseline = "middle";
    ctx.textAlign = align;

    const paddingX = 8;
    const paddingY = 5;
    const metrics = ctx.measureText(text);
    const w = metrics.width + paddingX * 2;
    const h = 22;

    let bx = x;
    if (align === "right") bx = x - w;
    if (align === "center") bx = x - w / 2;

    const by = y - h / 2;

    // background
    ctx.fillStyle = "rgba(15,23,42,0.85)";
    roundRect(ctx, bx, by, w, h, 10);
    ctx.fill();

    // border
    ctx.strokeStyle = color || "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // text
    ctx.fillStyle = color || "#fff";
    ctx.fillText(text, bx + paddingX, y);

    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function round0(n) {
    return String(Math.round(n));
  }
  function round1(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  /* -----------------------------
     Wiring to your UI (best effort)
     This code tries to connect to your existing controls.
     If your IDs differ, tell me your index.html and I’ll match them.
  ----------------------------- */

  function tryBindUI() {
    // Pump model select (global) - optional
    const pumpSelect =
      $("#pumpModelSelect") ||
      $("#pumpModel") ||
      $('[data-role="pump-model-select"]');

    if (pumpSelect) {
      // populate if empty
      if (pumpSelect.tagName === "SELECT" && pumpSelect.options.length < 2) {
        pumpSelect.innerHTML = "";
        for (const [key, p] of Object.entries(state.curves)) {
          const opt = document.createElement("option");
          opt.value = key;
          opt.textContent = p.label;
          pumpSelect.appendChild(opt);
        }
      }

      pumpSelect.value = state.selectedPumpKey;
      pumpSelect.addEventListener("change", () => {
        state.selectedPumpKey = pumpSelect.value;
        renderCurveChart();
      });
    }

    // TDH input
    const tdhInput =
      $("#tdhInput") ||
      $("#tdh") ||
      $('[data-role="tdh-input"]');

    if (tdhInput) {
      tdhInput.value = state.targetTDH;
      tdhInput.addEventListener("input", () => {
        state.targetTDH = toNum(tdhInput.value, state.targetTDH);
        renderCurveChart();
      });
    }

    // Required flow
    const flowInput =
      $("#requiredFlowInput") ||
      $("#requiredFlow") ||
      $('[data-role="required-flow-input"]');

    if (flowInput) {
      flowInput.value = state.operatingFlow;
      flowInput.addEventListener("input", () => {
        state.operatingFlow = toNum(flowInput.value, state.operatingFlow);
        renderCurveChart();
      });
    }

    // Curves editor modal textareas:
    // expects something like:
    // <textarea data-curve="jandy-vsflo-pro-2.7" data-rpm="3450"></textarea>
    const curveTextAreas = $$("textarea[data-curve][data-rpm]");
    if (curveTextAreas.length) {
      for (const ta of curveTextAreas) {
        const key = ta.getAttribute("data-curve");
        const rpm = toNum(ta.getAttribute("data-rpm"), 0);

        const pump = state.curves[key];
        if (!pump) continue;

        const line = pump.lines.find((l) => Number(l.rpm) === Number(rpm));
        if (!line) continue;

        // set current
        ta.value = (line.points || []).map(p => `${p.gpm},${p.tdh}`).join("\n");

        // parse on input
        ta.addEventListener("input", () => {
          line.points = parsePointsText(ta.value);
          renderCurveChart();
        });
      }
    }

    // If you have a "Save Curves" button
    const saveBtn = $("#saveCurvesBtn") || $('[data-role="save-curves"]');
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        // persist to localStorage
        try {
          localStorage.setItem("poolPumpCurvesV1", JSON.stringify(state.curves));
          alert("Curves saved.");
        } catch (e) {
          console.warn(e);
          alert("Could not save curves.");
        }
      });
    }

    // Load from localStorage if exists
    try {
      const raw = localStorage.getItem("poolPumpCurvesV1");
      if (raw) {
        const parsed = JSON.parse(raw);
        // minimal validation
        if (parsed && typeof parsed === "object") {
          state.curves = parsed;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  function ensureCanvasExists() {
    let canvas = $("#curveCanvas");
    if (canvas) return;

    // fallback: create a canvas inside a common container
    const container =
      $("#curveViewer") ||
      $('[data-role="curve-viewer"]') ||
      document.body;

    canvas = document.createElement("canvas");
    canvas.id = "curveCanvas";
    canvas.style.width = "100%";
    canvas.style.height = "320px";
    canvas.style.borderRadius = "14px";
    canvas.style.background = "rgba(2,6,23,0.25)";
    canvas.style.display = "block";
    canvas.style.marginTop = "12px";
    container.appendChild(canvas);
  }

  function boot() {
    ensureCanvasExists();
    tryBindUI();
    renderCurveChart();

    // redraw on resize
    let t = null;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(renderCurveChart, 80);
    });
  }

  // Expose small debug API
  window.PoolPumpApp = {
    state,
    render: renderCurveChart,
    setPump: (key) => { state.selectedPumpKey = key; renderCurveChart(); },
    setTDH: (v) => { state.targetTDH = Number(v); renderCurveChart(); },
    setRequiredFlow: (v) => { state.operatingFlow = Number(v); renderCurveChart(); },
    parsePointsText
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
