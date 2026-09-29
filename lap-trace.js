
const RIBBON_PX = 9;
const WALL_PX = 11;
const MICRO_LEN = 180;

export class LapRecorder {
  constructor(opts) {
    opts = opts || {};
    this.maxLaps = opts.maxLaps || 8;
    this.hz = opts.hz || 60;
    this.laps = [];
    this.cur = [];
    this.curLap = null;
    this._lastAt = 0;
    this.fromLine = false;
  }
  push(s) {
    if (!s || typeof s.dist !== "number" || !(s.dist >= 0)) return;
    const now = s.t == null ? Date.now() : s.t;
    if (now - this._lastAt < 1000 / (this.hz + 5)) return;
    const prev = this.cur.length ? this.cur[this.cur.length - 1] : null;
    if (prev && typeof s.x === "number" && typeof prev.x === "number") {
      const jump = Math.hypot(s.x - prev.x, s.z - prev.z), dt = Math.min(5, Math.max(0.001, (now - this._lastAt) / 1000));
      if (jump > ((s.speed || 0) / 3.6) * dt * 3 + 60) { this.cur = []; this.fromLine = false; }
    }
    this._lastAt = now;
    if (this.curLap == null) { this.curLap = s.lap || 1; this.fromLine = false; }
    if (s.lap != null && s.lap !== this.curLap) {
      const up = s.lap > this.curLap;
      if (up) this.close(s.lapMs); else this.cur = [];
      this.curLap = s.lap;
      this.fromLine = up;
    }
    else if (this.cur.length && s.dist + 30 < this.cur[this.cur.length - 1].dist) { this.close(s.lapMs); this.fromLine = true; }
    this.cur.push(s);
    if (this.cur.length > 45000) this.cur.shift();
  }
  close(ms) {
    const smp = this.cur;
    this.cur = [];
    if (smp.length < 40) return null;
    if (!this.fromLine) return null;
    const span = smp[smp.length - 1].t - smp[0].t;
    if (ms && Math.abs(span - ms) > Math.max(2000, ms * 0.03)) return null;
    const k = Math.ceil(smp.length / 20000);
    const lap = buildLap(k > 1 ? smp.filter((_, i) => i % k === 0) : smp, { n: this.curLap, ms: ms || null });
    this.laps.push(lap);
    while (this.laps.length > this.maxLaps) this.laps.shift();
    return lap;
  }
  all() { return this.laps.slice().reverse(); }
}

export function buildLap(samples, meta) {
  meta = meta || {};
  const len = samples[samples.length - 1].dist || 0;
  const t0 = samples[0].t || 0;
  const smp = samples.map(s => Object.assign({}, s, { rt: (s.t || 0) - t0 }));
  const ms = meta.ms || (smp[smp.length - 1].rt || null);
  const has = k => smp.some(s => typeof s[k] === "number");
  return {
    n: meta.n == null ? 0 : meta.n,
    ms, lenM: len, samples: smp,
    track: meta.track || "", car: meta.car || "", game: meta.game || "",
    compound: meta.compound || "", stintAge: meta.stintAge == null ? null : meta.stintAge,
    airC: meta.airC == null ? null : meta.airC, trackC: meta.trackC == null ? null : meta.trackC,
    fuelUsed: meta.fuelUsed == null ? null : meta.fuelUsed,
    corners: detectCorners(smp),
    micro: microSectors(smp),
    channels: { pos: has("x") && has("z"), susp: has("susp0"), brakeTemp: has("bt0"), inner: has("ti0"), press: has("tp0") }
  };
}

LapRecorder.prototype.live = function () {
  const cur = this.cur || [];
  if (cur.length < 60) return null;
  if (this._liveAt && cur.length - this._liveAt < 40) return this._live;
  this._liveAt = cur.length;
  const lap = buildLap(cur, { n: this.curLap == null ? 1 : this.curLap });
  lap.partial = true;
  this._live = lap;
  return lap;
};

