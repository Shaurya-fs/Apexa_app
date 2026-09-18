export function recordVals(C, t, F, DF, POS, NEG) {
  const real = C.state.sessions;
  const demo = false;
  const s = demo ? Object.assign({}, C.state, { sessions: C.demoSessions(), selSes: C.state.selSes || "d1" })
    : Object.assign({}, C.state, { sessions: C.state.sessions.filter(x => C.seatMatch(x)) });
  const D = ms => { const x = new Date(ms); return x.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  const H = ms => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const bestOf = ses => { const v = ses.laps.map(l => l.ms).filter(x => x > 0); return v.length ? Math.min.apply(null, v) : null; };

  const sesCards = s.sessions.map(ses => {
    const b = bestOf(ses), sel = ses.id === s.selSes;
    return {
      id: ses.id, sel,
      track: ses.track || "UNNAMED TRACK",
      sub: ses.mode + " · " + ses.game + " · " + H(ses.at) + " · " + C.carLabel(ses),
      date: D(ses.at), lapCount: String(ses.laps.length),
      best: b ? F(b) : "—:——.———",
      bg: sel ? t.line : "transparent",
      border: sel ? t.acc : t.line,
      titleColor: sel ? t.acc : t.text,
      pick: () => C.setState({ selSes: ses.id, selRecLap: null, trackDraft: ses.track || "",
        carDraft: ses.carName || "", targetDraft: ses.targetMs ? F(ses.targetMs) : "" })
    };
  });

  const cur = s.sessions.filter(x => x.id === s.selSes)[0] || null;
  const curBest = cur ? bestOf(cur) : null;
  const sameTrack = cur && cur.track ? s.sessions.filter(x => x.track === cur.track) : (cur ? [cur] : []);
  const pbAll = sameTrack.map(bestOf).filter(x => x);
  const pb = pbAll.length ? Math.min.apply(null, pbAll) : null;
  const typed = cur && cur.targetMs ? cur.targetMs : null;
  const prevAll = cur ? sameTrack.filter(x => x.id !== cur.id).map(bestOf).filter(x => x) : [];
  const prev = prevAll.length ? Math.min.apply(null, prevAll) : null;
  const target = typed || prev;
  const benchSrc = typed ? "TYPED IN BY YOU" : prev ? "YOUR BEST HERE, EARLIER SESSION" : "NO BENCHMARK YET";
  const gap = curBest && target ? (curBest - target) / 1000 : null;

  const dists = cur ? cur.laps.map(l => l.dist).filter(x => x > 0) : [];
  const medDist = dists.length ? dists.slice().sort((a, b) => a - b)[Math.floor(dists.length / 2)] : null;
  const ident = C.identifyTrack(medDist);

  const selRec = s.selRecLap;
  const traceLaps = (C.lapPool ? C.lapPool().laps : []) || [];
  const selLaps = cur ? cur.laps.slice().reverse().map((l, i) => {
    const n = cur.laps.length - i;
    const dB = curBest ? (l.ms - curBest) / 1000 : null;
    const dT = target ? (l.ms - target) / 1000 : null;
    const isBest = l.ms === curBest;
    const on = selRec === n;
    return {
      n: String(n), t: F(l.ms),
      d: dB === null || isBest ? "—" : DF(dB, 3),
      dColor: isBest ? t.acc : dB > 0 ? NEG : t.dim,
      dt: dT === null ? "—" : DF(dT, 3),
      dtColor: dT === null ? t.dim : dT < 0 ? POS : NEG,
      bg: on || isBest ? t.line : "transparent",
      border: on ? t.acc : isBest ? t.acc : t.line,
      pick: () => C.setState({ selRecLap: n })
    };
  }) : [];

  const selL = cur && selRec ? cur.laps[selRec - 1] : null;
  const traceMatch = selL ? traceLaps.filter(x => x.ms === selL.ms)[0] : null;
  const miniPath = cur && cur.outline && C.CAT ? C.CAT.outlinePath(cur.outline, 100, 10) : null;

  const win = gap === null ? 1.5 : Math.max(1.5, Math.abs(gap) * 1.25);
  const wOf = ms => {
    if (!ms || !curBest || !target) return "0%";
    const fast = Math.min(curBest, target);
    const over = (ms - fast) / 1000;
    return Math.round(Math.max(0, Math.min(1, 1 - over / win)) * 100) + "%";
  };
  const winLabel = gap === null ? "SCALE — FULL BAR IS 1.500s" : "SCALE — FULL BAR IS " + win.toFixed(3) + "s";

  const openMap = s.openTracks || {};
  const order = [], byTrack = {};
  // A lap length only identifies a track once two full laps agree on it. Sessions
  // that never completed two laps are pooled instead of inventing a track each.
  const measured = ses => (ses.laps || []).filter(l => l.ms > 0).length >= 2;
  s.sessions.forEach(ses => {
    const nm = C.nameOf(ses);
    const key = ses.trackId || (nm.named ? nm.track
      : measured(ses) ? "len:" + (C.lenKey(ses.lenM) || "unknown")
      : "len:unconfirmed");
    if (!byTrack[key]) { byTrack[key] = []; order.push(key); }
    byTrack[key].push({ ses, nm });
  });
  const trackGroups = order.map(key => {
    const list = byTrack[key], head = list[0].ses, headName = list[0].nm;
    const bests = list.map(x => bestOf(x.ses)).filter(x => x);
    const gBest = bests.length ? Math.min.apply(null, bests) : null;
    const withOutline = list.filter(x => x.ses.outline && x.ses.outline.length > 8)[0];
    const f = C.CAT ? C.CAT.flagColors(head.cc) : ["#5A6070", "#8C93A3"];
    const path = withOutline && C.CAT ? C.CAT.outlinePath(withOutline.ses.outline, 100, 9) : null;
    const holdsSel = list.some(x => x.ses.id === s.selSes);
    const open = key in openMap ? !!openMap[key] : holdsSel;

    const dayOrder = [], byDay = {};
    list.forEach(x => {
      const k = D(x.ses.at);
      if (!byDay[k]) { byDay[k] = []; dayOrder.push(k); }
      byDay[k].push(x);
    });
    const days = dayOrder.map(k => ({
      label: k.toUpperCase(),
      count: byDay[k].length + (byDay[k].length === 1 ? " SESSION" : " SESSIONS"),
      rows: byDay[k].map(({ ses, nm }) => {
        const b = bestOf(ses), sel = ses.id === s.selSes;
        return {
          lapCount: String(ses.laps.length),
          best: b ? F(b) : "—:——.———",
          bestColor: b && b === gBest ? t.acc : t.text,
          car: nm.car,
          when: H(ses.at),
          sub: [H(ses.at), ses.mode, ses.game, nm.carFrom].join(" · ").toUpperCase(),
          bg: sel ? t.line : "transparent",
          mark: sel ? t.acc : "transparent",
          mark2: sel ? t.acc : t.dim,
          titleColor: sel ? t.acc : t.text,
          pick: () => C.setState({ selSes: ses.id, selRecLap: null, trackDraft: ses.track || "",
            carDraft: ses.carName || "", targetDraft: ses.targetMs ? F(ses.targetMs) : "" })
        };
      })
    }));

    return {
      track: key === "len:unconfirmed" ? "SHORT SESSIONS" : headName.track,
      titleColor: headName.named && key !== "len:unconfirmed" ? t.text : t.dim,
      flagA: f[0], flagB: f[1],
      hasPath: !!path, noPath: !path, path: path || "",
      best: gBest ? F(gBest) : "—:——.———",
      open, shut: !open,
      caret: open ? "▾" : "▸",
      caretColor: open ? t.acc : t.dim,
      count: list.length + (list.length === 1 ? " SESSION" : " SESSIONS") + " · " + dayOrder.length + (dayOrder.length === 1 ? " DAY" : " DAYS"),
      toggle: () => C.toggleTrackGroup(key),
      meta: key === "len:unconfirmed"
        ? "FEWER THAN TWO COMPLETE LAPS · TRACK NOT IDENTIFIED"
        : [
        head.lenM ? (head.lenM / 1000).toFixed(3) + " KM MEASURED" : "LENGTH NOT MEASURED YET",
        head.turns ? head.turns + " TURNS" : null, headName.trackFrom
      ].filter(Boolean).join(" · "),
      days
    };
  });

  return {
    sesCards, trackGroups,
    catLine: (s.catVersion ? "NAME TABLES " + s.catSource.toUpperCase() : "NAME TABLES BUILT IN")
      + (s.catNote ? " · " + s.catNote : ""),
    noSessions: s.sessions.length === 0,
    hasSessions: s.sessions.length > 0,
    recordsCount: demo ? "DEMO ARCHIVE — NOT YOUR DATA" : s.sessions.length + (s.sessions.length === 1 ? " SESSION" : " SESSIONS") + " ARCHIVED",
    recordsEmpty: "Nothing archived yet. Every lap the bridge sees is written here — track a lap and it appears, named and timed.",
    hasSel: !!cur,
    selTrack: cur ? C.nameOf(cur).track : "—",
    selMeta: cur ? D(cur.at) + " · " + H(cur.at) + " · " + cur.mode + " · " + cur.game : "",
    selCar: cur ? C.nameOf(cur).car : "—",
    selTrackFrom: cur ? C.nameOf(cur).trackFrom : "",
    carDraft: s.carDraft,
    onCarDraft: e => C.setState({ carDraft: e.target.value }),
    carNote: cur ? C.nameOf(cur).carFrom + (cur.carId ? " — NAME IT ONCE AND EVERY SESSION IN THIS CAR PICKS IT UP" : "") : "NO CAR CODE IN THIS SESSION",
    saveCar: () => {
      const v = (s.carDraft || "").trim();
      C.editSel(demo, s, x => { x.carName = v; });
      if (cur && cur.carId) C.learnCar(cur.carId, v);
    },
    selLapsLabel: cur ? cur.laps.length + (cur.laps.length === 1 ? " LAP" : " LAPS") : "0 LAPS",
    hasMini: !!miniPath, noMini: !miniPath,
    miniPath: miniPath || "",
    miniStartX: cur && cur.outline ? (10 + cur.outline[0][0] * 80).toFixed(1) : "50",
    miniStartY: cur && cur.outline ? (10 + cur.outline[0][1] * 80).toFixed(1) : "50",
    miniNote: miniPath
      ? "SHAPE TRACED FROM YOUR OWN LAP · PLAN VIEW, NO ELEVATION ARCHIVED"
      : "NO SHAPE ARCHIVED — GT7 SENT NO POSITION DURING THIS SESSION",
    lapPickNote: selL
      ? "LAP " + selRec + " · " + F(selL.ms) + " · " + (selL.dist ? Math.round(selL.dist) + " m MEASURED" : "DISTANCE NOT SENT")
      : "PICK A LAP BELOW TO INSPECT IT",
    hasTrace: !!traceMatch, noTrace: !traceMatch,
    openTrace: () => { if (traceMatch) C.setState({ selLap: traceMatch.n, view: "ANALYSIS" }); },
    traceNote: traceMatch
      ? "FULL TRACE STILL IN MEMORY FOR THIS LAP"
      : selL ? "ONLY THE LAP TIME IS ARCHIVED. CORNER-BY-CORNER TRACES LIVE IN THE RUNNING SESSION ONLY." : "",
    selBest: curBest ? F(curBest) : "—:——.———",
    selLaps,
    pbLabel: pb ? F(pb) : "—:——.———",
    pbNote: cur && cur.track ? "ACROSS " + sameTrack.length + " SESSION" + (sameTrack.length === 1 ? "" : "S") + " AT THIS TRACK" : "NAME THE TRACK TO POOL SESSIONS",
    targetLabel: target ? F(target) : "—:——.———",
    gapLabel: gap === null ? "—" : DF(gap, 3),
    gapColor: gap === null ? t.dim : gap < 0 ? POS : NEG,
    gapNote: gap === null ? (curBest ? "No benchmark yet. Type a time, or run this track again and the earlier best becomes the reference." : "Type a benchmark to compare against.")
      : gap < 0 ? "You are under the benchmark by " + Math.abs(gap).toFixed(3) + "s."
      : "The benchmark is " + gap.toFixed(3) + "s clear of your best.",
    yoursW: wOf(curBest), targetW: wOf(target), winLabel,
    benchSrc,
    targetRowLabel: typed ? "TARGET" : prev ? "PREVIOUS" : "TARGET",
    hasSug: !!(ident && cur && !cur.track),
    sugLabel: ident ? ident.name : "",
    sugNote: medDist ? "LAP MEASURED AT " + Math.round(medDist) + " m" + (ident ? " — WITHIN " + (ident.err * 100).toFixed(1) + "% OF " + ident.name : " — NO CIRCUIT OF THAT LENGTH ON FILE") : "LAP LENGTH NOT MEASURED",
    useSug: () => {
      if (!ident) return;
      C.setState({ trackDraft: ident.name });
      C.editSel(demo, s, x => { x.track = ident.name; });
      C.learnTrack(medDist, ident.name);
    },
    yoursBarColor: gap !== null && gap <= 0 ? POS : t.acc,
    targetBarColor: t.dim,
    trackDraft: s.trackDraft, targetDraft: s.targetDraft,
    onTrackDraft: e => C.setState({ trackDraft: e.target.value }),
    onTargetDraft: e => C.setState({ targetDraft: e.target.value }),
    saveTrack: () => {
      const v = (s.trackDraft || "").trim();
      C.editSel(demo, s, x => { x.track = v; });
      if (v && medDist) C.learnTrack(medDist, v);
    },
    saveTarget: () => {
      const ms = C.parseLap(s.targetDraft);
      if (s.targetDraft.trim() && ms === null) { C.say("I could not read that time. Minutes colon seconds, like 1:21.616."); return; }
      C.editSel(demo, s, x => { x.targetMs = ms; });
    },
    dropSession: () => C.editRecords(list => {
      const out = list.filter(x => x.id !== s.selSes);
      C.setState({ selSes: out[0] ? out[0].id : null });
      return out;
    }),
    benchNote: "BENCHMARK — TYPED IN BY YOU. GT7 BROADCASTS NO LEADERBOARD.",
    inputStyle: { background: "transparent", border: "1px solid " + t.line, borderRadius: "2px",
      padding: "10px 12px", color: t.text, fontFamily: "'IBM Plex Mono',monospace", fontSize: "14px", outline: "none", width: "100%", boxSizing: "border-box" },
    recBtn: { background: "transparent", border: "1px solid " + t.acc, borderRadius: "2px", color: t.acc,
      padding: "10px 14px", fontFamily: "'IBM Plex Mono',monospace", fontSize: "10px", letterSpacing: "0.14em", cursor: "pointer" },
    dropBtn: { background: "transparent", border: "1px solid " + t.line, borderRadius: "2px", color: t.dim,
      padding: "8px 12px", fontFamily: "'IBM Plex Mono',monospace", fontSize: "10px", letterSpacing: "0.14em", cursor: "pointer" }
  };
}

export function demoSessions(C) {
  const day = 86400000, now = Date.now();
  return [
    { id: "d1", at: now - day, lastAt: now - day, track: "DEMO — SUZUKA", cc: "JP", turns: 18, trackConf: "medium", trackHow: "lap length 5808 m", carId: 1042, carName: "DEMO CAR", carCat: "Gr.3", game: "DEMO", mode: "Race", lenM: 5808,
      targetMs: 126400, laps: [{ ms: 128109, dist: 5811 }, { ms: 127482, dist: 5806 }, { ms: 127109, dist: 5808 }] },
    { id: "d2", at: now - day * 4, lastAt: now - day * 4, track: "DEMO — ROAD ATLANTA", cc: "US", turns: 12, trackConf: "high", trackHow: "length and start line", carId: 308, carName: "DEMO CAR", carCat: "Gr.4", game: "DEMO", mode: "Time Trial", lenM: 4088,
      targetMs: 80200, laps: [{ ms: 82107, dist: 4090 }, { ms: 81616, dist: 4086 }, { ms: 80959, dist: 4089 }, { ms: 81204, dist: 4092 }, { ms: 81388, dist: 4088 }] }
  ];
}
