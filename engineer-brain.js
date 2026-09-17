
export const DOMAINS = [
  { id: "braking",  label: "Braking",     needs: 30, rule: "Peak pressure at the start of the stop, bled off as the wheel turns. Pressure and steering should never both be rising.", cue: "Hit it harder, then release earlier." },
  { id: "entry",    label: "Entry",       needs: 30, rule: "Minimum speed belongs before the apex, not at it. Arriving slow and early costs less than arriving fast and running wide.", cue: "Slow the entry, carry the exit." },
  { id: "apex",     label: "Apex",        needs: 30, rule: "One apex, taken late enough that the exit is already straightening. Two apexes in one corner means the line was wrong on the way in.", cue: "Later apex here." },
  { id: "exit",     label: "Exit",        needs: 30, rule: "Throttle is a ramp, not a switch. Full throttle should arrive as the wheel reaches centre.", cue: "Feed it earlier, all the way to the kerb." },
  { id: "traction", label: "Traction",    needs: 40, rule: "Slip over about eight per cent is heat, not speed. Wheelspin on exit costs the next two hundred metres.", cue: "Ease it — you are spinning the rears." },
  { id: "tyres",    label: "Tyres",       needs: 40, rule: "Surface temperature is the only tyre figure GT7 broadcasts. Rising temperature across a stint means the front is working; a single hot corner means the line is.", cue: "Front left is taking it. Ease the first sector." },
  { id: "fuel",     label: "Fuel",        needs: 20, rule: "Consumption per lap is stable inside a stint. Short-filling is worth the stop only when the time saved exceeds the pit loss.", cue: "Fuel is good for eleven, plus reserve." },
  { id: "consist",  label: "Consistency", needs: 25, rule: "A repeatable driver is faster over a race than a fast one. The spread across a stint matters more than the single best lap.", cue: "Same again. Do not chase it." },
  { id: "racecraft",label: "Racecraft",   needs: 15, rule: "Position is held on exit, not on entry. Defending the apex loses the corner after it.", cue: "Let them have the apex. Take the exit." }
];

export function domain(id) { return DOMAINS.filter(d => d.id === id)[0] || null; }

const STORE_KEY = "gt7dash.brain";

