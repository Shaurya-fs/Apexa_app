
export const REFERENCE_MODES = ["PERSONAL BEST", "LAST LAP", "SESSION BEST", "SELECTED LAP"];

const MAX_DT = 0.5;
const SAMPLE_M = 5;
const TRACE_BUCKETS = 120;
const SMOOTH_TAU = 0.075;
const MAX_STEP_M = 40;
const MIN_LAP_M = 400;
const MIN_LAP_AVG_MS = 10;
const fin = v => typeof v === "number" && isFinite(v);
const num = (v, d) => (fin(v) ? v : d);

export class ReferenceLap {
  constructor(o) {
    this.id = o.id;
    this.label = o.label || o.id;
    this.lapN = o.lapN;
    this.lapMs = o.lapMs;
    this.samples = o.samples || [];
    this.events = o.events || [];
    this.distance = num(o.distance, this.samples.length ? this.samples[this.samples.length - 1].d : 0);
    this.sectorMs = o.sectorMs || null;
    this.buildIndex();
  }
  buildIndex() {
    this.grid = null;
    this.hasPos = false;
    this.cell = 20;
    const S = this.samples;
    if (S.length < 8) return;
    let n = 0;
    for (let i = 0; i < S.length; i++) if (fin(S[i].x) && fin(S[i].z)) n++;
    if (n < S.length * 0.8) return;
    this.hasPos = true;
    this.grid = new Map();
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (!fin(s.x) || !fin(s.z)) continue;
      const k = Math.floor(s.x / this.cell) + "|" + Math.floor(s.z / this.cell);
      let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(i);
    }
  }
  nearestByPos(p, hint, expectedD) {
    const S = this.samples;
    this.lastCand = 0;
    this.lastErr = null;
    if (!this.hasPos || !p || !fin(p.x) || !fin(p.z)) return -1;
    let best = -1, bd = Infinity;
    const test = i => {
      const s = S[i];
      if (!s || !fin(s.x) || !fin(s.z)) return;
      this.lastCand++;
      const dx = s.x - p.x;
      const dy = fin(s.y) && fin(p.y) ? s.y - p.y : 0;
      const dz = s.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) { bd = d2; best = i; }
    };
    if (fin(hint) && hint >= 0) {
      const lo = Math.max(0, hint - 8), hi = Math.min(S.length - 1, hint + 60);
      for (let i = lo; i <= hi; i++) test(i);
      if (bd < 400) { this.lastErr = Math.sqrt(bd); return best; }
      best = -1; bd = Infinity;
    }
    const c = this.cell;
    const gx = Math.floor(p.x / c), gz = Math.floor(p.z / c);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const arr = this.grid.get((gx + a) + "|" + (gz + b));
        if (!arr) continue;
        for (let j = 0; j < arr.length; j++) {
          const i = arr[j];
          if (fin(expectedD) && Math.abs(S[i].d - expectedD) > 400) continue;
          test(i);
        }
      }
    }
    this.lastErr = bd === Infinity ? null : Math.sqrt(bd);
    return bd < 2500 ? best : -1;
  }
  timeAtPos(p, hint, expectedD) {
    const i = this.nearestByPos(p, hint, expectedD);
    if (i < 0) return null;
    const S = this.samples;
    const proj = (a, b) => {
      if (!a || !b || !fin(a.x) || !fin(b.x)) return null;
      const flat = !(fin(a.y) && fin(b.y) && fin(p.y));
      const vx = b.x - a.x, vy = flat ? 0 : b.y - a.y, vz = b.z - a.z;
      const L2 = vx * vx + vy * vy + vz * vz;
      if (!(L2 > 1e-4)) return null;
      const wx = p.x - a.x, wy = flat ? 0 : p.y - a.y, wz = p.z - a.z;
      let u = (wx * vx + wy * vy + wz * vz) / L2;
      u = Math.max(0, Math.min(1, u));
      const ex = wx - vx * u, ey = wy - vy * u, ez = wz - vz * u;
      return {
        e2: ex * ex + ey * ey + ez * ez,
        t: a.t + (b.t - a.t) * u,
        d: a.d + (b.d - a.d) * u
      };
    };
    const back = proj(S[i - 1], S[i]);
    const fwd = proj(S[i], S[i + 1]);
    let r = back && fwd ? (back.e2 <= fwd.e2 ? back : fwd) : (back || fwd);
    if (!r) r = { t: S[i].t, d: S[i].d };
    if (!fin(r.t) || !fin(r.d)) return null;
    return { t: r.t, d: r.d, index: i };
  }
  timeAt(d) {
    const S = this.samples;
    if (!S.length || !fin(d)) return null;
    if (d <= S[0].d) return S[0].t;
    const last = S[S.length - 1];
    if (d >= last.d) {
      if (S.length < 2) return last.t;
      const p = S[S.length - 2];
      const slope = (last.t - p.t) / Math.max(0.001, last.d - p.d);
      return last.t + (d - last.d) * slope;
    }
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].d <= d) lo = m; else hi = m; }
    const a = S[lo], b = S[hi];
    return a.t + (b.t - a.t) * ((d - a.d) / Math.max(0.001, b.d - a.d));
  }
  sectorBounds(n) {
    const D = this.distance || 0, N = n > 3 ? n : 3, out = [];
    for (let i = 1; i <= N; i++) out.push((D * i) / N);
    return out;
  }
  eventAt(index) { return this.events.find(e => e.index === index) || null; }
}