export function coasting(lap) {
  if (!lap || !lap.samples || lap.samples.length < 20) return null;
  const smp = lap.samples;
  const corners = lap.corners || [];
  const byCorner = {};
  let total = 0;
  for (let i = 1; i < smp.length; i++) {
    const s = smp[i];
    const dt = ((s.rt || 0) - (smp[i - 1].rt || 0)) / 1000;
    if (!(dt > 0) || dt > 0.5) continue;
    if ((s.throttle || 0) > 6 || (s.brake || 0) > 6 || (s.speed || 0) < 45) continue;
    total += dt;
    const c = corners.filter(c2 => s.dist >= c2.d0 - 60 && s.dist <= c2.d1 + 20)[0];
    const key = c ? c.name + " " + c.dir : "straights";
    byCorner[key] = (byCorner[key] || 0) + dt;
  }
  const list = Object.keys(byCorner).map(k => ({ name: k, s: byCorner[k] }))
    .sort((a, b) => b.s - a.s);
  return { totalS: total, worst: list.slice(0, 3), perLapPct: lap.ms ? (total * 1000) / lap.ms : null };
}

export function gripWindow(laps, limitC) {
  const lim = limitC || 104;
  const peaks = (laps || []).filter(l => l && l.samples).map(l => {
    let hi = 0;
    l.samples.forEach(s => {
      for (let i = 0; i < 4; i++) { const v = s["t" + i]; if (typeof v === "number" && v > hi) hi = v; }
    });
    return hi;
  }).filter(v => v > 20);
  if (peaks.length < 3) return null;
  const n = peaks.length;
  const mx = (n - 1) / 2;
  const my = peaks.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  peaks.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) * (i - mx); });
  const slope = den ? num / den : 0;
  const last = peaks[n - 1];
  if (slope < 0.15) return { peak: last, slope, lapsLeft: null, stable: true };
  const lapsLeft = Math.max(0, (lim - last) / slope);
  return { peak: last, slope, lapsLeft, stable: false, limit: lim };
}

export function repeatability(laps) {
  const pool = (laps || []).filter(l => l && l.micro && l.micro.length);
  if (pool.length < 3) return null;
  const count = pool[0].micro.length;
  const same = pool.filter(l => l.micro.length === count);
  if (same.length < 3) return null;
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = same.map(l => l.micro[i].ms).filter(m => m > 0);
    if (v.length < 3) continue;
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length) / 1000;
    out.push({ n: i + 1, d0: same[0].micro[i].d0, d1: same[0].micro[i].d1, sd, meanS: m / 1000 });
  }
  if (!out.length) return null;
  const mean = out.reduce((a, b) => a + b.sd, 0) / out.length;
  return { sectors: out, meanSd: mean, worst: out.slice().sort((a, b) => b.sd - a.sd).slice(0, 3), laps: same.length };
}

