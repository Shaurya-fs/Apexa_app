# Apexa — your AI race engineer

Apexa reads live telemetry from Gran Turismo 7 and tells you what a real race
engineer would: a live delta against your best lap, F1-style coloured sector
times, and a voice that calls out where you're losing time. It recognises the
car and circuit on its own, keeps your lap history, and compares you against
other Apexa drivers on the same track. F1 24/25 telemetry is supported too.

**Live app:** https://apexa-ai.netlify.app
**Deploy:** push to `main` — Netlify builds and deploys automatically.

This is a static site; the UI is authored in a separate design project and
this folder is its exported build.

## Live telemetry

The dashboard reads GT7 over a local WebSocket bridge (`gt7-listener.js`,
not in this repo — it runs on the same machine as the PS5, see the desktop
app). Without a bridge connected, RACE runs in an idle preview; everything
else (ANALYSIS, RECORDS, COACH, SETUP, cloud leaderboards) still works.

## Accounts

Sign-in and lap sync use Firebase Auth + Firestore (`auth.js`). Paste a
project's web config in **SETUP → DRIVER → CONNECT PROJECT**, or ship one
via `window.GT7_FIREBASE` before the dashboard loads. Firestore layout and
suggested security rules are documented at the top of `auth.js`.

## Files

```
index.html      the app (generated from the design project)
support.js      component runtime
manifest.json   install metadata
sw.js           offline cache
auth.js         Firebase auth + Firestore
engineer-*.js   the engineers and their voice/wake logic
race-*.js       car/track catalogue, coach, strategy
live-delta.js   delta, sector and lap timing engine
lap-trace.js    corner-map lap recorder
pages/          CREW, RECORDS, ANALYSIS, PRO, STRATEGY
gt7-catalogue.json  car/track reference data
icons/, portraits/  art
```
