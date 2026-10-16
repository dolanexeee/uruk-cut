/**
 * Copy the FFmpeg WASM core and the @ffmpeg/ffmpeg class worker into public/
 * so they are served same-origin (no CDN, no cross-origin isolation needed).
 * Runs automatically as part of `npm run build` — including on Vercel, where
 * the binaries are restored from the npm packages instead of being uploaded.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const jobs = [
  ["node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js", "public/ffmpeg/ffmpeg-core.js"],
  ["node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm", "public/ffmpeg/ffmpeg-core.wasm"],
  ["node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js", "public/ffmpeg-worker/worker.js"],
  ["node_modules/@ffmpeg/ffmpeg/dist/esm/const.js", "public/ffmpeg-worker/const.js"],
  ["node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js", "public/ffmpeg-worker/errors.js"],
];

for (const [src, dst] of jobs) {
  const from = path.join(root, src);
  const to = path.join(root, dst);
  if (!existsSync(from)) {
    console.error(`copy-ffmpeg: missing ${src} — run npm install first`);
    process.exit(1);
  }
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`copy-ffmpeg: ${dst}`);
}