export function detectCorners(smp) {
  const k = smoothCurvature(smp, 16);
  const enter = 1 / 260;                   // radii under 260m count as a corner
  const exit = 1 / 430;                    // hysteresis — a corner only ends when it really opens out
  const OPEN_M = 30;                       // metres of open track needed to close a corner
  const out = [];
  let i = 0;
  while (i < smp.length) {
    if (Math.abs(k[i]) < enter) { i++; continue; }
    const sign = Math.sign(k[i]);
    let j = i, last = i, openFrom = null;
    while (j < smp.length) {
      const kk = k[j];
      if (Math.abs(kk) >= exit && Math.sign(kk) === sign) { last = j; openFrom = null; j++; continue; }
      if (Math.abs(kk) >= enter && Math.sign(kk) !== sign) break;   // direction change — split here
      if (openFrom === null) openFrom = j;
      if (smp[j].dist - smp[openFrom].dist > OPEN_M) break;
      j++;
    }
    const a = i, b = Math.min(smp.length - 1, last);
    if (smp[b].dist - smp[a].dist > 25) {
      let ap = a;
      for (let q = a; q <= b; q++) if (Math.abs(k[q]) > Math.abs(k[ap])) ap = q;
      out.push({
        n: out.length + 1, name: "T" + (out.length + 1),
        i0: a, i1: b, apex: ap,
        d0: smp[a].dist, d1: smp[b].dist, dApex: smp[ap].dist,
        dir: k[ap] > 0 ? "R" : "L",
        radius: Math.round(1 / Math.abs(k[ap])),
        minSpeed: Math.round(Math.min.apply(null, smp.slice(a, b + 1).map(s => s.speed || 0)))
      });
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

function smoothCurvature(smp, win) {
  const k = curvature(smp), n = k.length, out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let acc = 0, c = 0;
    for (let j = i; j >= 0 && smp[i].dist - smp[j].dist <= win / 2; j--) { acc += k[j]; c++; }
    for (let j = i + 1; j < n && smp[j].dist - smp[i].dist <= win / 2; j++) { acc += k[j]; c++; }
    out[i] = c ? acc / c : 0;
  }
  return out;
}

function curvature(smp) {
  const n = smp.length, k = new Array(n).fill(0);
  const havePos = smp.length > 2 && typeof smp[0].x === "number";
  for (let i = 2; i < n - 2; i++) {
    if (havePos) {
      const a = smp[i - 2], b = smp[i], c = smp[i + 2];
      const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - b.x, vz = c.z - b.z;
      const cross = ux * vz - uz * vx;
      const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      const chord = Math.hypot(c.x - a.x, c.z - a.z);
      const area = Math.abs(cross);
      k[i] = area < 1e-6 || lu * lv * chord === 0 ? 0 : Math.sign(cross) * (2 * area) / (lu * lv * chord);
    } else if (typeof b_steer(smp[i]) === "number") {
      let acc = 0;
      for (let q = i - 2; q <= i + 2; q++) acc += (b_steer(smp[q]) || 0);
      k[i] = (acc / 5) / 100 / 90;   // 100% lock ≈ 90m radius, a working guess
    }
  }
  const out = k.slice();
  for (let i = 3; i < n - 3; i++) out[i] = (k[i - 2] + k[i - 1] + k[i] + k[i + 1] + k[i + 2]) / 5;
  return out;
}
const b_steer = s => (s && typeof s.steer === "number" ? s.steer : undefined);

export function microSectors(smp) {
  const len = smp[smp.length - 1].dist || 0;
  if (len < MICRO_LEN * 2) return [];
  const count = Math.max(3, Math.round(len / MICRO_LEN));
  const step = len / count;
  const out = [];
  let idx = 0;
  for (let i = 0; i < count; i++) {
    const d1 = step * (i + 1);
    const start = idx;
    while (idx < smp.length - 1 && smp[idx].dist < d1) idx++;
    out.push({
      n: i + 1, d0: step * i, d1,
      ms: (smp[idx].rt || 0) - (smp[start].rt || 0),
      vMin: Math.round(Math.min.apply(null, smp.slice(start, idx + 1).map(s => s.speed || 0))),
      vMax: Math.round(Math.max.apply(null, smp.slice(start, idx + 1).map(s => s.speed || 0)))
    });
  }
  return out;
}

export function theoretical(laps) {
  const ref = laps[0];
  if (!ref || !ref.micro.length) return { ms: null, rows: [] };
  const pool = laps.filter(l => l.micro.length === ref.micro.length && Math.abs(l.lenM - ref.lenM) < ref.lenM * 0.02);
  const rows = ref.micro.map((m, i) => {
    let best = null, from = null;
    pool.forEach(l => { const v = l.micro[i]; if (v && v.ms > 0 && (best === null || v.ms < best)) { best = v.ms; from = l.n; } });
    return { n: m.n, d0: m.d0, d1: m.d1, best, from, cur: m.ms, lost: best === null ? null : m.ms - best };
  });
  const ms = rows.every(r => r.best) ? rows.reduce((a, r) => a + r.best, 0) : null;
  return { ms, rows, pooled: pool.length };
}

export function timeSlip(lap, ref, points) {
  points = points || 240;
  if (!lap || !ref) return [];
  const len = Math.min(lap.lenM, ref.lenM);
  const at = (l, d) => {
    const s = l.samples;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid].dist < d) lo = mid + 1; else hi = mid; }
    const b = s[lo], a = s[Math.max(0, lo - 1)];
    if (b.dist === a.dist) return b.rt || 0;
    const f = (d - a.dist) / (b.dist - a.dist);
    return (a.rt || 0) + f * ((b.rt || 0) - (a.rt || 0));
  };
  const out = [];
  for (let i = 0; i <= points; i++) {
    const d = (len * i) / points;
    out.push({ d, ms: at(lap, d) - at(ref, d) });
  }
  return out;
}

