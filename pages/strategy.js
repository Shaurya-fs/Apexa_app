export function planVals(C, t) {
  const s = C.state, p = C._plan || {};
  const F = (C.lastFrame && C.lastFrame.f1) || null;
  const auto = F && F.totalLaps ? F.totalLaps : 0;
  const mini = { background: "transparent", border: "1px solid " + t.line, borderRadius: "2px",
    padding: "5px 8px", color: t.text, fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px",
    outline: "none", width: "56px", boxSizing: "border-box" };

  const pitIn = typeof p.pitIn === "number" ? p.pitIn : null;
  const fuelM = typeof p.fuelMargin === "number" ? p.fuelMargin : null;
  const cues = C._ghostCues || 0;
  const blank = !p.ready || !!p.waiting;

  return {
    miniField: mini,
    raceLapsDraft: s.raceLaps === "" && auto ? String(auto) : s.raceLaps,
    onRaceLaps: e => C.setState({ raceLaps: e.target.value.replace(/[^0-9]/g, "") }),
    stopPicks: [0, 1, 2].map(n => {
      const on = Number(s.targetStops) === n;
      return { label: String(n), bg: on ? "#15170F" : "#12151A", border: on ? t.acc : t.line,
        fg: on ? t.acc : t.dim, pick: () => C.setState({ targetStops: n }) };
    }),
    planStops: p.totalLaps ? "OVER " + p.totalLaps + " LAPS" : "RACE LENGTH NOT SET",
    planPit: blank ? "—" : pitIn === null ? "NO STOP" : pitIn <= 0 ? "BOX NOW" : "L" + p.pitLap,
    planPitNote: blank ? "NO PLAN YET" : pitIn === null ? "RUNNING TO THE FLAG" :
      pitIn <= 0 ? "THE WINDOW IS OPEN" : pitIn + (pitIn === 1 ? " LAP AWAY" : " LAPS AWAY"),
    planColor: blank ? t.dim : pitIn !== null && pitIn <= 1 ? "#FF4D4D" : pitIn !== null && pitIn <= 4 ? "#FFB25C" : t.acc,
    planFuel: fuelM === null ? "—" : (fuelM >= 0 ? "+" : "−") + Math.abs(fuelM).toFixed(1) + " L",
    planFuelColor: fuelM === null ? t.dim : fuelM < -0.2 ? "#FF4D4D" : fuelM < 0.8 ? "#FFB25C" : "#5BE38C",
    planDeg: p.deg && p.deg.perLapS > 0.005 ? "+" + p.deg.perLapS.toFixed(2) + " s/LAP" : p.deg ? "FLAT" : "—",
    planNote: p.waiting || (blank ? "Set the race distance and drive a few laps — the plan builds itself." : p.degNote || ""),
    planNoteColor: blank ? "#FFB25C" : t.dim,
    toggleGhost: () => {
      const on = !s.ghostOn;
      C.setState({ ghostOn: on });
      if (!on && C.ghost) C.ghost.cues = [];
    },
    ghostState: s.ghostOn ? "ON" : "OFF",
    ghostColor: s.ghostOn ? t.acc : t.dim,
    ghostBorder: s.ghostOn ? t.acc : t.line,
    ghostNote: !s.ghostOn
      ? "Silent. Corner calls come after the lap instead."
      : cues
      ? cues + (cues === 1 ? " call" : " calls") + " armed from lap " + (C._ghostFrom || "—") + ", spoken before each corner."
      : "Two clean laps and it starts calling corners before you reach them."
  };
}
