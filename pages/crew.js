export function rosterVals(C, t) {
  if (!C.ROS) return { engineers: [], rosterStats: [], isEngineer: C.state.view === "ENGINEER",
    curEngName: "Wren", curEngRole: "Clear and even", curEngCue: "",
    freeEngineers: [], rosterProgress: "", nextUnlockLine: "" };
  const s = C.state;
  const rows = C.ROS.roster(s.sessions, s.engineerPick);
  const p = C.ROS.progressFrom(s.sessions);
  const nx = C.ROS.nextUnlock(s.sessions);
  const cur = rows.filter(e => e.selected)[0] || rows[0];
  const FL = cc => (C.CAT ? C.CAT.flagColors(cc) : ["#5A6070", "#8C93A3"]);
  return {
    isEngineer: s.view === "ENGINEER",
    engineers: rows.map(e => {
      const f = FL(e.cc);
      return {
        name: e.name, role: e.role, bio: e.bio,
        flagA: f[0], flagB: f[1],
        locked: !e.unlocked, unlocked: e.unlocked,
        cursor: e.unlocked ? "pointer" : "default",
        slotId: "engineer-" + e.id, slotHint: e.name,
        portraitStyle: { position: "absolute", inset: 0, backgroundImage: 'url("portraits/' + e.id + '.png")',
          backgroundSize: "cover", backgroundPosition: "center 18%", backgroundRepeat: "no-repeat",
          opacity: e.unlocked ? 1 : 0.3, filter: e.unlocked ? "none" : "grayscale(1)" },
        bg: e.selected ? t.line : "var(--panel,#0E1013)",
        border: e.selected ? t.acc : t.line,
        nameColor: e.unlocked ? t.text : t.dim,
        bioColor: e.unlocked ? t.text : t.dim,
        tag: e.selected ? "ON THE RADIO" : e.unlocked ? "READY" : "LOCKED",
        tagColor: e.selected ? t.acc : t.dim,
        requirement: e.requirement,
        progressLabel: e.progressLabel,
        pctW: Math.round(e.pct * 100) + "%",
        btnLabel: e.selected ? "SELECTED" : "PUT ON THE RADIO",
        btnBorder: e.selected ? t.acc : t.line,
        btnBg: e.selected ? t.acc : "transparent",
        btnFg: e.selected ? t.bg : t.text,
        pick: () => C.pickEngineer(e.id)
      };
    }),
    freeEngineers: rows.filter(e => e.free).map(e => {
      const f = FL(e.cc);
      return {
        name: e.name, oneLine: e.oneLine,
        sex: e.voice.sex === "F" ? "FEMALE" : "MALE",
        flagA: f[0], flagB: f[1],
        slotId: "engineer-" + e.id,
        thumbStyle: { position: "absolute", inset: 0, backgroundImage: 'url("portraits/' + e.id + '.png")',
          backgroundSize: "cover", backgroundPosition: "center 14%", backgroundRepeat: "no-repeat" },
        bg: e.selected ? t.line : "transparent",
        border: e.selected ? t.acc : t.line,
        ring: e.selected ? t.acc : t.line,
        nameColor: e.selected ? t.acc : t.text,
        tag: e.selected ? "ON THE RADIO" : "",
        tagColor: t.acc,
        pick: () => C.pickEngineer(e.id)
      };
    }),
    rosterProgress: rows.filter(e => e.unlocked).length + " OF 4 UNLOCKED",
    curEngName: cur ? cur.name : "—",
    curEngRole: cur ? cur.role : "",
    curEngCue: cur ? cur.radioCue : "",
    rosterStats: [
      { k: "LAPS LOGGED", v: String(p.laps) },
      { k: "CIRCUITS NAMED", v: String(p.tracks) },
      { k: "BEST CONSISTENT RUN", v: p.consistency > 1 ? p.consistency + " LAPS" : "—" }
    ],
    nextUnlockLine: nx
      ? nx.name + " — " + nx.requirement + ". You are at " + nx.at + " of " + nx.need + "."
      : "All four earned. Swap whenever the session calls for a different temperament."
  };
}

