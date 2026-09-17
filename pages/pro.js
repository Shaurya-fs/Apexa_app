export function proVals(C, t) {
  const { lap, ref, demo, laps } = C.picked();
  const LT = C.LT;
  const tabs = ["TRACES", "GRIP", "THERMAL", "MECHANICAL", "SECTORS", "EXPORT"];
  const v = C.state.proView;
  const out = {
    proTabs: tabs.map(x => {
      const on = x === v;
      return { label: x, border: on ? t.acc : t.line, bg: on ? t.acc : "transparent", fg: on ? t.bg : t.dim,
        go: () => C.setState({ proView: x }) };
    }),
    isProTraces: v === "TRACES", isProGrip: v === "GRIP", isProThermal: v === "THERMAL",
    isProMech: v === "MECHANICAL", isProSectors: v === "SECTORS", isProExport: v === "EXPORT",
    proHead: demo ? "DEMO DATA — NOT YOUR LAPS" : (lap ? lap.samples.length + " SAMPLES · " + Math.round(lap.lenM) + " M" : ""),
    proTitle: lap ? "Lap " + lap.n + " against lap " + ref.n : "No lap recorded",
    hasPro: !!lap
  };
  if (!lap || !LT) return out;

  const W = 1140;
  const len = Math.min(lap.lenM, ref.lenM);
  const line = (l, get, H, lo, hi) => {
    const s = l.samples, step = Math.max(1, Math.floor(s.length / 420)), pts = [];
    for (let i = 0; i < s.length; i += step) {
      const val = get(s[i]);
      if (typeof val !== "number" || s[i].dist > len) continue;
      const x = (s[i].dist / len) * W;
      const y = H - ((val - lo) / (hi - lo || 1)) * H;
      pts.push(Math.round(x * 10) / 10 + "," + Math.round(Math.max(-2, Math.min(H + 2, y)) * 10) / 10);
    }
    return pts.join(" ");
  };
  const cornerBands = H => lap.corners.map(c => ({
    x: (c.d0 / len) * W, w: Math.max(2, ((c.d1 - c.d0) / len) * W), h: H, name: c.name,
    lx: ((c.dApex) / len) * W
  }));

  if (v === "TRACES") {
    const chans = [
      { title: "STEERING", unit: "% LOCK", lo: -100, hi: 100, get: s => s.steer, zero: true },
      { title: "THROTTLE", unit: "%", lo: 0, hi: 100, get: s => s.throttle },
      { title: "BRAKE", unit: "%", lo: 0, hi: 100, get: s => s.brake },
      { title: "SPEED", unit: "KM/H", lo: 0, hi: 320, get: s => s.speed }
    ];
    const H = 96;
    out.traceCharts = chans.map(c => ({
      title: c.title, unit: c.unit, h: H,
      hasData: lap.samples.some(s => typeof c.get(s) === "number"),
      mine: line(lap, c.get, H, c.lo, c.hi),
      theirs: line(ref, c.get, H, c.lo, c.hi),
      zeroY: c.zero ? H / 2 : H,
      hiLabel: c.hi + "", loLabel: c.lo + "",
      bands: cornerBands(H)
    }));
    const slip = LT.timeSlip(lap, ref, 300);
    const mx = Math.max(0.25, slip.reduce((a, p) => Math.max(a, Math.abs(p.ms)), 0) / 1000);
    const SH = 118;
    out.slipPts = slip.map(p => {
      const x = (p.d / len) * W;
      const y = SH / 2 - (p.ms / 1000 / mx) * (SH / 2 - 4);
      return Math.round(x * 10) / 10 + "," + Math.round(y * 10) / 10;
    }).join(" ");
    out.slipH = SH;
    out.slipMid = SH / 2;
    out.slipTop = "+" + mx.toFixed(2) + " s LOST";
    out.slipBot = "−" + mx.toFixed(2) + " s GAINED";
    out.slipEnd = ((slip.length ? slip[slip.length - 1].ms : 0) / 1000).toFixed(3) + " s";
    out.slipEndColor = (slip.length ? slip[slip.length - 1].ms : 0) > 0 ? "#FF4D4D" : "#5BE38C";
    out.slipBands = cornerBands(SH);
  }

  if (v === "GRIP") {
    const hasG = lap.samples.some(s => typeof s.gLat === "number" && typeof s.gLon === "number");
    const R = 186, C = 210;
    const pk = lap.samples.reduce((a, s) => Math.max(a, Math.hypot(s.gLat || 0, s.gLon || 0)), 0);
    const scale = R / Math.max(1.6, Math.ceil(pk * 2) / 2);
    let trail = 0, tot = 0;
    out.ggHasData = hasG;
    out.ggDots = !hasG ? [] : lap.samples.filter((_, i) => i % 2 === 0).map(s => {
      const br = s.brake || 0, th = s.throttle || 0, gl = s.gLat || 0;
      const isTrail = br > 12 && Math.abs(gl) > 0.55;
      if (br > 12) { tot++; if (isTrail) trail++; }
      return {
        cx: C + gl * scale, cy: C - (s.gLon || 0) * scale,
        r: isTrail ? 2.4 : 1.5,
        fill: isTrail ? t.acc : br > 12 ? "rgba(255,77,77,0.6)" : th > 55 ? "rgba(91,227,140,0.55)" : "rgba(124,129,123,0.4)"
      };
    });
    out.ggRings = [0.5, 1, 1.5, 2].filter(g => g * scale <= R + 2).map(g => ({
      r: g * scale, cx: C, cy: C, label: g.toFixed(1) + " G", ly: C - g * scale - 5
    }));
    out.ggC = C; out.ggSize = C * 2;
    out.ggPeak = pk.toFixed(2) + " G PEAK COMBINED";
    out.ggTrail = tot ? Math.round((trail / tot) * 100) + "% OF BRAKING IS TRAIL-BRAKED" : "NO BRAKING DETECTED";
    out.ggLegend = [
      { label: "TRAIL-BRAKING", color: t.acc },
      { label: "BRAKING", color: "rgba(255,77,77,0.7)" },
      { label: "ON POWER", color: "rgba(91,227,140,0.7)" },
      { label: "COASTING", color: "rgba(124,129,123,0.6)" }
    ];
    const BH = 150;
    out.brakePts = line(lap, s => s.brake, BH, 0, 100);
    out.brakeRefPts = line(ref, s => s.brake, BH, 0, 100);
    out.brakeTempPts = lap.channels.brakeTemp ? line(lap, s => s.bt0, BH, 100, 900) : "";
    out.brakeH = BH;
    out.brakeNote = lap.channels.brakeTemp
      ? "FRONT-LEFT DISC, 100–900 °C · F1 BROADCASTS BRAKE TEMPERATURE"
      : "BRAKE TEMPERATURE NOT BROADCAST BY GT7";
    out.brakeBands = cornerBands(BH);
  }

  if (v === "THERMAL") {
    const names = ["FRONT LEFT", "FRONT RIGHT", "REAR LEFT", "REAR RIGHT"];
    const H = 118;
    out.thermCards = names.map((nm, i) => {
      const surf = s => s["t" + i], inner = s => s["ti" + i];
      const hasS = lap.samples.some(s => typeof surf(s) === "number");
      const hasI = lap.samples.some(s => typeof inner(s) === "number");
      const vals = lap.samples.map(surf).filter(x => typeof x === "number");
      const iv = lap.samples.map(inner).filter(x => typeof x === "number");
      const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const ms = mean(vals), mi = mean(iv);
      return {
        name: nm, h: H, hasS, hasI,
        surf: hasS ? line(lap, surf, H, 50, 130) : "",
        inner: hasI ? line(lap, inner, H, 50, 130) : "",
        press: lap.channels.press && typeof lap.samples[0]["tp" + i] === "number"
          ? lap.samples[lap.samples.length - 1]["tp" + i].toFixed(1) + " PSI" : "NO PRESSURE",
        pressDim: !lap.channels.press,
        surfLabel: ms == null ? "—" : Math.round(ms) + " °C MEAN SURFACE",
        innerLabel: mi == null ? "NOT BROADCAST BY GT7" : Math.round(mi) + " °C MEAN CARCASS",
        innerDim: mi == null,
        spread: ms != null && mi != null ? (mi - ms > 18 ? "CARCASS RUNNING HOT — LIFT PRESSURE" : "WITHIN WINDOW") : "",
        hot: ms != null && ms > 105
      };
    });
    out.thermNote = lap.channels.inner
      ? "SURFACE IN ACCENT, CARCASS IN GREEN · WINDOW 50–130 °C"
      : "GT7 SENDS ONE SURFACE TEMPERATURE PER TYRE AND NO PRESSURE. CARCASS AND PRESSURE PANELS FILL UNDER F1.";
    out.stintRow = laps.slice().reverse().map(l => {
      const mx = l.samples.reduce((a, s) => Math.max(a, s.t0 || 0, s.t1 || 0, s.t2 || 0, s.t3 || 0), 0);
      return {
        label: "L" + l.n, h: Math.max(4, Math.round((mx / 130) * 54)) + "px",
        color: mx > 108 ? "#FF4D4D" : mx > 100 ? "#FFB25C" : "#5BE38C",
        v: mx ? Math.round(mx) + "°" : "—"
      };
    });
    out.stintNote = lap.compound ? lap.compound + " · " + (lap.stintAge == null ? "AGE UNKNOWN" : lap.stintAge + " LAPS OLD") : "COMPOUND NOT BROADCAST BY GT7";
  }

  if (v === "MECHANICAL") {
    const ci = C.state.dampCorner;
    const cn = ["FRONT LEFT", "FRONT RIGHT", "REAR LEFT", "REAR RIGHT"];
    out.dampPicks = cn.map((nm, i) => {
      const on = i === ci;
      return { label: nm, border: on ? t.acc : t.line, bg: on ? t.acc : "transparent", fg: on ? t.bg : t.dim,
        pick: () => C.setState({ dampCorner: i }) };
    });
    const h = LT.damperHistogram(lap, ci);
    out.hasDamp = !!h;
    out.dampBins = h ? h.bins.map(b => ({
      label: b.label, h: Math.max(1, Math.round((b.pct / Math.max.apply(null, h.bins.map(x => x.pct))) * 200)) + "px",
      pct: b.pct.toFixed(1) + "%",
      color: Math.abs(parseFloat(b.label) || 0) > 100 ? "#FFB25C" : t.acc
    })) : [];
    out.dampMeta = h ? Math.round(h.travelMm) + " MM TRAVEL USED · " + h.n + " SAMPLES" : "";
    out.dampVerdict = h
      ? (h.bins[0].pct + h.bins[h.bins.length - 1].pct > 12
        ? "High-velocity tail is heavy. The dampers are being asked to deal with kerbs and bumps, not body roll — soften high-speed compression before touching anything else."
        : "Distribution is centred on low velocities, which is where a settled car lives. Nothing here says change the dampers.")
      : "";
    const SH = 150;
    out.suspTraces = [0, 1, 2, 3].map(i => ({
      name: cn[i], pts: lap.channels.susp ? line(lap, s => s["susp" + i], SH, 0, 90) : "",
      color: i < 2 ? t.acc : "#5BE38C"
    }));
    out.suspH = SH;
    out.mechEmpty = "Suspension position, damper velocity and wheel slip come from F1's MotionEx packet. GT7 broadcasts none of them, so this page fills only under F1 25. Everything else in the app works on both.";
  }

  if (v === "SECTORS") {
    const th = LT.theoretical([lap].concat(laps.filter(l => l !== lap)));
    const worst = th.rows.reduce((a, r) => Math.max(a, r.lost || 0), 1);
    out.microRows = th.rows.map(r => ({
      n: "S" + r.n,
      range: Math.round(r.d0) + "–" + Math.round(r.d1) + " M",
      cur: (r.cur / 1000).toFixed(3),
      best: r.best ? (r.best / 1000).toFixed(3) : "—",
      from: r.from ? "L" + r.from : "—",
      lost: r.lost == null ? "—" : (r.lost > 0 ? "+" : "") + (r.lost / 1000).toFixed(3),
      color: r.lost == null ? t.dim : r.lost > 60 ? "#FF4D4D" : r.lost > 15 ? "#FFB25C" : "#5BE38C",
      w: Math.round((Math.max(0, r.lost || 0) / worst) * 100) + "%",
      vMin: r.n ? "" : ""
    }));
    out.microTheo = th.ms ? C.fmt(th.ms) : "NEEDS EVERY SECTOR SET";
    out.microGain = th.ms && lap.ms ? "−" + ((lap.ms - th.ms) / 1000).toFixed(3) + " s ON THE TABLE" : "";
    out.microNote = th.pooled + " LAPS POOLED · 180 M PER SECTOR";
  }

  if (v === "EXPORT") {
    const csv = LT.motecCsv(lap, { track: lap.track, car: lap.car, game: lap.game });
    const head = csv.split("\r\n");
    const names = (head[8] || "").split(",").map(x => x.replace(/"/g, ""));
    out.exportChannels = names.filter(x => x).map(x => ({ name: x }));
    out.exportMeta = names.filter(x => x).length + " CHANNELS · " + lap.samples.length + " ROWS · " + Math.round(csv.length / 1024) + " KB";
    out.exportName = "lap" + lap.n + "-" + (lap.track || "session").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() + ".csv";
    out.doExport = () => {
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = out.exportName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    out.exportMissing = [
      !lap.channels.susp ? "Suspension position — F1 only" : null,
      !lap.channels.press ? "Tyre pressure — F1 only" : null,
      !lap.channels.inner ? "Carcass temperature — F1 only" : null,
      !lap.channels.brakeTemp ? "Brake temperature — F1 only" : null,
      !lap.channels.pos ? "World position — game sent none" : null
    ].filter(x => x).map(x => ({ name: x }));
    out.exportRate = "LOGGED AT THE PACKET RATE. GT7 SENDS 60 HZ, F1 25 UP TO 60 HZ — NEITHER GAME CAN GIVE YOU THE 100 HZ+ A REAL CAR LOGS AT.";
  }
  return out;
}