export function cornerVerdicts(lap, ref, opts) {
  opts = opts || {};
  const slip = timeSlip(lap, ref, 600);
  const slipAt = d => {
    if (!slip.length) return 0;
    const i = Math.max(0, Math.min(slip.length - 1, Math.round((d / slip[slip.length - 1].d) * (slip.length - 1))));
    return slip[i].ms;
  };
  const pbMs = opts.pbMs || null;
  return lap.corners.map(c => {
    const lost = (slipAt(Math.min(c.d1 + 60, lap.lenM)) - slipAt(Math.max(0, c.d0 - 90))) / 1000;
    const tags = [];
    const zone = lap.samples.slice(c.i0 - 40 < 0 ? 0 : c.i0 - 40, c.i1 + 1);
    const rz = refZone(ref, Math.max(0, c.d0 - 130), c.d1);

    const bp = brakePoint(zone), rbp = brakePoint(rz);
    if (bp != null && rbp != null && Math.abs(bp - rbp) > 6)
      tags.push("BRAKE " + Math.round(Math.abs(bp - rbp)) + "M " + (bp < rbp ? "EARLY" : "LATE"));

    const tp = throttlePoint(zone, c), rtp = throttlePoint(rz, c);
    if (tp != null && rtp != null && tp - rtp > 8) tags.push("THROTTLE " + Math.round(tp - rtp) + "M LATE");

    const bal = balance(lap.samples.slice(c.i0, c.i1 + 1));
    if (bal) tags.push(bal);

    const off = lineOffset(lap, ref, c);
    if (off != null && off > 1.4) tags.push("LINE " + off.toFixed(1) + "M OFF REFERENCE");

    const vRef = rz.length ? Math.min.apply(null, rz.map(s => s.speed || 999)) : null;
    if (vRef != null && vRef < 900 && c.minSpeed - vRef < -3)
      tags.push("MIN SPEED " + Math.round(vRef - c.minSpeed) + " KM/H DOWN");

    const verdict = lost > 0.08 ? "LOSS" : lost > 0.02 ? "SOFT" : "GOOD";
    return {
      n: c.n, name: c.name, dir: c.dir, radius: c.radius, minSpeed: c.minSpeed,
      d0: c.d0, d1: c.d1, dApex: c.dApex,
      lost, verdict, tags,
      pbNote: pbMs && lap.ms ? (lap.ms - pbMs) / 1000 : null
    };
  });
}

function refZone(ref, d0, d1) {
  return ref.samples.filter(s => s.dist >= d0 && s.dist <= d1);
}
function brakePoint(zone) {
  for (let i = 0; i < zone.length; i++) if ((zone[i].brake || 0) > 15) return zone[i].dist;
  return null;
}
function throttlePoint(zone, c) {
  for (let i = 0; i < zone.length; i++) if (zone[i].dist >= c.dApex && (zone[i].throttle || 0) > 40) return zone[i].dist;
  return null;
}
function balance(zone) {
  if (zone.length < 12) return null;
  const g = zone.map(s => Math.abs(s.gLat || 0)), st = zone.map(s => Math.abs(s.steer || 0));
  if (!g.some(x => x > 0.2)) return null;
  const half = Math.floor(zone.length / 2);
  const dSt = avg(st.slice(half)) - avg(st.slice(0, half));
  const dG = avg(g.slice(half)) - avg(g.slice(0, half));
  if (dSt > 6 && dG < 0.04) return "UNDERSTEER — DERIVED";
  if (dSt < -6 && dG > 0.05) return "OVERSTEER — DERIVED";
  return null;
}
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function lineOffset(lap, ref, c) {
  if (typeof lap.samples[0].x !== "number" || typeof ref.samples[0].x !== "number") return null;
  const mine = lap.samples.slice(c.i0, c.i1 + 1);
  if (!mine.length) return null;
  let acc = 0, n = 0;
  mine.forEach(s => {
    let best = null;
    for (let i = 0; i < ref.samples.length; i += 2) {
      const r = ref.samples[i];
      if (Math.abs(r.dist - s.dist) > 40) continue;
      const d = Math.hypot(r.x - s.x, r.z - s.z);
      if (best === null || d < best) best = d;
    }
    if (best !== null) { acc += best; n++; }
  });
  if (!n) return null;
  const mean = acc / n;
  // A racing line sits within a few metres of its reference. Anything past a track
  // width means the two laps are not in the same coordinate frame — say nothing.
  return mean > 25 ? null : mean;
}