export function brainVals(C, t) {
  const s = C.state;
  const tabs = ["ROSTER", "BRAIN"].map(x => {
    const on = (s.crewTab || "ROSTER") === x;
    return { label: x, border: on ? t.acc : t.line, bg: on ? t.acc : "transparent", fg: on ? t.bg : t.dim,
      go: () => C.setState({ crewTab: x }) };
  });
  const base = { crewTabs: tabs, isRoster: (s.crewTab || "ROSTER") === "ROSTER", isBrain: s.crewTab === "BRAIN" };
  if (!C.brain) return Object.assign(base, { brainTraits: [], brainLog: [], graphNodes: [], graphEdges: [] });

  const lv = C.brain.level();
  const G = C.brain.graph(320);
  const F = ms => { if (!ms) return "—:——.———"; const m = Math.floor(ms / 60000), sec = ((ms % 60000) / 1000).toFixed(3); return m + ":" + (sec < 10 ? "0" : "") + sec; };

  const cur = s.sessions.filter(x => x.id === s.selSes)[0] || s.sessions[0] || null;
  const myBest = cur ? (() => { const v = cur.laps.map(l => l.ms).filter(x => x > 0); return v.length ? Math.min.apply(null, v) : null; })() : null;
  const cmp = cur && cur.trackId ? C.brain.compare(cur.trackId, myBest) : { have: false };

  return Object.assign(base, {
    brainStage: "STAGE " + lv.n + " OF 5",
    brainStageLabel: lv.label,
    brainStageSays: lv.says,
    brainEstablished: lv.established + " OF 9 AREAS LEARNED",
    brainNext: lv.next ? "Next stage — " + lv.next + ", once two more domains fill up." : "Fully learned.",
    brainProfile: C.brain.profile() || "Not enough laps yet to describe your driving.",
    graphSize: G.size,
    graphEdges: G.nodes.map(n => ({
      x1: G.cx.toFixed(1), y1: G.cy.toFixed(1), x2: n.x.toFixed(1), y2: n.y.toFixed(1),
      stroke: n.established ? t.acc : t.line,
      width: (0.5 + n.confidence * 2).toFixed(2),
      opacity: (0.25 + n.confidence * 0.75).toFixed(2)
    })),
    graphNodes: G.nodes.map(n => ({
      cx: n.x.toFixed(1), cy: n.y.toFixed(1),
      r: (6 + n.confidence * 9).toFixed(1),
      fill: n.established ? t.acc : "#12151A",
      stroke: n.confidence > 0 ? t.acc : t.dim,
      label: n.label.toUpperCase(),
      lx: n.x.toFixed(1), ly: (n.y + (n.y < G.cy ? -20 : 27)).toFixed(1),
      labelColor: t.text,
      count: String(n.samples)
    })),
    graphCx: (G.size / 2).toFixed(1), graphCy: (G.size / 2).toFixed(1),
    brainTraits: C.brain.traits().map(x => ({
      label: x.label, verdict: x.verdict, detail: x.detail,
      verdictColor: x.established ? t.text : t.dim,
      pctW: Math.round(x.confidence * 100) + "%",
      barColor: x.established ? t.acc : t.dim,
      samples: x.samples ? x.samples + " OBSERVATIONS" : "NO DATA"
    })),
    brainLog: C.brain.log.slice(0, 7).map(e => ({
      tag: e.tag || "", saw: e.saw || "", changed: e.changed || "",
      when: new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    })),
    noBrainLog: C.brain.log.length === 0,
    cmpHave: !!cmp.have, cmpNone: !cmp.have,
    cmpTrack: cur && cur.track ? cur.track : "No identified circuit selected",
    cmpRows: cmp.have ? [
      { k: "YOUR BEST", v: F(myBest), c: t.acc },
      { k: "COMMUNITY MEDIAN", v: F(cmp.medianMs), c: t.text },
      { k: "COMMUNITY TOP 10%", v: F(cmp.p10Ms), c: t.text },
      { k: "TO MEDIAN", v: cmp.toMedian === null ? "—" : (cmp.toMedian > 0 ? "+" : "") + cmp.toMedian.toFixed(3), c: cmp.toMedian > 0 ? "#FF6B5C" : "#7CFF8A" }
    ] : [],
    cmpNote: cmp.have
      ? cmp.samples + " LAPS FROM OTHER DRIVERS"
      : (s.commNote || "NOTHING CACHED FOR THIS CIRCUIT YET"),
    pullCommunity: () => C.pullCommunity()
  });
}
