
const fin = v => typeof v === "number" && isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const DEFAULT_PIT_LOSS = 22;

export class StintPlanner {
  constructor(opts) {
    opts = opts || {};
    this.pitLoss = opts.pitLoss || DEFAULT_PIT_LOSS;
    this.reset();
  }
  reset() {
    this.laps = [];
    this.stint = 0;
    this.stops = 0;
    this.plan = null;
  }
  setPitLoss(s) { if (fin(s) && s > 4 && s < 90) this.pitLoss = s; }

  noteLap(rec) {
    if (!rec || !fin(rec.ms) || rec.ms <= 0) return;
    this.laps.push({ n: rec.n, ms: rec.ms, fuel: rec.fuel, age: rec.age, valid: rec.valid !== false });
    if (this.laps.length > 60) this.laps.shift();
  }
  notePit() { this.stops++; this.stint = this.laps.length; }

  degradation() {
    const stint = this.laps.slice(this.stint).filter(l => l.valid && l.ms > 0);
    if (stint.length < 4) return null;
    const times = stint.map(l => l.ms).sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)];
    const use = stint.filter(l => Math.abs(l.ms - med) < 1500);
    if (use.length < 4) return null;
    const n = use.length;
    const mx = (n - 1) / 2;
    const my = use.reduce((a, l) => a + l.ms, 0) / n;
    let num = 0, den = 0;
    use.forEach((l, i) => { num += (i - mx) * (l.ms - my); den += (i - mx) * (i - mx); });
    if (!den) return null;
    return { perLapS: (num / den) / 1000, laps: n, medianMs: med };
  }

  fuelBurn() {
    const withFuel = this.laps.filter(l => fin(l.fuel));
    if (withFuel.length < 2) return null;
    const a = withFuel[Math.max(0, withFuel.length - 4)], b = withFuel[withFuel.length - 1];
    const laps = (b.n - a.n) || 1;
    const used = a.fuel - b.fuel;
    if (!(used > 0)) return null;
    return used / laps;
  }

  update(ctx) {
    ctx = ctx || {};
    const out = { ready: false, waiting: "", calls: [] };
    const total = ctx.totalLaps || 0;
    const lap = ctx.lap || 0;
    const left = total ? Math.max(0, total - lap) : null;
    const burn = this.fuelBurn();
    const deg = this.degradation();
    const lapS = this.laps.length ? this.laps[this.laps.length - 1].ms / 1000 : null;

    out.totalLaps = total;
    out.lapsLeft = left;
    out.burn = burn;
    out.deg = deg;
    out.pitLoss = this.pitLoss;
    out.stops = this.stops;

    if (!total) { out.waiting = "Set the race distance and I'll plan the stops."; return out; }
    if (!burn) { out.waiting = "One more full lap and I'll have the fuel burn."; return out; }

    const need = left * burn;
    const have = fin(ctx.fuel) ? ctx.fuel : null;
    if (have != null) {
      out.fuelNeed = need;
      out.fuelMargin = have - need;
      out.fuelLaps = have / burn;
      out.fuelShortLaps = out.fuelMargin < 0 ? Math.abs(out.fuelMargin) / burn : 0;
      if (out.fuelMargin < -0.2) {
        out.calls.push({
          id: "fuelplan", priority: 86, cooldown: 60000,
          text: "On this burn you're " + out.fuelShortLaps.toFixed(1) + " laps short at the flag. " +
                "Lift and coast from the braking boards or we're stopping again."
        });
      } else if (out.fuelMargin > burn * 1.5) {
        out.calls.push({
          id: "fuelspare", priority: 40, cooldown: 120000,
          text: "Fuel's comfortable \u2014 " + (out.fuelMargin / burn).toFixed(1) + " laps spare. You can push."
        });
      }
    }

    const stops = ctx.targetStops == null ? 1 : ctx.targetStops;
    out.targetStops = stops;
    if (stops > 0) {
      const even = Math.round(total / (stops + 1));
      let pitLap = even;
      if (deg && deg.perLapS > 0.02) {
        const costNow = deg.perLapS * (lap - this.stint);
        const lapsToBreakEven = Math.max(0, (this.pitLoss / 3 - costNow) / deg.perLapS);
        pitLap = clamp(Math.round(lap + lapsToBreakEven), lap + 1, Math.max(lap + 1, total - 3));
      }
      out.pitLap = pitLap;
      out.pitIn = pitLap - lap;
      out.degNote = deg
        ? (deg.perLapS > 0.02
            ? "Losing " + deg.perLapS.toFixed(2) + "s a lap on this set."
            : "Tyres are holding \u2014 no measurable drop yet.")
        : "Four timed laps and I'll have the degradation.";

      if (out.pitIn <= 0 && this.stops < stops) {
        out.calls.push({ id: "boxnow", priority: 92, cooldown: 30000,
          text: "Box this lap, box this lap." });
      } else if (out.pitIn === 1) {
        out.calls.push({ id: "boxnext", priority: 88, cooldown: 30000,
          text: "Box next lap. Get the in-lap right, it's worth three tenths." });
      } else if (out.pitIn <= 4 && out.pitIn > 1) {
        out.calls.push({ id: "boxsoon", priority: 54, cooldown: 90000,
          text: "Plan is to box in " + out.pitIn + " laps. " + out.degNote });
      }
    }

    if (deg && deg.perLapS > 0.03 && fin(ctx.gapAheadS) && ctx.gapAheadS < 4) {
      const onOldTyre = deg.perLapS * (lap - this.stint);
      const gainPerLap = clamp(onOldTyre, 0, 2.2);
      const overTwoLaps = gainPerLap * 2;
      out.undercutGain = overTwoLaps;
      out.undercutOn = overTwoLaps > ctx.gapAheadS;
      if (out.undercutOn) {
        out.calls.push({ id: "undercut", priority: 82, cooldown: 60000,
          text: "Undercut is on" + (ctx.nameAhead ? " on " + ctx.nameAhead : "") +
                ". Fresh tyres are worth about " + overTwoLaps.toFixed(1) +
                " seconds over two laps and he's only " + ctx.gapAheadS.toFixed(1) + " up the road. Box when you're ready."
        });
      }
    }
    if (fin(ctx.gapBehindS) && ctx.gapBehindS < this.pitLoss && ctx.gapBehindS > 0 && out.pitIn != null && out.pitIn <= 2) {
      out.calls.push({ id: "trafficexit", priority: 70, cooldown: 60000,
        text: "Careful \u2014 " + (ctx.nameBehind ? ctx.nameBehind : "the car behind") + " is " +
              ctx.gapBehindS.toFixed(1) + " back and the stop costs about " + this.pitLoss +
              ". You'll come out behind him unless we wait."
      });
    }

    if (ctx.safetyCar && /SAFETY/.test(ctx.safetyCar) && this.stops < (ctx.targetStops == null ? 1 : ctx.targetStops)) {
      out.calls.push({ id: "scpit", priority: 95, cooldown: 40000,
        text: "Safety car \u2014 this is a cheap stop. Box now if you're going to." });
    }

    const f = (ctx.forecast || []).filter(x => x && x.rainPct >= 40)[0];
    if (f) {
      out.rain = f;
      out.calls.push({ id: "rain", priority: 78, cooldown: 180000,
        text: f.rainPct + " percent chance of rain in " + f.inMin + " minutes. Keep it in mind before we commit to a set."
      });
    }

    out.ready = true;
    out.lapS = lapS;
    return (this.plan = out);
  }
}

