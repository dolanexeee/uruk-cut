import { clipDuration, type Clip, type SourceAsset } from "../store/editor";
import type { ExportCallbacks } from "./export";

/**
 * Desktop (Tauri) export path — the same render pipeline as the web/WASM
 * export, but executed by a native FFmpeg sidecar binary:
 *
 *   source files are written to a temp dir (tauri-plugin-fs), the SAME
 *   segment-cut + concat argument sequence is run through the Rust
 *   `run_ffmpeg` command (tauri-plugin-shell sidecar), progress arrives as
 *   `ffmpeg-progress` events parsed from ffmpeg's stderr `time=` stamps,
 *   and the joined MP4 is read back and returned as a Blob — exactly the
 *   contract the web flow fulfills.
 */

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(name);
  return m ? m[1].toLowerCase() : "mp4";
}

interface FFmpegRunResult {
  code: number;
  output: string;
}

export async function exportVideoNative(
  clips: Clip[],
  assets: SourceAsset[],
  cb: ExportCallbacks
): Promise<Blob> {
  if (clips.length === 0) throw new Error("No clips to export");
  const byId = new Map(assets.map((a) => [a.id, a]));

  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const fs = await import("@tauri-apps/plugin-fs");
  const pathApi = await import("@tauri-apps/api/path");

  const run = (args: string[]) =>
    invoke<FFmpegRunResult>("run_ffmpeg", { args });

  cb.onStage({ type: "preparing" }, 0);

  // Uniform output canvas: largest source, capped at 1920x1080 (same as web).
  let W = 2;
  let H = 2;
  for (const c of clips) {
    const a = byId.get(c.sourceId);
    if (!a) throw new Error("A clip references a missing source");
    W = Math.max(W, Math.min(a.width, 1920));
    H = Math.max(H, Math.min(a.height, 1080));
  }
  W = even(W);
  H = even(H);
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;

  const tmp = await pathApi.tempDir();
  const work = await pathApi.join(tmp, `uruk-cut-export-${Date.now()}`);
  await fs.mkdir(work, { recursive: true });

  // Progress plumbing: the Rust command emits `ffmpeg-progress` events with
  // the `time=` position (seconds) of the currently running encode. While a
  // segment encode runs we map it onto that segment's share of the bar —
  // identical staging math to the WASM path.
  const total = clips.length;
  let active = false;
  let segIndex = 0;
  let segDur = 0;
  const unlisten = await listen<{ time: number }>("ffmpeg-progress", (e) => {
    if (!active || segDur <= 0) return;
    const p = Math.min(1, Math.max(0, (e.payload.time || 0) / segDur));
    cb.onStage(
      { type: "segment", index: segIndex, total },
      ((segIndex + p) / (total + 0.25)) * 0.98
    );
  });

  const segPaths: string[] = [];
  try {
    for (let i = 0; i < total; i++) {
      const clip = clips[i];
      const asset = byId.get(clip.sourceId)!;
      const dur = clipDuration(clip);
      const inPath = await pathApi.join(work, `in${i}.${extOf(asset.name)}`);
      const segPath = await pathApi.join(work, `seg${i}.mp4`);
      segPaths.push(segPath);

      cb.onStage({ type: "segment", index: i, total }, (i / (total + 0.25)) * 0.98);
      await fs.writeFile(inPath, new Uint8Array(await asset.file.arrayBuffer()));

      // Detect an audio stream from the `ffmpeg -i` banner (same test as web).
      const probe = await run(["-hide_banner", "-i", inPath]);
      const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(probe.output);

      const common = [
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-c:a", "aac",
        "-b:a", "160k",
        "-ar", "48000",
        "-ac", "2",
        "-vf", vf,
        "-t", dur.toFixed(3),
        "-movflags", "+faststart",
        segPath,
      ];
      const args = hasAudio
        ? ["-y", "-ss", clip.start.toFixed(3), "-i", inPath, ...common]
        : [
            "-y",
            "-ss", clip.start.toFixed(3),
            "-i", inPath,
            "-f", "lavfi",
            "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-map", "0:v:0",
            "-map", "1:a:0",
            ...common,
          ];

      segIndex = i;
      segDur = dur;
      active = true;
      const res = await run(args);
      active = false;
      if (res.code !== 0) {
        throw new Error(
          `Encoder failed on segment ${i + 1} (exit ${res.code}): ${res.output.slice(-400)}`
        );
      }
    }

    cb.onStage({ type: "joining" }, 0.97);
    const listPath = await pathApi.join(work, "list.txt");
    const list = segPaths.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n");
    await fs.writeFile(listPath, new TextEncoder().encode(list));
    const outPath = await pathApi.join(work, "uruk-cut-export.mp4");
    const join = await run(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
    if (join.code !== 0) {
      throw new Error(`Joining segments failed (exit ${join.code}): ${join.output.slice(-400)}`);
    }
    const data = await fs.readFile(outPath);
    const blob = new Blob([data as BlobPart], { type: "video/mp4" });
    cb.onStage({ type: "done" }, 1);
    return blob;
  } finally {
    active = false;
    unlisten();
    await fs.remove(work, { recursive: true }).catch(() => undefined);
  }
}
