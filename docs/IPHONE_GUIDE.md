# Taking Watchlight to iPhone

This guide gets the game from this repo onto a real iPhone. Two paths:

- **Path A — PWA (no Mac, no Apple account, today).** The game is already a
  complete installable web app: fullscreen, offline, home-screen icon.
- **Path B — native TestFlight (needs a Mac + Apple Developer account).**
  The repo is Capacitor-ready; the Mac session is a few commands + Xcode.

Reality check (from the research, §5.6): the final *native* compile requires
Xcode/macOS — impossible inside this container. Path A needs no Mac at all.

---

## 0. Build the production bundle (same for both paths)

```bash
npm install
npm run build          # type-checks + emits dist/
npm run preview        # optional: sanity-check the prod build at :3000
node scripts/cdp-smoke.mjs   # 32/32 e2e checks against the prod build
```

`dist/` is a fully static site (single JS bundle, manifest, service worker,
icons — no server code, no environment variables, relative paths only).

## Path A — PWA on iPhone

### A1. Put `dist/` on a public HTTPS URL
Any static host works. Zero-config options:

- **Vercel** (free Hobby tier, HTTPS): push the repo, import it in the
  Vercel dashboard (framework preset **Vite**, build `npm run build`, output
  `dist`), or `npm i -g vercel && vercel --prod` from the repo. The repo
  ships a `vercel.json` with correct cache headers (SW/HTML revalidate,
  hashed assets immutable). The project is non-commercial, so Vercel's
  Hobby-tier terms fit as-is.
- **GitHub Pages** (recommended for the long run, free, HTTPS):
  1. Push this repo to GitHub (human step — the agent has no push rights).
  2. Repo → Settings → Pages → Deploy from branch → select branch, `/ (root)`
     or `/docs` — then either copy `dist/` contents to the served folder, or
     add a tiny workflow that runs `npm ci && npm run build` and publishes
     `dist/`.
  3. The build uses `base: './'`, so it works in a sub-path
     (`user.github.io/watchlight/`) without configuration.
- **Netlify Drop** (drag-and-drop `dist/`, instant HTTPS URL) or any other
  static host — equally fine.

> iPhone installs PWAs **only over HTTPS** — this is non-negotiable.

### A2. Install on the iPhone
1. Open the URL in **Safari** (Chrome-on-iOS can't install PWAs — all iOS
   browsers are WebKit, but only Safari manages home-screen web apps).
2. Share button → **Add to Home Screen** → Add.
3. Launch from the home screen: standalone (no browser chrome), portrait,
   dark splash, generated icon.
4. First visit caches everything (`sw.js`); after that the game runs
   **offline** (airplane-mode test is a good acceptance check).
5. Home-screen PWA storage is **ITP-exempt** — saves persist (research D8).

### A3. Quick LAN test without any hosting (optional)
To feel it on a phone *before* publishing:
1. Push/pull this repo to the Windows machine, then in PowerShell:
   `npm install; npm run dev -- --host 0.0.0.0`
2. Phone on the same Wi-Fi → browse to `http://<PC-LAN-IP>:3000`.
   (No HTTPS → no install/offline, but real touch + real screen.)

## Path B — native app via Capacitor (TestFlight)

When a Mac is available (borrowed/bought — one evening):

```bash
# on the Mac, inside the repo:
npm install
npm run build                      # fresh dist/
npm i -D @capacitor/cli @capacitor/core @capacitor/ios
npx cap add ios                    # creates ios/ (first time only)
npx cap sync                       # copies dist/ + config into the Xcode project
npx cap open ios                   # opens Xcode
```

In Xcode:
1. Set the **signing team** (requires an Apple Developer account, $99/yr)
   under project → Signing & Capabilities. Bundle id is pre-set:
   `com.watchlight.game` (in `capacitor.config.ts`).
2. Select **Any iOS Device** → **Product → Archive**.
3. Window → Organizer → **Distribute App → App Store Connect → Upload**
   (first time: create the app record in App Store Connect with the same
   bundle id; the 1024px marketing icon is pre-generated at
   `public/icons/icon-1024.png`).
4. TestFlight tab → add yourself/players → install **TestFlight** from the
   App Store on the iPhone → accept the build.

Already prepared in this repo so the above "just works":
- `capacitor.config.ts` (appId, portrait, scroll disabled, background color)
- `base: './'` build → loads from the WKWebView bundle, no server needed
- No Fullscreen API usage, no dev-only flags in prod, SW registration is
  production-only (irrelevant but harmless inside WKWebView)

## Checklist

| Item | Status |
|---|---|
| PWA manifest + offline service worker | ✅ in `public/` |
| Home-screen / touch icons (192/512/maskable/180) | ✅ generated |
| App Store 1024 marketing icon | ✅ `public/icons/icon-1024.png` |
| Capacitor config | ✅ `capacitor.config.ts` |
| iOS behaviours (audio unlock, safe areas, auto-pause) | ✅ in engine code |
| Hosting the PWA | ☐ human: pick host, push |
| Apple Developer account | ☐ human, only for Path B |
| Mac session (Xcode archive) | ☐ human, only for Path B |
