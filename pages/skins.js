// Skin helpers: arcs, dials, tyre diagram and circuit map for the four dashboard skins.
// Reads state only — nothing here writes state or touches the delta engine or the engineer.
const TAU = Math.PI / 180;
const pol = (cx, cy, r, a) => [cx + r * Math.sin(a * TAU), cy - r * Math.cos(a * TAU)];
const q = n => Math.round(n * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = v => (typeof v === "number" && isFinite(v) ? v : null);

function sector(cx, cy, ri, ro, a0, a1) {
  const [x0, y0] = pol(cx, cy, ro, a0), [x1, y1] = pol(cx, cy, ro, a1);
  const [x2, y2] = pol(cx, cy, ri, a1), [x3, y3] = pol(cx, cy, ri, a0);
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M${q(x0)},${q(y0)} A${ro},${ro} 0 ${big} 1 ${q(x1)},${q(y1)} L${q(x2)},${q(y2)} A${ri},${ri} 0 ${big} 0 ${q(x3)},${q(y3)}Z`;
}
function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = pol(cx, cy, r, a0), [x1, y1] = pol(cx, cy, r, a1);
  return `M${q(x0)},${q(y0)} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${q(x1)},${q(y1)}`;
}

const mix = (c1, c2, t) => {
  const a = [1, 3, 5].map(i => parseInt(c1.slice(i, i + 2), 16)), b = [1, 3, 5].map(i => parseInt(c2.slice(i, i + 2), 16));
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
};
function tyreCol(v) {
  if (v < 60) return "#4EA8FF";
  if (v < 78) return mix("#4EA8FF", "#3BE06A", (v - 60) / 18);
  if (v < 96) return mix("#3BE06A", "#C8E63A", (v - 78) / 18);
  if (v < 104) return mix("#C8E63A", "#F5D93A", (v - 96) / 8);
  return mix("#F5D93A", "#FF5A3D", Math.min(1, (v - 104) / 16));
}
const band = v => (v < 60 ? "COLD" : v < 78 ? "WARMING" : v <= 103 ? "IN WINDOW" : "OVER WINDOW");

// ---- circuit outline from the catalogue, smoothed and fitted to a box (cached per circuit)
function catmull(pts, per) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      const f = k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  return out;
}
function fitMap(raw, start, W, H, pad) {
  let best = null;
  for (let deg = 0; deg < 180; deg += 10) {
    const th = deg * TAU, c = Math.cos(th), s = Math.sin(th);
    const r = raw.map(([x, y]) => [x * c - y * s, x * s + y * c]);
    const xs = r.map(p => p[0]), ys = r.map(p => p[1]);
    const sc = Math.min((W - 2 * pad) / (Math.max(...xs) - Math.min(...xs)), (H - 2 * pad) / (Math.max(...ys) - Math.min(...ys)));
    if (!best || sc > best.sc) best = { deg, sc, r, xs, ys };
  }
  const { deg, sc, r, xs, ys } = best, th = deg * TAU, c = Math.cos(th), s = Math.sin(th);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const map = ([x, y]) => { const rx = x * c - y * s, ry = x * s + y * c; return [(rx - cx) * sc + W / 2, (ry - cy) * sc + H / 2]; };
  let pts = raw.map(map);
  if (start && typeof start.x === "number") {          // begin the loop at the start line
    const sp = map([start.x, start.z]);
    let bi = 0, bd = 1e18;
    pts.forEach((p, i) => { const d = (p[0] - sp[0]) ** 2 + (p[1] - sp[1]) ** 2; if (d < bd) { bd = d; bi = i; } });
    pts = pts.slice(bi).concat(pts.slice(0, bi));
  }
  return { dense: catmull(pts, 8), map, sc };
}
function corners(pts, win, minsep, maxn) {
  const n = pts.length, sc = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - win + n) % n], b = pts[i], c = pts[(i + win) % n];
    const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    sc.push(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]));
  }
  const chosen = [];
  Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(sc[b]) - Math.abs(sc[a])).forEach(i => {
    if (Math.abs(sc[i]) < 0.45 || chosen.length >= maxn) return;
    if (chosen.every(j => Math.min((i - j + n) % n, (j - i + n) % n) > minsep)) chosen.push(i);
  });
  return chosen.sort((a, b) => a - b).map(i => [i, sc[i]]);
}
function circuit(C, W, H, pad) {
  const head = (C.state.sessions || [])[0];
  const id = head && head.trackId;
  if (!id) return null;
  const key = id + "|" + W + "x" + H;
  if (C._skMap && C._skMap.key === key) return C._skMap;
  const ent = C.catTrack ? C.catTrack(id) : null;
  if (!ent || !ent.path || ent.path.length < 12) return (C._skMap = { key, none: true });
  const m = fitMap(ent.path, ent.start, W, H, pad);
  const n = m.dense.length, cum = [0];
  for (let i = 1; i <= n; i++) { const a = m.dense[i - 1], b = m.dense[i % n]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  return (C._skMap = { key, ...m, n, cum, total: cum[n], corners: corners(m.dense, 14, 48, 10), name: ent.name });
}
const polyStr = (pts, a, b) => pts.slice(a, b + 1).map(p => q(p[0]) + "," + q(p[1])).join(" ");

export function skinVals(C, t) {
  const s = C.state, skin = t.skin || "cockpit";
  const L = C.liveState(), onAir = L === "LIVE" || L === "LOST";
  const LDT = C.liveNow() || (C.everLive ? C.live : null);
  const FX = (LDT && LDT.f1) || null;
  const dxs = s.dxs || null;
  const POS = t.pos || "#3BE06A", NEG = t.neg || "#F2564B";
  const out = {
    skinCockpit: skin === "cockpit", skinGlance: skin === "glance", skinTrack: skin === "track", skinHeritage: skin === "heritage",
    hasF1: !!FX
  };

  // engine speed scale: the car's own rev limit when the game sends it
  const lim = LDT && LDT.rpmLimit > 1000 ? LDT.rpmLimit : 0;
  let scaleMax = lim ? Math.ceil(lim * 1.04 / 1000) * 1000 : 9000;
  if (s.rpm > scaleMax) scaleMax = Math.ceil(s.rpm / 1000) * 1000;
  const red = lim || scaleMax * 0.93;
  const frac = onAir ? clamp(s.rpm / scaleMax, 0, 1) : 0;
  const zone = rpm => (rpm < red * 0.72 ? t.text : rpm < red * 0.93 ? t.acc : rpm < red ? "#FF8A3D" : "#F2564B");

  // shared bits
  const dl = dxs && onAir ? num(dxs.liveDelta) : null;
  out.skDbLeft = dl === null ? "50%" : dl < 0 ? "50%" : (50 - clamp(Math.abs(dl), 0, 1) * 50) + "%";
  out.skDbW = dl === null ? "0%" : clamp(Math.abs(dl), 0, 1) * 50 + "%";
  out.skDbCol = dl !== null && dl > 0 ? NEG : POS;
  out.skEngImg = 'url("portraits/' + (s.engineerPick || "wren") + '.png")';
  out.skEngName = (C.ROS && C.ROS.byId ? C.ROS.byId(s.engineerPick || "wren").name : "Wren").toUpperCase();

  // sector progress cells: finished sectors take their F1 colour, the live one fills as you go
  const N = (dxs && dxs.sectorCount) || 3, cur = dxs ? dxs.currentSector : 0;
  const prog = dxs && num(dxs.trackProgress) !== null ? clamp(dxs.trackProgress, 0, 1) : 0;
  const SC = { purple: "#C061FF", green: "#3BE06A", yellow: "#F5D93A", white: t.text };
  out.skProg = Array.from({ length: N }, (_, i) => {
    const st = dxs && dxs.sectorColors ? dxs.sectorColors[i] : null;
    if (!onAir || !dxs) return { fill: "transparent", fw: "0%" };
    if (i < cur) return { fill: st ? SC[st] : t.text, fw: "100%" };
    if (i === cur) return { fill: t.text, fw: clamp((prog * N - cur) * 100, 0, 100) + "%" };
    return { fill: "transparent", fw: "0%" };
  });

  // long circuits get many sectors: keep the tiles compact
  out.skFull = N <= 6;
  out.skTSz = N <= 6 ? "22px" : "15px";
  out.skTilePad = N <= 6 ? "8px 10px 0" : "3px 6px 0";
  out.skTilePb = N <= 6 ? "8px" : "3px";
  out.skBarH = N <= 6 ? "5px" : "3px";

  // tyres: car diagram + window bars (raw temps, shown in the chosen unit)
  const T = (s.tyres || []).slice(0, 4);
  const NM = ["FL", "FR", "RL", "RR"];
  const pos = [[56, 14], [236, 14], [56, 110], [236, 110]];
  out.skTy = NM.map((nm, i) => {
    const v = T[i] > 0 && onAir ? T[i] : null;
    const [x, y] = pos[i], left = i % 2 === 0;
    const col = v === null ? "rgba(255,255,255,.12)" : tyreCol(v);
    return {
      pos: nm, x, y, fill: col, band: v === null ? "—" : band(v), bandCol: v === null ? t.dim : col,
      txt: v === null ? "—" : C.tempStr(v), lp: q((left ? x - 10 : x + 48) / 3.3) + "%", tp: q((y + 40) / 1.9) + "%", tr: left ? "-100%" : "0",
      mark: v === null ? "0%" : clamp((v - 50) / 70, 0, 1) * 100 + "%", winL: ((78 - 50) / 70 * 100) + "%", winW: ((103 - 78) / 70 * 100) + "%"
    };
  });

  // water / oil rings
  const ring = (v, lo, hi, col) => {
    const f = v === null ? 0 : clamp((v - lo) / (hi - lo), 0, 1);
    return { dash: (188.5 * f) + " 251.3", col, txt: v === null ? "—" : Math.round(v) + "°C" };
  };
  const wt = LDT && onAir ? num(LDT.waterTemp) : null, ot = LDT && onAir ? num(LDT.oilTemp) : null;
  out.skWater = ring(wt, 60, 130, wt > 112 ? "#F2564B" : "#4EA8FF");
  out.skOil = ring(ot, 60, 150, ot > 135 ? "#F2564B" : "#FF8A3D");
  out.skCar = [
    { k: "OIL PRESS", v: LDT && onAir ? (LDT.oilPressure || 0).toFixed(1) + " bar" : "—" },
    { k: "BOOST", v: LDT && onAir ? (LDT.boost || 0).toFixed(2) + " bar" : "—" }
  ];

  // ----- COCKPIT: arc round the gear
  if (skin === "cockpit") {
    const n = 54, segs = [];
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, a0 = -125 + 250 * i / n + 0.55, a1 = -125 + 250 * (i + 1) / n - 0.55;
      segs.push({ d: sector(380, 300, 228, 264, a0, a1), fill: f <= frac && onAir ? zone(f * scaleMax) : "rgba(255,255,255,.07)" });
    }
    out.ckSegs = segs;
    out.ckTicks = Array.from({ length: Math.floor(scaleMax / 1000) + 1 }, (_, k) => {
      const [x, y] = pol(380, 300, 288, -125 + 250 * (k * 1000 / scaleMax));
      return { x: q(x), y: q(y + 5), lp: q(x / 7.6) + "%", tp: q((y + 5) / 5.9) + "%", t: k, fill: k * 1000 >= red ? "#F2564B" : t.dim };
    });
    const [rx1, ry1] = pol(380, 300, 220, -125 + 250 * red / scaleMax), [rx2, ry2] = pol(380, 300, 274, -125 + 250 * red / scaleMax);
    out.ckRed = { x1: q(rx1), y1: q(ry1), x2: q(rx2), y2: q(ry2) };
    out.ckThrPx = clamp(s.throttle, 0, 100) * 2.2;
    out.ckBrkPx = clamp(s.brake, 0, 100) * 2.2;
  }

  // ----- GLANCE HUD: ring of dots
  if (skin === "glance") {
    const n = 76;
    out.glDots = Array.from({ length: n }, (_, i) => {
      const f = (i + 0.5) / n, [x, y] = pol(782, 362, 262, -135 + 270 * f), on = f <= frac && onAir;
      return { cx: q(x), cy: q(y), r: q(3.2 + 5.6 * f), fill: on ? zone(f * scaleMax) : "rgba(255,255,255,.09)", filter: on ? "url(#glGlow)" : "none" };
    });
    out.glDelta = dl === null ? "–" : (dl < 0 ? "▲" : "▼");
    out.glTy = NM.map((nm, i) => {
      const v = T[i] > 0 && onAir ? T[i] : null, cx = 1290 + i * 72;
      return { cx, lp: q(cx / 15.64) + "%", tp: q(453 / 6) + "%", lp2: q(496 / 6) + "%", pos: nm, txt: v === null ? "—" : C.tempStr(v), col: v === null ? "rgba(255,255,255,.14)" : tyreCol(v) };
    });
  }

  // ----- TRACK HERO: circuit map coloured by sector + edge LEDs
  if (skin === "track") {
    out.skLeds = Array.from({ length: 24 }, (_, i) => {
      const g = i < 8 ? 0 : i < 16 ? 1 : 2, col = ["#3BE06A", "#F2564B", "#4EA8FF"][g], on = onAir && i < Math.round(24 * frac);
      return { bg: on ? col : "rgba(255,255,255,.07)", glow: on ? "0 0 12px " + col + "aa" : "none" };
    });
    const W = 860, H = 540, m = circuit(C, W, H, 62);
    out.thHas = !!(m && !m.none && onAir);
    out.thNone = !out.thHas;
    out.thHint = !onAir ? "No signal yet." : m && m.none ? "This circuit has no map data yet." : "Finish a lap to draw the circuit.";
    out.thName = m && !m.none ? m.name : "";
    out.thSegs = []; out.thLabels = []; out.thDot = { x: -50, y: -50 }; out.thLine = { x1: 0, y1: 0, x2: 0, y2: 0 };
    if (out.thHas) {
      const P = m.dense, n = m.n, lap = P.concat([P[0]]);
      out.thBase = polyStr(lap, 0, n);
      // car position = nearest point on the circuit to the live position
      const pos = C.lastFrame && C.lastFrame.pos;
      let ci = 0;
      if (pos && typeof pos.x === "number") {
        const [px, py] = m.map([pos.x, pos.z]); let bd = 1e18;
        P.forEach((p, i) => { const d = (p[0] - px) ** 2 + (p[1] - py) ** 2; if (d < bd) { bd = d; ci = i; } });
      }
      const idxAt = f => { const target = f * m.total; let lo = 0, hi = n; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (m.cum[mid] <= target) lo = mid; else hi = mid; } return lo; };
      for (let i = 0; i < N; i++) {
        const a = idxAt(i / N), b = idxAt((i + 1) / N), st = dxs && dxs.sectorColors ? dxs.sectorColors[i] : null;
        if (i < cur) out.thSegs.push({ pts: polyStr(lap, a, b), stroke: st ? SC[st] : "#F4F5F2", w: 9, filter: "url(#thGlow)" });
        else if (i === cur) {
          const e = clamp(ci, a, b);
          out.thSegs.push({ pts: polyStr(lap, a, e), stroke: "#F4F5F2", w: 9, filter: "url(#thGlow)" });
          out.thSegs.push({ pts: polyStr(lap, e, b), stroke: "rgba(255,255,255,.16)", w: 4, filter: "none" });
        } else out.thSegs.push({ pts: polyStr(lap, a, b), stroke: "rgba(255,255,255,.16)", w: 4, filter: "none" });
      }
      m.corners.forEach(([i, ang], k) => {
        const a = P[(i - 6 + n) % n], b = P[i], c = P[(i + 6) % n];
        let tx = c[0] - a[0], ty = c[1] - a[1]; const L2 = Math.hypot(tx, ty) || 1; tx /= L2; ty /= L2;
        const [ox, oy] = ang > 0 ? [ty, -tx] : [-ty, tx];
        const lx = b[0] + ox * 38, ly = b[1] + oy * 38;
        out.thLabels.push({ x: q(lx), cy: q(ly), lp: q(lx / 8.6) + "%", tp: q((ly + 4) / 5.4) + "%", n: k + 1 });
      });
      out.thDot = { x: q(P[ci][0]), y: q(P[ci][1]) };
      const a0 = P[0], b0 = P[6], dx = b0[0] - a0[0], dy = b0[1] - a0[1], ln = Math.hypot(dx, dy) || 1, nx = -dy / ln * 18, ny = dx / ln * 18;
      out.thLine = { x1: q(a0[0] - nx), y1: q(a0[1] - ny), x2: q(a0[0] + nx), y2: q(a0[1] + ny) };
    }
  }

  // ----- HERITAGE: analogue dials
  if (skin === "heritage") {
    const cx = 782, cy = 322, R = 285, face = R - 15, TS = scaleMax / 1000;
    const a = v => -135 + 270 * v / scaleMax;
    out.hrTicks = [];
    for (let v = 0; v <= scaleMax; v += 200) {
      const major = v % 1000 === 0, [x1, y1] = pol(cx, cy, face - (major ? 34 : 20), a(v)), [x2, y2] = pol(cx, cy, face - 8, a(v));
      out.hrTicks.push({ x1: q(x1), y1: q(y1), x2: q(x2), y2: q(y2), col: v >= red ? "#E0372B" : "#E9E3D2", w: major ? 3.4 : 1.5, op: major ? 1 : 0.7 });
    }
    out.hrNums = Array.from({ length: TS + 1 }, (_, k) => {
      const [x, y] = pol(cx, cy, face - 66, a(k * 1000));
      return { x: q(x), y: q(y + 13), lp: q(x / 15.64) + "%", tp: q((y + 13) / 6.2) + "%", t: k, fill: k * 1000 >= red ? "#E0372B" : "#E9E3D2" };
    });
    out.hrRed = arc(cx, cy, face - 3, a(Math.min(red, scaleMax)), 135);
    out.hrNeedle = "rotate(" + q(a(onAir ? Math.min(s.rpm, scaleMax) : 0)) + " " + cx + " " + cy + ")";
    out.hrScaleLabel = "RPM × 1000";
    // fuel dial (left)
    const fuelF = clamp((s.fuel || 0) / 60, 0, 1);
    out.hrFuelBg = arc(262, 336, 150, -135, 135);
    out.hrFuelFill = fuelF > 0.005 ? arc(262, 336, 150, -135, -135 + 270 * fuelF) : "";
    out.hrFuelTicks = Array.from({ length: 5 }, (_, k) => { const [x1, y1] = pol(262, 336, 185, -135 + 67.5 * k), [x2, y2] = pol(262, 336, 173, -135 + 67.5 * k); return { x1: q(x1), y1: q(y1), x2: q(x2), y2: q(y2) }; });
    out.hrWater = wt === null ? "—" : Math.round(wt) + "°";
    out.hrOil = ot === null ? "—" : Math.round(ot) + "°";
    // delta dial (right): needle swings right when you are faster
    const dd = dl === null ? 0 : clamp(dl, -1, 1);
    out.hrDeltaNeedle = "rotate(" + q(-dd * 80) + " 1302 376)";
    out.hrDeltaGood = arc(1302, 336, 160, 0, 80);
    out.hrDeltaBad = arc(1302, 336, 160, -80, 0);
    out.hrDeltaTicks = [-1, -0.5, 0, 0.5, 1].map(v => {
      const [x1, y1] = pol(1302, 336, 185, 80 * v), [x2, y2] = pol(1302, 336, 170, 80 * v), [x3, y3] = pol(1302, 336, 148, 80 * v);
      return { x1: q(x1), y1: q(y1), x2: q(x2), y2: q(y2), x3: q(x3), y3: q(y3 + 5), lp: q(x3 / 15.64) + "%", tp: q((y3 + 5) / 6.2) + "%", t: v === 0 ? "0" : (v < 0 ? "+" : "−") + Math.abs(v).toFixed(1).replace(/^0/, "") };
    });
  }
  return out;
}
