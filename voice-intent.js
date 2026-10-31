// What the driver said -> what they want. Pure text in, request out, so it can be tested without a microphone.
// Free speech, not fixed phrases: 1. tidy the text and mend the usual speech-engine slips ("ties", "whether", "lapse"),
// 2. pick out the racing words, allowing for near-misses by spelling and by sound, 3. decide the request from the words found together
// ("tyres" + "how long" = tyre life; "fuel" + "laps" = fuel range; "weather", "rain" = weather).
// A request the car's data cannot answer still gets an id (unsupported / topic) so the engineer can say so politely.

// ---------------------------------------------------------------------------------------------- 1. tidy the text
const SLIPS = [
  [/\blabs?\b/g, m => (m === "labs" ? "laps" : "lap")],
  [/\blapse\b/g, "laps"],
  [/\bt(?:y|ie|i)\s?res?\b|\btiers?\b|\bties\b|\btoes\b|\btires?\b|\btyres?\b|\btyr\b|\btie ?rs\b/g, "tyres"],
  [/\b(?:dealt a|delta's|deltas|dealer|delter|del ta|delt a)\b/g, "delta"],
  [/\bfuell?(?:ed|ing)?\b|\bfeul\b|\bfuels\b/g, "fuel"],
  [/\bliters?\b/g, "litres"],
  [/\bwhether\b(?! (?:i|we|to|or|it'?s? ok|that))/g, "weather"],
  [/\bwether\b|\bweathers\b/g, "weather"],
  [/\bunder steer\b/g, "understeer"],
  [/\bover steer\b/g, "oversteer"],
  [/\bbreak(s|ing)?\b/g, (m, s) => "brake" + (s || "")],
  [/\bboxbox\b/g, "box"]
];

export function normalise(text) {
  let t = String(text || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  SLIPS.forEach(([re, to]) => { t = t.replace(re, to); });
  return t;
}

// ---------------------------------------------------------------------------------------------- 2. the racing words
const LEX = {
  tyre: "tyres tyre rubber slicks compound compounds wheels inters softs mediums hards",
  fuel: "fuel petrol gasoline juice litres litre tank burn consumption mileage",
  lap: "lap laps circuits rounds",
  life: "life lasting lasts long longer remaining remain left leave survive hold holding endure until finish finishing end flag distance stay stint stints togo",
  wear: "worry worried worrying concern concerned wear wearing worn degrade degrading degradation deg gone dead shot finished done cooked old age aged fresh grip dropping",
  change: "change swap switch replace changing",
  weather: "weather rain raining rainy wet dry forecast sunny sun cloud clouds cloudy storm drizzle conditions humid humidity",
  temp: "temp temps temperature temperatures hot hotter cold colder warm warmer heat overheating overheat cooling cool degrees boiling",
  air: "track air ambient outside asphalt tarmac",
  oil: "oil", water: "water coolant", engine: "engine motor revs", boost: "boost turbo",
  pressure: "pressure pressures psi",
  brake: "brake brakes braking discs pads",
  ers: "battery ers hybrid deploy deployment harvest harvesting energy mgu", drs: "drs",
  gap: "gap gaps ahead behind",
  position: "position positions place standings leader leading lead winning winner rank ranked",
  chase: "chasing catching closing rival opponent",
  delta: "delta pace quick quicker faster slower losing lost gaining improve improving better costing",
  sector: "sector sectors",
  corner: "corner corners turn turns",
  advice: "advice tip tips suggestion suggestions coach coaching",
  best: "best fastest record personal benchmark target reference",
  prev: "last previous",
  box: "box pit pits pitstop pitting stop stops",
  damage: "damage damaged crash crashed broken",
  setup: "setup downforce aero wing springs camber differential diff gearing suspension",
  time: "time",
  race: "race session"
};
const STOP = new Set("a an the my me i is are am was were be been do does did can could would should will shall please hey okay ok tell give show say what whats how hows this that these those it its there any some you your we let get got have has had just really actually now so and or but if then than um uh er hmm yeah well also still on in at of to for with about from by as into over out much many more going will gonna wanna want need like".split(" "));

const WORDS = [];
const EXACT = new Map();
Object.keys(LEX).forEach(c => LEX[c].split(" ").forEach(w => { WORDS.push([w, c]); (EXACT.get(w) || EXACT.set(w, []).get(w)).push(c); }));

// edit distance with swaps, bounded
function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
// how a word sounds, roughly: "weather" and "whether" both -> "wthr"
function skeleton(w) {
  const s = w.replace(/ph/g, "f").replace(/wh/g, "w").replace(/ck/g, "k").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k");
  return s[0] + s.slice(1).replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");
}
const STEMS = w => {
  const o = [w];
  if (w.endsWith("'s")) o.push(w.slice(0, -2));
  if (w.length > 3 && w.endsWith("s")) o.push(w.slice(0, -1));
  if (w.length > 5 && w.endsWith("ing")) { o.push(w.slice(0, -3)); o.push(w.slice(0, -3) + "e"); }
  if (w.length > 4 && w.endsWith("ed")) { o.push(w.slice(0, -2)); o.push(w.slice(0, -1)); }
  if (w.length > 4 && w.endsWith("er")) o.push(w.slice(0, -2));
  return o;
};
const cache = new Map();
function concepts(tok) {
  if (cache.has(tok)) return cache.get(tok);
  let out = [];
  for (const s of STEMS(tok)) { const e = EXACT.get(s); if (e) { out = e; break; } }
  if (!out.length && tok.length >= 5 && !STOP.has(tok)) {
    let best = null;
    const max = tok.length >= 8 ? 2 : tok.length >= 5 ? 1 : 0, sk = tok.length >= 5 ? skeleton(tok) : null;
    for (const [w, c] of WORDS) {
      if (w.length < 4 || w[0] !== tok[0] && !(sk && w.length >= 5 && skeleton(w) === sk)) continue;
      const d = dist(tok, w, max);
      const sound = sk && w.length >= 5 && skeleton(w) === sk && w.slice(0, 2) === tok.slice(0, 2) && d <= 2;
      if (d <= max || sound) { const score = d <= max ? d : 1.5; if (!best || score < best.score) best = { score, c }; else if (score === best.score && !best.cs) best.cs = true; }
    }
    if (best) out = [best.c];
  }
  cache.set(tok, out);
  return out;
}

// ---------------------------------------------------------------------------------------------- 3. what they want
const NOTE_LEAD = /^(?:(?:please |can you |could you )?(?:make|take|add|log|write)(?: down)?(?: a)? ?note(?: that| of)?|note(?: that| down)?|log(?: that)?|remember(?: that)?|write(?: this)?(?: down)?|tell the (?:team|crew|engineers?)(?: that)?|feedback)\b[ ,:]*/;

// Car-feel remarks a driver makes without asking anything.
export const FEELS = [
  { id: "understeer", re: /\b(understeer|pushing|won'?t turn|washing out|front (?:is |feels )?(?:tight|heavy|pushing)|nose (?:is )?(?:pushing|wide))\b/,
    reply: "Understeer, noted. Brake a touch earlier and wait for the nose to bite before you add steering." },
  { id: "oversteer", re: /\b(oversteer|loose|snappy|rear (?:is |feels )?(?:loose|light|stepping)|tail(?: is)? (?:out|stepping)|spinning|spun)\b/,
    reply: "Loose rear, noted. Squeeze the throttle in on the exit and let the car settle before you commit." },
  { id: "lockup", re: /\b(lock(?:ing|ed)? up|locking|locked)\b/,
    reply: "Lock-ups, noted. Less pedal pressure at the start of the brake zone and release smoothly." },
  { id: "grip", re: /\b(no grip|lost(?: the)? grip|sliding|slippy|slippery|no traction)\b/,
    reply: "Low grip, noted. Check the tyre temperatures and give it a cooler lap if they're hot." },
  { id: "brakes", re: /\b(brakes? (?:are |feel |is )?(?:fading|soft|gone|spongy|hot)|brake fade)\b/,
    reply: "Brake fade, noted. Brake earlier and lighter for a couple of laps and let them cool on the straights." }
];

// phrases that are not about a number: talk about the radio itself
const RADIO = [
  ["repeat", /\b(repeat|say that again|say again|what was that(?! (?:lap|time))|come again|pardon|didn'?t (?:catch|hear)|one more time)\b/],
  ["check", /\b(radio check|comms check|mic check|can you hear me|are you there|testing)\b/],
  ["quiet", /\b(too much (?:talking|chatter|noise)|too chatty|too many calls|only (?:tell me |give me )?(?:the )?(?:important|key|essential)|be quiet|quiet|shut up|stop talking|stop the (?:chatter|calls|talking)|chatter|less (?:talking|calls|chatter)|fewer calls|only the important|talk less|speak less|say less|calm down)\b/],
  ["loud", /\b((?:give|send) me more|more updates|talk more|more (?:calls|chatter|info)|keep me (?:posted|informed)|say more|talk to me more|speak more|tell me more)\b/],
  ["help", /\b(what can i (?:ask|say)|what can you (?:do|tell|help|know|answer)|what do you (?:know|do)|help\b(?! me (?:go|get|be|find|improve|drive|to))|commands|what are you (?:able|good))\b/]
];

// the older phrase rules still catch what the word rules leave over
const RULES = [
  ["box", /\b(box|box box|pit|pit now|pit this lap|pit stop|come in|should i (?:box|pit|stop))\b/],
  ["best", /\b(best lap|fastest lap|personal best|my best|\bpb\b)\b/],
  ["last", /\b(last lap|previous lap|that lap|lap time|how long was|what was (?:my|that) (?:lap|time))\b/],
  ["gap", /\b(gap|behind me|ahead of me|car ahead|car behind|catching|interval|who'?s (?:ahead|behind))\b/],
  ["race", /\b(position|where am i (?:in|running)|standings?|race update|leader|points|what place|which place)\b/],
  ["fuel", /\b(fuel|litres|petrol|gas|save fuel|enough to finish)\b/],
  ["tyre", /\b(tyres|rubber|tyre temps?|tyre wear|temps|temperatures?|wear)\b/],
  ["gain", /\b(gain|faster|quicker|improve|better|find (?:me )?(?:some |more )?time|where can i|how (?:do|can) i (?:go |get )?(?:faster|quicker)|what should i (?:fix|work on|change))\b/],
  ["time", /\b(losing|lost time|slow(?:er|ing)?|sectors?|where am i (?:slow|losing|down)|time loss|what(?:'s| is) costing)\b/],
  ["delta", /\b(delta|pace|how am i (?:doing|looking|going)|am i (?:up|down|quick|fast)|predicted|on it|how'?s (?:the|my) lap)\b/]
];

export function isQuestion(raw) {
  const t = normalise(raw);
  return /\?\s*$/.test(String(raw || "").trim()) || /^(?:what|whats|how|hows|when|where|which|who|whos|why|is|are|am|do|does|did|can|could|will|would|should|tell me|give me|any|have|has)\b/.test(t) || / or /.test(t);
}

export function parseIntent(raw) {
  const t = normalise(raw);
  if (!t) return { id: null, text: "", rest: "" };
  const lead = t.match(NOTE_LEAD);
  if (lead) {
    const rest = t.slice(lead[0].length).trim();
    const feel = FEELS.find(f => f.re.test(rest));
    return { id: "note", text: t, rest, feel: feel || null };
  }
  for (const [id, re] of RADIO) if (re.test(t)) return { id, text: t, rest: "" };

  const toks = t.replace(/'/g, "").split(" ").filter(Boolean);
  const C = new Set(), hit = {};
  toks.forEach(w => concepts(w).forEach(c => { C.add(c); (hit[c] = hit[c] || []).push(w); }));
  const has = (...cs) => cs.some(c => C.has(c));
  const q = isQuestion(raw);
  const out = (id, slots) => ({ id, text: t, rest: "", slots: slots || {}, concepts: Array.from(C) });

  const feel = FEELS.find(f => f.re.test(t));
  if (feel && !q) return { id: "feel", text: t, rest: t, feel, slots: {}, concepts: Array.from(C) };

  const T = has("tyre");
  const how = /\b(how long|how many|how much|how far|when|until|before)\b/.test(t);
  // things the car does not send, or that we cannot change from here: said politely by the engineer
  if (has("damage")) return out("unsupported", { topic: "damage" });
  if (has("setup") && !T) return out("unsupported", { topic: "setup" });

  if (/\brun(?:ning)? (?:dry|out)\b|\bout of (?:fuel|petrol|gas)\b/.test(t)) return out("fuel");
  if (has("temp") && !has("oil", "water", "engine") && (/\b(?:front|rear) (?:left|right)\b|\b(?:fl|fr|rl|rr)\b/.test(t))) return out("tyre");
  if (has("weather") || (has("air") && /\b(like|looking|outside|out there)\b/.test(t) && !T && !has("lap", "time")) || (has("temp") && has("air") && !T && !has("oil", "water", "engine", "brake"))) return out("weather");
  if (!T && has("wear") && /\b(degradation|degrade|degrading|deg|worn|wearing)\b/.test(t)) return out("tyrelife");
  if (T && has("pressure")) return out("pressure");
  if (T && (/\b(compound|compounds|softs?|mediums?|hards?|inters?|wets?)\b/.test(t) || /\b(?:which|what)\b.*\b(?:am i|are we|have i got) on\b/.test(t)) && !has("life", "wear", "lap")) return out("compound");
  const lastLife = /\blast\b/.test(t) && !/\blast (?:lap|time|one|corner|sector)\b/.test(t);
  const goingOff = /\b(going off|gone off|fall(?:ing)? off|fell off|cliff|getting worse|losing grip|fading|about to go)\b/.test(t);
  if (T && (has("life", "lap", "wear", "change") || how || lastLife || goingOff)) return has("box") && !has("life", "lap", "wear") ? out("box") : out("tyrelife");
  if (T) return out("tyre");
  if (has("fuel")) return out("fuel");
  if (/\b(make it|enough|run out|reach the (?:end|flag)|(?:will|can|going to) i finish)\b/.test(t) || /\b(save|conserve|lift and coast)\b/.test(t)) return out("fuel");
  if (has("oil", "water", "engine", "boost")) return out("engine", { focus: has("oil") ? "oil" : has("water") ? "water" : has("boost") ? "boost" : "engine" });
  if (has("temp") && !has("brake")) return out("engine", { focus: "engine" });
  if (has("brake") && !/\b(where|later|earlier|harder|softer|easy|point|zone|marker)\b/.test(t)) return out("brakes");
  if (has("ers", "drs")) return out("ers", { focus: has("drs") ? "drs" : "ers" });
  if (/\b(how long was|how long did (?:that|the|my) lap|what time did i (?:just )?(?:do|get|set)|time did i just|lap take)\b/.test(t)) return out("last");
  if (/\bhow (?:long|much|many) (?:time |laps? |more )?(?:is |do we have |have we got )?(?:left|remaining)\b/.test(t)) return out("laps");
  if (/\bwhere(?:'s| is| are)? (?:the |my )?time (?:going|gone|lost|disappearing)\b|\bgiving away\b|\bwhere (?:am i|do i|are we) (?:giving|give|slow|losing|lose|down|dropping)|where.*(?:losing|lose|lost) (?:the most )?time\b/.test(t)) return out("time");
  if (/\bhow far (?:to|until) (?:the )?(?:flag|end|finish)\b|\bto the flag\b|\b(?:(?:laps?|race|time|minutes?) to go|how (?:long|far|much) to go|laps? (?:left|remaining|remain|togo))\b|\b(?:what|which) lap\b|\b(?:how much|how many).*\b(?:race|laps?|session)\b.*\b(?:left|remaining|remain|to go)\b/.test(t)) return out("laps");
  if (has("lap") && (has("life") || how) || (has("time") && has("life")) || /\bhow long is (?:the|this) (?:race|session)\b/.test(t)) return out("laps");

  if (/\b(?:ahead|behind|faster|quicker|slower|up|down)(?: of| than| on)? (?:my |the )?(?:best|reference)\b|\bam i on (?:a |the )?(?:good|bad|quick|fast|slow|decent) lap\b/.test(t)) return out("delta");
  if (/\bwhat did i (?:just )?(?:set|do|get|run)\b|\bhow did that lap go\b/.test(t)) return out("last");
  if (/\bwhich (?:corner|sector|turn|bit|part)\b|\bwhat(?:'s| is) (?:slowing|costing|holding) me\b/.test(t)) return out("time");
  if (has("advice") || /\b(?:find|get|gain|more) (?:more )?(?:pace|speed|time)\b|\bhow (?:do|can) i (?:be |go |get |find |improve)|\bwhat can i (?:improve|do better|work on)\b|\bwhere can i (?:improve|be quicker)\b/.test(t)) return out("gain");
  if (/\bin the race\b|\brace (?:update|status)\b/.test(t)) return out("race");
  if (/\b(?:car|guy|driver|man|cars) (?:in )?(?:front|ahead|behind)\b|\bin front\b|\bahead\b.*\bleader\b|\bleader\b.*\bahead\b|\bgap\b/.test(t)) return out("gap");
  if (/\b(how am i (?:doing|looking|going)|am i (?:up|down|quick|fast)|against (?:my |the )?best|vs (?:my |the )?best|versus (?:my |the )?best|compared (?:to|with) (?:my |the )?best|how(?:s| is) it (?:looking|going))\b/.test(t)) return out("delta");
  for (const [id, re] of RULES) if (re.test(t)) return out(id);
  if (has("gap", "chase")) return out("gap");
  if (has("position")) return out("race");
  if (has("best")) return out("best");
  if (has("prev") && has("lap", "time")) return out("last");
  if (has("box")) return out("box");
  if (has("delta", "sector")) return out(has("sector") ? "time" : "delta");
  if (has("corner") && q) return out("time");
  if (has("time") && has("lap")) return out("last");
  if (feel) return { id: "feel", text: t, rest: t, feel, slots: {}, concepts: Array.from(C) };
  if (/\bhow much\b.*\b(?:do i have|have i got|is left|is there|have we got|left)\b/.test(t)) return out("fuel");   // the usual "how much have I got" is the fuel
  return { id: null, text: t, rest: "", concepts: Array.from(C), question: q };
}

// ---------------------------------------------------------------------------------------------- polite words
export const HELP_LINE = "Ask me about your tyres and how long they'll last, fuel, laps to go, the gap, lap times, where you're losing time, the engine or the weather. Say note, then what you want logged. Say talk less or talk more to change how much I say.";

const SORRY = [
  "That one's outside what the car sends me. I can talk tyres, fuel, laps, the gap, lap times, the engine and the weather.",
  "I can't get that from the telemetry. Try tyres, fuel, delta, the gap, or where you're losing time.",
  "Sorry, I don't have that. Ask me about tyres, fuel, laps to go, lap times or the engine."
];
export function sorry(raw) {
  let h = 0; const s = String(raw || ""); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return SORRY[h % SORRY.length];
}