export function ribbon(lap, opts) {
  opts = opts || {};
  const W = opts.width || 760, H = opts.height || 430;
  const yaw = (opts.yaw == null ? 34 : opts.yaw) * Math.PI / 180;
  const tilt = (opts.tilt == null ? 26 : opts.tilt) * Math.PI / 180;
  const vScale = opts.vScale == null ? 1 : opts.vScale;
  const wallPx = opts.wallPx == null ? WALL_PX : opts.wallPx;
  const verdicts = opts.verdicts || [];
  const base = opts.base || "rgba(96,164,232,0.30)";
  const edge = opts.edge || "rgba(150,206,255,0.85)";
  const wallCol = opts.wall || "rgba(44,92,144,0.42)";
  const cols = Object.assign({ LOSS: "#FF4D4D", SOFT: "#FFB25C", GOOD: "#5BE38C" }, opts.colors);

  const pts = centreline(lap, opts.points || 300);
  if (pts.length < 8) return null;

  const P = p => {
    const ct = Math.cos(yaw), st = Math.sin(yaw);
    const X = p.x * ct - p.z * st, Z = p.x * st + p.z * ct;
    return { x: X, y: Z * Math.sin(tilt) - p.y * vScale * Math.cos(tilt), depth: Z };
  };
  const flat = pts.map(P);
  const xs = flat.map(p => p.x), ys = flat.map(p => p.y);
  const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  const pad = RIBBON_PX + wallPx + 20;
  const k = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxY - minY));
  const ox = (W - (maxX - minX) * k) / 2 - minX * k;
  const oy = (H - (maxY - minY) * k) / 2 - minY * k;
  const S = p => { const q = P(p); return { x: q.x * k + ox, y: q.y * k + oy, depth: q.depth }; };
  const HW = RIBBON_PX / k;
  const WALL = wallPx / (k * Math.cos(tilt) * (vScale || 1));

  const verdictAt = d => {
    for (let i = 0; i < verdicts.length; i++) {
      const v = verdicts[i];
      if (d >= v.d0 - 20 && d <= v.d1 + 20) return v;
    }
    return null;
  };

  const segs = [];
  const railL = [], railR = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const na = normal(pts, i), nb = normal(pts, i + 1);
    const off = (p, n, sd, dy) => S({ x: p.x + n.x * HW * sd, y: p.y + (dy || 0), z: p.z + n.z * HW * sd });
    const AL = off(a, na, -1), AR = off(a, na, 1), BL = off(b, nb, -1), BR = off(b, nb, 1);
    const ALd = off(a, na, -1, -WALL), ARd = off(a, na, 1, -WALL), BLd = off(b, nb, -1, -WALL), BRd = off(b, nb, 1, -WALL);
    const v = verdictAt(a.dist);
    const fill = v ? tint(cols[v.verdict] || base) : base;
    const stroke = v ? cols[v.verdict] || edge : edge;
    const depth = (AL.depth + BR.depth) / 2;
    segs.push({ kind: "wall", depth, pts: poly([AL, BL, BLd, ALd]), fill: wallCol });
    segs.push({ kind: "wall", depth, pts: poly([AR, BR, BRd, ARd]), fill: wallCol });
    segs.push({ kind: "top", depth, pts: poly([AL, BL, BR, AR]), fill, stroke: fill, corner: v ? v.name : "" });
    railL.push(AL); railR.push(AR);
    if (i === pts.length - 2) { railL.push(BL); railR.push(BR); }
  }
  segs.sort((p, q) => p.depth - q.depth);
  const rails = [railL, railR].map(r => ({ pts: r.map(p => Math.round(p.x * 10) / 10 + "," + Math.round(p.y * 10) / 10).join(" "), color: edge }));

  const labels = verdicts.map(v => {
    let best = pts[0], bd = 1e9;
    pts.forEach(p => { const d = Math.abs(p.dist - v.dApex); if (d < bd) { bd = d; best = p; } });
    const s = S(best);
    return { name: v.name, x: s.x, y: s.y - 17, color: cols[v.verdict] || edge, lost: v.lost };
  });

  const st = S(pts[0]);
  const elev = Math.round(Math.max.apply(null, pts.map(p => p.y)) - Math.min.apply(null, pts.map(p => p.y)));
  return { w: W, h: H, segs, rails, labels, start: { x: st.x, y: st.y }, elevM: elev, vScale, synthetic: !lap.channels.pos };
}

