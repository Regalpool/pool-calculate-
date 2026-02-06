/* ============================================================
   Pool Pump Sizing Tool - app.js (FULL WORKING)
   - Pumps + Water Features + SPA calculations
   - PASS/CLOSE status per pump
   - Curve editor (points: GPM,TDH per line)
   - Canvas curve drawing (no external libs)
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

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

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
      .map(l => l.trim())
      .filter(Boolean);

    const pts = [];
    for (const line of lines) {
      const parts = line.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const gpm = num(parts[0], NaN);
      const tdh = num(parts[1], NaN);
      if (!Number.isFinite(gpm) || !Number.isFinite(tdh)) continue;
      pts.push({ gpm, tdh });
    }

    // Sort by GPM asc (typical curve points)
    pts.sort((a, b) => a.gpm - b.gpm);
    return pts;
  }

  function pointsToText(points) {
    return (points || []).map(p => `${p.gpm},${p.tdh}`).join("\n");
  }

  // Find GPM at a target TDH by interpolating between curve points
  // Points are (gpm, tdh) where tdh generally decreases as gpm increases.
  function gpmAtTDH(points, targetTDH) {
    if (!points || points.length < 2) return 0;

    // Build segments in order of GPM
    // If targetTDH is higher than max TDH at low flow => cannot reach (0)
    const maxTDH = Math.max(...points.map(p => p.tdh));
    const minTDH = Math.min(...points.map(p => p.tdh));

    if (targetTDH > maxTDH) return 0;
    if (targetTDH < minTDH) {
      // Below curve's minimum TDH, pump can do at least max listed GPM
      return points[points.length - 1].gpm;
    }

    // Find segment where TDH crosses target
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      // TDH usually decreases; but handle either direction robustly
      const t1 = a.tdh, t2 = b.tdh;

      const crosses =
        (targetTDH <= t1 && targetTDH >= t2) ||
        (targetTDH >= t1 && targetTDH <= t2);

      if (!crosses) continue;

      // Linear interpolation in TDH space to get GPM
      // t = t1 + u*(t2-t1)
      const denom = (t2 - t1);
      if (Math.abs(denom) < 1e-9) return a.gpm; // flat segment
      const u = (targetTDH - t1) / denom;
      const g = a.gpm + u * (b.gpm - a.gpm);
      return clamp(g, Math.min(a.gpm, b.gpm), Math.max(a.gpm, b.gpm));
    }

    // Fallback: not found
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
  const DEFAULT_CURVES = {
    "Jandy VS FloPro 2.7 HP": {
      modelLabel: "Jandy VS FloPro 2.7 HP",
      rpmLines: [
        {
          rpm: 3450,
          label: "3450 RPM",
          points: [
            { gpm: 0, tdh: 95 },
            { gpm: 30, tdh:
