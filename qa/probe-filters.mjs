/**
 * Probe the filter lists of both ffmpeg builds used by Uruk Cut:
 *  - native sidecar (direct CLI)
 *  - WASM core (@ffmpeg/core) driven inside headless Chromium exactly as the
 *    web app loads it (same-origin unbundled class worker).
 * Writes qa/filter-probe.json with the evidence.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3201;
const WANT = ["subtitles", "ass", "drawtext", "amix", "afade", "volume", "aresample", "aformat", "anullsrc", "color"];

function filterLines(out) {
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const found = {};
  for (const name of WANT) {
    const re = new RegExp(`^[.A-Za-z]+\\s+${name}\\s+[\\w|]+->[\\w]+`);
    found[name] = lines.some((l) => re.test(l));
  }
  return found;
}

// ---------- native sidecar ----------
const sidecar = path.join(root, "src-tauri/binaries/uruk-ffmpeg-x86_64-unknown-linux-gnu");
const nativeOut = execFileSync(sidecar, ["-hide_banner", "-filters"], { encoding: "utf8" });
const nativeErr = execFileSync(sidecar, ["-hide_banner", "-filters"], { encoding: "utf8" });
const nativeFilters = filterLines(nativeOut || nativeErr);
console.log("native sidecar:", nativeFilters);

// ---------- WASM core ----------
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("nf");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const probeHtml = `<!doctype html><html><body><script type="module">
import { FFmpeg } from "/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js";
const ff = new FFmpeg();
window.__logs = [];
ff.on("log", ({ message }) => window.__logs.push(message));
try {
  await ff.load({
    coreURL: "/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js",
    wasmURL: "/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm",
    classWorkerURL: "/node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js",
  });
  window.__logs = [];
  await ff.exec(["-hide_banner", "-filters"]);
  window.__filtersText = window.__logs.join("\\n");
  window.__done = true;
} catch (e) {
  window.__error = String(e && e.message ? e.message : e);
  window.__done = true;
}
</script></body></html>`;
const probePath = path.join(root, "qa-probe.html");
fs.writeFileSync(probePath, probeHtml);

let wasmFilters = null;
let wasmError = null;
try {
  process.env.NO_PROXY = "127.0.0.1,localhost";
  process.env.no_proxy = "127.0.0.1,localhost";
  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));
  await page.goto(`http://127.0.0.1:${PORT}/qa-probe.html`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
  wasmError = await page.evaluate(() => window.__error || null);
  const text = await page.evaluate(() => window.__filtersText || "");
  if (text) wasmFilters = filterLines(text);
  console.log("wasm core:", wasmFilters, wasmError || "");
  await browser.close();
} finally {
  fs.rmSync(probePath, { force: true });
  server.close();
}

const evidence = {
  probedAt: new Date().toISOString(),
  nativeSidecar: { binary: "src-tauri/binaries/uruk-ffmpeg (johnvansickle static 7.0.2)", filters: nativeFilters },
  wasmCore: { package: "@ffmpeg/core 0.12.x (ffmpeg-core.wasm)", filters: wasmFilters, error: wasmError },
};
fs.writeFileSync(path.join(root, "qa", "filter-probe.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
