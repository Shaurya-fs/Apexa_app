
const CHATTER_FLOOR = { Minimal: 62, Essential: 38, Talkative: 0 };
const fin = v => typeof v === "number" && isFinite(v);

const TENTHS = ["", "a tenth", "two tenths", "three tenths", "four tenths", "half a second",
  "six tenths", "seven tenths", "eight tenths", "nine tenths"];
export function tenths(x) {
  const a = Math.abs(x);
  if (a < 0.045) return "a few hundredths";
  if (a < 0.95) return TENTHS[Math.round(a * 10)] || "nine tenths";
  if (a < 1.15) return "a second";
  if (a < 1.75) return "a second and a half";
  return a.toFixed(1) + " seconds";
}
function lapTime(ms) {
  if (!fin(ms) || ms <= 0) return "no time";
  const s = ms / 1000, m = Math.floor(s / 60), r = s - m * 60;
  return m + ":" + (r < 10 ? "0" : "") + r.toFixed(3);
}
const SECTOR = ["Sector one", "Sector two", "Sector three"];
const sectorName = i => SECTOR[i] || "Sector " + (i + 1);

const TYRE_NAMES = ["front left", "front right", "rear left", "rear right"];
const tyreBand = tp => (!fin(tp) ? null : tp < 60 ? "cold" : tp < 78 ? "warming" : tp <= 103 ? "window" : "hot");

function secs(x) {
  if (!fin(x)) return "no gap";
  if (x < 0.35) return "right on him";
  if (x < 1.05) return x.toFixed(1) + " of a second";
  return x.toFixed(1) + " seconds";
}

export class RaceCoach {
  constructor() {
    this.said = {};
    this.magnitude = {};
    this.rot = {};
    this.lastId = null;
    this.lastAny = 0;
    this.lapFlags = {};
    this.lap = null;
    this.persona = "CALM";
    this.lastPos = 0;
    this.lastPen = 0;
    this.gaps = [];
    this.lapMsHint = 90000;
    this.refSaid = 0;
  }
  setPersona(p) { this.persona = p || "CALM"; }
  noteLap(n) { if (n !== this.lap) { this.lap = n; this.lapFlags = {}; } }

  vary(id, pool) {
    const i = (this.rot[id] = (this.rot[id] || 0) + 1) - 1;
    return pool[i % pool.length];
  }

  fromEvents(events, ctx) {
    const out = [];
    (events || []).forEach(e => {
      if (e.kind === "reference") {
        out.push({ id: "ref", tag: "SYSTEM", priority: 70, cooldown: 20000,
          text: this.refSaid++ ? "Reference is now " + lapTime(e.lapMs) + "." : "Got a clean lap on record, " + lapTime(e.lapMs) + ". Delta's live from here." });
      }
      if (e.kind === "lap") out.push.apply(out, this.lapMessages(e, ctx));
      if (e.kind === "sector") {
        out.push.apply(out, this.previewTips(e, ctx));
        if (!fin(e.delta) || Math.abs(e.delta) < 0.15) return;
        const up = e.delta < 0;
        out.push({ id: "sector" + e.index, tag: "SECTOR", priority: 42, cooldown: 25000,
          meta: { corner: "S" + (e.index + 1), event: "SECTOR_DELTA", change: e.delta },
          text: this.vary("sector", [
            sectorName(e.index) + ", " + tenths(e.delta) + (up ? " up." : " down."),
            (up ? "Good sector, " : "Lost time there, ") + tenths(e.delta) + (up ? " to the good." : " away."),
            sectorName(e.index) + " " + (up ? "green" : "red") + " by " + tenths(e.delta) + "."
          ]) });
      }
      if (e.kind === "corner") { out.push.apply(out, this.cornerMessages(e, ctx)); out.push.apply(out, this.techniqueNow(e, ctx)); }
    });
    return out;
  }