export class GhostCoach {
  constructor() { this.cues = []; this.fired = {}; this.lap = -1; }

  load(verdicts, lapN) {
    this.lap = lapN;
    this.fired = {};
    this.cues = (verdicts || [])
      .filter(v => v.lost > 0.05 && v.tags && v.tags.length)
      .sort((a, b) => b.lost - a.lost)
      .slice(0, 5)
      .map(v => ({ at: Math.max(0, v.d0 - 110), name: v.name, text: cueFor(v) }))
      .filter(c => c.text)
      .sort((a, b) => a.at - b.at);
    return this.cues.length;
  }

  at(dist, lapN) {
    if (lapN !== this.lap) { this.fired = {}; this.lap = lapN; }
    for (const c of this.cues) {
      if (this.fired[c.name]) continue;
      if (dist >= c.at && dist < c.at + 60) {
        this.fired[c.name] = true;
        return { id: "ghost" + c.name, tag: "GHOST", priority: 74, cooldown: 4000,
          meta: { corner: c.name, event: "GHOST_CUE" }, text: c.text };
      }
    }
    return null;
  }
}

function cueFor(v) {
  const tag = (v.tags || [])[0] || "";
  const brake = (v.tags || []).filter(t => /^BRAKE /.test(t))[0];
  const thr = (v.tags || []).filter(t => /^THROTTLE /.test(t))[0];
  const minv = (v.tags || []).filter(t => /^MIN SPEED /.test(t))[0];
  if (brake && /EARLY/.test(brake)) {
    const m = brake.match(/(\d+)/);
    return v.name + " coming \u2014 brake " + (m ? m[1] : "a few") + " metres later.";
  }
  if (brake && /LATE/.test(brake)) return v.name + " \u2014 you've been overshooting. Brake a touch earlier and get it turned.";
  if (thr) return v.name + " \u2014 get on the power earlier out of this one.";
  if (minv) return v.name + " \u2014 you're slow through the middle. Carry more speed.";
  if (/UNDERSTEER/.test(tag)) return v.name + " \u2014 it's washing out. Slow the hands, wait for the nose.";
  if (/OVERSTEER/.test(tag)) return v.name + " \u2014 rear steps out here. Be smoother on the throttle.";
  if (/^LINE /.test(tag)) return v.name + " \u2014 you're off your own line here. Wider entry.";
  return "";
}
