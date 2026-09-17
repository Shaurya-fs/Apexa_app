// Real accounts for the Race Engineer dashboard.
// Firebase Auth (Google, Apple, anonymous guest) + Firestore for profiles,
// archived sessions and per-track leaderboards.
//
// Config: paste the Firebase web config once in SETUP -> DRIVER -> CLOUD, or
// ship it by defining window.GT7_FIREBASE = {...} before the dashboard loads.
//
// Firestore layout
//   drivers/{uid}                      profile: name, number, team, ids, meta
//   drivers/{uid}/sessions/{sessionId} archived sessions (track, car, laps)
//   records/{trackId}__{uid}           one best-lap row per driver per track
//
// Suggested security rules:
//   match /databases/{db}/documents {
//     match /drivers/{uid} {
//       allow read: if request.auth != null;
//       allow write: if request.auth.uid == uid;
//       match /sessions/{s} { allow read, write: if request.auth.uid == uid; }
//     }
//     match /records/{row} {
//       allow read: if request.auth != null;
//       allow write: if request.auth != null
//         && row.split('__')[1] == request.auth.uid;
//     }
//   }

const SDK = "https://www.gstatic.com/firebasejs/10.13.2/";
const CONFIG_KEY = "gt7dash.firebase";
const REQUIRED = ["apiKey", "authDomain", "projectId", "appId"];

let M = null;      // loaded SDK modules
let app = null, auth = null, db = null;
let booting = null;

export function readConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && REQUIRED.every(k => c[k])) return c;
    }
  } catch (e) {}
  const g = typeof window !== "undefined" ? window.GT7_FIREBASE : null;
  if (g && REQUIRED.every(k => g[k])) return g;
  return null;
}

// Accepts the whole `const firebaseConfig = {...}` snippet from the Firebase
// console, or bare JSON. Returns the parsed config.
export function saveConfig(text) {
  const src = String(text || "").trim();
  if (!src) throw new Error("Paste the Firebase web config first");
  const body = src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1);
  let c = null;
  try { c = JSON.parse(body); } catch (e) {
    try { c = new Function("return (" + body + ")")(); } catch (e2) {
      throw new Error("That does not parse as a Firebase config");
    }
  }
  const missing = REQUIRED.filter(k => !c || !c[k]);
  if (missing.length) throw new Error("Config is missing " + missing.join(", "));
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  return c;
}

export function clearConfig() {
  try { localStorage.removeItem(CONFIG_KEY); } catch (e) {}
}

export function configured() { return !!readConfig(); }

async function boot() {
  if (app) return true;
  const cfg = readConfig();
  if (!cfg) throw new Error("No Firebase config");
  if (!booting) {
    booting = (async () => {
      const [a, b, c] = await Promise.all([
        import(SDK + "firebase-app.js"),
        import(SDK + "firebase-auth.js"),
        import(SDK + "firebase-firestore.js")
      ]);
      M = { app: a, auth: b, fs: c };
      app = a.initializeApp(cfg);
      auth = b.getAuth(app);
      db = c.getFirestore(app);
      try { await b.setPersistence(auth, b.browserLocalPersistence); } catch (e) {}
      return true;
    })();
  }
  return booting;
}

// cb(user|null, err) — fires immediately with the restored session, then on
// every change. Returns an unsubscribe function.
export function onUser(cb) {
  let stop = null, dead = false;
  boot().then(() => {
    if (dead) return;
    stop = M.auth.onAuthStateChanged(auth, u => cb(u ? shape(u) : null, null));
  }).catch(err => { if (!dead) cb(null, err); });
  return () => { dead = true; if (stop) stop(); };
}

function shape(u) {
  const p = (u.providerData && u.providerData[0] && u.providerData[0].providerId) || "";
  return {
    uid: u.uid,
    email: u.email || "",
    displayName: u.displayName || "",
    photoURL: u.photoURL || "",
    guest: !!u.isAnonymous,
    provider: u.isAnonymous ? "guest"
      : p.indexOf("google") === 0 ? "google"
      : p.indexOf("apple") === 0 ? "apple"
      : p || "account",
    newUser: false
  };
}