function poly(a) { return a.map(p => Math.round(p.x * 10) / 10 + "," + Math.round(p.y * 10) / 10).join(" "); }
function tint(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + ",0.42)";
}
function normal(pts, i) {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  return { x: -dz / l, z: dx / l };
}

function centreline(lap, count) {
  const s = lap.samples;
  if (!s.length) return [];
  const out = [];
  if (lap.channels.pos) {
    const step = lap.lenM / count;
    let idx = 0;
    for (let i = 0; i <= count; i++) {
      const d = step * i;
      while (idx < s.length - 1 && s[idx].dist < d) idx++;
      const p = s[idx];
      out.push({ x: p.x, y: typeof p.y === "number" ? p.y : 0, z: p.z, dist: p.dist });
    }
    return out;
  }
  let x = 0, z = 0, head = 0;
  const k = curvature(s);
  for (let i = 1; i < s.length; i++) {
    const ds = s[i].dist - s[i - 1].dist;
    if (!(ds > 0)) continue;
    head += k[i] * ds;
    x += Math.sin(head) * ds; z += Math.cos(head) * ds;
    out.push({ x, y: 0, z, dist: s[i].dist });
  }
  const stride = Math.max(1, Math.floor(out.length / count));
  return out.filter((_, i) => i % stride === 0);
}