  lapMessages(e, ctx) {
    const out = [];
    out.push.apply(out, this.tyreCheck(e, ctx));
    if (!e.valid) {
      out.push({ id: "invalid", tag: "LAP", priority: 45, cooldown: 20000,
        text: "That one won't count, distance was short. Next one clean." });
      return out;
    }
    if (e.best) {
      out.push({ id: "best", tag: "LAP", priority: 82, cooldown: 8000,
        meta: { corner: "LAP " + e.lapN, event: "NEW_BEST", ms: e.ms, lapN: e.lapN },
        text: this.vary("best", [
          "New best. " + lapTime(e.ms) + ". That's the reference now.",
          lapTime(e.ms) + ". Best of the session. Do it again.",
          "Personal best, " + lapTime(e.ms) + ". Nothing needs changing."
        ]) });
    } else if (fin(e.delta)) {
      const worst = (e.sectorDeltas || []).reduce((a, v, i) => (fin(v) && (!a || v > a.v) ? { v, i } : a), null);
      const where = worst && worst.v > 0.08 ? " " + sectorName(worst.i) + " is where it went, " + tenths(worst.v) + "." : "";
      out.push({ id: "lapdone", tag: "LAP", priority: 52, cooldown: 8000,
        meta: { corner: "LAP " + e.lapN, event: "LAP_COMPLETE", change: e.delta, ms: e.ms, lapN: e.lapN },
        text: lapTime(e.ms) + ", " + tenths(e.delta) + (e.delta > 0 ? " off the reference." : " up on the reference.") + where });
    }
    const losses = (e.events || []).filter(c => fin(c.deltaChange) && c.deltaChange > 0.12)
      .sort((a, b) => b.deltaChange - a.deltaChange);
    if (losses.length > 1) {
      out.push({ id: "lapfocus", tag: "COACHING", priority: 44, cooldown: 30000,
        text: "Two places to find it. " + losses.slice(0, 2).map(c => c.name).join(" and ") +
              ". Work on " + losses[0].name + " first, that's " + tenths(losses[0].deltaChange) + "." });
    }
    return out;
  }

  // every 2nd lap: are the tyres actually in the window (ambient() handles overheat alerts)
  tyreCheck(e, ctx) {
    const T = ctx.tyres;
    if (!Array.isArray(T) || T.length !== 4 || !fin(e.lapN) || e.lapN % 2 !== 0) return [];
    const bands = T.map(tyreBand);
    if (bands.some(b => b === null)) return [];
    const bad = bands.map((b, i) => ({ i, b, tp: T[i] })).filter(x => x.b !== "window");
    if (!bad.length) {
      return [{ id: "tyrecheck-ok", tag: "TYRE", priority: 50, cooldown: 15000,
        meta: { corner: "TYRES", event: "TYRES_OPTIMAL", lapN: e.lapN },
        text: this.vary("tyreok", [
          "Tyres are in the window, all four corners. Optimal.",
          "Tyre temps look good across the board.",
          "All four in the window. Keep doing what you're doing."
        ]) }];
    }
    bad.sort((a, b) => Math.abs(b.tp - 90) - Math.abs(a.tp - 90));
    const w = bad[0];
    const name = TYRE_NAMES[w.i];
    const why = w.b === "cold" ? "still cold" : w.b === "warming" ? "still building heat" : "over the window";
    return [{ id: "tyrecheck-bad", tag: "TYRE", priority: 54, cooldown: 15000,
      meta: { corner: "TYRES", event: "TYRES_NOT_OPTIMAL", lapN: e.lapN, worst: w.i, temp: Math.round(w.tp) },
      text: "Tyres aren't optimal yet. " + name.charAt(0).toUpperCase() + name.slice(1) + "'s " + why +
            ", " + Math.round(w.tp) + " degrees." + (bad.length > 1 ? " Others are settling too." : "") }];
  }

  cornerMessages(e, ctx) {
    const c = e.corner, ref = e.ref;
    if (!fin(c.deltaChange)) return [];
    const lost = c.deltaChange;
    if (lost > 0.1) {
      let why = "";
      if (ref) {
        const dv = c.entrySpeed - ref.entrySpeed;
        const dw = c.throttleWait - ref.throttleWait;
        if (dv > 5) why = " Too hot on entry, " + Math.round(dv) + " k p h. Brake earlier and you'll get on power sooner.";
        else if (dv < -5) why = " You're " + Math.round(-dv) + " k p h slower on entry. Carry more in.";
        else if (dw > 0.15) why = " You're back on throttle " + tenths(dw) + " late.";
        else if (c.minSpeed < ref.minSpeed - 4) why = " Mid-corner speed's down " + Math.round(ref.minSpeed - c.minSpeed) + " k p h. Carry more through the middle.";
      }
      if (!why && c.wheelspin > 1.15) why = " That was wheelspin on the exit.";
      if (!why && fin(c.lock) && c.lock < 0.82) why = " You locked the fronts going in.";
      return [{ id: "loss" + c.index, tag: "COACHING", priority: 56, cooldown: 18000,
        meta: { corner: c.name, event: "DELTA_LOSS", change: lost, entrySpeed: Math.round(c.entrySpeed), minSpeed: Math.round(c.minSpeed) },
        text: c.name + ", " + tenths(lost) + " lost." + why }];
    }
    if (lost < -0.1) {
      return [{ id: "gain" + c.index, tag: "COACHING", priority: 34, cooldown: 25000,
        meta: { corner: c.name, event: "DELTA_GAIN", change: lost, entrySpeed: Math.round(c.entrySpeed) },
        text: this.vary("gain", [
          c.name + " was " + tenths(lost) + " better. Keep that.",
          "That's " + tenths(lost) + " in " + c.name + ". Same again.",
          c.name + " green by " + tenths(lost) + "."
        ]) }];
    }
    return [];
  }

