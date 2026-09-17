
export const CATALOGUE_URL = "https://catalogue.raceengineer.app/gt7/v1.json";

export const TRACK_SEED = [
  { id: "suzuka",        name: "Suzuka Circuit",              cc: "JP", lenM: 5807,  turns: 18, conf: "exact" },
  { id: "suzuka-east",   name: "Suzuka Circuit East",         cc: "JP", lenM: 2243,  turns: 9,  conf: "exact" },
  { id: "fuji",          name: "Fuji Speedway",               cc: "JP", lenM: 4563,  turns: 16, conf: "exact" },
  { id: "tsukuba",       name: "Tsukuba Circuit",             cc: "JP", lenM: 2045,  turns: 14, conf: "exact" },
  { id: "autopolis",     name: "Autopolis",                   cc: "JP", lenM: 4674,  turns: 19, conf: "exact" },
  { id: "spa",           name: "Circuit de Spa-Francorchamps", cc: "BE", lenM: 7004, turns: 19, conf: "exact" },
  { id: "monza",         name: "Autodromo Nazionale Monza",   cc: "IT", lenM: 5793,  turns: 11, conf: "exact" },
  { id: "nurb-gp",       name: "Nürburgring GP",              cc: "DE", lenM: 5148,  turns: 15, conf: "exact" },
  { id: "nurb-nords",    name: "Nürburgring Nordschleife",    cc: "DE", lenM: 20832, turns: 73, conf: "exact" },
  { id: "nurb-24h",      name: "Nürburgring 24h",             cc: "DE", lenM: 25378, turns: 87, conf: "exact" },
  { id: "redbull",       name: "Red Bull Ring",               cc: "AT", lenM: 4318,  turns: 10, conf: "exact" },
  { id: "redbull-short", name: "Red Bull Ring Short Track",   cc: "AT", lenM: 2167,  turns: 6,  conf: "exact" },
  { id: "catalunya",     name: "Circuit de Barcelona-Catalunya", cc: "ES", lenM: 4655, turns: 14, conf: "exact" },
  { id: "brands-gp",     name: "Brands Hatch Grand Prix",     cc: "GB", lenM: 3916,  turns: 9,  conf: "exact" },
  { id: "brands-indy",   name: "Brands Hatch Indy",           cc: "GB", lenM: 1929,  turns: 6,  conf: "exact" },
  { id: "goodwood",      name: "Goodwood Motor Circuit",      cc: "GB", lenM: 3809,  turns: 9,  conf: "exact" },
  { id: "sarthe",        name: "Circuit de la Sarthe",        cc: "FR", lenM: 13626, turns: 38, conf: "exact" },
  { id: "interlagos",    name: "Autódromo José Carlos Pace",  cc: "BR", lenM: 4309,  turns: 15, conf: "exact" },
  { id: "bathurst",      name: "Mount Panorama",              cc: "AU", lenM: 6213,  turns: 23, conf: "exact" },
  { id: "laguna",        name: "WeatherTech Raceway Laguna Seca", cc: "US", lenM: 3602, turns: 11, conf: "exact" },
  { id: "atlanta",       name: "Michelin Raceway Road Atlanta", cc: "US", lenM: 4088, turns: 12, conf: "exact" },
  { id: "watkins-long",  name: "Watkins Glen Long Course",    cc: "US", lenM: 5552,  turns: 11, conf: "exact" },
  { id: "watkins-short", name: "Watkins Glen Short Course",   cc: "US", lenM: 3960,  turns: 7,  conf: "exact" },
  { id: "daytona-road",  name: "Daytona Road Course",         cc: "US", lenM: 5729,  turns: 12, conf: "exact" },
  { id: "daytona-oval",  name: "Daytona Tri-Oval",            cc: "US", lenM: 4023,  turns: 4,  conf: "exact" },
  { id: "willow-big",    name: "Willow Springs Big Willow",   cc: "US", lenM: 4023,  turns: 9,  conf: "exact" },
  { id: "route-x",       name: "Special Stage Route X",       cc: "XX", lenM: 30283, turns: 4,  conf: "exact" },
  { id: "deep-forest",   name: "Deep Forest Raceway",         cc: "XX", lenM: 3607,  turns: 12, conf: "approx" },
  { id: "trial-mountain",name: "Trial Mountain Circuit",      cc: "XX", lenM: 3945,  turns: 12, conf: "approx" },
  { id: "high-speed",    name: "High Speed Ring",             cc: "XX", lenM: 3901,  turns: 7,  conf: "approx" },
  { id: "blue-moon",     name: "Blue Moon Bay Speedway",      cc: "XX", lenM: 3218,  turns: 4,  conf: "approx" }
];

export const CAR_SEED = {};

const FLAGS = {
  JP: ["#BC002D", "#F2F2F2"], DE: ["#DD0000", "#FFCE00"], GB: ["#C8102E", "#012169"],
  FR: ["#0055A4", "#EF4135"], IT: ["#008C45", "#CD212A"], ES: ["#C60B1E", "#FFC400"],
  BE: ["#000000", "#FDDA24"], AT: ["#ED2939", "#FFFFFF"], US: ["#3C3B6E", "#B22234"],
  BR: ["#009C3B", "#FFDF00"], AU: ["#00247D", "#C8102E"], CA: ["#D80621", "#FFFFFF"],
  CH: ["#D52B1E", "#FFFFFF"], NL: ["#AE1C28", "#21468B"], PT: ["#046A38", "#DA291C"],
  XX: ["#5A6070", "#8C93A3"]
};
export function flagColors(cc) { return FLAGS[cc] || FLAGS.XX; }