export function motecCsv(lap, meta) {
  meta = meta || {};
  const ch = [
    ["Distance", "m", s => s.dist],
    ["Time", "s", s => (s.rt || 0) / 1000],
    ["Speed", "km/h", s => s.speed],
    ["Throttle Pos", "%", s => s.throttle],
    ["Brake Pos", "%", s => s.brake],
    ["Steering Angle", "%", s => s.steer],
    ["Gear", "", s => s.gear],
    ["Engine RPM", "rpm", s => s.rpm],
    ["G Force Lat", "G", s => s.gLat],
    ["G Force Long", "G", s => s.gLon],
    ["Corr Speed", "km/h", s => s.speed],
    ["Tyre Temp FL", "C", s => s.t0], ["Tyre Temp FR", "C", s => s.t1],
    ["Tyre Temp RL", "C", s => s.t2], ["Tyre Temp RR", "C", s => s.t3],
    ["Tyre Press FL", "psi", s => s.tp0], ["Tyre Press FR", "psi", s => s.tp1],
    ["Tyre Press RL", "psi", s => s.tp2], ["Tyre Press RR", "psi", s => s.tp3],
    ["Brake Temp FL", "C", s => s.bt0], ["Brake Temp FR", "C", s => s.bt1],
    ["Brake Temp RL", "C", s => s.bt2], ["Brake Temp RR", "C", s => s.bt3],
    ["Susp Pos FL", "mm", s => s.susp0], ["Susp Pos FR", "mm", s => s.susp1],
    ["Susp Pos RL", "mm", s => s.susp2], ["Susp Pos RR", "mm", s => s.susp3],
    ["Fuel Level", "L", s => s.fuel],
    ["Pos X", "m", s => s.x], ["Pos Y", "m", s => s.y], ["Pos Z", "m", s => s.z]
  ].filter(c => lap.samples.some(s => typeof c[2](s) === "number"));

  const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const L = [];
  L.push([q("Format"), q("MoTeC CSV File")].join(","));
  L.push([q("Venue"), q(meta.track || lap.track || "Unknown")].join(","));
  L.push([q("Vehicle"), q(meta.car || lap.car || "Unknown")].join(","));
  L.push([q("Driver"), q(meta.driver || "")].join(","));
  L.push([q("Device"), q("Race Engineer — " + (lap.game || meta.game || "sim") + " UDP bridge")].join(","));
  L.push([q("Comment"), q("Lap " + lap.n + (lap.ms ? " · " + (lap.ms / 1000).toFixed(3) + "s" : "") + " · " + Math.round(lap.lenM) + "m")].join(","));
  L.push([q("Duration"), q(((lap.ms || 0) / 1000).toFixed(3))].join(","));
  L.push("");
  L.push(ch.map(c => q(c[0])).join(","));
  L.push(ch.map(c => q(c[1])).join(","));
  L.push("");
  lap.samples.forEach(s => {
    L.push(ch.map(c => { const v = c[2](s); return typeof v === "number" ? Math.round(v * 1000) / 1000 : ""; }).join(","));
  });
  return L.join("\r\n");
}

export function damperHistogram(lap, corner) {
  const key = ["susp0", "susp1", "susp2", "susp3"][corner] || "susp0";
  const s = lap.samples;
  if (!s.some(x => typeof x[key] === "number")) return null;
  const bins = [-150, -100, -50, -25, -10, 10, 25, 50, 100, 150];
  const counts = new Array(bins.length + 1).fill(0);
  let n = 0, minP = 1e9, maxP = -1e9;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1][key], b = s[i][key];
    if (typeof a !== "number" || typeof b !== "number") continue;
    const dt = ((s[i].rt || 0) - (s[i - 1].rt || 0)) / 1000;
    if (!(dt > 0)) continue;
    const v = (b - a) / dt;
    let k = bins.length;
    for (let q = 0; q < bins.length; q++) if (v < bins[q]) { k = q; break; }
    counts[k]++; n++;
    if (b < minP) minP = b;
    if (b > maxP) maxP = b;
  }
  if (!n) return null;
  const labels = ["<-150", "-150", "-100", "-50", "-25", "±10", "25", "50", "100", "150", ">150"];
  return {
    bins: counts.map((c, i) => ({ label: labels[i] || "", pct: (c / n) * 100, count: c })),
    travelMm: Math.round(maxP - minP), n,
    bottoming: countAt(s, key, maxP, 0.5) / n * 100
  };
}
function countAt(s, key, edge, tol) {
  let c = 0;
  s.forEach(x => { if (typeof x[key] === "number" && Math.abs(x[key] - edge) < tol) c++; });
  return c;
}

const DEMO_PLAN = [
  [720, 0], [95, -95], [140, 0], [120, 160], [300, 0], [70, 34],
  [250, 0], [130, -210], [90, 0], [80, -62], [420, 0], [150, 185],
  [180, 0], [60, 44], [230, 0], [170, -320], [480, 0], [110, 72],
  [160, 0], [100, -105], [270, 0], [65, 40], [330, 0], [140, 240], [210, 0]
];