  ambient(ctx) {
    const out = [], f = ctx.frame || {}, d = ctx.delta || {}, T = ctx.tyres || [];
    this.noteLap(ctx.lap);

    if (f.waterTemp > 112) out.push({ id: "water", tag: "CRITICAL", priority: 96, cooldown: 45000,
      text: "Water's at " + Math.round(f.waterTemp) + ". Lift on the straights, give it air." });
    if (f.oilTemp > 135) out.push({ id: "oil", tag: "CRITICAL", priority: 94, cooldown: 45000,
      text: "Oil's at " + Math.round(f.oilTemp) + ". Short shift, back off a lap." });

    const hottest = T.length ? T.reduce((a, v, i) => (v > T[a] ? i : a), 0) : -1;
    if (hottest >= 0 && T[hottest] > 103) {
      const name = ["front left", "front right", "rear left", "rear right"][hottest];
      out.push({ id: "tyre", tag: "TYRE", priority: 68, cooldown: 40000, oncePerLap: true,
        escalate: Math.round(T[hottest]), escalateBy: 4,
        meta: { corner: "TYRES", event: "TYRE_OVERHEAT", peak: Math.round(T[hottest]) },
        text: this.vary("tyre", [
          "The " + name + " is over the window at " + Math.round(T[hottest]) + ". Less steering angle, more patience.",
          name.charAt(0).toUpperCase() + name.slice(1) + " " + Math.round(T[hottest]) + " degrees. Give it a cool lap or you'll lose the end of the run.",
          "Watch the " + name + ", " + Math.round(T[hottest]) + " and climbing."
        ]) });
    }
    const spread = T.length === 4 ? Math.max.apply(null, T) - Math.min.apply(null, T) : 0;
    if (spread > 18 && T.length === 4) out.push({ id: "spread", tag: "TYRE", priority: 40, cooldown: 60000, oncePerLap: true,
      text: "Big spread across the axle. You're leaning on one corner." });

    if (fin(f.fuel) && f.fuel > 0 && ctx.fuelPerLap > 0) {
      const laps = f.fuel / ctx.fuelPerLap;
      if (laps < 2.2) out.push({ id: "fuelcrit", tag: "FUEL", priority: 88, cooldown: 40000,
        text: "Fuel's critical. " + laps.toFixed(1) + " laps. Short shift, lift early." });
      else if (laps < 4) out.push({ id: "fuel", tag: "FUEL", priority: 58, cooldown: 70000, oncePerLap: true,
        text: "Fuel for " + laps.toFixed(1) + " laps. Save a tenth of a litre a lap from here." });
    }

    if (f.revLimiter) this.limFrames = (this.limFrames || 0) + 1; else this.limFrames = 0;
    if (this.limFrames > 45) out.push({ id: "limiter", tag: "COACHING", priority: 24, cooldown: 90000, oncePerLap: true,
      text: this.vary("limiter", [
        "You're on the limiter. Shift a touch earlier.",
        "Bouncing off the limiter down that straight. Nothing there."
      ]) });

    if (!d.hasReference && ctx.lapCount === 0 && ctx.moving) {
      out.push({ id: "norefyet", tag: "SYSTEM", priority: 64, cooldown: 120000,
        text: "No reference yet. Give me one clean lap and the delta comes alive." });
    }
    if (d.hasReference && d.deltaTrend === "losing" && fin(d.liveDelta) && d.liveDelta > 0.45) {
      out.push({ id: "drifting", tag: "PACE", priority: 46, cooldown: 25000,
        text: this.vary("drifting", [
          "You're " + tenths(d.liveDelta) + " down and it's still going the wrong way. Reset. One corner at a time.",
          tenths(d.liveDelta) + " off the reference. Stop chasing it, build it back."
        ]) });
    }
    if (d.hasReference && fin(d.liveDelta) && d.liveDelta < -0.35 && d.trackProgress > 0.7) {
      out.push({ id: "onit", tag: "PACE", priority: 36, cooldown: 30000,
        text: tenths(d.liveDelta) + " up with the last sector to go. Nothing silly." });
    }

    if (ctx.validLapCount >= 3 && fin(ctx.consistency) && ctx.consistency < 0.6) {
      out.push({ id: "consist", tag: "COACHING", priority: 38, cooldown: 120000, oncePerLap: true,
        text: "Your laps are spread over " + ctx.spreadS.toFixed(1) + " seconds. Repeatable is quicker than brave, every time." });
    }
    return out;
  }

