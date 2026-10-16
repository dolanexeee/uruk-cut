/**
 * Minimal zero-dependency static server for the Next.js static export (out/).
 * Used by `npm run start` (and the Playwright smoke test) now that the app is
 * built with `output: "export"` — `next start` does not serve static exports.
 *
 * Usage: node scripts/serve-out.mjs [-p PORT]   (default port 3000)
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out");
const args = process.argv.slice(2);
let port = 3000;
const pi = args.indexOf("-p");
if (pi >= 0 && args[pi + 1]) port = parseInt(args[pi + 1], 10);
else if (process.env.PORT) port = parseInt(process.env.PORT, 10);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.join(root, pathname);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file)) file = path.join(root, "index.html"); // SPA fallback
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serve-out: http://127.0.0.1:${port} (root: ${root})`);
});