export function demoLap(n, seed) {
  const rnd = mulberry(seed || n * 977 + 13);
  const DS = 3;

  const raw = [];
  let head = 0, dist = 0;
  DEMO_PLAN.forEach(([len, r]) => {
    for (let d = 0; d < len; d += DS) {
      if (r) head += (DS / r);
      dist += DS;
      raw.push({ head, dist, r: r ? Math.abs(r) : 1200 });
    }
  });
  const total = dist;
  const fix = (Math.PI * 2 - head) / total;
  let x = 0, z = 0;
  const path = raw.map(p => {
    const h = p.head + fix * p.dist;
    x += Math.sin(h) * DS; z += Math.cos(h) * DS;
    return { x, z, dist: p.dist, r: p.r, head: h };
  });
  const gx = path[path.length - 1].x, gz = path[path.length - 1].z;
  path.forEach(p => { const f = p.dist / total; p.x -= gx * f; p.z -= gz * f; });
  path.forEach(p => {
    const u = p.dist / total;
    p.y = Math.sin(u * Math.PI * 2 - 0.7) * 11 + Math.sin(u * Math.PI * 6) * 3.5 + u * 4;
  });

  const bias = DEMO_PLAN.map(() => 0.955 + rnd() * 0.09);
  const segOf = [];
  DEMO_PLAN.forEach(([len], i) => { for (let d = 0; d < len; d += DS) segOf.push(i); });
  const N = path.length;
  const vmax = 84;
  const lim = path.map((p, i) => Math.min(vmax, Math.sqrt(1.52 * 9.81 * p.r) * (bias[segOf[i]] || 1)));
  const v = lim.slice();
  for (let i = 1; i < N; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * 4.6 * DS));
  for (let i = N - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * 11.5 * DS));
  v[0] = Math.min(v[0], v[N - 1]);

  const samples = [];
  let t = 0;
  for (let i = 0; i < N; i++) {
    const p = path[i];
    const vi = v[i], kmh = vi * 3.6;
    const dv = (v[Math.min(N - 1, i + 1)] - v[Math.max(0, i - 1)]) / (2 * DS);
    const along = dv * vi;
    const turn = i > 0 ? p.head - path[i - 1].head : 0;
    const gLat = Math.max(-1.9, Math.min(1.9, (vi * vi) / Math.max(45, p.r) / 9.81 * Math.sign(turn || 1)));
    const gLon = Math.max(-1.7, Math.min(1.2, along / 9.81));
    const brake = along < -0.6 ? Math.min(100, -along / 11.5 * 100) : 0;
    const thr = along >= -0.6 ? Math.min(100, 45 + Math.max(0, along) / 4.6 * 62) : 0;
    const load = Math.abs(gLat), heat = 74 + load * 18 + (p.dist / total) * 4;
    t += (DS / Math.max(6, vi)) * 1000;
    samples.push({
      t, dist: p.dist, lap: n, rt: t,
      x: p.x, y: p.y, z: p.z,
      speed: kmh, gear: Math.max(1, Math.min(7, 1 + Math.round(kmh / 46))), rpm: 4200 + ((kmh * 47) % 4300),
      throttle: Math.round(thr), brake: Math.round(brake),
      steer: Math.max(-100, Math.min(100, (1 / Math.max(45, p.r)) * 4200 * Math.sign(turn || 1))),
      gLat, gLon,
      t0: heat + 4, t1: heat + 6, t2: heat - 2, t3: heat,
      ti0: heat + 15, ti1: heat + 18, ti2: heat + 9, ti3: heat + 11,
      bt0: 300 + brake * 4.4, bt1: 306 + brake * 4.4, bt2: 240 + brake * 3.2, bt3: 244 + brake * 3.2,
      tp0: 23.4, tp1: 23.5, tp2: 22.1, tp3: 22.2,
      susp0: 38 + gLat * 11 - Math.max(0, -gLon) * 9, susp1: 38 - gLat * 11 - Math.max(0, -gLon) * 9,
      susp2: 44 + gLat * 8 + Math.max(0, gLon) * 7, susp3: 44 - gLat * 8 + Math.max(0, gLon) * 7,
      fuel: 62 - (p.dist / total) * 2.6
    });
  }
  const lap = buildLap(samples, { n, ms: t, track: "DEMO CIRCUIT", car: "DEMO CAR", game: "DEMO", compound: "MEDIUM", stintAge: n, airC: 24, trackC: 33, fuelUsed: 2.6 });
  lap.demo = true;
  return lap;
}
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
