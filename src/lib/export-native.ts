import {
  clipDuration,
  totalDuration,
  type Clip,
  type SourceAsset,
} from "../store/editor";
import type { ExportCallbacks } from "./export";
import {
  buildFinalPassArgs,
  needsFinalPass,
  type ExportExtras,
} from "./finalpass";

const FONT_FILES = ["NotoSansArabic.ttf", "Inter.ttf"];

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
  extras: ExportExtras,
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
  // the `time=` position (seconds) of the currently running encode. The
  // listener maps it through the active window (base + scale * time/dur) —
  // segments and the Phase-2 finishing pass each install their own window,
  // with staging math identical to the WASM path.
  const total = clips.length;
  const withPass = needsFinalPass(extras);
  const denom = total + 0.25 + (withPass ? 1 : 0);
  let active = false;
  let stage: "segment" | "finishing" = "segment";
  let segIndex = 0;
  let progBase = 0;
  let progScale = 0;
  let progDur = 0;
  const unlisten = await listen<{ time: number }>("ffmpeg-progress", (e) => {
    if (!active || progDur <= 0) return;
    const p = Math.min(1, Math.max(0, (e.payload.time || 0) / progDur));
    cb.onStage(
      stage === "segment"
        ? { type: "segment", index: segIndex, total }
        : { type: "finishing" },
      progBase + p * progScale
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

      cb.onStage({ type: "segment", index: i, total }, (i / denom) * 0.98);
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
      stage = "segment";
      progBase = (i / denom) * 0.98;
      progScale = (1 / denom) * 0.98;
      progDur = dur;
      active = true;
      const res = await run(args);
      active = false;
      if (res.code !== 0) {
        throw new Error(
          `Encoder failed on segment ${i + 1} (exit ${res.code}): ${res.output.slice(-400)}`
        );
      }
    }

    cb.onStage({ type: "joining" }, (total / denom) * 0.98);
    const listPath = await pathApi.join(work, "list.txt");
    const list = segPaths.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n");
    await fs.writeFile(listPath, new TextEncoder().encode(list));
    const basePath = await pathApi.join(work, "base.mp4");
    const outPath = await pathApi.join(work, "uruk-cut-export.mp4");
    const join = await run(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", basePath]);
    if (join.code !== 0) {
      throw new Error(`Joining segments failed (exit ${join.code}): ${join.output.slice(-400)}`);
    }

    let finalPath = basePath;
    if (withPass) {
      // Phase 2 final pass: caption/text burn-in + music mix (lib/finalpass.ts).
      cb.onStage({ type: "finishing" }, ((total + 0.25) / denom) * 0.98);
      let assPath: string | null = null;
      let fontsDir: string | null = null;
      let musicPath: string | null = null;
      if (extras.assContent) {
        assPath = await pathApi.join(work, "captions.ass");
        await fs.writeFile(assPath, new TextEncoder().encode(extras.assContent));
        // Feed libass the bundled fonts; if the webview cannot fetch its own
        // assets, fall back to system fonts (fontsDir stays null).
        try {
          const dir = await pathApi.join(work, "fonts");
          await fs.mkdir(dir, { recursive: true });
          for (const name of FONT_FILES) {
            const res = await fetch(`${window.location.origin}/fonts/${name}`);
            if (!res.ok) throw new Error(`font HTTP ${res.status}`);
            await fs.writeFile(
              await pathApi.join(dir, name),
              new Uint8Array(await res.arrayBuffer())
            );
          }
          fontsDir = dir;
        } catch {
          fontsDir = null;
        }
      }
      if (extras.music) {
        musicPath = await pathApi.join(work, `music.${extOf(extras.music.file.name)}`);
        await fs.writeFile(musicPath, new Uint8Array(await extras.music.file.arrayBuffer()));
      }
      const args = buildFinalPassArgs(extras, {
        base: basePath,
        out: outPath,
        ass: assPath,
        fontsDir,
        music: musicPath,
      });
      stage = "finishing";
      progBase = ((total + 0.25) / denom) * 0.98;
      progScale = (1 / denom) * 0.98;
      progDur = Math.max(0.1, totalDuration(clips));
      active = true;
      const pass = await run(["-y", ...args]);
      active = false;
      if (pass.code !== 0) {
        throw new Error(`Finishing pass failed (exit ${pass.code}): ${pass.output.slice(-400)}`);
      }
      finalPath = outPath;
    }

    const data = await fs.readFile(finalPath);
    const blob = new Blob([data as BlobPart], { type: "video/mp4" });
    cb.onStage({ type: "done" }, 1);
    return blob;
  } finally {
    active = false;
    unlisten();
    await fs.remove(work, { recursive: true }).catch(() => undefined);
  }
}