  race(ctx) {
    const out = [], F = (ctx.frame && ctx.frame.f1) || null;
    if (!F || !F.position) return out;

    const now = ctx.nowMs;
    const ahead = fin(F.gapAheadMs) && F.gapAheadMs > 0 ? F.gapAheadMs / 1000 : null;
    const behind = fin(F.gapBehindMs) && F.gapBehindMs > 0 ? F.gapBehindMs / 1000 : null;
    const trend = this.gapTrend(now, ahead, behind);
    const pos = F.position, cars = ctx.frame.carsOnTrack || 0;
    const racing = /Race|Qualifying|Practice/.test(F.sessionType || "") ;
    const nA = F.nameAhead || "", nB = F.nameBehind || "";
    const him = nA || "the car ahead", he = nA || "he";
    const chaser = nB || "the car behind", heB = nB || "he";

    if (this.lastPos && pos !== this.lastPos) {
      const gained = pos < this.lastPos;
      out.push({ id: "pos", tag: "RACE", priority: 84, cooldown: 4000,
        meta: { corner: "P" + pos, event: gained ? "POSITION_GAIN" : "POSITION_LOSS" },
        text: gained
          ? this.vary("posup", [
              "That's P" + pos + ". Good move, head down.",
              "P" + pos + " now. Well done — build a gap.",
              "Up to P" + pos + "."
            ])
          : this.vary("posdn", [
              "We've dropped to P" + pos + ". Stay calm, we'll get it back.",
              "P" + pos + " now. Settle in behind him and learn where he's weak.",
              "Down to P" + pos + "."
            ]) });
    }
    this.lastPos = pos;

    if (racing && (ahead !== null || behind !== null)) {
      out.push({ id: "standing", tag: "RACE", priority: 50, cooldown: 55000, oncePerLap: true,
        text: "P" + pos + (cars ? " of " + cars : "") + ". " + this.gapLine(ahead, behind, nA, nB) });
    }

    if (ahead !== null && ahead < 4 && trend.aheadRate < -0.04) {
      const lapsOut = trend.aheadRate < -0.05 ? Math.max(1, Math.round(ahead / Math.abs(trend.aheadRate))) : null;
      out.push({ id: "closing", tag: "RACE", priority: 66, cooldown: 22000,
        meta: { corner: "P" + (pos - 1), event: "CLOSING", change: trend.aheadRate },
        text: this.vary("closing", [
          "You're catching " + him + ". " + secs(ahead) + " to " + (nA ? "him" : "the car ahead") +
            (lapsOut ? ", that's about " + lapsOut + (lapsOut === 1 ? " lap" : " laps") + " to the back of him." : "."),
          secs(ahead) + " to " + him + ", coming down " + tenths(trend.aheadRate) + " a lap. Keep it clean.",
          "Gap to " + him + " is " + secs(ahead) + ". You're quicker than " + he + " — stay patient."
        ]) });
    }

    if (ahead !== null && ahead <= 1.0 && F.drsAllowed) {
      out.push({ id: "drsrange", tag: "RACE", priority: 80, cooldown: 15000,
        text: this.vary("drsrange", [
          "You're inside a second on " + him + " — DRS is yours on the straight.",
          "In the window on " + him + ". Get the exit right and use the flap."
        ]) });
    } else if (ahead !== null && ahead <= 1.6 && ahead > 1.0) {
      out.push({ id: "drsclose", tag: "RACE", priority: 60, cooldown: 25000,
        text: secs(ahead) + " to " + him + ". Find three tenths and you've got DRS." });
    }

    if (behind !== null && behind < 1.0) {
      out.push({ id: "defend", tag: "RACE", priority: 76, cooldown: 20000,
        meta: { corner: "P" + (pos + 1), event: "UNDER_PRESSURE" },
        text: this.vary("defend", [
          chaser.charAt(0).toUpperCase() + chaser.slice(1) + " is within a second — " + heB + "'ll have DRS. Defend the inside.",
          secs(behind) + " to " + chaser + " and " + heB + " has the flap. Cover the line into the braking zone.",
          (nB ? nB + " is" : "Car behind is") + " on you. Protect the apex, don't overdrive it."
        ]) });
    } else if (behind !== null && behind < 2.5 && trend.behindRate < -0.05) {
      out.push({ id: "caught", tag: "RACE", priority: 62, cooldown: 30000,
        text: (nB || "He") + " is taking " + tenths(trend.behindRate) + " a lap out of you. " + secs(behind) + " behind now." });
    } else if (behind !== null && behind > 2.5 && trend.behindRate > 0.05) {
      out.push({ id: "clear", tag: "RACE", priority: 34, cooldown: 70000, oncePerLap: true,
        text: "You're pulling clear behind, " + secs(behind) + " and growing. Manage it from here." });
    }

    if (racing && ahead !== null && behind !== null && ahead > 5 && behind > 5) {
      out.push({ id: "clearair", tag: "RACE", priority: 30, cooldown: 120000, oncePerLap: true,
        text: "Clear air both ways. Drive your own race, look after the tyres." });
    }

    if (F.penalties > 0 && F.penalties !== this.lastPen) {
      out.push({ id: "pen", tag: "CRITICAL", priority: 90, cooldown: 20000,
        text: F.penalties + " second" + (F.penalties === 1 ? "" : "s") + " of penalty. You need that much of a gap by the flag." });
    }
    this.lastPen = F.penalties;

    if (fin(F.tyreAge) && F.tyreAge >= 18) {
      out.push({ id: "tyreage", tag: "TYRE", priority: 44, cooldown: 90000, oncePerLap: true,
        text: (F.compound || "These") + "s are " + F.tyreAge + " laps old. Expect the rears to go before the fronts." });
    }
    return out;
  }

