/**
 * Uruk Cut — Phase 4 screenshots:
 *   - screenshot-header-project.png: header with Save / Open / New buttons
 *   - screenshot-volume-adjust.png: Adjust tab with the per-clip volume
 *     slider (set to 50%) + mute toggle
 *   - screenshot-anim-preview.png: preview frame caught mid slide-up
 *     animation (playhead parked 0.08 s into the overlay)
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(root, "..");
const PORT = 3105;
const BASE = `http://127.0.0.1:${PORT}`;

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

const server = startServer();
let browser;
try {
  if (!(await waitForServer())) throw new Error("server did not come up");
  process.env.NO_PROXY = "127.0.0.1,localhost";
  process.env.no_proxy = "127.0.0.1,localhost";
  browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required", "--no-proxy-server"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?test=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.__urukStore === "function", null, { timeout: 30000 });
  await page.setInputFiles('[data-testid="file-input"]', [path.join(root, "fixtures", "with-audio.mp4")]);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip-block"]').length === 1, null, { timeout: 30000 });

  // Header (project buttons) — clip the top strip of the page.
  await page.screenshot({ path: path.join(root, "screenshot-header-project.png"), clip: { x: 0, y: 0, width: 1440, height: 64 } });
  console.log("saved screenshot-header-project.png");

  // Adjust tab with volume at 50%.
  await page.evaluate(() => {
    const st = window.__urukStore.getState();
    st.updateClip(st.clips[0].id, { volume: 0.5 });
  });
  await page.click('[data-testid="tab-adjust"]');
  await page.waitForSelector('[data-testid="slider-volume"]', { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.locator('[data-testid="adjust-panel"]').screenshot({ path: path.join(root, "screenshot-volume-adjust.png") });
  console.log("saved screenshot-volume-adjust.png");

  // Animated text mid-animation: overlay starts at 1.0s; park playhead at 1.08.
  await page.evaluate(() => {
    const st = window.__urukStore.getState();
    st.addTextOverlay();
    const ov = window.__urukStore.getState().textOverlays[0];
    st.updateTextOverlay(ov.id, { text: "SLIDE UP TITLE", animation: "slide-up", start: 1.0, duration: 3, position: "top", size: 0.09 });
    st.seekTo(1.08);
  });
  await page.waitForTimeout(700); // let the preview align + render the frame
  await page.locator('[data-testid="preview-frame"]').screenshot({ path: path.join(root, "screenshot-anim-preview.png") });
  console.log("saved screenshot-anim-preview.png");
} catch (err) {
  console.error("screenshot run failed:", String(err && err.message ? err.message : err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  killServer(server);
}