export class LiveDeltaEngine {
  constructor(opts) {
    const o = opts || {};
    this.mode = o.mode || "PERSONAL BEST";
    this.sectorCount = 3;
    this.bestSectorMs = new Array(this.sectorCount).fill(null);
    this.prevLapSectorMs = new Array(this.sectorCount).fill(null);
    this.sectorColors = new Array(this.sectorCount).fill(null);
    this.selectedId = null;
    this.laps = [];
    this.reference = null;
    this.queue = [];
    this.cornerStats = new Map();
    this.sessionId = 1;
    this.axisBias = 1;
    this.biasLaps = 0;
    this.todTrust = false;
    this.todRate = 1;
    this.resetLap(true);
  }

  setReferenceMode(mode) { this.mode = mode; this.resolveReference(); }
  setReferenceLap(lap) { this.selectedId = lap && lap.id; this.mode = "SELECTED LAP"; this.resolveReference(); }
  validLaps() { return this.laps.filter(l => l.valid && l.lineStart); }
  resolveReference() {
    const V = this.validLaps();
    let lap = null;
    if (!V.length) lap = null;
    else if (this.mode === "LAST LAP") lap = V[V.length - 1];
    else if (this.mode === "SELECTED LAP") lap = V.find(l => l.id === this.selectedId) || null;
    else lap = V.reduce((a, b) => (b.lapMs < a.lapMs ? b : a));
    const id = lap && lap.id;
    if (id !== (this.reference && this.reference.id)) {
      this.reference = lap ? new ReferenceLap(lap) : null;
      if (this.reference) this.queue.push({ kind: "reference", label: this.reference.label, lapMs: this.reference.lapMs });
    }
    return this.reference;
  }

