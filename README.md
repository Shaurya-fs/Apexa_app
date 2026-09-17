# AI Race Engineer — deployable app folder

Everything in this folder is static. Put it on HTTPS, install it, done.
`index.html` is the app. Edit source in the design project, regenerate this
folder, push, and the installed app picks up the change on next launch.

## 1. Make the repo

On github.com: **New repository** → name it (e.g. `race-engineer`) → Public →
no README, no .gitignore. Then, in this folder:

```
git init -b main
git add .
git commit -m "Race Engineer app"
git remote add origin https://github.com/YOUR-NAME/race-engineer.git
git push -u origin main
```

## 2. Turn on Pages

Repo → **Settings** → **Pages** → Source: *Deploy from a branch* →
Branch `main`, folder `/ (root)` → Save. A minute later it is live at:

```
https://YOUR-NAME.github.io/race-engineer/
```

Open it on your phone. Chrome offers *Install app*; Safari uses
*Share → Add to Home Screen*.

## 3. Connect the cloud project (for accounts)

Sign-in and lap sync need a Firebase project — see `CLOUD-SETUP.md` in the
design project, or just open **SETUP → DRIVER → CONNECT PROJECT** in the app
and paste the config. Add your Pages domain
(`YOUR-NAME.github.io`) under **Firebase → Authentication → Settings →
Authorized domains**, or Google sign-in will refuse.

## 4. Android package, if you want one

1. Go to **pwabuilder.com**, paste your Pages URL, **Build My PWA** → Android.
2. Choose the signing option it offers and **keep the generated keystore and
   its passwords**. Lose them and you cannot ever update the listing.
3. It gives you an `.aab` for Play and an `.apk` for sideloading.
4. PWABuilder also gives you an `assetlinks.json`. It must be reachable at
   `https://YOUR-NAME.github.io/.well-known/assetlinks.json` — on a project
   Pages site that path belongs to your *user* site, not this repo, so either
   use a custom domain or accept that the app shows a URL bar.

The wrapper loads your live URL, so content updates need no new upload. You
only rebuild the package when the name, icon, or package id changes.

## What will not work on the hosted build

**Live telemetry.** The dashboard reads GT7 through `gt7-listener.js`, which
speaks plain `ws://` on your LAN. A page served over HTTPS is not allowed to
open an unencrypted socket to `192.168.x.x` — browsers only exempt
`localhost`. So on the Pages build, RACE has no live data.

Everything that does not need the bridge works: driver profile, archived
sessions, ANALYSIS, SETUP, COACH, THEMES, and cloud leaderboards.

Two ways to get live telemetry:

- **Same machine as the bridge.** Keep using `http://localhost:8091/`, which
  the listener already serves. No certificate needed.
- **Give the bridge a real certificate.** Run a tunnel on the listener machine
  so it is reachable as `wss://something.example`, then point the app's source
  at that. This is the only route that gets live laps onto a phone.

## Updating

Regenerate this folder from the design project, then:

```
git add -A && git commit -m "Update" && git push
```

The service worker is network-first, so a push is live on the next launch.
If a change ever seems stuck, bump `CACHE` in `sw.js`.

## Files

```
index.html         the app (generated from Race Engineer Dash.dc.html)
support.js         component runtime — required
manifest.json      install metadata
sw.js              offline cache
auth.js            Firebase auth + Firestore
engineer-*.js      the four engineers and their brains
race-*.js          catalogue, coach, strategy
live-delta.js      delta maths
lap-trace.js       lap trace storage
pages/             CREW, RECORDS, ANALYSIS, PRO, STRATEGY sections
portraits/         engineer portraits
icons/             app icons
.nojekyll          stops Pages from filtering files
```

`gt7-listener.js` is deliberately **not** here. It is a Node process that runs
on your own machine, not something to host.