  gapTrend(now, ahead, behind) {
    this.gaps = this.gaps || [];
    const last = this.gaps[this.gaps.length - 1];
    if (!last || now - last.t > 1000) {
      this.gaps.push({ t: now, a: ahead, b: behind });
      if (this.gaps.length > 40) this.gaps.shift();
    }
    const old = this.gaps.find(g => now - g.t > 12000 && now - g.t < 40000);
    if (!old) return { aheadRate: 0, behindRate: 0 };
    const per = (nowV, oldV) => {
      if (!fin(nowV) || !fin(oldV)) return 0;
      const lapS = (this.lapMsHint || 90000) / 1000;
      return ((nowV - oldV) / ((now - old.t) / 1000)) * lapS;
    };
    return { aheadRate: per(ahead, old.a), behindRate: per(behind, old.b) };
  }

  gapLine(ahead, behind, nA, nB) {
    const A = nA || "the car ahead", B = nB || "the car behind";
    if (ahead === null && behind === null) return "No one near you.";
    if (ahead === null) return secs(behind) + " to " + B + ".";
    if (behind === null) return secs(ahead) + " to " + A + ".";
    return secs(ahead) + " to " + A + ", " + secs(behind) + " to " + B + ".";
  }

  report(ctx) {
    const F = (ctx.frame && ctx.frame.f1) || null, d = ctx.delta || {};
    const bits = [];
    if (F && F.position) {
      const ahead = fin(F.gapAheadMs) && F.gapAheadMs > 0 ? F.gapAheadMs / 1000 : null;
      const behind = fin(F.gapBehindMs) && F.gapBehindMs > 0 ? F.gapBehindMs / 1000 : null;
      bits.push("You're P" + F.position + (ctx.frame.carsOnTrack ? " of " + ctx.frame.carsOnTrack : "") + ".");
      bits.push(this.gapLine(ahead, behind, F.nameAhead, F.nameBehind));
      if (fin(F.gapLeaderMs) && F.gapLeaderMs > 0 && F.position > 1)
        bits.push(secs(F.gapLeaderMs / 1000) + " to the leader.");
      if (F.weather || fin(F.trackC)) {
        bits.push([F.weather, fin(F.trackC) ? "track " + F.trackC + " degrees" : ""].filter(Boolean).join(", ") + ".");
      }
      if (F.safetyCar && !/No Safety Car/i.test(F.safetyCar)) bits.push(F.safetyCar + ".");
      if (F.compound) bits.push(F.compound + ", " + (F.tyreAge || 0) + " laps on them.");
    } else {
      bits.push("No race data on this feed — GT7 doesn't broadcast position or intervals.");
    }
    if (fin(d.liveDelta) && d.hasReference)
      bits.push("You're " + tenths(d.liveDelta) + (d.liveDelta > 0 ? " off" : " up on") + " the reference.");
    return bits.join(" ");
  }

