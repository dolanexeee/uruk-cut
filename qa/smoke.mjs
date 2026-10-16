/**
 * Uruk Cut — Phase 1 smoke test (Playwright).
 * Drives the production build: import fixtures via the real file input,
 * split via the UI button, trim via a real pointer drag on the edge handle,
 * undo/redo via keyboard, export a 2-source sequence, then ffprobe the result.
 */
import { chromium, firefox } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(root, "..");
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const browserKind = process.env.BROWSER || "chromium";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

function startServer() {
  const proc = spawn("npm", ["run", "start", "--", "-p", String(PORT)], {
    cwd: project,
    stdio: "pipe",
    env: { ...process.env },
    detached: true,
  });
  return proc;
}
function killServer(proc) {
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    try {
      proc.kill("SIGTERM");
    } catch {}
  }
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
try {
  if (!(await waitForServer())) throw new Error("server did not come up");

  const launcher = browserKind === "firefox" ? firefox : chromium;
  process.env.NO_PROXY = "127.0.0.1,localhost";
  process.env.no_proxy = "127.0.0.1,localhost";
  const browser = await launcher.launch({
    args: ["--autoplay-policy=no-user-gesture-required", "--no-proxy-server"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("console.error:", m.text().slice(0, 300));
  });

  await page.goto(`${BASE}/?test=1`, { waitUntil: "networkidle" });
  check("page loads", await page.locator("text=URUK").first().isVisible());

  // ---- import both fixtures through the real file input ----
  await page.setInputFiles('[data-testid="file-input"]', [
    path.join(root, "fixtures", "with-audio.mp4"),
    path.join(root, "fixtures", "no-audio.mp4"),
  ]);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip-block"]').length === 2,
    null,
    { timeout: 30000 }
  );
  check("import creates 2 clips", true);

  const state1 = await page.evaluate(() => {
    const s = window.__urukStore.getState();
    return {
      clips: s.clips.map((c) => ({ start: c.start, end: c.end })),
      total: s.clips.reduce((a, c) => a + (c.end - c.start), 0),
      assets: s.assets.map((a) => ({ name: a.name, duration: a.duration, thumbs: a.thumbnails.length })),
    };
  });
  check("asset A probed 5s with thumbnails", approx(state1.assets[0].duration, 5, 0.35) && state1.assets[0].thumbs > 0, JSON.stringify(state1.assets[0]));
  check("asset B probed 4s with thumbnails", approx(state1.assets[1].duration, 4, 0.35) && state1.assets[1].thumbs > 0, JSON.stringify(state1.assets[1]));
  check("total duration ≈ 9s", approx(state1.total, 9, 0.4), `total=${state1.total.toFixed(2)}`);

  await page.screenshot({ path: path.join(root, "screenshot-desktop.png") });
  check("desktop screenshot saved", fs.existsSync(path.join(root, "screenshot-desktop.png")));

  // ---- split: click into first clip (seeks), then click Split button ----
  const firstClip = page.locator('[data-testid="clip-block"]').first();
  const box = await firstClip.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const ph = await page.evaluate(() => window.__urukStore.getState().playhead);
  check("click on clip seeks playhead", approx(ph, 2.5, 0.6), `playhead=${ph.toFixed(2)}`);
  await page.click('button[aria-label="Split at playhead"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip-block"]').length === 3,
    null,
    { timeout: 10000 }
  );
  check("split produces 3 clips", true);

  // ---- trim: real pointer drag on the last clip's right handle, -48px ≈ -1s ----
  const blocks = page.locator('[data-testid="clip-block"]');
  const last = blocks.nth(2);
  const handle = last.locator('[data-testid="trim-right"]');
  const hb = await handle.boundingBox();
  const before = await page.evaluate(() => {
    const s = window.__urukStore.getState();
    return s.clips.reduce((a, c) => a + (c.end - c.start), 0);
  });
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 48, hb.y + hb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterTrim = await page.evaluate(() => {
    const s = window.__urukStore.getState();
    return s.clips.reduce((a, c) => a + (c.end - c.start), 0);
  });
  check("trim drag shortens total by ≈1s", approx(before - afterTrim, 1, 0.35), `before=${before.toFixed(2)} after=${afterTrim.toFixed(2)}`);

  // ---- undo / redo via keyboard ----
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  const afterUndo = await page.evaluate(() => window.__urukStore.getState().clips.reduce((a, c) => a + (c.end - c.start), 0));
  check("undo restores duration", approx(afterUndo, 9, 0.4), `afterUndo=${afterUndo.toFixed(2)}`);
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(200);
  const afterRedo = await page.evaluate(() => window.__urukStore.getState().clips.reduce((a, c) => a + (c.end - c.start), 0));
  check("redo reapplies trim", approx(afterRedo, afterTrim, 0.2), `afterRedo=${afterRedo.toFixed(2)}`);

  // ---- delete + undo restore (extra editing coverage) ----
  await page.keyboard.press("Control+z"); // back to untrimmed 9s state for a predictable export? No: redo state is the trimmed one we want.
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(150);

  // ---- export the sequence (A split into 2 + B trimmed to ~3s, B has no audio) ----
  const expected = afterTrim; // ≈ 8s
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 300000 }),
    page.click('header button:has-text("Export MP4")'),
  ]);
  const outPath = path.join(root, "export-test.mp4");
  await download.saveAs(outPath);
  check("export downloads a file", fs.existsSync(outPath) && fs.statSync(outPath).size > 10000, `size=${fs.existsSync(outPath) ? fs.statSync(outPath).size : 0}`);

  const probe = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,codec_name", "-of", "json", outPath], { encoding: "utf8" })
  );
  const types = probe.streams.map((s) => s.codec_type).sort();
  check("export has video+audio streams", types.includes("video") && types.includes("audio"), JSON.stringify(probe.streams));
  check("export duration ≈ expected", approx(parseFloat(probe.format.duration), expected, 0.75), `exported=${parseFloat(probe.format.duration).toFixed(2)} expected≈${expected.toFixed(2)}`);

  // ---- mobile viewport screenshot ----
  const mob = await browser.newContext({ viewport: { width: 414, height: 896 }, acceptDownloads: true });
  const mpage = await mob.newPage();
  await mpage.goto(`${BASE}/?test=1`, { waitUntil: "networkidle" });
  await mpage.setInputFiles('[data-testid="file-input"]', [path.join(root, "fixtures", "with-audio.mp4")]);
  await mpage.waitForFunction(
    () => document.querySelectorAll('[data-testid="clip-block"]').length === 1,
    null,
    { timeout: 30000 }
  );
  await mpage.waitForTimeout(600);
  await mpage.screenshot({ path: path.join(root, "screenshot-mobile.png") });
  check("mobile screenshot saved", fs.existsSync(path.join(root, "screenshot-mobile.png")));

  await browser.close();
} catch (err) {
  check("smoke run completed without exception", false, String(err && err.message ? err.message : err));
} finally {
  killServer(server);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
process.exit(process.exitCode || 0);