  resetLap(hard) {
    this.dist = 0;
    this.lapMs = 0;
    this.samples = [];
    this.lastSampleD = -1e9;
    this.rawDelta = null;
    this.displayDelta = null;
    this.refD = 0;
    this.refIdx = null;
    this.posAligned = false;
    this.axisScale = 1;
    this.deltaHist = [];
    this.trace = new Array(TRACE_BUCKETS).fill(null);
    this.sector = 0;
    this.sectorDeltas = new Array(this.sectorCount).fill(null);
    this.sectorEntry = [0].concat(new Array(this.sectorCount - 1).fill(null));
    this.sectorMs = new Array(this.sectorCount).fill(null);
    this.sectorColors = new Array(this.sectorCount).fill(null);
    this.cornerIndex = 0;
    this.corner = null;
    this.cornerFrames = 0;
    this.straightFrames = 0;
    this.events = [];
    this.brakeStart = null;
    this.prev = null;
    this.startPos = null;
    this.todStart = null;
    this.todSpan = null;
    this.spikes = 0;
    if (hard) {
      this.curLap = null;
      this.lapFromLine = false;
      this.lapStartMs = null;
      this.bestMs = null;
      this.lastMs = null;
      this.bestSectorMs = new Array(this.sectorCount).fill(null);
      this.prevLapSectorMs = new Array(this.sectorCount).fill(null);
    }
  }
  setSectorCount(n) {
    const c = Math.max(3, Math.min(12, Math.round(n) || 3));
    if (c === this.sectorCount) return;
    this.sectorCount = c;
    this.sector = 0;
    this.sectorDeltas = new Array(c).fill(null);
    this.sectorEntry = [0].concat(new Array(c - 1).fill(null));
    this.sectorMs = new Array(c).fill(null);
    this.sectorColors = new Array(c).fill(null);
    this.bestSectorMs = new Array(c).fill(null);
    this.prevLapSectorMs = new Array(c).fill(null);
    this.enterDelta = null;
    for (const l of this.laps) { l.sectorMs = new Array(c).fill(null); l.sectorDeltas = new Array(c).fill(null); }
  }
  markSectorColor(i, ms) {
    if (!fin(ms)) { this.sectorColors[i] = null; return; }
    const prev = this.prevLapSectorMs[i];
    const best = this.bestSectorMs[i];
    let color;
    if (prev === null) color = "white";
    else if (best !== null && ms <= best) color = "purple";
    else if (ms < prev) color = "green";
    else color = "yellow";
    if (best === null || ms < best) this.bestSectorMs[i] = ms;
    this.sectorColors[i] = color;
  }
  abandonLap(f) {
    this.resetLap(false);
    this.lapFromLine = false;
    this.lapMs = 0;
    this.prev = f;
    this.abandoned = (this.abandoned || 0) + 1;
  }
  reset(hard) {
    if (hard) {
      this.laps = []; this.reference = null; this.cornerStats.clear(); this.sessionId++;
      this.axisBias = 1; this.biasLaps = 0;
      this.todTrust = false; this.todRate = 1;
    }
    this.resetLap(true);
  }

  nextLapMs(f, dt) {
    const tod = fin(f.todMs) ? f.todMs : null;
    if (tod !== null) {
      if (this.todStart === null || tod < this.todStart) {
        this.todStart = tod - (this.todTrust ? 0 : this.lapMs / this.todRate);
      }
      const span = (tod - this.todStart) * this.todRate;
      if (this.todTrust && span >= 0 && span < 1800000) { this.clock = "SIM"; return span; }
      this.todSpan = span;
    }
    this.clock = "INT";
    return this.lapMs + dt * 1000;
  }

  calibrateClock(gameMs) {
    if (!fin(gameMs) || gameMs < 4000) return;
    const span = fin(this.todSpan) ? this.todSpan : null;
    if (span === null || span < 4000) return;
    const r = gameMs / span;
    if (r > 0.8 && r < 1.25) {
      this.todRate = this.todTrust ? this.todRate * r : r;
      this.todTrust = true;
    }
  }

  lineByPos(f) {
    const S = this.startPos;
    if (!S || !f || !f.pos || !fin(f.pos.x)) return false;
    const med = this.medianDistance();
    const floor = Math.max(MIN_LAP_M, med ? med * 0.7 : 1500);
    if (this.dist < floor) return false;
    const dx = f.pos.x - S.x;
    const dy = fin(f.pos.y) && fin(S.y) ? f.pos.y - S.y : 0;
    const dz = f.pos.z - S.z;
    return dx * dx + dy * dy + dz * dz < 625;
  }

