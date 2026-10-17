# Uruk Cut — GitHub launch pack (ready to apply once `dolanexeee` is linked)

Prepared 2026-10-16 evening (America/Edmonton), while the device-code authorization
for the new account `dolanexeee` was in flight. Nothing here is published yet —
this is copy-ready material so the transfer + polish takes minutes, not drafting time.

## Repo About (paste into the About box)

- **Description:** `Uruk Cut — clean-room open-source short-form video editor. Web + desktop (Tauri, native FFmpeg), on-device AR/EN captions, 98.3% of a published 30-item parity checklist.`
- **Website:** `https://uruk-cut.vercel.app`
- **Topics:** `video-editor` `tauri` `ffmpeg` `whisper` `nextjs` `open-source` `clean-room` `video-editing` `arabic` `captions`

## Profile setup for `dolanexeee`

- **Name:** URUK
- **Bio:** `URUK — open-source software suite. First app: Uruk Cut, a clean-room video editor for web & desktop.`
- **Avatar / social preview:** already prepared by Elena in chat on 2026-10-16
  (bronze scissors on dark, matching the app icon) — reuse those files, do not regenerate.
- **Profile README:** create repo `dolanexeee/dolanexeee` (public, with README)
  and paste `profile-README-dolanexeee.md` from this folder.
- If Mustafa creates the **uruk-suite** org from the website instead: the same
  README works as the org profile via a public `.github` repo in the org
  (`profile/README.md`). Org creation cannot be done via API — website only.

## Transfer + release checklist (in order)

1. Confirm the `gh` session is on `dolanexeee` (`gh auth status`) — NOT shdautobot.
2. Transfer `shdautobot/uruk-cut` → `dolanexeee` (or into `uruk-suite` if created).
   Transfer keeps issues, releases, and tags — v0.1.0 and its Linux installers move with it.
3. Apply the About box + avatar/social preview above.
4. **First Actions test — do this before promising 100% parity:**
   the repo's workflow `.github/workflows/release-desktop.yml` has never actually
   run in CI (header comment says so). Trigger it once via **workflow_dispatch**;
   in that mode installers land as *run artifacts*, not attached to a release.
   Matrix: ubuntu-22.04, windows-latest, macos-13 (Intel), macos-14 (Apple Silicon).
5. If the dispatch run is green on Windows + macOS: cut a fresh tag (e.g. `v0.1.1`)
   so the tag-triggered run attaches all installers to a proper Release.
   Do NOT re-push `v0.1.0` — that release already exists with the Linux assets.
6. Verify the Release page shows Windows (.msi/.exe) and macOS (.dmg) assets
   alongside the existing Linux .deb/.rpm/AppImage before updating PARITY.md.
7. Only then: update PARITY.md item #29 Partial → Done (score 98.3% → 100%)
   and the README parity line, in one commit.

## Fallbacks (already established, do not re-litigate)

- If the new account's Actions also get flagged: macOS via Codemagic free tier
  (already connected from the WAHSH work), Windows via a local cross-compile.
  No paid route — Mustafa refused billing outright.
- GitHub's terms historically allow one free account per person; Elena already
  flagged this to Mustafa in chat on 2026-10-16. Not a blocker he asked to solve.
