/**
 * Uruk Cut — Phase 2 export test (WASM pipeline, production build).
 * Scenario: speech fixture trimmed 0.5–5.5 s (5 s timeline) + manual cues
 * (karaoke style, word timings) + one text overlay + music track @0.5 with
 * fades. Exports twice (captions on/off) and proves caption burn-in by
 * pixel-diffing the bottom caption band of a frame inside a cue window.
 * Also captures the Phase-2 screenshots. Writes qa/export-phase2-results.json.
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const qa = path.join(root, "qa");
const PORT = 3104;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

const server = spawn("npm", ["run", "start", "--", "-p", String(PORT)], {
  cwd: root,
  stdio: "pipe",
  detached: true,
});
function killServer() {
  try { process.kill(-server.pid, "SIGTERM"); } catch { try { server.kill("SIGTERM"); } catch {} }
}
async function waitForServer(deadlineMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function probe(file) {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", file], { encoding: "utf8" })
  );
}
function extractFrame(video, t, out) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", video, "-frames:v", "1", out]);
}
async function bandDiff(pngA, pngB) {
  const a = await sharp(pngA).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(pngB).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = a.info;
  if (b.info.width !== width || b.info.height !== height) throw new Error("frame sizes differ");
  const bandTop = Math.floor(height * 0.72); // bottom 28%: caption zone
  let sum = 0;
  let diffPx = 0;
  let n = 0;
  for (let y = bandTop; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
      sum += d;
      if (d > 16) diffPx++;
      n++;
    }
  }
  return { meanAbsDiff: sum / n, pctPixelsChanged: (diffPx / n) * 100 };
}

const CUES = [
  {
    start: 0.3,
    end: 2.2,
    text: "Welcome to Uruk Cut",
    words: [
      { word: "Welcome", start: 0.3, end: 0.9 },
      { word: "to", start: 0.9, end: 1.1 },
      { word: "Uruk", start: 1.1, end: 1.6 },
      { word: "Cut", start: 1.6, end: 2.2 },
    ],
  },
  { start: 2.3, end: 4.2, text: "This is a caption test" },
];

try {
  if (!(await waitForServer())) throw new Error("server did not come up");
  process.env.NO_PROXY = "127.0.0.1,localhost";
  process.env.no_proxy = "127.0.0.1,localhost";
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required", "--no-proxy-server"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text().slice(0, 200)); });

  await page.goto(`${BASE}/?test=1`, { waitUntil: "networkidle" });

  /* ---- build the scenario ---- */
  await page.setInputFiles('[data-testid="file-input"]', [path.join(qa, "fixtures", "speech-en.mp4")]);
  await page.waitForFunction(() => window.__urukStore.getState().clips.length === 1, null, { timeout: 30000 });

  await page.evaluate((cues) => {
    const st = window.__urukStore.getState();
    const asset = st.assets[0];
    const clip = st.clips[0];
    st.trimClip(clip.id, 0.5, 5.5); // 5 s timeline
    st.setAssetCaptions(asset.id, cues.map((c, i) => ({ id: `cue_${i}`, ...c })));
    st.setCaptionsEnabled(true);
    st.setCaptionStyle("karaoke");
    st.addTextOverlay();
    const fresh = window.__urukStore.getState();
    const ov = fresh.textOverlays[fresh.textOverlays.length - 1];
    fresh.updateTextOverlay(ov.id, {
      text: "URUK CUT DEMO",
      start: 0.5,
      duration: 4,
      position: "top",
      size: 0.09,
      color: "#ffffff",
      bold: true,
      pill: true,
    });
  }, CUES);

  // music via the real panel input
  await page.click('[data-testid="tab-music"]');
  await page.setInputFiles('[data-testid="music-input"]', [path.join(qa, "fixtures", "music.wav")]);
  await page.waitForFunction(() => !!window.__urukStore.getState().music, null, { timeout: 30000 });
  await page.evaluate(() => {
    const st = window.__urukStore.getState();
    st.updateMusic({ volume: 0.5, fadeIn: 0.5, fadeOut: 0.5, trimEnd: 6 });
    st.seekTo(1.0); // inside cue 1 (timeline 0–1.7 after trim mapping)
  });
  await page.waitForTimeout(500);

  check("caption overlay visible in preview", await page.locator('[data-testid="caption-overlay"]').isVisible());
  check("text overlay visible in preview", await page.locator('[data-testid="text-overlay-preview"]').isVisible());
  check("caption row rendered", await page.locator('[data-testid="caption-row"]').isVisible());
  check("text row rendered", await page.locator('[data-testid="text-row"]').isVisible());
  check("audio row rendered", await page.locator('[data-testid="audio-row"]').isVisible());

  await page.locator('[data-testid="audio-row"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(qa, "screenshot-timeline-rows.png") });
  await page.click('[data-testid="tab-captions"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(qa, "screenshot-captions-panel.png") });
  await page.evaluate(() => window.__urukStore.getState().seekTo(1.0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(qa, "screenshot-captions-desktop.png") });

  /* ---- export WITH captions (WASM) ---- */
  const exportAndSave = async (name) => {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 420000 }),
      page.click('header button:has-text("Export MP4")'),
    ]);
    const out = path.join(qa, name);
    await download.saveAs(out);
    return out;
  };
  const capFile = await exportAndSave("export-phase2-wasm.mp4");
  const capProbe = probe(capFile);
  const capTypes = capProbe.streams.map((s) => s.codec_type).sort();
  check("WASM export: file saved", fs.statSync(capFile).size > 10000, `size=${fs.statSync(capFile).size}`);
  check("WASM export: h264 + audio", capTypes.includes("video") && capTypes.includes("audio"), JSON.stringify(capProbe.streams));
  check("WASM export: duration ≈ 5s", approx(parseFloat(capProbe.format.duration), 5, 0.75), `dur=${parseFloat(capProbe.format.duration).toFixed(2)}`);

  /* ---- export WITHOUT captions ---- */
  await page.evaluate(() => window.__urukStore.getState().setCaptionsEnabled(false));
  // close the export modal from the previous run (its only <button> is Close)
  await page.locator("div.fixed.inset-0 button").first().click();
  await page.waitForTimeout(300);
  const noCapFile = await exportAndSave("export-phase2-wasm-nocap.mp4");
  const noCapProbe = probe(noCapFile);
  check("WASM nocap export: duration ≈ 5s", approx(parseFloat(noCapProbe.format.duration), 5, 0.75), `dur=${parseFloat(noCapProbe.format.duration).toFixed(2)}`);

  /* ---- burn proof: pixel-diff the caption band at t=1.2 (inside cue 1) ---- */
  const fCap = path.join(qa, "frame-cap-wasm.png");
  const fNo = path.join(qa, "frame-nocap-wasm.png");
  extractFrame(capFile, 1.2, fCap);
  extractFrame(noCapFile, 1.2, fNo);
  const diff = await bandDiff(fCap, fNo);
  console.log("WASM burn diff:", JSON.stringify(diff));
  check("WASM burn: caption band differs materially", diff.pctPixelsChanged > 0.5 && diff.meanAbsDiff > 0.5,
    `pctChanged=${diff.pctPixelsChanged.toFixed(2)}% meanAbs=${diff.meanAbsDiff.toFixed(2)}`);
  fs.writeFileSync(path.join(qa, "export-phase2-results.json"), JSON.stringify({ wasm: { diff, capDuration: capProbe.format.duration } }, null, 2));

  /* ---- mobile screenshot with captions ---- */
  const mob = await browser.newContext({ viewport: { width: 414, height: 896 }, acceptDownloads: true });
  const mp = await mob.newPage();
  await mp.goto(`${BASE}/?test=1`, { waitUntil: "networkidle" });
  await mp.setInputFiles('[data-testid="file-input"]', [path.join(qa, "fixtures", "speech-en.mp4")]);
  await mp.waitForFunction(() => window.__urukStore.getState().clips.length === 1, null, { timeout: 30000 });
  await mp.evaluate((cues) => {
    const st = window.__urukStore.getState();
    st.setAssetCaptions(st.assets[0].id, cues.map((c, i) => ({ id: `cue_${i}`, ...c })));
    st.setCaptionStyle("classic");
    st.seekTo(1.0);
  }, CUES);
  await mp.waitForTimeout(500);
  check("mobile: caption overlay visible", await mp.locator('[data-testid="caption-overlay"]').isVisible());
  await mp.screenshot({ path: path.join(qa, "screenshot-captions-mobile.png") });

  await browser.close();
} catch (err) {
  check("export-phase2 run completed without exception", false, String(err && err.message ? err.message : err));
} finally {
  killServer();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
process.exit(process.exitCode || 0);