  pick(msgs, ctx) {
    const now = ctx.nowMs;
    const floor = CHATTER_FLOOR[ctx.chatter] !== undefined ? CHATTER_FLOOR[ctx.chatter] : 38;
    const gap = ctx.chatter === "Minimal" ? 26000 : ctx.chatter === "Talkative" ? 9000 : 16000;
    const tr = TRAITS[this.persona] || TRAITS.CALM;
    const urgent = (msgs || []).some(m => m && m.text && m.priority >= 80);
    if (!urgent && now - this.lastAny < gap * tr.gap) return null;
    const sec = typeof ctx.sectorsElapsed === "number" ? ctx.sectorsElapsed : null;
    const need = ctx.chatter === "Minimal" ? 3 : ctx.chatter === "Talkative" ? 1 : 2;
    const since = sec === null || this.lastAnySector === undefined ? 99 : sec - this.lastAnySector;
    const ok = (msgs || []).filter(m => {
      if (!m || !m.text) return false;
      if (m.priority < 80 && since < need) return false;
      if (m.priority < floor + tr.floor && m.priority < 80) return false;
      if (m.id === this.lastId && m.priority < 80) return false;
      if (m.oncePerLap && this.lapFlags[m.id]) return false;
      const last = this.said[m.id] || 0;
      const mult = ctx.chatter === "Minimal" ? 1.8 : ctx.chatter === "Talkative" ? 0.6 : 1;
      if (now - last < (m.cooldown || 20000) * mult) return false;
      // Escalate or shut up: a warning already given only comes back when the
      // thing it warned about has got measurably worse.
      if (typeof m.escalate === "number") {
        const seen = this.magnitude[m.id];
        if (seen !== undefined && m.escalate < seen + (m.escalateBy || 3)) return false;
      }
      return true;
    });
    if (!ok.length) return null;
    ok.sort((a, b) => b.priority - a.priority);
    const m = ok[0];
    this.said[m.id] = now;
    if (typeof m.escalate === "number") {
      this.magnitude[m.id] = Math.max(this.magnitude[m.id] === undefined ? -Infinity : this.magnitude[m.id], m.escalate);
    }
    this.lastAny = now;
    if (sec !== null) this.lastAnySector = sec;
    this.lastId = m.id;
    if (m.oncePerLap) this.lapFlags[m.id] = true;
    return { ...m, text: this.style(m.text) };
  }
}

// How each engineer talks. gap/floor throttle how often they come on the
// radio; style rewrites the line they were going to say.
const TRAITS = {
  CALM:      { gap: 1.0, floor: 0,  style: "calm" },
  BLUNT:     { gap: 0.8, floor: 0,  style: "blunt" },
  ANALYTIC:  { gap: 1.0, floor: 0,  style: "analytic" },
  PRECISE:   { gap: 1.9, floor: 14, style: "precise" },
  DIRECT:    { gap: 0.8, floor: 0,  style: "blunt" },
  TECHNICAL: { gap: 1.0, floor: 0,  style: "analytic" }
};

// Hedges and softeners. HARD is stripped by the blunt and precise engineers;
// SOFT (pure guesswork) comes out for everyone but Wren.
const HEDGE_HARD = /\b(if you can|when you can|your call|no rush|take your time|don't worry|no panic|stay calm|nice and easy|a little bit|a little|a touch|i think|i reckon|maybe|perhaps)\b[,:]?\s*/gi;
const HEDGE_SOFT = /\b(i think|i reckon|maybe|perhaps)\b[,:]?\s*/gi;

// Split on sentence punctuation only when a space or end-of-string follows, so
// lap times like 1:24.118 survive intact.
const SENTENCES = t => String(t).split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);

const tidy = t => {
  let s = String(t)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[,;:]\s*/, "")
    .replace(/,\s*([.!?])/g, "$1")
    .trim();
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s && !/[.!?]$/.test(s)) s += ".";
  return s;
};

const hasFigure = s => /\d/.test(s);
const words = s => s.split(" ").filter(Boolean);

RaceCoach.prototype.traits = function () { return TRAITS[this.persona] || TRAITS.CALM; };

RaceCoach.prototype.style = function (text) {
  const mode = this.traits().style;
  if (mode === "calm") return text;
  const parts = SENTENCES(text);
  if (!parts.length) return text;

  // A clause carrying a number is the reading; one without it is the call.
  const figures = parts.filter(hasFigure);
  const calls = parts.filter(x => !hasFigure(x));

  if (mode === "blunt") {
    // The call first, the number behind it, nothing softened.
    const keep = [calls[0], figures[0]].filter(Boolean);
    return (keep.length ? keep : parts.slice(0, 1))
      .map(x => tidy(x.replace(HEDGE_HARD, ""))).join(" ");
  }
  if (mode === "analytic") {
    // The number first, with units and delta intact, then the call.
    const keep = figures.length
      ? figures.slice(0, 2).concat(calls.slice(0, 1))
      : parts.slice(0, 2);
    return keep.filter(Boolean).map(x => tidy(x.replace(HEDGE_SOFT, ""))).join(" ");
  }
  if (mode === "precise") {
    // One clause, the actionable one, nine words at most.
    const pick = calls[0] || figures[0] || parts[0];
    const w = words(tidy(pick.replace(HEDGE_HARD, "")));
    return w.length > 9 ? tidy(w.slice(0, 9).join(" ")) : w.join(" ");
  }
  return text;
};