// kind: "google" | "apple" | "guest"
export async function signIn(kind) {
  await boot();
  const A = M.auth;
  if (kind === "guest") {
    const r = await A.signInAnonymously(auth);
    return Object.assign(shape(r.user), { newUser: isNew(r) });
  }
  const provider = kind === "apple"
    ? new A.OAuthProvider("apple.com")
    : new A.GoogleAuthProvider();
  if (kind === "apple") { provider.addScope("email"); provider.addScope("name"); }
  else provider.setCustomParameters({ prompt: "select_account" });
  let r;
  try {
    r = await A.signInWithPopup(auth, provider);
  } catch (err) {
    const code = String(err && err.code || "");
    // Popup blocked or not allowed (some embedded webviews) — fall back.
    if (/popup-blocked|popup-closed-by-user|operation-not-supported/.test(code)) {
      await A.signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
  return Object.assign(shape(r.user), { newUser: isNew(r) });
}

function isNew(r) {
  const meta = r && r.user && r.user.metadata;
  if (!meta) return false;
  if (r._tokenResponse && typeof r._tokenResponse.isNewUser === "boolean") {
    return r._tokenResponse.isNewUser;
  }
  return meta.creationTime === meta.lastSignInTime;
}

// Call once at boot so a redirect sign-in resolves.
export async function resumeRedirect() {
  await boot();
  const r = await M.auth.getRedirectResult(auth);
  return r && r.user ? Object.assign(shape(r.user), { newUser: isNew(r) }) : null;
}

export async function signOutNow() {
  await boot();
  await M.auth.signOut(auth);
}

// Upgrade a guest account to Google/Apple, keeping uid and all synced laps.
export async function linkGuest(kind) {
  await boot();
  const A = M.auth;
  if (!auth.currentUser) throw new Error("Not signed in");
  const provider = kind === "apple" ? new A.OAuthProvider("apple.com") : new A.GoogleAuthProvider();
  const r = await A.linkWithPopup(auth.currentUser, provider);
  return shape(r.user);
}

export async function loadProfile(uid) {
  await boot();
  const F = M.fs;
  const snap = await F.getDoc(F.doc(db, "drivers", uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveProfile(uid, patch) {
  await boot();
  const F = M.fs;
  await F.setDoc(
    F.doc(db, "drivers", uid),
    Object.assign({}, patch, { updatedAt: F.serverTimestamp() }),
    { merge: true }
  );
}

const best = ses => {
  const v = ((ses && ses.laps) || []).map(l => l.ms).filter(x => x > 0);
  return v.length ? Math.min.apply(null, v) : null;
};

// Push archived sessions and refresh the driver's leaderboard rows.
// Returns { sessions, records } counts.
export async function pushSessions(uid, profile, sessions) {
  await boot();
  const F = M.fs;
  const rows = (sessions || []).filter(s => s && s.id).slice(0, 60);
  if (!rows.length) return { sessions: 0, records: 0 };

  let batch = F.writeBatch(db), n = 0, wrote = 0;
  const commit = async () => { if (n) { await batch.commit(); batch = F.writeBatch(db); n = 0; } };

  for (const s of rows) {
    batch.set(F.doc(db, "drivers", uid, "sessions", String(s.id)), {
      game: s.game || "GT7",
      track: s.track || "",
      trackId: s.trackId || null,
      lenM: s.lenM || null,
      carId: s.carId || null,
      carName: s.carName || "",
      mode: s.mode || "",
      at: s.at || null,
      lapCount: ((s.laps || []).length) || 0,
      bestMs: best(s),
      laps: (s.laps || []).slice(-120).map(l => ({ ms: l.ms, at: l.at || null })),
      syncedAt: F.serverTimestamp()
    }, { merge: true });
    n++; wrote++;
    if (n >= 400) await commit();
  }
  await commit();

  // One best-lap row per track+car so the leaderboard stays cheap to read.
  const peak = new Map();
  for (const s of rows) {
    const key = s.trackId || (s.lenM ? "len" + Math.round(s.lenM) : null);
    if (!key) continue;
    const ms = best(s);
    if (!ms) continue;
    const cur = peak.get(key);
    if (!cur || ms < cur.bestMs) {
      peak.set(key, { bestMs: ms, track: s.track || "", carName: s.carName || "", at: s.at || null });
    }
  }
  for (const [trackId, r] of peak) {
    await F.setDoc(F.doc(db, "records", trackId + "__" + uid), {
      uid, trackId,
      driver: (profile && profile.name) || "",
      number: (profile && profile.number) || "",
      team: (profile && profile.team) || "",
      track: r.track, carName: r.carName,
      bestMs: r.bestMs, at: r.at,
      updatedAt: F.serverTimestamp()
    }, { merge: true });
  }
  return { sessions: wrote, records: peak.size };
}

// Fastest drivers on a track. trackId is the catalogue id, or "len####".
export async function leaderboard(trackId, limitN) {
  await boot();
  const F = M.fs;
  const q = F.query(
    F.collection(db, "records"),
    F.where("trackId", "==", trackId),
    F.orderBy("bestMs", "asc"),
    F.limit(limitN || 10)
  );
  const snap = await F.getDocs(q);
  return snap.docs.map(d => d.data());
}

export async function pullSessions(uid, limitN) {
  await boot();
  const F = M.fs;
  const q = F.query(
    F.collection(db, "drivers", uid, "sessions"),
    F.orderBy("at", "desc"),
    F.limit(limitN || 60)
  );
  const snap = await F.getDocs(q);
  return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
}

export function friendlyError(err) {
  const code = String((err && err.code) || "");
  const msg = String((err && err.message) || err || "sign-in failed");
  if (/popup-closed|cancelled-popup/.test(code)) return "SIGN-IN WINDOW CLOSED";
  if (/popup-blocked/.test(code)) return "BROWSER BLOCKED THE POPUP — ALLOW POPUPS AND RETRY";
  if (/unauthorized-domain/.test(code)) return "ADD THIS DOMAIN UNDER FIREBASE AUTH → SETTINGS → AUTHORIZED DOMAINS";
  if (/operation-not-allowed|configuration-not-found/.test(code)) return "ENABLE THIS PROVIDER IN THE FIREBASE CONSOLE FIRST";
  if (/network-request-failed/.test(code)) return "NO NETWORK — LAPS STAY LOCAL";
  if (/permission-denied/.test(code)) return "FIRESTORE RULES REJECTED THE WRITE";
  if (/failed-precondition|index/.test(code)) return "FIRESTORE NEEDS THE INDEX IT OFFERS IN THE CONSOLE LINK";
  if (/No Firebase config/.test(msg)) return "NO CLOUD PROJECT CONNECTED YET";
  return msg.replace(/^Firebase:\s*/, "").toUpperCase().slice(0, 96);
}