  update(f) {
    if (!f) return this.getState();
    const p = this.prev;
    this.prev = f;
    if (fin(f.bestLapMs) && f.bestLapMs > 4000) this.gameBestMs = f.bestLapMs;

    if (f.lap !== null && f.lap !== undefined && this.curLap === null) {
      this.curLap = f.lap;
      this.lapFromLine = false;
      if (f.lap >= 0) this.resetLap(false);
    }

    const finished = p && fin(f.lastLapMs) && f.lastLapMs > 0 && f.lastLapMs !== p.lastLapMs
      && this.dist > MIN_LAP_M;
    const restarted = fin(f.lap) && fin(this.curLap) && f.lap < this.curLap;
    const counted = fin(f.lap) && fin(this.curLap) && f.lap !== this.curLap && !restarted;
    const looped = !fin(f.lap) && !fin(f.lastLapMs) && this.lineByPos(f);
    if (restarted) { this.abandonLap(f); this.curLap = f.lap; return this.getState(); }
    if (counted || finished || looped) {
      this.finalizeLap(f, p);
      this.curLap = fin(f.lap) ? f.lap : this.curLap;
      return this.getState();
    }

    if (!p) return this.getState();

    let dt = (f.tMs - p.tMs) / 1000;
    if (!fin(dt) || dt <= 0) return this.getState();
    const bigGap = dt > MAX_DT;
    if (f.pos && p.pos && !f.paused) {
      const jx = f.pos.x - p.pos.x, jy = (f.pos.y || 0) - (p.pos.y || 0), jz = f.pos.z - p.pos.z;
      const jump = Math.sqrt(jx * jx + jy * jy + jz * jz);
      if (fin(jump) && jump > num(f.speedMs, 0) * Math.min(dt, 5) * 3 + 60) { this.abandonLap(f); return this.getState(); }
    }

    const rolling = num(f.speedMs, 0) > 0.5;
    if (f.paused) { this.todStart = null; return this.getState(); }
    if (f.onTrack === false && !rolling) return this.getState();

    this.lapMs = this.nextLapMs(f, dt > 5 ? 0 : dt);
    if (dt > 5) { this.spikes++; return this.getState(); }

    const cap = Math.min(400, Math.max(MAX_STEP_M, num(f.speedMs, 0) * dt * 1.8 + 12));
    const expect = Math.max(0, num(f.speedMs, 0)) * dt;
    let step = null;
    if (f.pos && p.pos) {
      const dx = f.pos.x - p.pos.x, dy = f.pos.y - p.pos.y, dz = f.pos.z - p.pos.z;
      const m = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (fin(m) && m < cap && (expect <= 0.05 || (m > expect * 0.25 && m < expect * 3 + 2))) step = m;
    }
    if (step === null) step = expect;
    if (!fin(step) || step > cap) { this.spikes++; return this.getState(); }
    if (bigGap) this.spikes++;
    if (f.gear === 0 && num(f.speedMs, 0) > 0.5) step = -step;
    this.dist = Math.max(0, this.dist + step);

    if (this.dist - this.lastSampleD >= SAMPLE_M) {
      this.lastSampleD = this.dist;
      const s = { d: this.dist, t: this.lapMs };
      if (f.pos && fin(f.pos.x)) {
        s.x = f.pos.x; s.y = f.pos.y; s.z = f.pos.z;
        if (!this.startPos) this.startPos = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
      }
      this.samples.push(s);
    }

    this.computeDelta(dt, f);
    this.trackSectors();
    this.trackCorners(f, dt);
    return this.getState();
  }

  axisFactor() {
    const R = this.reference;
    if (!R || !R.distance) return 1;
    const others = this.laps.filter(l => l.valid && l.id !== R.id && l.distance > 0).slice(-3);
    if (!others.length) return 1;
    const mean = others.reduce((a, l) => a + l.distance, 0) / others.length;
    const f = R.distance / mean;
    const base = f > 0.85 && f < 1.15 ? f : 1;
    return this.clampAxis(base * this.axisBias);
  }
  clampAxis(v) { return fin(v) && v > 0.85 && v < 1.15 ? v : 1; }

  trainAxisBias(lap) {
    if (this.reference && this.reference.hasPos) return;
    if (!lap || !lap.valid || !fin(lap.deltaResidual) || !lap.lapMs) return;
    if (Math.abs(lap.deltaResidual) > 5) return;
    const step = -(lap.deltaResidual * 1000) / lap.lapMs;
    if (!fin(step)) return;
    this.axisBias = this.clampAxis(this.axisBias * (1 + 0.6 * step));
    this.biasLaps++;
  }
  refScale() {
    const R = this.reference;
    if (!R || !R.lapMs || !fin(this.gameBestMs) || this.gameBestMs <= 0) return 1;
    const k = this.gameBestMs / R.lapMs;
    return k > 0.5 && k <= 1.001 ? k : 1;
  }

  noDelta(method) {
    this.rawDelta = null;
    this.displayDelta = null;
    this.refMsAt = null;
    this.method = method;
  }