export class EngineerBrain {
  constructor(opts) {
    opts = opts || {};
    this.driverType = null;
    this.obs = {};
    this.log = [];
    this.community = {};
    this.load();
  }

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (d) {
        this.obs = d.obs || {};
        this.log = Array.isArray(d.log) ? d.log.slice(0, 200) : [];
        this.community = d.community || {};
        this.driverType = d.driverType || null;
      }
    } catch (e) {}
  }
  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        obs: this.obs, log: this.log.slice(0, 200),
        community: this.community, driverType: this.driverType
      }));
    } catch (e) {}
  }

  record(domainId, v, tag) {
    const o = this.obs[domainId] || (this.obs[domainId] = { n: 0, sum: 0, sumSq: 0, tags: {} });
    o.n++;
    if (typeof v === "number") { o.sum += v; o.sumSq += v * v; }
    if (tag) o.tags[tag] = (o.tags[tag] || 0) + 1;
  }

  note(entry) {
    this.log.unshift(Object.assign({ at: Date.now() }, entry));
    this.log = this.log.slice(0, 200);
    this.save();
  }

  stat(domainId) {
    const o = this.obs[domainId];
    if (!o || !o.n) return { n: 0, mean: null, sd: null, top: null, confidence: 0 };
    const mean = o.sum / o.n;
    const varc = Math.max(0, o.sumSq / o.n - mean * mean);
    const tags = Object.keys(o.tags).sort((a, b) => o.tags[b] - o.tags[a]);
    const d = domain(domainId);
    return {
      n: o.n, mean, sd: Math.sqrt(varc),
      top: tags[0] || null, tagCount: tags[0] ? o.tags[tags[0]] : 0,
      confidence: Math.min(1, o.n / ((d && d.needs) || 30))
    };
  }

  ingestLap(lap, verdicts, sessionLaps) {
    if (!lap || !lap.samples || lap.samples.length < 20) return;
    const S = lap.samples;

    const idle = S.filter(s => (s.throttle || 0) < 3 && (s.brake || 0) < 3).length;
    const coastPct = (idle / S.length) * 100;
    this.record("entry", coastPct, coastPct > 12 ? "coasting" : "committed");

    const both = S.filter(s => (s.brake || 0) > 8 && (s.throttle || 0) > 8).length;
    this.record("braking", (both / S.length) * 100, both / S.length > 0.06 ? "overlap" : "clean release");

    const spin = S.filter(s => s.throttle > 60 && s.slip0 > 1.08).length;
    if (S.some(s => typeof s.slip0 === "number")) {
      this.record("traction", (spin / S.length) * 100, spin > S.length * 0.03 ? "spinning" : "hooked up");
    }

    const t0 = S[0].tt0, t1 = S[S.length - 1].tt0;
    if (typeof t0 === "number" && typeof t1 === "number") {
      this.record("tyres", t1 - t0, t1 - t0 > 6 ? "building heat" : "stable");
    }

    if (typeof lap.fuelUsed === "number" && lap.fuelUsed > 0) {
      this.record("fuel", lap.fuelUsed, "burn logged");
    }

    const times = (sessionLaps || []).map(l => l.ms).filter(x => x > 0);
    if (times.length >= 3) {
      const spread = (Math.max.apply(null, times) - Math.min.apply(null, times)) / 1000;
      this.record("consist", spread, spread < 1 ? "repeatable" : spread < 2.5 ? "settling" : "scattered");
    }

    (verdicts || []).forEach(v => {
      const tag = (v.tags && v.tags[0]) || v.verdict;
      if (v.verdict === "lost" || (v.lost || 0) > 0.05) this.record("apex", v.lost || 0, tag);
      else this.record("exit", v.lost || 0, tag);
      if (v.tags && v.tags.some(x => /brak/i.test(x))) this.record("braking", v.lost || 0, "late brake");
    });

    this.save();
  }

  traits() {
    const T = [];
    const add = (id, label, fn) => {
      const st = this.stat(id);
      const d = domain(id);
      T.push(Object.assign({
        id, label, domain: d ? d.label : id,
        samples: st.n, confidence: st.confidence,
        established: st.n >= (d ? d.needs : 30)
      }, st.n ? fn(st) : { verdict: "Not observed yet", detail: "Needs " + (d ? d.needs : 30) + " laps of this before it is worth saying.", value: null }));
    };

    add("braking", "Brake release", st => ({
      verdict: st.mean > 6 ? "Trails the brake deep" : st.mean > 2 ? "Some overlap on entry" : "Releases cleanly",
      detail: st.mean.toFixed(1) + "% of the lap with both pedals loaded · most often " + (st.top || "—"),
      value: st.mean
    }));
    add("entry", "Commitment", st => ({
      verdict: st.mean > 14 ? "Coasts between the pedals" : st.mean > 8 ? "Small gaps on entry" : "Commits early",
      detail: st.mean.toFixed(1) + "% of the lap on neither pedal",
      value: st.mean
    }));
    add("traction", "Throttle discipline", st => ({
      verdict: st.mean > 4 ? "Spins the rears on exit" : st.mean > 1.5 ? "Occasional slip" : "Clean on exit",
      detail: st.mean.toFixed(1) + "% of the lap over the slip threshold · " + (st.top || "—"),
      value: st.mean
    }));
    add("tyres", "Tyre management", st => ({
      verdict: st.mean > 8 ? "Heats the fronts hard" : st.mean > 3 ? "Builds temperature steadily" : "Keeps them in the window",
      detail: "front left up " + st.mean.toFixed(1) + "°C across a lap · surface temperature only",
      value: st.mean
    }));
    add("consist", "Repeatability", st => ({
      verdict: st.mean < 1 ? "Very repeatable" : st.mean < 2.5 ? "Settles after a few laps" : "Scattered lap to lap",
      detail: "typical spread " + st.mean.toFixed(2) + "s across a stint",
      value: st.mean
    }));
    return T;
  }

  profile() {
    const T = this.traits().filter(x => x.established);
    if (T.length < 2) return null;
    const by = id => T.filter(x => x.id === id)[0];
    const c = by("consist"), e = by("entry"), tr = by("traction");
    if (c && c.value < 1 && (!tr || tr.value < 2)) return "Metronomic. Advice should be about finding the last tenth, not about tidying up.";
    if (tr && tr.value > 4) return "Fast hands, loose exits. Worth spending a session on throttle application alone.";
    if (e && e.value > 14) return "Loses time between the pedals rather than in the corners. Entry commitment is the cheapest gain available.";
    return "Balanced. No single domain stands out as the thing to fix next.";
  }

  level() {
    const est = DOMAINS.filter(d => this.stat(d.id).n >= d.needs).length;
    const stages = [
      { n: 1, label: "Listening", says: "Lap times and fuel only. No opinions yet." },
      { n: 2, label: "Forming a view", says: "Enough of one domain to start pointing at it." },
      { n: 3, label: "Coaching", says: "Corner-level advice, tied to your own reference lap." },
      { n: 4, label: "Anticipating", says: "Calls arrive before the corner instead of after the mistake." },
      { n: 5, label: "Tuned to you", says: "Advice weighted to the domains you personally lose time in." }
    ];
    const n = Math.max(1, Math.min(5, 1 + Math.floor(est / 2)));
    const cur = stages[n - 1];
    const next = stages[n] || null;
    return {
      n, label: cur.label, says: cur.says,
      established: est, of: DOMAINS.length,
      next: next ? next.label : null,
      need: next ? (n * 2) : null
    };
  }

  graph(size) {
    const S = size || 100, R = S * 0.36, cx = S / 2, cy = S / 2;
    const nodes = DOMAINS.map((d, i) => {
      const a = (i / DOMAINS.length) * Math.PI * 2 - Math.PI / 2;
      const st = this.stat(d.id);
      return {
        id: d.id, label: d.label,
        x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R,
        confidence: st.confidence, samples: st.n,
        established: st.n >= d.needs
      };
    });
    return { size: S, cx, cy, nodes };
  }

  compare(trackId, myBestMs) {
    const c = this.community[trackId];
    if (!c) return { have: false };
    const med = c.medianMs || null;
    return {
      have: true, samples: c.samples || 0, fetched: c.at || null,
      medianMs: med, bestMs: c.bestMs || null, p10Ms: c.p10Ms || null,
      toMedian: med && myBestMs ? (myBestMs - med) / 1000 : null,
      toBest: c.bestMs && myBestMs ? (myBestMs - c.bestMs) / 1000 : null,
      car: c.car || null
    };
  }
  putCommunity(trackId, data) {
    this.community[trackId] = Object.assign({ at: Date.now() }, data);
    this.save();
  }
}

export async function fetchCommunity(url, query) {
  const u = new URL(url);
  if (query && query.trackId) u.searchParams.set("track", query.trackId);
  if (query && query.carId) u.searchParams.set("car", String(query.carId));
  const res = await fetch(u.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error("community HTTP " + res.status);
  const b = await res.json();
  if (!b || !b.samples) throw new Error("community empty");
  return { samples: b.samples, medianMs: b.medianMs, bestMs: b.bestMs, p10Ms: b.p10Ms, car: b.car || null };
}

export const COMMUNITY_URL = "https://catalogue.raceengineer.app/gt7/community";
