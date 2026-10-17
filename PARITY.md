# Uruk Cut — Core-Use Parity Checklist

Uruk Cut is a clean-room reimplementation of the *core* of a short-form
video editor. This file defines — publicly and auditably — what "the core"
means for this project, and how much of it is actually built.

## How the score works

The **core-use surface** is the fixed list of 30 capabilities below,
grouped by area. Each item is marked:

- **Done** = works end-to-end in the shipped app (preview *and* export,
  where export is relevant) — counts **1**
- **Partial** = works with a stated limitation — counts **0.5**
- **Missing** = not built — counts **0**

**Coverage = (Done + 0.5 × Partial) / 30.** The score is never rounded up.
The list itself is the definition: if a capability is not on this list, it
is not part of the claimed surface (see *Out of scope* below).

## The checklist

### Editing basics

| # | Capability | Status | Delivered |
|---|-----------|--------|-----------|
| 1 | Multi-clip import (file picker + drag & drop) | Done | Phase 1 |
| 2 | Source probing (duration/dimensions) + filmstrip thumbnails | Done | Phase 1 |
| 3 | Timeline with ruler, playhead, zoom (6–240 px/s), click-to-seek | Done | Phase 1 |
| 4 | Trim clips by dragging edge handles | Done | Phase 1 |
| 5 | Split clip at playhead | Done | Phase 1 |
| 6 | Delete selected clip | Done | Phase 1 |
| 7 | Reorder clips by dragging | Done | Phase 1 |
| 8 | Undo / redo (snapshot history) | Done | Phase 1 |
| 9 | Per-clip playback speed (0.5×–2×), duration math consistent across timeline, captions and export | Done | Phase 3 |

### Captions & text

| # | Capability | Status | Delivered |
|---|-----------|--------|-----------|
| 10 | On-device auto-captions (Whisper, Arabic + English, word-level timestamps) | Done | Phase 2 |
| 11 | Caption style presets, incl. karaoke word highlighting | Done | Phase 2 |
| 12 | Manual cue add / edit / delete with timing fields | Done | Phase 2 |
| 13 | Captions burned into the exported video | Done | Phase 2 |
| 14 | Text overlays (content, timing, position, size, color, bold, background pill) | Done | Phase 2 |
| 15 | Text overlays burned into the exported video | Done | Phase 2 |

### Audio

| # | Capability | Status | Delivered |
|---|-----------|--------|-----------|
| 16 | Music track import with waveform timeline row | Done | Phase 2 |
| 17 | Music trim + timeline offset (drag) | Done | Phase 2 |
| 18 | Music volume + fade-in / fade-out | Done | Phase 2 |
| 19 | Keep / mute original clip audio (project toggle) | Done | Phase 2 |
| 20 | Per-clip volume control | Missing | — |

### Effects & polish

| # | Capability | Status | Delivered |
|---|-----------|--------|-----------|
| 21 | Per-clip brightness / contrast / saturation adjustments | Done | Phase 3 |
| 22 | One-tap look presets per clip | Done | Phase 3 |
| 23 | Transitions between clips (crossfade / dip-to-black) in export; preview approximates | Done | Phase 3 |
| 24 | Animated text / motion effects | Missing | — |

### Canvas & export

| # | Capability | Status | Delivered |
|---|-----------|--------|-----------|
| 25 | Canvas aspect presets (9:16 / 16:9 / 1:1 / 4:5) for preview + export | Done | Phase 3 |
| 26 | MP4 export in the browser (WASM FFmpeg, H.264 + AAC, live progress, download) | Done | Phase 1 |
| 27 | MP4 export on desktop (native FFmpeg sidecar) | Done | Phase 1.5 |

### Project handling

| # | Capability | Status | Delivered |
|---|-----------|--------|-----------|
| 28 | Bilingual English / Arabic interface with full RTL layout | Done | Phase 1–2 |
| 29 | Open-source desktop installers — Linux built + verified locally; Windows/macOS installers come from a CI workflow that has not run yet | Partial | Phase 1.5 |
| 30 | Save / load a project to a file | Missing | — |

## Current score

**26 Done, 1 Partial, 3 Missing → (26 + 0.5) / 30 = 88.3% of the defined
core-use surface.**

Score history: 71.6% before Phase 3 (21 Done, 1 Partial, 8 Missing) →
88.3% after Phase 3 (items 9, 21, 22, 23, 25 landed). Remaining gaps:
per-clip volume (#20), animated text / motion effects (#24), save/load
project (#30), and the Partial on desktop installers (#29 — Windows/macOS
CI has not run yet).

## Out of scope (not part of the surface, by design)

- **Cloud AI features** of commercial editors (cloud transcription,
  AI background removal, generative fill, script-to-video) — Uruk Cut runs
  fully on-device; its auto-captions use a local Whisper model.
- **Proprietary asset libraries** (stock footage/music catalogs, branded
  templates, fonts and sticker packs owned by other vendors).
- **Accounts, cloud sync and collaboration** — projects live on the
  user's device only.
- **Multi-track video compositing** (picture-in-picture, overlays of one
  video over another) and keyframe animation.

Naming these exclusions is deliberate: a parity percentage is only honest
if the denominator is printed next to it.