  computeDelta(dt, f) {
    const R = this.reference;
    if (!R || this.dist < 20) { this.noDelta(R ? "WARMUP" : "NO-REF"); return; }
    let refMs = null;
    let method = "none";
    const m = R.hasPos && f && f.pos && fin(f.pos.x)
      ? R.timeAtPos(f.pos, this.refIdx, this.dist)
      : null;
    const plausible = m && (this.dist < 100 || Math.abs(m.d - this.dist) < 300);
    if (m && plausible) {
      if (fin(this.refIdx) && m.index < this.refIdx - 5) this.refIdx = null;
      else this.refIdx = m.index;
      this.posAligned = true;
      this.refD = m.d;
      this.axisScale = this.dist > 0 ? m.d / this.dist : 1;
      refMs = m.t;
      method = "POS";
    } else {
      this.refIdx = null;
      this.posAligned = false;
      this.axisScale = this.axisFactor();
      this.refD = this.dist * this.axisScale;
      if (R.distance && this.refD > R.distance * 1.03) {
        this.noDelta("PAST-END");
        this.pastEnd = (this.pastEnd || 0) + 1;
        if (this.pastEnd > 150) { this.pastEnd = 0; this.abandonLap(f); }
        return;
      }
      refMs = R.timeAt(this.refD);
      method = m ? "DIST-POSREJ" : "DIST";
    }
    this.method = method;
    this.pastEnd = 0;
    this.refMsAt = fin(refMs) ? refMs : null;
    if (!fin(refMs)) { this.noDelta("NO-REFTIME"); return; }
    const k = this.refScale();
    const raw = (this.lapMs - refMs * k) / 1000;
    if (!fin(raw) || Math.abs(raw) > 30) { this.spikes++; this.noDelta("OUT-OF-RANGE"); return; }
    this.rawDelta = raw;
    const a = 1 - Math.exp(-dt / SMOOTH_TAU);
    this.displayDelta = this.displayDelta === null ? raw : this.displayDelta + (raw - this.displayDelta) * a;
    this.deltaHist.push({ t: this.lapMs, v: raw });
    if (this.deltaHist.length > 200) this.deltaHist.shift();
    const D = R.distance || 1;
    const b = Math.max(0, Math.min(TRACE_BUCKETS - 1, Math.floor((this.refD / D) * TRACE_BUCKETS)));
    this.trace[b] = raw;
  }

  trackSectors() {
    const R = this.reference; if (!R || !R.distance) return;
    const B = R.sectorBounds(this.sectorCount);
    const d = this.refD || this.dist;
    let s = 0;
    while (s < B.length - 1 && d >= B[s]) s++;
    if (s === this.sector) return;
    const i = this.sector;
    const exitDelta = this.rawDelta;
    this.sectorMs[i] = this.lapMs - this.sectorEntry[i];
    this.markSectorColor(i, this.sectorMs[i]);
    if (fin(exitDelta) && (i === 0 || fin(this.enterDelta))) {
      const gained = i === 0 ? exitDelta : exitDelta - this.enterDelta;
      this.sectorDeltas[i] = gained;
      this.queue.push({ kind: "sector", index: i, delta: gained, ms: this.sectorMs[i] });
    }
    this.enterDelta = exitDelta;
    this.sector = s;
    this.sectorEntry[s] = this.lapMs;
  }