export const PERSONAS = [
  { id: "CALM", name: "Calm", line: "Measured, unhurried. Speaks when it matters." },
  { id: "DIRECT", name: "Direct", line: "Short, blunt, no softening. Race pace only." },
  { id: "TECHNICAL", name: "Technical", line: "Numbers first. Speeds, deltas, temperatures." }
];

// ---- driving tips ---------------------------------------------------------------------------------------------
// Two kinds. techniqueNow(): a corner has just finished and the driver did something worth a word (locked the
// fronts, spun the rears, braked harder than they needed to). previewTips(): a sector has just finished, so look
// at the corners of the sector that is coming and warn about the one the driver has been getting wrong.
// Everything is judged against the driver's own best pass through the same corner, so there is no opinion about
// the car or the circuit here, only "you did it better before".
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const KMH = v => Math.round(v);

RaceCoach.prototype.noteCorner = function (e, ctx) {
  const c = e && e.corner; if (!c || !fin(c.deltaChange) || !fin(c.startDistance)) return null;
  const d = (ctx && ctx.delta) || {};
  const lapD = d.referenceDistance || d.lapDistance || 0;
  // The engine numbers corners afresh every lap and merges or splits them differently from lap to lap, so a
  // corner is recognised by where it is on the circuit, not by its number.
  this.ch = this.ch || new Map();
  let key = null, near = 60;
  this.ch.forEach((list, k) => {
    const l = list[list.length - 1], gap = Math.abs(l.start - c.startDistance);
    if (gap < near) { near = gap; key = k; }
  });
  if (key === null) key = "c" + Math.round(c.startDistance);
  const rec = { key, lapN: e.lapN, name: c.name, start: c.startDistance, frac: lapD > 0 ? c.startDistance / lapD : null,
    brake: fin(c.maxBrake) ? c.maxBrake : 0, brakeM: fin(c.brakeDistance) ? c.brakeDistance : null,
    entry: c.entrySpeed, min: c.minSpeed, wait: fin(c.throttleWait) ? c.throttleWait : 0,
    spin: c.wheelspin || 0, lock: fin(c.lock) ? c.lock : 1, dc: c.deltaChange };
  // the reference lap's own pass through this corner is the baseline until the driver has a best pass of their own
  const rf = e.ref;
  if (rf && fin(rf.startDistance) && Math.abs(rf.startDistance - c.startDistance) < 60 && fin(rf.minSpeed) && fin(rf.entrySpeed))
    rec.base = { lapN: -1, brake: fin(rf.maxBrake) ? rf.maxBrake : 0, brakeM: fin(rf.brakeDistance) ? rf.brakeDistance : null, entry: rf.entrySpeed, min: rf.minSpeed,
      wait: fin(rf.throttleWait) ? rf.throttleWait : 0, dc: -1 };
  const list = this.ch.get(key) || [];
  list.push(rec); if (list.length > 8) list.shift();
  this.ch.set(key, list);
  return rec;
};

// the best earlier pass through this corner: the one that lost least against the reference
RaceCoach.prototype.bestPass = function (key, notLapN) {
  const l = ((this.ch && this.ch.get(key)) || []).filter(r => r.lapN !== notLapN);
  return l.length >= 1 ? l.reduce((a, r) => (r.dc < a.dc ? r : a)) : null;
};

