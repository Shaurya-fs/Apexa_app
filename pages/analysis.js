export function heavyVals(C, t) {
  const s = C.state;
  if (s.view !== "ANALYSIS" && s.view !== "PRO") return C._heavy || {};
  const key = [s.view, s.proView, s.selLap, s.refLap, s.traceCount, s.theme, s.mapYaw, s.mapVert, s.speedUnit, s.dampCorner].join("|");
  if (C._heavyKey !== key) {
    C._heavyKey = key;
    C._heavy = Object.assign({}, C.mapVals(t), C.proVals(t));
  }
  return C._heavy;
}

export function mapVals(C, t) {
  const { lap, ref, demo, laps } = C.picked();
  if (!lap || !C.LT) return { hasMap: false, mapSegs: [], mapPins: [], cornerCards: [] };
  const verdicts = ref && ref !== lap ? C.LT.cornerVerdicts(lap, ref, {}) : [];
  const rb = C.LT.ribbon(lap, {
    width: 760, height: 430, yaw: C.state.mapYaw, tilt: 30, vScale: C.state.mapVert || 1, wallPx: 9, verdicts,
    base: "rgba(96,164,232,0.26)", edge: "rgba(150,206,255,0.8)", wall: "rgba(40,86,140,0.5)"
  });
  const COL = { LOSS: "#FF4D4D", SOFT: "#FFB25C", GOOD: "#5BE38C" };
  const worst = verdicts.reduce((a, c) => Math.max(a, c.lost), 0.001);
  return {
    hasMap: !!rb, mapDemo: demo,
    mapSegs: rb ? rb.segs.map(g => ({ pts: g.pts, fill: g.fill })) : [],
    mapRails: rb ? rb.rails : [],
    mapPins: rb ? rb.labels : [],
    mapStartX: rb ? rb.start.x : 0, mapStartY: rb ? rb.start.y : 0,
    mapNote: rb
      ? (rb.synthetic ? "ESTIMATED PATH" : "BUILT FROM YOUR OWN LAP")
      : "",
    vertLabel: "HEIGHT ×" + (C.state.mapVert || 1),
    bumpVert: () => C.setState(st => ({ mapVert: st.mapVert >= 8 ? 1 : (st.mapVert || 1) + (st.mapVert >= 4 ? 2 : 1) })),
    mapMeta: rb ? Math.round(lap.lenM) + " M · " + rb.elevM + " M ELEVATION · " + verdicts.length + " C.CORNERS" : "",
    mapTitle: (demo ? "DEMO — " : "") + "LAP " + lap.n + (lap.partial ? " · TRACING LIVE" : lap.ms ? " · " + C.fmt(lap.ms) : ""),
    mapRefTitle: ref && ref !== lap ? "vs LAP " + ref.n + (ref.ms ? " · " + C.fmt(ref.ms) : "") : "NO REFERENCE YET",
    lapLabels: laps.map(l => "L" + l.n),
    cornerCards: verdicts.slice().sort((a, b) => b.lost - a.lost).map(c => ({
      name: c.name + " " + c.dir,
      v: (c.lost >= 0 ? "+" : "") + c.lost.toFixed(2),
      color: COL[c.verdict],
      w: Math.round((Math.max(0, c.lost) / worst) * 100) + "%",
      meta: "R" + c.radius + "M · MIN " + Math.round(C.cvSpeed(c.minSpeed)) + " " + C.speedUnitLabel().toUpperCase(),
      tags: c.tags.length ? c.tags : ["NOTHING FLAGGED"],
      tagColor: c.tags.length ? t.text : t.dim
    })),
    lapPicks: laps.map(l => {
      const on = l === lap, p = { border: on ? t.acc : t.line, bg: on ? t.acc : "transparent", fg: on ? t.bg : t.dim };
      return { label: "L" + l.n + (l.partial ? "  LIVE" : l.ms ? "  " + C.fmt(l.ms) : ""), border: p.border, bg: p.bg, fg: p.fg,
        pick: () => C.setState({ selLap: l.n }) };
    }),
    refPicks: laps.map(l => {
      const on = l === ref, p = { border: on ? "#5BE38C" : t.line, bg: on ? "#5BE38C" : "transparent", fg: on ? t.bg : t.dim };
      return { label: "L" + l.n, border: p.border, bg: p.bg, fg: p.fg, pick: () => C.setState({ refLap: l.n }) };
    }),
    spinMap: () => C.setState(s => ({ mapYaw: (s.mapYaw + 30) % 360 })),
    ...C.insightVals(t, lap, laps)
  };
}

export function insightVals(C, t, lap, laps) {
  const closed = (laps || []).filter(l => l && !l.partial);
  const co = C.LT.coasting ? C.LT.coasting(lap) : null;
  const gw = C.LT.gripWindow ? C.LT.gripWindow(closed) : null;
  const rp = C.LT.repeatability ? C.LT.repeatability(closed) : null;

  const coastCol = !co ? t.dim : co.totalS > 2.2 ? "#FF4D4D" : co.totalS > 1.1 ? "#FFB25C" : "#5BE38C";
  const gripCol = !gw || gw.stable ? "#5BE38C" : gw.lapsLeft < 2 ? "#FF4D4D" : gw.lapsLeft < 5 ? "#FFB25C" : t.text;
  const repCol = !rp ? t.dim : rp.meanSd > 0.25 ? "#FF4D4D" : rp.meanSd > 0.12 ? "#FFB25C" : "#5BE38C";

  return {
    coastValue: co ? co.totalS.toFixed(2) + "s" : "—",
    coastColor: coastCol,
    coastNote: co
      ? (co.worst.length
          ? "Most of it " + (co.worst[0].name === "straights" ? "on the straights" : "at " + co.worst[0].name) +
            ", " + co.worst[0].s.toFixed(2) + "s."
          : "Spread evenly round the lap.")
      : "Needs a lap with throttle and brake recorded.",
    coastBars: co ? co.worst.map(w => ({
      name: w.name, v: w.s.toFixed(2) + "s",
      w: Math.round((w.s / Math.max(0.01, co.worst[0].s)) * 100) + "%"
    })) : [],

    gripValue: !gw ? "—" : gw.stable ? "STABLE" : gw.lapsLeft < 1 ? "GONE" : gw.lapsLeft.toFixed(1),
    gripUnit: !gw ? "NEEDS THREE LAPS"
      : gw.stable ? "TEMPERATURE HOLDING"
      : gw.lapsLeft >= 1 ? "LAPS LEFT IN THE WINDOW"
      : "ALREADY PAST THE CEILING",
    gripColor: gripCol,
    gripNote: gw
      ? "Peak " + Math.round(gw.peak) + "\u00B0, " + (gw.slope >= 0 ? "+" : "") + gw.slope.toFixed(1) + "\u00B0 a lap against a " + (gw.limit || 104) + "\u00B0 ceiling."
      : "Three completed laps and the trend appears.",

    repValue: rp ? "\u00B1" + rp.meanSd.toFixed(2) + "s" : "—",
    repUnit: rp ? "MEAN · WORST THREE BELOW" : "",
    repColor: repCol,
    repNote: rp
      ? "Across " + rp.laps + " laps, per hundred metres of track."
      : "Three completed laps and this fills in.",
    repBars: rp ? rp.worst.map(w => ({
      name: Math.round(w.d0) + "\u2013" + Math.round(w.d1) + "M",
      v: "\u00B1" + w.sd.toFixed(2) + "s",
      w: Math.round((w.sd / Math.max(0.01, rp.worst[0].sd)) * 100) + "%"
    })) : []
  };
}
