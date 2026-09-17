
export const ENGINEERS = [
  {
    id: "wren", name: "Wren", cc: "GB", persona: "CALM",
    role: "Clear and even",
    oneLine: "Calm, says the one thing that matters.",
    bio: "Says the one thing that matters and then gets off the radio. Good first engineer — never talks over a corner.",
    radioCue: "Radio check. Take the first lap to feel it out, I'll stay quiet.",
    voice: {
      sex: "F", rate: 0.95, pitch: 1.03, volume: 1, gap: 1.35, slot: 0,
      langs: ["en-GB", "en-IE", "en-AU"],
      prefer: ["Serena", "Kate", "Sonia", "Fiona", "Moira", "Libby", "Hazel", "Stephanie", "Samantha"]
    },
    unlock: null
  },
  {
    id: "marchetti", name: "Marchetti", cc: "IT", persona: "BLUNT",
    role: "Blunt, forty years on the wall",
    oneLine: "Blunt veteran, tells you straight.",
    bio: "Has seen the mistake you are about to make. Will tell you it was the mistake, in four words, while you are still in the corner.",
    radioCue: "Brakes. You were late there last time and you know it.",
    voice: {
      sex: "M", rate: 0.9, pitch: 0.72, volume: 1, gap: 1.5, slot: 0,
      langs: ["en-GB", "en-US"],
      prefer: ["Daniel", "Arthur", "Oliver", "Gordon", "George", "Thomas", "Alex"]
    },
    unlock: null
  },
  {
    id: "adeola", name: "Adeola", cc: "NG", persona: "ANALYTIC",
    role: "Numbers before opinions",
    oneLine: "Every call has a figure attached.",
    bio: "Quotes the sector, the delta and the corner number. Every call has a figure attached, and none of them are estimates.",
    radioCue: "Sector two is where it is. Three tenths, all of it on entry.",
    voice: {
      sex: "F", rate: 1.16, pitch: 1.14, volume: 1, gap: 0.65, slot: 1,
      langs: ["en-US", "en-NG", "en-ZA"],
      prefer: ["Samantha", "Joanna", "Aria", "Jenny", "Zira", "Tessa", "Nicky", "Salli", "Allison"]
    },
    unlock: { kind: "tracks", need: 4, label: "Log laps at 4 different circuits" }
  },
  {
    id: "sato", name: "Satō", cc: "JP", persona: "PRECISE",
    role: "Precision, barely a word",
    oneLine: "Speaks only when it is worth a tenth.",
    bio: "Speaks when there is something worth a tenth and not otherwise. The hardest to earn and the quietest once you have him.",
    radioCue: "Good. Same again.",
    voice: {
      sex: "M", rate: 1.02, pitch: 0.99, volume: 0.92, gap: 1.8, slot: 1,
      langs: ["en-US", "en-GB"],
      prefer: ["Reed", "Eddy", "Rishi", "Ryan", "Guy", "Matthew", "Oliver", "Davis"]
    },
    unlock: { kind: "consistency", need: 5, label: "Five laps inside 1.0s of each other, one session" }
  }
];

export function byId(id) { return ENGINEERS.filter(e => e.id === id)[0] || ENGINEERS[0]; }

// Everything the dashboard needs to make this engineer sound like themselves:
// delivery numbers, an ordered wish-list of system voices, and the wish-list of
// the other engineer of the same sex so the two never land on one voice.
export function voicePlan(id) {
  const e = byId(id);
  const v = e.voice || {};
  const twin = ENGINEERS.filter(x => x.id !== e.id && x.voice && x.voice.sex === v.sex)[0];
  return {
    id: e.id,
    sex: v.sex === "M" ? "MALE" : "FEMALE",
    rate: v.rate || 1,
    pitch: v.pitch || 1,
    volume: typeof v.volume === "number" ? v.volume : 1,
    gap: v.gap || 1,
    slot: v.slot || 0,
    langs: v.langs || ["en-US"],
    prefer: v.prefer || [],
    twinPrefer: (twin && twin.voice && twin.voice.prefer) || []
  };
}

export function progressFrom(sessions) {
  const list = sessions || [];
  const laps = list.reduce((n, s) => n + ((s.laps || []).filter(l => l.ms > 0).length), 0);
  const tracks = {};
  list.forEach(s => { if (s.track) tracks[s.track] = 1; });
  const trackCount = Object.keys(tracks).length;

  let streak = 0;
  list.forEach(s => {
    const t = (s.laps || []).map(l => l.ms).filter(x => x > 0);
    for (let i = 0; i < t.length; i++) {
      for (let j = i; j < t.length; j++) {
        const w = t.slice(i, j + 1);
        if (Math.max.apply(null, w) - Math.min.apply(null, w) > 1000) break;
        if (w.length > streak) streak = w.length;
      }
    }
  });

  return { laps, tracks: trackCount, consistency: streak };
}

function have(kind, p) {
  if (kind === "laps") return p.laps;
  if (kind === "tracks") return p.tracks;
  if (kind === "consistency") return p.consistency;
  return 0;
}

export function roster(sessions, selectedId) {
  const p = progressFrom(sessions);
  return ENGINEERS.map(e => {
    const u = e.unlock;
    const at = u ? have(u.kind, p) : 0;
    const unlocked = !u || at >= u.need;
    return {
      ...e,
      unlocked,
      selected: e.id === (selectedId || "wren") && unlocked,
      at, need: u ? u.need : 0,
      requirement: u ? u.label : "Free — on the radio from your first lap",
      free: !u,
      progressLabel: u ? at + " / " + u.need : "",
      pct: u ? Math.min(1, at / u.need) : 1
    };
  });
}

export function nextUnlock(sessions) {
  const r = roster(sessions).filter(e => !e.unlocked);
  if (!r.length) return null;
  r.sort((a, b) => (b.at / b.need) - (a.at / a.need));
  return r[0];
}