function band(entry) { return entry.conf === "exact" ? 25 : 90; }

function startMatch(entry, start) {
  if (!entry.start || !start) return null;
  const d = Math.hypot(entry.start[0] - start.x, entry.start[1] - start.z);
  return d < 500 ? d : null;
}

export function identify(query, tracks) {
  const len = query && query.lenM;
  if (!(len > 400)) return null;
  const table = tracks && tracks.length ? tracks : TRACK_SEED;
  const near = table.filter(e => Math.abs(e.lenM - len) <= band(e));
  if (!near.length) return null;

  if (near.length > 1 && query.start) {
    const placed = near.map(e => ({ e, d: startMatch(e, query.start) })).filter(x => x.d !== null);
    if (placed.length === 1) return decorate(placed[0].e, "high", "length and start line");
    if (placed.length > 1) {
      placed.sort((a, b) => a.d - b.d);
      if (placed[1].d - placed[0].d > 200) return decorate(placed[0].e, "high", "length and start line");
    }
    return null;
  }
  if (near.length > 1) return null;

  const e = near[0];
  if (query.start && startMatch(e, query.start) !== null) return decorate(e, "high", "length and start line");
  return decorate(e, e.conf === "exact" ? "medium" : "low", "lap length " + Math.round(len) + " m");
}

function decorate(e, confidence, how) {
  return { id: e.id, name: e.name, cc: e.cc, lenM: e.lenM, turns: e.turns || null, confidence, how };
}

export function carEntry(code, cars) {
  if (!code) return null;
  const table = cars || CAR_SEED;
  const e = table[code] !== undefined ? table[code] : table[String(code)];
  if (!e) return null;
  return typeof e === "string" ? { name: e } : e;
}

export function carName(code, cars) {
  const e = carEntry(code, cars);
  return e ? (e.name || null) : null;
}

export function trackById(id, tracks) {
  if (!id) return null;
  const table = tracks && tracks.length ? tracks : TRACK_SEED;
  for (let i = 0; i < table.length; i++) if (table[i].id === id) return table[i];
  return null;
}

const CACHE_KEY = "gt7dash.catalogue";

export function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && c.version && Array.isArray(c.tracks)) return c;
  } catch (e) {}
  return null;
}

export function merged(cache) {
  const c = cache || readCache();
  if (!c) return { version: 0, published: null, tracks: TRACK_SEED, cars: CAR_SEED, source: "built in" };
  const byId = {};
  TRACK_SEED.forEach(e => { byId[e.id] = e; });
  c.tracks.forEach(e => { if (e && e.id && e.lenM) byId[e.id] = e; });
  return {
    version: c.version, published: c.published || null,
    tracks: Object.keys(byId).map(k => byId[k]),
    cars: Object.assign({}, CAR_SEED, c.cars || {}),
    source: "catalogue v" + c.version
  };
}

export async function refresh(opts) {
  opts = opts || {};
  const url = opts.url || CATALOGUE_URL;
  const have = readCache();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("catalogue HTTP " + res.status);
  const body = await res.json();
  if (!body || !body.version || !Array.isArray(body.tracks)) throw new Error("catalogue malformed");
  if (have && have.version >= body.version) return { changed: false, catalogue: merged(have) };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(body)); } catch (e) {}
  const before = have ? have.tracks.length : TRACK_SEED.length;
  return {
    changed: true, catalogue: merged(body),
    addedTracks: Math.max(0, body.tracks.length - before),
    addedCars: Object.keys(body.cars || {}).length
  };
}

export function outlineFrom(points, count) {
  const pts = (points || []).filter(p => p && typeof p.x === "number" && typeof p.z === "number");
  if (pts.length < 12) return null;
  const n = count || 72;
  const step = pts.length / n;
  const pick = [];
  for (let i = 0; i < n; i++) pick.push(pts[Math.min(pts.length - 1, Math.floor(i * step))]);
  const xs = pick.map(p => p.x), zs = pick.map(p => p.z);
  const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  const z0 = Math.min.apply(null, zs), z1 = Math.max.apply(null, zs);
  const span = Math.max(x1 - x0, z1 - z0) || 1;
  const ox = (span - (x1 - x0)) / 2, oz = (span - (z1 - z0)) / 2;
  return pick.map(p => [
    Math.round(((p.x - x0 + ox) / span) * 1000) / 1000,
    Math.round(((p.z - z0 + oz) / span) * 1000) / 1000
  ]);
}

export function outlinePath(outline, size, pad) {
  if (!outline || outline.length < 8) return null;
  const S = size || 100, P = pad === undefined ? 6 : pad, I = S - P * 2;
  return outline.map((p, i) => (i ? "L" : "M") + (P + p[0] * I).toFixed(1) + " " + (P + p[1] * I).toFixed(1)).join(" ") + " Z";
}
