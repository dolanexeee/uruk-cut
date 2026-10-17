/**
 * Uruk Cut — Phase 4 project save/load test (#30, Playwright, production
 * build). Flow:
 *   1. Import the with-audio fixture; via the store hook: trim the clip,
 *      set speed 1.5×, volume 0.5, add a caption cue (with word timings)
 *      and an animated text overlay.
 *   2. Wait for the IndexedDB autosave to land; assert the bundle exists.
 *   3. Save -> download the .urukcut; inspect the ZIP in Node (project.json
 *      fields + media entry).
 *   4. Reload the page: the project must be AUTO-RESTORED from IndexedDB
 *      (restored note visible; clip/cue/text/speed/volume all match).
 *   5. New project (confirm accepted): state empties.
 *   6. Open the saved .urukcut through the header file input: the same
 *      assertions must hold again.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(root, "..");
const PORT = 3104;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

function startServer() {
  return spawn("npm", ["run", "start", "--", "-p", String(PORT)], {
    cwd: project, stdio: "pipe", env: { ...process.env }, detached: true,
  });
}
function killServer(proc) {
  try { process.kill(-proc.pid, "SIGTERM"); } catch { try { proc.kill("SIGTERM"); } catch {} }
}
async function waitForServer(deadlineMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const snapshot = (page) =>
  page.evaluate(() => {
    const s = window.__urukStore.getState();
    const clip = s.clips[0] || null;
    const cues = Object.values(s.captionsByAsset).flat();
    return {
      assets: s.assets.length,
      clips: s.clips.length,
      clip: clip
        ? { start: clip.start, end: clip.end, speed: clip.speed, volume: clip.volume, muted: clip.muted }
        : null,
      cueText: cues.length ? cues[0].text : null,
      cueWords: cues.length && cues[0].words ? cues[0].words.length : 0,
      overlays: s.textOverlays.map((o) => ({ text: o.text, animation: o.animation })),
    };
  });

function assertProject(snap, label) {
  check(`${label}: 1 asset + 1 clip`, snap.assets === 1 && snap.clips === 1, JSON.stringify(snap));
  check(`${label}: trim restored (0.5–4.5)`,
    !!snap.clip && approx(snap.clip.start, 0.5, 0.01) && approx(snap.clip.end, 4.5, 0.01), JSON.stringify(snap.clip));
  check(`${label}: speed 1.5× restored`, !!snap.clip && approx(snap.clip.speed, 1.5, 0.001), `speed=${snap.clip?.speed}`);
  check(`${label}: volume 0.5 restored`, !!snap.clip && approx(snap.clip.volume, 0.5, 0.001), `volume=${snap.clip?.volume}`);
  check(`${label}: caption cue text restored`, snap.cueText === "Hello Phase Four", `cue=${snap.cueText}`);
  check(`${label}: caption word timings restored`, snap.cueWords === 3, `words=${snap.cueWords}`);
  check(`${label}: text overlay restored with animation`,
    snap.overlays.length === 1 && snap.overlays[0].text === "TITLE CARD" && snap.overlays[0].animation === "slide-up",
    JSON.stringify(snap.overlays));
}

const server = startServer();
let browser;
try {
  check("server up", await waitForServer());
  process.env.NO_PROXY = "127.0.0.1,localhost";
  process.env.no_proxy = "127.0.0.1,localhost";
  browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required", "--no-proxy-server"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  page.on("dialog", (d) => void d.accept());

  await page.goto(`${BASE}/?test=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.__urukStore === "function", null, { timeout: 30000 });

  /* ---- 1. build the project state ---- */
  await page.setInputFiles('[data-testid="file-input"]', [path.join(root, "fixtures", "with-audio.mp4")]);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip-block"]').length === 1, null, { timeout: 30000 });
  await page.evaluate(() => {
    const st = window.__urukStore.getState();
    const clip = st.clips[0];
    const assetId = clip.sourceId;
    st.updateClip(clip.id, { start: 0.5, end: 4.5, speed: 1.5, volume: 0.5 });
    st.setAssetCaptions(assetId, [{
      id: "cue_test", start: 0.6, end: 2.4, text: "Hello Phase Four",
      words: [
        { word: "Hello", start: 0.6, end: 1.1 },
        { word: "Phase", start: 1.1, end: 1.7 },
        { word: "Four", start: 1.7, end: 2.4 },
      ],
    }]);
    st.addTextOverlay();
    const ov = window.__urukStore.getState().textOverlays[0];
    st.updateTextOverlay(ov.id, { text: "TITLE CARD", animation: "slide-up", start: 0.5, duration: 3 });
  });
  const snap0 = await snapshot(page);
  check("state built as intended", snap0.clips === 1 && snap0.cueText === "Hello Phase Four", JSON.stringify(snap0));

  /* ---- 2. autosave lands in IndexedDB ---- */
  const autosaved = await page.evaluate(async () => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const blob = await new Promise((resolve) => {
        const req = indexedDB.open("uruk-cut", 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) return resolve(null);
          const get = db.transaction("kv", "readonly").objectStore("kv").get("autosave-v1");
          get.onsuccess = () => resolve(get.result ?? null);
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      });
      if (blob && blob.size > 1000) return blob.size;
      await new Promise((r) => setTimeout(r, 500));
    }
    return 0;
  });
  check("IndexedDB autosave written", autosaved > 1000, `blob=${autosaved} bytes`);

  /* ---- 3. Save -> .urukcut download -> inspect the ZIP ---- */
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.click('[data-testid="save-project"]'),
  ]);
  const savePath = path.join(root, "project-download.urukcut");
  await download.saveAs(savePath);
  const zipBytes = fs.readFileSync(savePath);
  const entries = unzipSync(new Uint8Array(zipBytes));
  const names = Object.keys(entries);
  const json = JSON.parse(strFromU8(entries["project.json"]));
  check(".urukcut contains project.json + media", names.includes("project.json") && names.some((n) => n.startsWith("media/")), names.join(","));
  check(".urukcut project.json fields",
    json.format === "uruk-cut-project" &&
      approx(json.clips[0].speed, 1.5, 0.001) &&
      approx(json.clips[0].volume, 0.5, 0.001) &&
      json.captionsByAsset[json.assets[0].id][0].text === "Hello Phase Four" &&
      json.textOverlays[0].animation === "slide-up",
    `speed=${json.clips[0].speed} volume=${json.clips[0].volume}`);

  /* ---- 4. reload: auto-restore from IndexedDB ---- */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.__urukStore === "function", null, { timeout: 30000 });
  await page.waitForFunction(
    () => window.__urukStore.getState().clips.length === 1, null, { timeout: 45000 });
  check("restored note shown", await page.locator('[data-testid="restored-note"]').isVisible());
  assertProject(await snapshot(page), "after reload (IndexedDB)");

  /* ---- 5. New project clears everything ---- */
  await page.click('[data-testid="new-project"]');
  await page.waitForFunction(
    () => window.__urukStore.getState().clips.length === 0, null, { timeout: 10000 });
  const snapNew = await snapshot(page);
  check("new project empties state", snapNew.assets === 0 && snapNew.clips === 0 && snapNew.overlays.length === 0, JSON.stringify(snapNew));

  /* ---- 6. Open the saved .urukcut ---- */
  await page.setInputFiles('[data-testid="open-input"]', [savePath]);
  await page.waitForFunction(
    () => window.__urukStore.getState().clips.length === 1, null, { timeout: 45000 });
  assertProject(await snapshot(page), "after Open (.urukcut)");
} catch (err) {
  check("project test run completed without exception", false, String(err && err.message ? err.message : err).slice(0, 500));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  killServer(server);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
process.exit(process.exitCode || 0);
