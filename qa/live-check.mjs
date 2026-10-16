/** Live deployment check: import a fixture and export on the production URL. */
import { firefox } from "playwright";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.LIVE_URL || "https://uruk-cut.vercel.app";
const root = path.dirname(new URL(import.meta.url).pathname);

// External egress requires the authenticated proxy (per workspace AGENTS.md).
const proxyUrl = new URL(process.env.https_proxy || process.env.HTTPS_PROXY);
const proxy = {
  server: `${proxyUrl.protocol}//${proxyUrl.host}`,
  username: decodeURIComponent(proxyUrl.username),
  password: decodeURIComponent(proxyUrl.password),
};
const browser = await firefox.launch({ proxy });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
  ignoreHTTPSErrors: true, // the sandbox egress proxy MITMs TLS with its own CA
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));

await page.goto(`${BASE}/?test=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("text=URUK", { timeout: 60000 });
console.log("title ok:", (await page.locator("text=URUK").first().isVisible()) ? "URUK visible" : "MISSING");

await page.setInputFiles('[data-testid="file-input"]', [path.join(root, "fixtures", "no-audio.mp4")]);
await page.waitForFunction(
  () => document.querySelectorAll('[data-testid="clip-block"]').length === 1,
  null,
  { timeout: 45000 }
);
console.log("live import: 1 clip on timeline");

const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 300000 }),
  page.click('header button:has-text("Export MP4")'),
]);
const out = path.join(root, "live-export-test.mp4");
await download.saveAs(out);
const probe = JSON.parse(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,codec_name", "-of", "json", out], { encoding: "utf8" })
);
console.log("live export probe:", JSON.stringify(probe.streams), "duration:", probe.format.duration, "size:", fs.statSync(out).size);
await browser.close();