  trackCorners(f, dt) {
    const load = fin(f.gLat) ? Math.abs(f.gLat)
      : fin(f.steerRad) ? Math.abs(f.steerRad) * 3.2
      : num(f.brake, 0) * 1.2;
    const inCorner = load > 0.55;

    if (num(f.brake, 0) > 0.15 && this.brakeStart === null) this.brakeStart = this.dist;
    if (num(f.brake, 0) < 0.05 && !inCorner) this.brakeStart = null;

    if (!this.corner) {
      this.cornerFrames = inCorner ? this.cornerFrames + 1 : 0;
      if (this.cornerFrames >= 3) {
        this.cornerIndex++;
        this.corner = {
          index: this.cornerIndex,
          name: "T" + this.cornerIndex,
          startDistance: this.dist,
          deltaBefore: this.rawDelta,
          entrySpeed: num(f.speedMs, 0) * 3.6,
          minSpeed: num(f.speedMs, 0) * 3.6,
          maxLoad: load,
          brakeDistance: this.brakeStart === null ? null : Math.max(0, this.dist - this.brakeStart),
          maxBrake: num(f.brake, 0),
          throttleWait: 0,
          gotThrottle: false
        };
        this.straightFrames = 0;
      }
      return;
    }

    const c = this.corner;
    c.minSpeed = Math.min(c.minSpeed, num(f.speedMs, 0) * 3.6);
    c.maxLoad = Math.max(c.maxLoad, load);
    c.maxBrake = Math.max(c.maxBrake, num(f.brake, 0));
    if (!c.gotThrottle) {
      if (num(f.throttle, 0) > 0.35 && num(f.speedMs, 0) * 3.6 <= c.minSpeed + 8) c.gotThrottle = true;
      else if (c.maxBrake > 0.15) c.throttleWait += dt;
    }
    if (fin(f.slipRatio && f.slipRatio[2])) {
      const spin = Math.max(f.slipRatio[2], f.slipRatio[3]);
      if (num(f.throttle, 0) > 0.5 && spin > 1.12) c.wheelspin = Math.max(c.wheelspin || 0, spin);
      const lockF = Math.min(f.slipRatio[0], f.slipRatio[1]);
      if (num(f.brake, 0) > 0.3 && lockF < 0.85) c.lock = Math.min(c.lock === undefined ? 1 : c.lock, lockF);
    }

    this.straightFrames = inCorner ? 0 : this.straightFrames + 1;
    if (this.straightFrames < 12) return;

    c.endDistance = this.dist;
    c.deltaAfter = this.rawDelta;
    c.deltaChange = fin(c.deltaBefore) && fin(c.deltaAfter) ? c.deltaAfter - c.deltaBefore : null;
    c.exitThrottle = num(f.throttle, 0);
    this.corner = null;
    this.cornerFrames = 0;
    this.events.push(c);

    if (fin(c.deltaChange)) {
      const st = this.cornerStats.get(c.index) || { index: c.index, name: c.name, count: 0, total: 0, worst: 0, last: 0 };
      st.count++; st.total += c.deltaChange; st.last = c.deltaChange;
      st.worst = Math.max(st.worst, c.deltaChange);
      this.cornerStats.set(c.index, st);
      const ref = this.reference && this.reference.eventAt(c.index);
      this.queue.push({ kind: "corner", corner: c, ref, lapN: this.curLap });
    }
  }

  rejectReference() {
    const R = this.reference;
    this.pastEnd = 0;
    if (!R) return;
    const lap = this.laps.find(l => l.id === R.id);
    if (lap) lap.valid = false;
    this.reference = null;
    this.refIdx = null;
    this.resolveReference();
  }

  pruneLaps() {
    const med = this.medianDistance();
    if (!med) return;
    let changed = false;
    for (const l of this.laps) {
      if (l.valid && l.distance < med * 0.6) { l.valid = false; changed = true; }
    }
    if (!changed) return;
    if (this.reference && !this.laps.some(l => l.valid && l.id === this.reference.id)) {
      this.reference = null;
      this.refIdx = null;
    }
    this.resolveReference();
  }

