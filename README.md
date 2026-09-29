# Apexa — AI Race Engineer

Live telemetry dashboard and voice-coached race engineer for Gran Turismo 7
(and F1 24/25). Static site, source of truth is a separate design project;
this folder is its exported build.

**Live app:** https://clever-macaron-4dccb7.netlify.app
**Deploy:** push to `main` — Netlify builds and deploys automatically.

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
