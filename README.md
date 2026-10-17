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
- **Parity:** what "the core of a short-form editor" means for this project
  is defined as an explicit 30-item checklist in **[PARITY.md](./PARITY.md)**
  — currently **88.3%** of that defined surface is built (score computed
  there, never rounded up, with the out-of-scope list printed next to it).

## Deployment (web)

Production: <https://uruk-cut.vercel.app>. Redeploy with the Vercel CLI from a
**git-free copy** of the source (plus `.vercel/project.json`): deployments
created from inside the git checkout were server-side BLOCKED (their git
metadata doesn't match how this project was first deployed), while the
git-free upload — 41.8 KB thanks to `.vercelignore` — builds and aliases
cleanly. Vercel runs `npm run build` remotely, which regenerates the ffmpeg
core, ONNX Runtime files and worker from npm packages; only `public/fonts/`
ships from the repo.

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

## Phase-2 features

- **Auto-captions (on-device Whisper)** — captions are generated locally in
  a Web Worker with [Whisper](https://huggingface.co/Xenova) via
  `@huggingface/transformers` (ONNX Runtime Web). Model picker: **tiny**
  (~40 MB), **base** (~150 MB), **small** (~500 MB, default). The model
  downloads once from Hugging Face on first use and is cached by the
  browser afterwards; after that, transcription works fully offline and
  **no audio ever leaves the device**. Language: auto-detect, Arabic, or
  English. Audio is extracted per source video (16 kHz mono WAV via the
  bundled FFmpeg), transcribed once per source with **word-level
  timestamps**, and the words are grouped into cues (≤ ~4 s, ≤ 2 short
  lines). Timeline clips show the slice of their source's cues inside
  their trim. The captions panel lists every cue with editable text and
  start/end fields; cues can be added or deleted by hand, and clicking a
  cue seeks the preview. Generation shows real progress and can be
  cancelled. Manual captioning works even without ever running Whisper.
- **Caption styles** — Classic (white bold on a black pill), Yellow Pop
  (yellow bold, dark outline), Minimal (white, soft shadow), and Karaoke
  (the active word highlights in Uruk bronze `#d9a441` as it is spoken,
  using the word timings).
- **Text overlays** — add text items with start/duration, position
  (top/center/bottom), size, color, bold, and an optional background pill.
  They render in the preview and are burned into exports.
- **Music track** — import an audio file (MP3/WAV/M4A/OGG) onto its own
  timeline row: waveform block with trim handles, drag to offset, volume,
  and 0–2 s fade-in/fade-out. A project toggle keeps or mutes the original
  clip audio. The preview plays the music in sync (fades approximated by
  volume ramps); exports mix it precisely with FFmpeg `afade` + `amix`.

## Phase-3 features

- **Per-clip adjustments** — brightness / contrast / saturation sliders per
  clip (Adjust tab). The preview applies the matching CSS `filter`; exports
  apply FFmpeg `eq` in the segment filter chain — same values, both
  pipelines.
- **Look presets** — eight one-tap looks per clip (Original, Warm, Cool,
  Vivid, Vintage, Fade, Golden, Noir), each a named FFmpeg filter chain
  (`eq` / `colorbalance` / `colorchannelmixer`) with a CSS approximation
  for the preview. Model: a clip uses *either* a preset *or* the manual
  sliders — picking a preset selects it; touching a slider switches the
  clip to "Custom" and the sliders take over.
- **Transitions** — a project-level setting: None / Crossfade / Dip to
  black, 0.3 / 0.5 / 1.0 s. Exports rebuild the join with `xfade` +
  `acrossfade` (the requested duration is clamped to fit the shortest
  adjacent pair of clips), so the total duration shrinks by
  overlap × (clips − 1) — the timeline, preview total and progress all use
  the same math. **The preview transition is an approximation** (the
  outgoing clip dips toward the boundary); the exported blend is exact.
- **Canvas / aspect presets** — Original, 9:16, 16:9, 1:1, 4:5. The preset
  fixes the export canvas aspect: the canonical size (9:16 → 1080×1920) is
  the cap, scaled down — never up — to the largest source's long edge (a
  360p source exports 9:16 at 360×640). Sources are scaled + padded to the
  canvas; the preview letterboxes the same frame inside its stage, and
  caption layout (ASS) uses the same canvas.
- **Per-clip speed** — 0.5× / 0.75× / 1× / 1.5× / 2× per clip. Clip
  duration everywhere is `(out − in) / speed`: timeline widths, totals,
  caption cue mapping, and export (`setpts` + pitch-preserving `atempo`).

**Caption burn-in method (per platform).** Both FFmpeg builds were probed
for filters (`qa/filter-probe.json`): the WASM core (`@ffmpeg/core`) and
the native sidecar both ship libass (`subtitles`/`ass`). So on **both**
platforms the exporter generates an `.ass` file — caption styles, `\k`
karaoke tags when word timings exist, text overlays as styled events —
and burns it with the `subtitles` filter in a final pass, with `fontsdir`
pointed at the bundled fonts (`public/fonts/`: Noto Sans Arabic +
Inter). libass shapes Arabic (bidi + letter joining) correctly, which a
`drawtext` chain cannot do reliably; that is why ASS is the primary path
rather than a fallback.

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
- One video track only (no picture-in-picture compositing). Filters,
  transitions, canvas presets and per-clip speed arrived in Phase 3 — see
  above; per-clip volume, animated text and project save/load are the
  remaining checklist gaps (see [PARITY.md](./PARITY.md)).
- **Preview transitions are approximate** (an outgoing-clip dip), and
  preview look filters are CSS approximations of the export's FFmpeg
  chains — close, not pixel-identical. Exports are the exact render.
- The preview stage keeps a 16:9 box and letterboxes portrait canvases
  inside it, so a 9:16 preview is small on a landscape screen; the export
  itself is full-resolution.
- **Whisper runs on the CPU (WASM)** in the browser build, single-threaded
  when the page is not cross-origin-isolated: transcription of a short
  clip takes noticeably longer than the clip itself, and the first run
  downloads the chosen model. Long recordings are therefore slow; the app
  targets short-form clips. Desktop uses the same in-webview Whisper
  (export is native there; transcription is not).
- Karaoke highlighting needs word timings: cues typed or edited by hand
  (editing a cue clears its word timings) render as whole-cue highlights
  instead. If the caption style is Karaoke but a cue has no word timings,
  the whole cue is shown in the base style.
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

Phase 2 adds: `qa/probe-filters.mjs` (filter evidence for both FFmpeg
builds → `qa/filter-probe.json`), `qa/make-fixtures-phase2.sh` (speech +
music fixtures: English voice synthesized locally with FFmpeg's libflite;
Arabic voice via the Google Translate TTS endpoint — Edge TTS's WSS
endpoint is blocked by the QA sandbox's egress proxy),
`qa/stt-test.mjs` (drives the real captions panel in a browser: Whisper
small on the English + Arabic fixtures; verbatim transcripts in
`qa/stt-results.json`), `qa/export-phase2.mjs` (full WASM-pipeline export
with captions/text/music + pixel-diff burn proof), and
`qa/native-plan-test.mjs` (executes the app's shared final-pass command
builder verbatim through the native sidecar, with the same probes).

Phase 3 adds: `qa/export-phase3.mjs` (compiles the app's shared
sequence/look/render modules and executes the plans through the native
sidecar: look pixel-diffs, crossfade/dip-to-black duration proofs, speed
segment proofs, canvas-size probes → `qa/export-phase3-results.json`) and
`qa/phase3-ui.mjs` (drives the real UI: Adjust tab, speed + transition +
canvas controls, and a WASM export through the xfade join).

## Project status

- **Phase 1 (done):** browser editor — import, timeline, trim/split/reorder,
  undo/redo, preview, WASM MP4 export; EN/AR UI. Smoke test: 15/15.
- **Phase 1.5 (done):** Tauri desktop app with native-FFmpeg export
  (Linux installers built + verified locally), open-source GitHub release
  (this repo), tag-triggered cross-platform release workflow (CI-untested).
- **Phase 2 (done):** on-device Whisper auto-captions (Arabic + English,
  word timings, karaoke), caption styles, text overlays, music track with
  fades — all rendered in preview and burned/mixed into exports on both
  the WASM and native pipelines (ASS via libass; see Phase-2 section).
- **Phase 3 (done):** per-clip adjustments + look presets, transitions
  (crossfade / dip-to-black), canvas aspect presets, per-clip speed — see
  the Phase-3 section and [PARITY.md](./PARITY.md) (88.3% of the defined
  core-use surface).
- Later phases: the remaining checklist gaps (per-clip volume, animated
  text, project save/load).

## License

Apache License 2.0 — see [LICENSE](./LICENSE). The bundled FFmpeg WebAssembly
core is a separate work under GPL-2.0-or-later, used unmodified.