// What is wrong with one pass through a corner, worst first. Each finding has the spoken tip and a weight.
RaceCoach.prototype.diagnose = function (r) {
  const best = this.bestPass(r.key, r.lapN) || r.base || null, out = [];
  if (r.lock < 0.82 && r.brake > 0.3)
    out.push({ w: 9, kind: "lock", tip: "Easy on the brake pedal into " + r.name + ", the fronts are locking. Squeeze it on, then release gradually." });
  if (best) {
    const dMin = r.min - best.min, dBrake = r.brake - best.brake, dEntry = r.entry - best.entry;
    if (dBrake > 0.12 && dMin < -3)
      out.push({ w: 7 + Math.min(2, -dMin / 8), kind: "overbrake", tip: "Go easy on the brakes into " + r.name + ". You're braking harder than your best lap and ending up " + KMH(-dMin) + " k p h slower in the middle." });
    else if (dEntry > 6 && r.dc > best.dc + 0.06)
      out.push({ w: 6, kind: "hot", tip: "You're arriving at " + r.name + " " + KMH(dEntry) + " k p h hotter than your best lap. Brake a touch earlier and you'll be on the power sooner." });
    if (r.brakeM !== null && best.brakeM !== null && r.brakeM > best.brakeM + 12 && dEntry < 3)
      out.push({ w: 4, kind: "early", tip: "You're on the brakes " + KMH(r.brakeM - best.brakeM) + " metres earlier than your best lap into " + r.name + ". Hold it a little longer." });
  }
  if (r.spin > 1.15)
    out.push({ w: 6, kind: "spin", tip: "Wheelspin out of " + r.name + ". Squeeze the throttle on, don't stamp it." });
  if (best && r.wait > 0.8 && r.wait > best.wait + 0.25)
    out.push({ w: 5, kind: "late", tip: "You're late back on the power at " + r.name + ". Get the throttle down as soon as the car is pointing at the exit." });
  return out.sort((a, b) => b.w - a.w);
};

RaceCoach.prototype.techniqueNow = function (e, ctx) {
  const r = this.noteCorner(e, ctx); if (!r) return [];
  const f = this.diagnose(r)[0]; if (!f) return [];
  // a repeat of the same fault in the same corner stays quiet for a few laps; the preview below covers it
  this.tipSaid = this.tipSaid || {};
  const key = f.kind + r.key;
  if (this.tipSaid[key] && r.lapN - this.tipSaid[key] < 3) return [];
  this.tipSaid[key] = r.lapN;
  return [{ id: "tip-" + f.kind + r.key, tag: "COACHING", priority: f.kind === "lock" ? 66 : 50 + f.w / 2, cooldown: 40000, oncePerLap: true,
    meta: { corner: r.name, event: "TECHNIQUE_" + f.kind.toUpperCase() }, text: f.tip }];
};

// A sector has just finished: say what to watch in the next one.
RaceCoach.prototype.previewTips = function (e, ctx) {
  const d = (ctx && ctx.delta) || {}, N = d.sectorCount || 3;
  if (!fin(e.index) || !this.ch || this.ch.size === 0) return [];
  const next = (e.index + 1) % N, lo = next / N, hi = (next + 1) / N;
  const latest = [];
  this.ch.forEach(list => {
    const r = list[list.length - 1];
    if (r && r.frac !== null && r.frac >= lo && r.frac < hi) latest.push(r);
  });
  if (!latest.length) return [];
  // is this the quick sector of the lap? (highest typical mid-corner speed)
  const mins = [];
  for (let s = 0; s < N; s++) {
    const m = []; this.ch.forEach(list => { const r = list[list.length - 1]; if (r && r.frac !== null && Math.floor(r.frac * N) === s) m.push(r.min); });
    mins.push(m.length ? median(m) : null);
  }
  const mine = mins[next];
  const quick = N > 1 && mine !== null && mins.every(v => v === null || v <= mine) && mins.filter(v => v !== null).length > 1;
  let top = null;
  this.prevSaid = this.prevSaid || {};
  const lapNow = (ctx && ctx.lap) || 0;
  // the same warning about the same corner is not read out every lap: once, then again only after a few laps
  latest.forEach(r => { const f = this.diagnose(r)[0]; const k = f ? f.kind + r.key : ""; if (f && !(this.prevSaid[k] !== undefined && lapNow - this.prevSaid[k] < 4) && (!top || f.w > top.f.w)) top = { r, f, k }; });
  const sec = ["one", "two", "three", "four", "five", "six", "seven", "eight"][next] || String(next + 1);
  if (top) {
    this.prevSaid[top.k] = lapNow;
    return [{ id: "tip-prev" + next, tag: "COACHING", priority: 53, cooldown: 60000,
      meta: { corner: top.r.name, event: "TECHNIQUE_PREVIEW" },
      text: "Sector " + sec + " next" + (quick ? ", the quick one" : "") + ". " + top.f.tip }];
  }
  if (quick && !(this.quickLap !== undefined && lapNow - this.quickLap < 4)) {
    this.quickLap = lapNow;
    return [{ id: "tip-quick" + next, tag: "COACHING", priority: 40, cooldown: 90000, oncePerLap: true,
      text: "Quick sector next. Light on the brakes, keep it smooth, and let the speed carry." }];
  }
  return [];
};
