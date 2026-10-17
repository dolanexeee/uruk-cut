/**
 * Uruk Cut — Phase 3 UI test (Playwright, production build).
 * Drives the real UI: import -> Adjust tab (slider switches clip to Custom,
 * Vivid preset chip applies + preview CSS filter follows) -> speed 2x chip
 * -> project bar (crossfade 0.5s, total shrinks to 6.0s) -> WASM export
 * through the xfade join -> probe. Then a mobile pass: 9:16 canvas preset
 * letterboxes the preview frame portrait at 414x896.
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(root, "..");
const PORT = 3102;
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
function probe(file) {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", file], { encoding: "utf8" })
  );
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
  page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));

  await page.goto(`${BASE}/?test=1`, { waitUntil: "networkidle" });
  await page.setInputFiles('[data-testid="file-input"]', [
    path.join(root, "fixtures", "with-audio.mp4"),
    path.join(root, "fixtures", "no-audio.mp4"),
  ]);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip-block"]').length === 2, null, { timeout: 30000 });
  check("import creates 2 clips", true);

  // Select clip 1 (plain click seeks + selects).
  const firstClip = page.locator('[data-testid="clip-block"]').first();
  await firstClip.scrollIntoViewIfNeeded();
  const box = await firstClip.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);

  // ---- Adjust tab: slider -> custom; Vivid chip -> preset + preview CSS ----
  await page.click('[data-testid="tab-adjust"]');
  await page.waitForSelector('[data-testid="adjust-panel"]', { timeout: 10000 });
  check("adjust panel opens", true);

  await page.locator('[data-testid="slider-saturation"]').fill("0");
  await page.waitForTimeout(200);
  let clipState = await page.evaluate(() => {
    const c = window.__urukStore.getState().clips[0];
    return { presetId: c.presetId, saturation: c.adjust.saturation, speed: c.speed };
  });
  check("slider drag switches clip to custom look",
    clipState.presetId === "custom" && clipState.saturation === 0, JSON.stringify(clipState));

  await page.click('[data-testid="preset-vivid"]');
  await page.waitForTimeout(200);
  clipState = await page.evaluate(() => {
    const c = window.__urukStore.getState().clips[0];
    return { presetId: c.presetId, speed: c.speed };
  });
  check("Vivid chip sets preset", clipState.presetId === "vivid");
  const videoFilter = await page.evaluate(() => document.querySelector("video")?.style.filter || "");
  check("preview CSS filter follows Vivid", videoFilter.includes("saturate(1.45)"), videoFilter);

  await page.screenshot({ path: path.join(root, "screenshot-adjust-panel.png") });
  check("adjust panel screenshot saved", fs.existsSync(path.join(root, "screenshot-adjust-panel.png")));

  // ---- speed 2x on clip 1 ----
  await page.click('[data-testid="speed-2"]');
  await page.waitForTimeout(200);
  clipState = await page.evaluate(() => {
    const c = window.__urukStore.getState().clips[0];
    return { speed: c.speed };
  });
  check("speed chip sets 2x", clipState.speed === 2);

  // ---- project bar: crossfade 0.5 -> total 2.5 + 4 - 0.5 = 6.0 ----
  await page.click('[data-testid="trans-crossfade"]');
  await page.click('[data-testid="trans-dur-0.5"]');
  await page.waitForTimeout(200);
  const proj = await page.evaluate(() => window.__urukStore.getState().project);
  check("project bar sets crossfade 0.5",
    proj.transitionType === "crossfade" && proj.transitionDuration === 0.5, JSON.stringify(proj));
  const totalText = await page.evaluate(() => {
    const s = window.__urukStore.getState();
    const sum = s.clips.reduce((a, c) => a + (c.end - c.start) / (c.speed || 1), 0);
    return sum - 0.5 * (s.clips.length - 1);
  });
  check("sequence math: total is 6.0s", approx(totalText, 6.0, 0.01), `total=${totalText}`);
  const readout = await page.locator("text=0:06.0").first().isVisible().catch(() => false);
  check("preview readout shows 0:06.0 total", readout);

  // ---- WASM export through the xfade join ----
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 300000 }),
    page.click('header button:has-text("Export MP4")'),
  ]);
  const outPath = path.join(root, "export-phase3-wasm.mp4");
  await download.saveAs(outPath);
  const p = probe(outPath);
  const types = p.streams.map((s) => `${s.codec_type}:${s.codec_name}`).join(",");
  check("WASM xfade export: duration ~6.0s", approx(parseFloat(p.format.duration), 6.0, 0.75),
    `dur=${parseFloat(p.format.duration).toFixed(2)}`);
  check("WASM xfade export: h264+aac", types.includes("video:h264") && types.includes("audio:aac"), types);

  // ---- mobile: 9:16 canvas letterbox ----
  const mctx = await browser.newContext({ viewport: { width: 414, height: 896 }, acceptDownloads: true });
  const mpage = await mctx.newPage();
  await mpage.goto(`${BASE}/?test=1`, { waitUntil: "networkidle" });
  await mpage.setInputFiles('[data-testid="file-input"]', [path.join(root, "fixtures", "with-audio.mp4")]);
  await mpage.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip-block"]').length === 1, null, { timeout: 30000 });
  await mpage.click('[data-testid="canvas-9:16"]');
  await mpage.waitForTimeout(400);
  const frameBox = await mpage.locator('[data-testid="preview-frame"]').boundingBox();
  check("mobile 9:16: preview frame is portrait",
    !!frameBox && frameBox.height > frameBox.width,
    frameBox ? `${Math.round(frameBox.width)}x${Math.round(frameBox.height)}` : "no box");
  await mpage.screenshot({ path: path.join(root, "screenshot-canvas-mobile.png") });
  check("mobile canvas screenshot saved", fs.existsSync(path.join(root, "screenshot-canvas-mobile.png")));
  await mctx.close();
  await ctx.close();
} catch (err) {
  check("phase3-ui run completed without exception", false, String(err && err.message ? err.message : err).slice(0, 500));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  killServer(server);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
process.exit(process.exitCode || 0);