  finalizeLap(f, p) {
    const R = this.reference;
    const lastSec = this.sectorCount - 1;
    if (this.sector === lastSec && fin(this.rawDelta)) {
      this.sectorMs[lastSec] = this.lapMs - this.sectorEntry[lastSec];
      this.markSectorColor(lastSec, this.sectorMs[lastSec]);
      if (fin(this.enterDelta)) this.sectorDeltas[lastSec] = this.rawDelta - this.enterDelta;
    }
    const gameMs = fin(f.lastLapMs) && f.lastLapMs > 0 ? f.lastLapMs : null;
    this.calibrateClock(gameMs);
    const lapMs = gameMs || (this.lapMs > 4000 ? this.lapMs : null);
    const dist = this.dist;
    const t0 = this.samples.length ? this.samples[0].t : 0;
    const samples = t0 > 200
      ? this.samples.map(s => ({ d: s.d, t: s.t - t0, x: s.x, y: s.y, z: s.z }))
      : this.samples.slice();
    const avgMs = lapMs ? dist / (lapMs / 1000) : 0;
    const plausible = !!lapMs && lapMs > 4000 && dist > MIN_LAP_M && avgMs > MIN_LAP_AVG_MS;
    const gameClock = p && fin(p.lapMs) ? p.lapMs : this.lapMs;
    const clockOk = !gameMs || Math.abs(gameClock - gameMs) <= Math.max(1500, gameMs * 0.015);
    const done = this.samples.length > 8 && plausible && this.lapFromLine && clockOk;
    let lap = null;

    if (done) {
      const med = this.medianDistance();
      const valid = !med || (dist > med * 0.85 && dist < med * 1.15);
      lap = {
        id: "S" + this.sessionId + "L" + (fin(this.curLap) ? this.curLap : this.laps.length + 1),
        lapN: fin(this.curLap) ? this.curLap : this.laps.length + 1,
        label: "LAP " + (fin(this.curLap) ? this.curLap : this.laps.length + 1),
        lapMs, distance: dist, valid,
        lineStart: !!this.lapFromLine,
        samples: samples,
        events: this.events.slice(),
        sectorMs: this.sectorMs.slice(),
        sectorDeltas: this.sectorDeltas.slice(),
        sectorColors: this.sectorColors.slice(),
        deltaEnd: this.rawDelta,
        trace: this.trace.slice(),
        spikes: this.spikes,
        deltaResidual: R && R.lapMs && fin(this.rawDelta)
          ? (lapMs - R.lapMs) / 1000 - this.rawDelta : null
      };
      this.lastResidual = lap.deltaResidual;
      this.trainAxisBias(lap);
      this.prevLapSectorMs = this.sectorMs.slice();
      this.laps.push(lap);
      if (this.laps.length > 40) this.laps.shift();
      this.pruneLaps();
      this.lastMs = lapMs;
      const wasBest = this.bestMs;
      const pBest = p && fin(p.bestLapMs) && p.bestLapMs > 4000 ? p.bestLapMs : null;
      const baseMs = pBest || (R && R.lapMs) || null;
      if (valid && (!this.bestMs || lapMs < this.bestMs)) this.bestMs = lapMs;
      this.queue.push({
        kind: "lap", lapN: lap.lapN, ms: lapMs, valid,
        delta: baseMs ? (lapMs - baseMs) / 1000 : null,
        best: valid && (!wasBest || lapMs < wasBest),
        sectorDeltas: lap.sectorDeltas, sectorMs: lap.sectorMs,
        events: lap.events
      });
    }

    this.resetLap(false);
    this.lapFromLine = true;
    this.lapMs = 0;
    this.prev = f;
    this.resolveReference();
    return lap;
  }

  medianDistance() {
    const D = this.validLaps().map(l => l.distance).sort((a, b) => a - b);
    return D.length ? D[Math.floor(D.length / 2)] : null;
  }

  drain() { const q = this.queue; this.queue = []; return q; }

  trend() {
    const H = this.deltaHist;
    if (H.length < 8) return "stable";
    const now = H[H.length - 1];
    let old = H[0];
    for (let i = H.length - 1; i >= 0; i--) { if (now.t - H[i].t >= 700) { old = H[i]; break; } }
    const d = now.v - old.v;
    return d > 0.03 ? "losing" : d < -0.03 ? "gaining" : "stable";
  }

  diagLine() {
    const R = this.reference;
    const n = (v, dp) => (fin(v) ? v.toFixed(dp === undefined ? 0 : dp) : "—");
    return [
      this.method || "none",
      R && R.hasPos ? "refpos" : "refnopos",
      "d" + n(this.dist),
      "r" + n(this.refD) + "/" + n(R ? R.distance : null),
      "i" + (fin(this.refIdx) ? this.refIdx : "—") + "/" + (R ? R.samples.length : 0),
      "lt" + n(this.lapMs / 1000, 2),
      "rt" + n(this.refMsAt === null ? null : this.refMsAt / 1000, 2),
      "reflap" + n(R ? R.lapMs / 1000 : null, 2),
      "raw" + n(this.rawDelta, 3),
      "err" + n(R ? R.lastErr : null, 1),
      "clk" + (this.clock || "—") + (this.todTrust ? "✓" : "") + "×" + n(this.todRate, 4),
      "k" + n(this.refScale(), 4),
      "gbest" + n(fin(this.gameBestMs) ? this.gameBestMs / 1000 : null, 2),
      "cand" + (R && fin(R.lastCand) ? R.lastCand : "—"),
      "sp" + this.spikes
    ].join(" ");
  }

