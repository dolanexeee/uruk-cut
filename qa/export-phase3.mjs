/**
 * Uruk Cut — Phase 3 native-pipeline test.
 * Compiles the app's shared plan modules (store sequence math, looks,
 * render, captions) and executes the resulting segment/join plans verbatim
 * through the real sidecar FFmpeg, then probes + pixel-diffs the outputs:
 *   - shared-math checks (speed durations, transition overlap, offsets,
 *     canvas presets, filter-chain construction, join plan)
 *   - look proof: Vivid vs Original frame diff; extreme slider diff larger
 *   - transition proof: 5s + 4s with 0.5s crossfade -> ~8.5s, h264+aac
 *   - speed proof: 4s range at 2x -> ~2s segment (atempo), 2s at 0.5x -> ~4s
 *   - canvas proof: 9:16 -> exactly 1080x1920 (1080p source), 360x640 (360p)
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const qa = path.join(root, "qa");
const SIDECAR = path.join(root, "src-tauri/binaries/uruk-ffmpeg-x86_64-unknown-linux-gnu");
const WORK = path.join(qa, ".tmp-phase3");
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
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", file], { encoding: "utf8" })
  );
}
function extractFrame(video, t, out) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", video, "-frames:v", "1", out]);
}
async function frameDiff(pngA, pngB) {
  const a = await sharp(pngA).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(pngB).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = a.info;
  let sum = 0, diffPx = 0;
  const n = width * height;
  for (let i = 0; i < n * channels; i += channels) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
    sum += d;
    if (d > 16) diffPx++;
  }
  return { meanAbsDiff: sum / n, pctPixelsChanged: (diffPx / n) * 100 };
}

const FIX = {
  withAudio: path.join(qa, "fixtures", "with-audio.mp4"), // 5s, 640x360, h264+aac
  noAudio: path.join(qa, "fixtures", "no-audio.mp4"), // 4s, 640x360, h264 only
};

try {
  /* ---- compile the app's own modules ---- */
  execFileSync("npx", ["tsc", "src/lib/render.ts", "src/lib/finalpass.ts", "--outDir", path.join(WORK, "build"),
    "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node",
    "--lib", "es2022,dom,dom.iterable", "--esModuleInterop", "--skipLibCheck"], {
    cwd: root, encoding: "utf8", stdio: "pipe",
  });
  const store = await import(pathToFileURL(path.join(WORK, "build", "store", "editor.js")).href);
  const render = await import(pathToFileURL(path.join(WORK, "build", "lib", "render.js")).href);
  const captions = await import(pathToFileURL(path.join(WORK, "build", "lib", "captions.js")).href);
  const looks = await import(pathToFileURL(path.join(WORK, "build", "lib", "looks.js")).href);
  check("plan modules compile + load",
    typeof render.buildJoinArgs === "function" && typeof store.totalDuration === "function");

  const { clipDuration, totalDuration, transitionOverlap, clipStartOffsets, DEFAULT_ADJUST } = store;
  const { segmentVideoFilter, segmentAudioFilter, buildJoinArgs } = render;
  const { outputCanvas } = captions;
  const mkClip = (over) => ({
    id: "c", sourceId: "a", start: 0, end: 5, speed: 1,
    adjust: { ...DEFAULT_ADJUST }, presetId: "original", ...over,
  });

  /* ---- shared math ---- */
  check("math: clipDuration divides by speed", clipDuration(mkClip({ start: 1, end: 5, speed: 2 })) === 2);
  check("math: clipDuration tolerates legacy clip (no speed field)",
    clipDuration({ id: "x", sourceId: "a", start: 0, end: 4 }) === 4);
  const projX = { transitionType: "crossfade", transitionDuration: 0.5, canvasPreset: "original" };
  const two = [mkClip({ end: 5 }), mkClip({ end: 4 })];
  check("math: totalDuration subtracts overlap", approx(totalDuration(two, projX), 8.5, 1e-9),
    `total=${totalDuration(two, projX)}`);
  check("math: totalDuration without project unchanged", totalDuration(two) === 9);
  check("math: transitionOverlap clamps to shortest pair",
    approx(transitionOverlap([mkClip({ end: 1 }), mkClip({ end: 5 })],
      { transitionType: "crossfade", transitionDuration: 1.0, canvasPreset: "original" }), 0.9, 1e-9));
  check("math: clipStartOffsets shift by overlap",
    JSON.stringify(clipStartOffsets(two, projX)) === JSON.stringify([0, 4.5]));
  const a640 = [{ id: "a", width: 640, height: 360 }];
  const a1080 = [{ id: "a", width: 1920, height: 1080 }];
  check("canvas: original keeps source size",
    JSON.stringify(outputCanvas([mkClip({})], a640, "original")) === JSON.stringify({ width: 640, height: 360 }));
  check("canvas: 9:16 of 640x360 -> 360x640",
    JSON.stringify(outputCanvas([mkClip({})], a640, "9:16")) === JSON.stringify({ width: 360, height: 640 }),
    JSON.stringify(outputCanvas([mkClip({})], a640, "9:16")));
  check("canvas: 9:16 of 1920x1080 -> 1080x1920",
    JSON.stringify(outputCanvas([mkClip({})], a1080, "9:16")) === JSON.stringify({ width: 1080, height: 1920 }));
  check("canvas: 1:1 of 640x360 -> 640x640",
    JSON.stringify(outputCanvas([mkClip({})], a640, "1:1")) === JSON.stringify({ width: 640, height: 640 }));
  check("looks: vivid chain", looks.clipLookFfmpeg(mkClip({ presetId: "vivid" })) === "eq=saturation=1.45:contrast=1.08");
  check("looks: custom sliders -> eq",
    looks.clipLookFfmpeg(mkClip({ presetId: "custom", adjust: { brightness: 0.1, contrast: 1, saturation: 0 } })) ===
    "eq=brightness=0.1:contrast=1:saturation=0");
  check("render: segment vf has look + setpts for 2x vivid",
    segmentVideoFilter(mkClip({ presetId: "vivid", speed: 2 }), 640, 360).includes("eq=saturation=1.45:contrast=1.08") &&
    segmentVideoFilter(mkClip({ presetId: "vivid", speed: 2 }), 640, 360).includes("setpts=PTS/2"));
  check("render: atempo chain", segmentAudioFilter(mkClip({ speed: 2 })) === "atempo=2" &&
    segmentAudioFilter(mkClip({ speed: 1 })) === null);
  const xplan = buildJoinArgs(["s0.mp4", "s1.mp4"], two, projX, "out.mp4", "list.txt");
  check("join: crossfade plan uses xfade at offset 4.5 + acrossfade",
    xplan.applied?.duration === 0.5 &&
    xplan.args.join(" ").includes("xfade=transition=fade:duration=0.5:offset=4.5") &&
    xplan.args.join(" ").includes("acrossfade=d=0.5"));
  const cplan = buildJoinArgs(["s0.mp4", "s1.mp4"], two, null, "out.mp4", "list.txt");
  check("join: no transition -> concat plan", cplan.usesList === true && cplan.applied === null);

  /* ---- segment runner (mirrors the app exporters' arg assembly) ---- */
  const segDurations = {};
  function encodeSegment(name, srcFile, clip, canvas, hasAudio) {
    const out = path.join(WORK, name);
    const af = segmentAudioFilter(clip);
    const common = [
      "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-b:a", "160k",
      "-ar", "48000", "-ac", "2", "-vf", segmentVideoFilter(clip, canvas.width, canvas.height),
      ...(af ? ["-af", af] : []),
      "-t", clipDuration(clip).toFixed(3), "-movflags", "+faststart", out,
    ];
    const args = hasAudio
      ? ["-y", "-ss", clip.start.toFixed(3), "-i", srcFile, ...common]
      : ["-y", "-ss", clip.start.toFixed(3), "-i", srcFile, "-f", "lavfi",
         "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
         "-map", "0:v:0", "-map", "1:a:0", ...common];
    execFileSync(SIDECAR, args, { encoding: "utf8" });
    segDurations[name] = parseFloat(probe(out).format.duration);
    return out;
  }
  function joinSegments(segFiles, clips, project, outName) {
    const out = path.join(WORK, outName);
    const plan = buildJoinArgs(segFiles, clips, project, out, path.join(WORK, "list.txt"));
    if (plan.usesList) {
      fs.writeFileSync(path.join(WORK, "list.txt"), segFiles.map((s) => `file '${s}'`).join("\n"));
    }
    execFileSync(SIDECAR, ["-y", ...plan.args], { encoding: "utf8" });
    return { out, plan };
  }

  const C640 = { width: 640, height: 360 };

  /* ---- look proof ---- */
  const segOrig = encodeSegment("look-orig.mp4", FIX.withAudio, mkClip({}), C640, true);
  const segVivid = encodeSegment("look-vivid.mp4", FIX.withAudio, mkClip({ presetId: "vivid" }), C640, true);
  const segCustom = encodeSegment("look-custom.mp4", FIX.withAudio,
    mkClip({ presetId: "custom", adjust: { brightness: 0, contrast: 1, saturation: 0 } }), C640, true);
  const fOrig = path.join(qa, "frame-look-original.png");
  const fVivid = path.join(qa, "frame-look-vivid.png");
  const fCustom = path.join(qa, "frame-look-custom.png");
  extractFrame(segOrig, 2.0, fOrig);
  extractFrame(segVivid, 2.0, fVivid);
  extractFrame(segCustom, 2.0, fCustom);
  const dVivid = await frameDiff(fOrig, fVivid);
  const dCustom = await frameDiff(fOrig, fCustom);
  console.log("look diffs:", JSON.stringify({ vivid: dVivid, customSaturation0: dCustom }));
  check("filter proof: Vivid differs measurably from Original",
    dVivid.meanAbsDiff > 1 && dVivid.pctPixelsChanged > 5,
    `meanAbs=${dVivid.meanAbsDiff.toFixed(2)} pct=${dVivid.pctPixelsChanged.toFixed(1)}%`);
  check("filter proof: extreme slider (saturation 0) differs more than Vivid",
    dCustom.meanAbsDiff > dVivid.meanAbsDiff,
    `custom meanAbs=${dCustom.meanAbsDiff.toFixed(2)} vs vivid=${dVivid.meanAbsDiff.toFixed(2)}`);

  /* ---- transition proof ---- */
  const segA = encodeSegment("tr-a.mp4", FIX.withAudio, mkClip({ end: 5 }), C640, true);
  const segB = encodeSegment("tr-b.mp4", FIX.noAudio, mkClip({ end: 4 }), C640, false);
  const { out: xOut } = joinSegments([segA, segB], two, projX, "joined-xfade.mp4");
  const xProbe = probe(xOut);
  const xTypes = xProbe.streams.map((s) => `${s.codec_type}:${s.codec_name}`).join(",");
  check("transition proof: crossfade duration ~8.5s",
    approx(parseFloat(xProbe.format.duration), 8.5, 0.3), `dur=${parseFloat(xProbe.format.duration).toFixed(2)}`);
  check("transition proof: streams h264+aac", xTypes.includes("video:h264") && xTypes.includes("audio:aac"), xTypes);
  const { out: fbOut } = joinSegments([segA, segB], two,
    { transitionType: "fadeblack", transitionDuration: 0.5, canvasPreset: "original" }, "joined-fadeblack.mp4");
  check("transition proof: dip-to-black duration ~8.5s",
    approx(parseFloat(probe(fbOut).format.duration), 8.5, 0.3),
    `dur=${parseFloat(probe(fbOut).format.duration).toFixed(2)}`);
  const { out: catOut } = joinSegments([segA, segB], two, null, "joined-concat.mp4");
  check("regression: plain concat duration ~9s",
    approx(parseFloat(probe(catOut).format.duration), 9, 0.3),
    `dur=${parseFloat(probe(catOut).format.duration).toFixed(2)}`);

  /* ---- speed proof ---- */
  const segFast = encodeSegment("speed-2x.mp4", FIX.withAudio, mkClip({ start: 0.5, end: 4.5, speed: 2 }), C640, true);
  check("speed proof: 4s range at 2x -> ~2s segment",
    approx(segDurations["speed-2x.mp4"], 2, 0.3), `dur=${segDurations["speed-2x.mp4"].toFixed(2)}`);
  const fastTypes = probe(segFast).streams.map((s) => s.codec_type).sort();
  check("speed proof: segment keeps video+audio (atempo)", fastTypes.includes("video") && fastTypes.includes("audio"));
  encodeSegment("speed-half.mp4", FIX.withAudio, mkClip({ start: 0, end: 2, speed: 0.5 }), C640, true);
  check("speed proof: 2s range at 0.5x -> ~4s segment",
    approx(segDurations["speed-half.mp4"], 4, 0.3), `dur=${segDurations["speed-half.mp4"].toFixed(2)}`);

  /* ---- canvas proof ---- */
  const big = path.join(WORK, "big-1080.mp4");
  execFileSync(SIDECAR, ["-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-shortest", big], { encoding: "utf8" });
  const bigClip = mkClip({ end: 2 });
  const canvasBig = outputCanvas([bigClip], [{ id: "a", width: 1920, height: 1080 }], "9:16");
  const segBig = encodeSegment("canvas-916.mp4", big, bigClip, canvasBig, true);
  const bigStream = probe(segBig).streams.find((s) => s.codec_type === "video");
  check("canvas proof: 9:16 export of 1080p source is exactly 1080x1920",
    bigStream.width === 1080 && bigStream.height === 1920, `${bigStream.width}x${bigStream.height}`);
  const canvasSmall = outputCanvas([mkClip({})], a640, "9:16");
  const segSmall = encodeSegment("canvas-916-small.mp4", FIX.withAudio, mkClip({}), canvasSmall, true);
  const smallStream = probe(segSmall).streams.find((s) => s.codec_type === "video");
  check("canvas proof: 9:16 export of 360p source is 360x640 (no upscale)",
    smallStream.width === 360 && smallStream.height === 640, `${smallStream.width}x${smallStream.height}`);

  /* ---- results file ---- */
  fs.writeFileSync(path.join(qa, "export-phase3-results.json"), JSON.stringify({
    lookDiffs: { vivid: dVivid, customSaturation0: dCustom },
    transitionDuration: parseFloat(xProbe.format.duration),
    concatDuration: parseFloat(probe(catOut).format.duration),
    speedSegmentDurations: { fast2x: segDurations["speed-2x.mp4"], half: segDurations["speed-half.mp4"] },
    canvas: { big: `${bigStream.width}x${bigStream.height}`, small: `${smallStream.width}x${smallStream.height}` },
  }, null, 2));
} catch (err) {
  check("phase3 run completed without exception", false,
    String(err && err.message ? err.message : err).slice(0, 600) +
    (err && err.stderr ? `\nstderr tail: ${String(err.stderr).slice(-500)}` : ""));
} finally {
  fs.rmSync(WORK, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
process.exit(process.exitCode || 0);
