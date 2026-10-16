/**
 * Uruk Cut — Phase 2 native (desktop) pipeline test.
 * The desktop exporter (src/lib/export-native.ts) builds its ffmpeg command
 * with the SAME pure builder the web exporter uses (src/lib/finalpass.ts).
 * This harness compiles those exact TypeScript modules, builds the export
 * plan for the standard Phase-2 scenario, and executes the resulting argv
 * verbatim through the real sidecar binary — then probes + pixel-diffs the
 * output exactly like the browser test. (The Tauri IPC hop itself was
 * covered in Phase 1.5; this test covers the Phase-2 command construction
 * and the sidecar's libass burn.)
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const qa = path.join(root, "qa");
const SIDECAR = path.join(root, "src-tauri/binaries/uruk-ffmpeg-x86_64-unknown-linux-gnu");
const WORK = path.join(qa, ".tmp-native");
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

function probe(file) {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,codec_name", "-of", "json", file], { encoding: "utf8" })
  );
}
function volumedetect(file, ss, t) {
  const args = ["-hide_banner"];
  if (ss !== undefined) args.push("-ss", String(ss));
  args.push("-i", file);
  if (t !== undefined) args.push("-t", String(t));
  args.push("-af", "volumedetect", "-f", "null", "-");
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  const m = /mean_volume:\s*(-?[\d.]+|-\/\-inf|inf) dB/.exec(r.stderr || "");
  if (!m) return null;
  if (/inf/.test(m[1])) return -999;
  return parseFloat(m[1]);
}
function extractFrame(video, t, out) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", video, "-frames:v", "1", out]);
}
async function bandDiff(pngA, pngB) {
  const a = await sharp(pngA).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(pngB).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = a.info;
  const bandTop = Math.floor(height * 0.72);
  let sum = 0, diffPx = 0, n = 0;
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
    id: "cue_0",
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
  { id: "cue_1", start: 2.3, end: 4.2, text: "This is a caption test" },
];

try {
  /* ---- compile the app's own plan-builder modules ---- */
  execFileSync("npx", ["tsc", "src/lib/finalpass.ts", "--outDir", path.join(WORK, "build"),
    "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node",
    "--lib", "es2022,dom,dom.iterable", "--esModuleInterop", "--skipLibCheck"], {
    cwd: root, encoding: "utf8", stdio: "pipe",
  });
  const finalpass = await import(pathToFileURL(path.join(WORK, "build", "lib", "finalpass.js")).href);
  const { buildExportExtras, buildFinalPassArgs, needsFinalPass } = finalpass;
  check("plan builder compiles + loads", typeof buildFinalPassArgs === "function");

  /* ---- base.mp4 via the Phase-1 segment recipe (sidecar) ---- */
  const vf = "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p";
  const seg = path.join(WORK, "seg0.mp4");
  execFileSync(SIDECAR, ["-y", "-ss", "0.5", "-i", path.join(qa, "fixtures", "speech-en.mp4"),
    "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-vf", vf, "-t", "5.000", "-movflags", "+faststart", seg], { encoding: "utf8" });
  const base = path.join(WORK, "base.mp4");
  fs.writeFileSync(path.join(WORK, "list.txt"), `file '${seg}'`);
  execFileSync(SIDECAR, ["-y", "-f", "concat", "-safe", "0", "-i", path.join(WORK, "list.txt"), "-c", "copy", base], { encoding: "utf8" });
  check("base.mp4 built (trimmed 5s segment)", approx(parseFloat(probe(base).format.duration), 5, 0.75), probe(base).format.duration);

  /* ---- build the plan exactly as the app does ---- */
  const state = {
    clips: [{ id: "c1", sourceId: "a1", start: 0.5, end: 5.5 }],
    assets: [{ id: "a1", name: "speech-en.mp4", duration: 6, width: 640, height: 360, thumbnails: [], url: "", file: null }],
    captionsByAsset: { a1: CUES },
    captionsEnabled: true,
    captionStyle: "karaoke",
    textOverlays: [{
      id: "txt_0", text: "URUK CUT DEMO", start: 0.5, duration: 4,
      position: "top", size: 0.09, color: "#ffffff", bold: true, pill: true,
    }],
    music: {
      id: "mus_0", name: "music.wav", file: { name: "music.wav" }, url: "",
      duration: 10, start: 0, trimStart: 0, trimEnd: 6,
      volume: 0.5, fadeIn: 0.5, fadeOut: 0.5, peaks: [],
    },
    keepOriginalAudio: true,
  };
  const extras = buildExportExtras(state);
  check("extras: ASS generated", typeof extras.assContent === "string" && extras.assContent.length > 100);
  check("extras: ASS has cue + overlay + karaoke tag",
    extras.assContent.includes("Welcome") &&
    extras.assContent.includes("URUK CUT DEMO") &&
    extras.assContent.includes("{\\k"));
  check("extras: final pass needed", needsFinalPass(extras) === true);
  const assPath = path.join(WORK, "captions.ass");
  fs.writeFileSync(assPath, extras.assContent);

  const runPass = (ex, outName) => {
    const args = buildFinalPassArgs(ex, {
      base,
      out: outName,
      ass: ex.assContent ? assPath : null,
      fontsDir: ex.assContent ? path.join(root, "public", "fonts") : null,
      music: ex.music ? path.join(qa, "fixtures", "music.wav") : null,
    });
    execFileSync(SIDECAR, ["-y", ...args], { encoding: "utf8" });
    return outName;
  };

  /* ---- captioned + music export ---- */
  const capOut = runPass(extras, path.join(qa, "export-phase2-native.mp4"));
  const capProbe = probe(capOut);
  const capTypes = capProbe.streams.map((s) => s.codec_type).sort();
  check("native export: h264 + audio", capTypes.includes("video") && capTypes.includes("audio"), JSON.stringify(capProbe.streams));
  check("native export: duration ≈ 5s", approx(parseFloat(capProbe.format.duration), 5, 0.75), `dur=${parseFloat(capProbe.format.duration).toFixed(2)}`);

  /* ---- same but captions off (music only, video copied) ---- */
  const noCapOut = runPass({ ...extras, assContent: null }, path.join(qa, "export-phase2-native-nocap.mp4"));
  check("native nocap export: duration ≈ 5s", approx(parseFloat(probe(noCapOut).format.duration), 5, 0.75));

  /* ---- burn proof ---- */
  const fCap = path.join(qa, "frame-cap-native.png");
  const fNo = path.join(qa, "frame-nocap-native.png");
  extractFrame(capOut, 1.2, fCap);
  extractFrame(noCapOut, 1.2, fNo);
  const diff = await bandDiff(fCap, fNo);
  console.log("native burn diff:", JSON.stringify(diff));
  check("native burn: caption band differs materially", diff.pctPixelsChanged > 0.5 && diff.meanAbsDiff > 0.5,
    `pctChanged=${diff.pctPixelsChanged.toFixed(2)}% meanAbs=${diff.meanAbsDiff.toFixed(2)}`);

  /* ---- music presence: level in the speech gap (3.8–5.0 s), where the
     with-music export should carry the tone bed and the no-music export
     should be (near-)silent ---- */
  const noMusicOut = runPass({ ...extras, music: null }, path.join(WORK, "nomusic.mp4"));
  const vWith = volumedetect(capOut, 3.8, 1.2);
  const vWithout = volumedetect(noMusicOut, 3.8, 1.2);
  console.log(`gap mean_volume with music=${vWith} dB, without=${vWithout} dB`);
  check("music mixed in (audible in speech gap)", vWith !== null && vWithout !== null && vWith > vWithout + 10,
    `with=${vWith} without=${vWithout}`);

  /* ---- merge results ---- */
  const resultsFile = path.join(qa, "export-phase2-results.json");
  const prev = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : {};
  prev.native = { diff, capDuration: capProbe.format.duration, meanVolumeWithMusic: vWith, meanVolumeWithoutMusic: vWithout };
  fs.writeFileSync(resultsFile, JSON.stringify(prev, null, 2));
} catch (err) {
  check("native-plan run completed without exception", false,
    String(err && err.message ? err.message : err).slice(0, 600) +
    (err && err.stderr ? `\nstderr tail: ${String(err.stderr).slice(-400)}` : ""));
} finally {
  fs.rmSync(WORK, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
process.exit(process.exitCode || 0);
