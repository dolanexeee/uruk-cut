# URUK Cut

**Uruk Cut** is a short-form video editor that runs entirely in your browser —
and, since Phase 1.5, as a native desktop app. Import clips, arrange them on
a timeline, trim and split them, and export a single MP4 — no uploads, no
server-side rendering, no account. It is the first application in the
**URUK** open-source suite.

- **Web app:** the hosted build of this repo (static export, served as-is).
- **Desktop app:** the same UI in a Tauri v2 shell, with export rendered by a
  bundled **native FFmpeg** binary instead of WebAssembly — see
  [Desktop app](#desktop-app-phase-15).

## Clean-Room Statement

Uruk Cut is a clean-room implementation. It was designed and written from
public documentation (web platform APIs, the FFmpeg command-line interface)
and from observed behavior of general video-editing workflows — the concepts
of a timeline, clips with in/out points, splitting, and export are industry
common practice. This repository contains **no third-party proprietary code,
assets, artwork, or branding**, and no code from any commercial editor was
read, decompiled, or copied in its creation. All source code in this
repository is original work, released under the Apache License 2.0.

The export engine is [FFmpeg](https://ffmpeg.org/) compiled to WebAssembly
(the `@ffmpeg/ffmpeg` / `@ffmpeg/core` packages, GPL-2.0-or-later), loaded
locally from this app's own static assets at runtime — your media never
leaves your device.

## Phase-1 features

- **Import** — file picker or drag & drop of multiple videos (MP4 / WebM /
  MOV, as your browser supports). Each source is probed for duration and
  dimensions and gets an auto-generated filmstrip of thumbnails.
- **Timeline** — one video track with a time ruler, playhead, and zoom
  (6–240 px/sec). Click the ruler or a clip to seek.
- **Editing** — trim by dragging clip edges (pointer + touch), split at the
  playhead, delete the selected clip, drag clips to reorder them.
- **Undo / redo** — snapshot history of the timeline (Ctrl+Z / Ctrl+Shift+Z,
  plus toolbar buttons).
- **Preview** — plays the edited sequence in order, honoring every clip's
  in/out points, with play/pause and current/total time.
- **Export** — renders the sequence to one MP4 (H.264 + AAC) entirely on the
  device: each segment is cut and re-encoded to uniform parameters (capped at
  source resolution, max 1080p height), sources without audio get a silent
  track so joins stay consistent, then segments are concatenated. Live
  progress is shown, and the file downloads as `uruk-cut-export.mp4`.
- **Arabic / English UI** — one-click toggle; Arabic switches the whole
  layout to RTL.

## Desktop app (Phase 1.5)

The desktop app is a [Tauri v2](https://tauri.app/) shell (`src-tauri/`)
around the exact same static web build (`out/`) that the hosted site serves —
one codebase, two shells. App identity: **Uruk Cut**, bundle identifier
`org.uruk.cut`, version synced with `package.json`.

**Native export.** In the browser, export runs FFmpeg compiled to
WebAssembly. Inside the desktop shell the app detects Tauri
(`window.__TAURI_INTERNALS__`) and branches (`src/lib/export.ts` →
`src/lib/export-native.ts`) to a **native FFmpeg sidecar binary**:

1. Source files are written to a temp directory (tauri-plugin-fs, scoped to
   `$TEMP`/`$APPCACHE` only).
2. The *same* segment-cut + concat argument sequence as the web pipeline is
   executed by a Rust command (`run_ffmpeg` in `src-tauri/src/lib.rs`) that
   spawns the sidecar via tauri-plugin-shell and streams progress — parsed
   from FFmpeg's stderr `time=` stamps — back to the UI as Tauri events.
3. The joined MP4 is read back and handed to the UI as a `Blob`, exactly
   like the web flow, so the rest of the app cannot tell the difference.

The sidecar is a static FFmpeg build (Linux: johnvansickle.com, Windows:
gyan.dev, macOS: evermeet.cx — all GPLv3 builds of FFmpeg, shipped
**unmodified** as a standalone executable next to the app binary). It is
installed under the name **`uruk-ffmpeg`** so it never collides with a
system `ffmpeg` package (an earlier `ffmpeg`-named build of the .deb
failed to install on machines with FFmpeg already installed — fixed and
re-verified). Sidecar binaries are **not** in git; fetch the one for your
platform with:

```bash
bash scripts/fetch-sidecar.sh            # auto-detect, or pass a target triple
```

**Linux installers** (built and verified locally): `.deb`, `.rpm`, and
AppImage under `src-tauri/target/release/bundle/`. Windows/macOS installers
are produced by CI — see [Releasing](#releasing-desktop-installers).

**Linux runtime note:** the webview (WebKitGTK) probes and previews media
through GStreamer. A bare system needs an H.264-capable GStreamer plugin
(e.g. `gstreamer1.0-libav` on Ubuntu) to import MP4s; without it, imports
silently yield no clip. Export itself does not depend on GStreamer — it
uses the bundled FFmpeg.

## Releasing desktop installers

`.github/workflows/release-desktop.yml` builds installers for Linux
(x86_64), Windows (x86_64), and macOS (Intel + Apple Silicon) with Tauri,
fetching the correct static FFmpeg per OS through
`scripts/fetch-sidecar.sh`. It runs on `v*` tags (installers are attached
to the GitHub Release) and manually via `workflow_dispatch` (installers
land as workflow artifacts). The workflow is YAML-validated but has not
yet been executed in CI — the first tagged release is its real test.

## Honest limitations (Phase 1)

- Export is **CPU-bound**: rendering takes real time, roughly proportional
  to total clip length and resolution. It is a proof of local export, not a
  cloud render farm. (The desktop app's native FFmpeg is substantially
  faster than the browser's WASM build, but still local CPU work.)
- **Desktop on bare Linux** needs a GStreamer H.264 plugin for import/
  preview (see the Desktop section); the bundled FFmpeg covers export only.
- The FFmpeg core used is **single-threaded** — deliberately, so it also
  works on iOS Safari without cross-origin isolation headers. Multi-threaded
  encoding would be faster on desktop Chrome but cannot run everywhere.
- **Large files are constrained by device memory.** Sources and segments are
  held in the browser/WASM memory space; very long or 4K sources may fail on
  low-memory phones. Short-form clips (the app's target) work best.
- One video track only; no captions, text overlays, music library, filters,
  or transitions yet — those are planned for later phases.
- Browser codec support varies: Safari cannot play some WebM files, Firefox
  may need system codecs for some MP4s. Export relies on FFmpeg (WASM), not
  on the browser's own codecs.

## Build from source

Web app:

```bash
npm install
npm run dev        # development server

npm run build      # static export into out/ (also copies the FFmpeg core)
npm run start      # serve out/ statically (scripts/serve-out.mjs)
```

Desktop app (in addition to the above; Rust toolchain required — on
Debian/Ubuntu also the Tauri v2 system packages: `libwebkit2gtk-4.1-dev`,
`build-essential`, `libxdo-dev`, `libssl-dev`,
`libayatana-appindicator3-dev`, `librsvg2-dev`):

```bash
bash scripts/fetch-sidecar.sh   # static FFmpeg -> src-tauri/binaries/
npm run tauri dev               # run the desktop shell against the dev server
npm run tauri build             # installers -> src-tauri/target/release/bundle/
```

The Next.js build is a **static export** (`output: "export"` in
`next.config.ts`), so the single `out/` build is both the hosted web app
and the desktop frontend.

The FFmpeg core (`ffmpeg-core.js`, `ffmpeg-core.wasm`) is self-hosted under
`public/ffmpeg/` — it is copied from the `@ffmpeg/core` npm package at
install time of this repo's release and served same-origin, so there is no
CDN dependency and no cross-origin isolation (COEP/COOP) requirement. The
`@ffmpeg/ffmpeg` class worker is likewise served unbundled from
`public/ffmpeg-worker/` (bundlers rewrite its dynamic `import()` of the core
and break it; served same-origin it works as upstream intends). Note the
production build uses webpack (`next build --webpack`) for the same reason:
Turbopack currently fails on this package's dynamic module expressions.

## QA

`qa/smoke.mjs` is a Playwright smoke test: it imports two generated fixtures
(one with audio, one without), splits, trims with a real pointer drag,
undoes/redoes, exports the sequence, and probes the resulting MP4 with
ffprobe. Fixtures live in `qa/fixtures/` and were generated with a local
FFmpeg build. `qa/live-check.mjs` repeats import + export against the live
deployment. Phase 1.5 additionally verified the desktop app by installing
the built `.deb` and driving it under Xvfb (import via the native file
chooser, native-sidecar export to 100%) — see `qa/screenshot-desktop-*.png`.

## Project status

- **Phase 1 (done):** browser editor — import, timeline, trim/split/reorder,
  undo/redo, preview, WASM MP4 export; EN/AR UI. Smoke test: 15/15.
- **Phase 1.5 (done):** Tauri desktop app with native-FFmpeg export
  (Linux installers built + verified locally), open-source GitHub release
  (this repo), tag-triggered cross-platform release workflow (CI-untested).
- Later phases: captions/text/music, more tracks and effects.

## License

Apache License 2.0 — see [LICENSE](./LICENSE). The bundled FFmpeg WebAssembly
core is a separate work under GPL-2.0-or-later, used unmodified.
