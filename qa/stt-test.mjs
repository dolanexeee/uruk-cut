/**
 * Uruk Cut — Phase 2 STT test (Playwright, production build).
 * Drives the real Captions panel: imports a speech fixture, clicks
 * "Generate captions" (Whisper small, on-device in a Web Worker; first run
 * downloads the model from Hugging Face through the sandbox proxy), then
 * asserts on the cues stored per asset. Repeats for the Arabic fixture.
 * Writes qa/stt-results.json with the verbatim transcripts.
 */
import { firefox } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3103;
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
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    try { server.kill("SIGTERM"); } catch {}
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

async function waitForCues(page, assetId, timeoutMs, label) {
  const t0 = Date.now();
  let lastLog = 0;
  while (Date.now() - t0 < timeoutMs) {
    const snap = await page.evaluate((id) => {
      const s = window.__urukStore.getState();
      return {
        cues: (s.captionsByAsset[id] || []).length,
        job: s.captionJob ? `${s.captionJob.stage}:${s.captionJob.detail}:${Math.round(s.captionJob.progress * 100)}%` : null,
        error: s.captionError,
      };
    }, assetId);
    if (snap.error) throw new Error(`${label}: caption job error: ${snap.error}`);
    if (snap.cues > 0 && !snap.job) return true;
    if (Date.now() - lastLog > 30000) {
      console.log(`  …${label}: waiting (${Math.round((Date.now() - t0) / 1000)}s) job=${snap.job} cues=${snap.cues}`);
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return false;
}

function cueStats(cues, assetDuration) {
  const ordered = cues.every((c, i) => i === 0 || cues[i - 1].end <= c.end + 0.001) &&
    cues.every((c, i) => i === 0 || cues[i - 1].start <= c.start + 0.001);
  const valid = cues.every((c) => c.end > c.start);
  let covered = 0;
  let curS = null;
  let curE = null;
  for (const c of cues) {
    if (curS === null || c.start > curE) {
      if (curS !== null) covered += curE - curS;
      curS = c.start;
      curE = c.end;
    } else {
      curE = Math.max(curE, c.end);
    }
  }
  if (curS !== null) covered += curE - curS;
  return { ordered, valid, coverage: covered / assetDuration };
}

const report = { model: "Xenova/whisper-small", runs: {} };
try {
  if (!(await waitForServer())) throw new Error("server did not come up");
  const proxyUrl = new URL(process.env.https_proxy || process.env.HTTPS_PROXY);
  const proxy = {
    server: `${proxyUrl.protocol}//${proxyUrl.host}`,
    username: decodeURIComponent(proxyUrl.username),
    password: decodeURIComponent(proxyUrl.password),
    bypass: "127.0.0.1,localhost",
  };
  // Firefox: in this sandbox Chromium's CONNECT tunnels through the egress
  // proxy fail (ERR_TUNNEL_CONNECTION_FAILED for huggingface.co) while
  // Firefox's succeed — an environment quirk, not an app issue (the same
  // proxy pattern is used by qa/live-check.mjs).
  const browser = await firefox.launch({
    proxy,
    firefoxUserPrefs: { "media.autoplay.default": 0 },
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    ignoreHTTPSErrors: true, // sandbox egress proxy MITMs TLS with its own CA
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 300)));

  await page.goto(`${BASE}/?test=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => typeof window.__urukStore === "function", null, { timeout: 60000 });
  check("page loads with store hook", true);

  /* ---------------- English fixture ---------------- */
  await page.setInputFiles('[data-testid="file-input"]', [path.join(root, "qa", "fixtures", "speech-en.mp4")]);
  await page.waitForFunction(() => window.__urukStore.getState().assets.length === 1, null, { timeout: 30000 });
  const enAsset = await page.evaluate(() => {
    const a = window.__urukStore.getState().assets[0];
    return { id: a.id, duration: a.duration };
  });
  console.log(`EN asset duration=${enAsset.duration.toFixed(2)}s`);
  await page.evaluate(() => {
    const st = window.__urukStore.getState();
    st.setWhisperModel("small");
    st.setSpeechLang("en");
  });
  await page.click('[data-testid="generate-captions"]');
  const enDone = await waitForCues(page, enAsset.id, 25 * 60 * 1000, "EN");
  check("EN: caption job completes", enDone);
  const en = await page.evaluate((id) => {
    const s = window.__urukStore.getState();
    return (s.captionsByAsset[id] || []).map((c) => ({ start: c.start, end: c.end, text: c.text, words: (c.words || []).length }));
  }, enAsset.id);
  const enStats = cueStats(en, enAsset.duration);
  const enText = en.map((c) => c.text).join(" ");
  report.runs.en = { cues: en, transcript: enText, stats: enStats };
  console.log("EN transcript:", JSON.stringify(enText));
  console.log("EN cues:", JSON.stringify(en.map((c) => [Number(c.start.toFixed(2)), Number(c.end.toFixed(2)), c.text, `w:${c.words}`])));
  check("EN: cues exist", en.length > 0, `${en.length} cues`);
  check("EN: timestamps ordered & valid", enStats.ordered && enStats.valid);
  check("EN: coverage > 40% of clip", enStats.coverage > 0.4, `coverage=${enStats.coverage.toFixed(2)}`);
  check(
    "EN: expected keyword present",
    /welcome/i.test(enText) || /caption/i.test(enText),
    enText.slice(0, 120)
  );
  check("EN: word timings present", en.some((c) => c.words > 1));

  /* ---------------- Arabic fixture ---------------- */
  await page.setInputFiles('[data-testid="file-input"]', [path.join(root, "qa", "fixtures", "speech-ar.mp4")]);
  await page.waitForFunction(() => window.__urukStore.getState().assets.length === 2, null, { timeout: 30000 });
  const arAsset = await page.evaluate(() => {
    const a = window.__urukStore.getState().assets[1];
    return { id: a.id, duration: a.duration };
  });
  console.log(`AR asset duration=${arAsset.duration.toFixed(2)}s`);
  await page.selectOption('[data-testid="caption-asset-select"]', arAsset.id);
  await page.evaluate(() => window.__urukStore.getState().setSpeechLang("ar"));
  await page.click('[data-testid="generate-captions"]');
  const arDone = await waitForCues(page, arAsset.id, 10 * 60 * 1000, "AR");
  check("AR: caption job completes", arDone);
  const ar = await page.evaluate((id) => {
    const s = window.__urukStore.getState();
    return (s.captionsByAsset[id] || []).map((c) => ({ start: c.start, end: c.end, text: c.text, words: (c.words || []).length }));
  }, arAsset.id);
  const arStats = cueStats(ar, arAsset.duration);
  const arText = ar.map((c) => c.text).join(" ");
  report.runs.ar = { cues: ar, transcript: arText, stats: arStats };
  console.log("AR transcript:", JSON.stringify(arText));
  console.log("AR cues:", JSON.stringify(ar.map((c) => [Number(c.start.toFixed(2)), Number(c.end.toFixed(2)), c.text, `w:${c.words}`])));
  check("AR: cues exist", ar.length > 0, `${ar.length} cues`);
  check("AR: timestamps ordered & valid", arStats.ordered && arStats.valid);

  await browser.close();
} catch (err) {
  check("STT run completed without exception", false, String(err && err.message ? err.message : err));
} finally {
  killServer();
}

fs.writeFileSync(path.join(root, "qa", "stt-results.json"), JSON.stringify(report, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
process.exit(process.exitCode || 0);