  getState() {
    const R = this.reference;
    const D = R && R.distance ? R.distance : 0;
    const safe = v => (fin(v) && Math.abs(v) < 600 ? v : null);
    const delta = safe(this.displayDelta);
    const refMs = R ? R.lapMs : null;
    return {
      hasReference: !!R,
      referenceLapId: R ? R.id : null,
      referenceLabel: R ? R.label : null,
      referenceLapMs: refMs,
      gameBestLapMs: fin(this.gameBestMs) ? this.gameBestMs : null,
      referenceScale: this.refScale(),
      referenceMode: this.mode,
      currentLapMs: Math.max(0, this.lapMs || 0),
      liveDelta: delta,
      rawDelta: safe(this.rawDelta),
      predictedLapMs: refMs && delta !== null ? Math.max(0, refMs + delta * 1000) : null,
      bestLapMs: this.bestMs || null,
      lastLapMs: this.lastMs || null,
      lapDistance: this.dist,
      axisScale: this.axisScale || 1,
      posAligned: !!this.posAligned,
      deltaDiag: this.diagLine(),
      axisBias: this.axisBias,
      calibrationLaps: this.biasLaps,
      lastDeltaResidual: fin(this.lastResidual) ? this.lastResidual : null,
      trackProgress: D ? Math.min(1.2, (this.refD || this.dist) / D) : null,
      referenceDistance: D || null,
      currentSector: this.sector,
      sectorCount: this.sectorCount,
      sectorDeltas: this.sectorDeltas.slice(),
      sectorMs: this.sectorMs.slice(),
      sectorColors: this.sectorColors.slice(),
      currentSectorDelta: this.sectorDeltas[Math.max(0, this.sector - 1)],
      deltaTrend: this.trend(),
      deltaTrace: this.trace,
      corner: this.corner,
      cornerEvents: this.events,
      cornerStats: Array.from(this.cornerStats.values()).sort((a, b) => b.total - a.total),
      laps: this.laps,
      lapCount: this.laps.length,
      validLapCount: this.validLaps().length,
      spikes: this.spikes
    };
  }
}

export function normalizeGt7(d, tMs) {
  if (!d) return null;
  return {
    tMs: fin(tMs) ? tMs : (fin(d.t) ? d.t : Date.now()),
    packetId: d.packetId,
    lap: fin(d.lap) && d.lap >= 0 ? d.lap : null,
    lapMs: fin(d.currentLapMs) && d.currentLapMs >= 0 && d.currentLapMs < 1800000 ? d.currentLapMs : null,
    lastLapMs: fin(d.lastLapMs) && d.lastLapMs > 0 ? d.lastLapMs : null,
    bestLapMs: fin(d.bestLapMs) && d.bestLapMs > 0 ? d.bestLapMs : null,
    speedMs: fin(d.speedMs) ? Math.abs(d.speedMs) : fin(d.speed) ? Math.abs(d.speed) / 3.6 : 0,
    pos: d.pos && fin(d.pos.x) ? d.pos : null,
    throttle: num(d.throttle, 0),
    brake: num(d.brake, 0),
    gear: fin(d.gear) ? d.gear : null,
    rpm: num(d.rpm, 0),
    gLat: fin(d.gLat) ? d.gLat : null,
    gLong: fin(d.gLong) ? d.gLong : null,
    steerRad: fin(d.steerRad) ? d.steerRad : null,
    slipRatio: Array.isArray(d.slipRatio) ? d.slipRatio : null,
    tyreTemp: Array.isArray(d.tyreTemp) ? d.tyreTemp : null,
    fuel: num(d.fuel, 0),
    fuelCapacity: num(d.fuelCapacity, 0),
    waterTemp: num(d.waterTemp, 0),
    oilTemp: num(d.oilTemp, 0),
    revLimiter: !!d.revLimiter,
    onTrack: d.onTrack !== false,
    todMs: fin(d.timeOfDayMs) && d.timeOfDayMs >= 0 ? d.timeOfDayMs : null,
    paused: !!d.paused,
    inPit: !!d.inPit,
    surface: d.surface || null
  };
}

export function fmtLap(ms) {
  if (!fin(ms) || ms <= 0) return "—:——.———";
  const s = ms / 1000, m = Math.floor(s / 60), r = s - m * 60;
  return m + ":" + (r < 10 ? "0" : "") + r.toFixed(3);
}
export function fmtDelta(v, dp) {
  if (!fin(v)) return "—.———";
  return (v < 0 ? "−" : "+") + Math.abs(v).toFixed(dp === undefined ? 3 : dp);
}
