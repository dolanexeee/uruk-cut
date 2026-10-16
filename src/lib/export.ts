import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { clipDuration, type Clip, type ExportStage, type SourceAsset } from "../store/editor";

let ffmpeg: FFmpeg | null = null;
let loaded = false;

async function ensureLoaded(): Promise<FFmpeg> {
  if (!ffmpeg) ffmpeg = new FFmpeg();
  if (!loaded) {
    const base = `${window.location.origin}/ffmpeg`;
    const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm");
    // The class worker is served unbundled from public/ffmpeg-worker: when
    // webpack bundles @ffmpeg/ffmpeg's own worker, its dynamic import() of
    // the blob core URL breaks ("Cannot find module 'blob:…'"). Served
    // same-origin, the worker's native import of the core works everywhere.
    const classWorkerURL = `${window.location.origin}/ffmpeg-worker/worker.js`;
    await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
    loaded = true;
  }
  return ffmpeg;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(name);
  return m ? m[1].toLowerCase() : "mp4";
}

/** Parse the `ffmpeg -i` log output to detect an audio stream. */
async function detectAudio(ff: FFmpeg, fileName: string): Promise<boolean> {
  let logs = "";
  const handler = ({ message }: { message: string }) => {
    logs += message + "\n";
  };
  ff.on("log", handler);
  try {
    await ff.exec(["-hide_banner", "-i", fileName]);
  } catch {
    // -i without an output exits non-zero; the log is what we need.
  } finally {
    ff.off("log", handler);
  }
  return /Stream #\d+:\d+.*: Audio:/.test(logs);
}

export interface ExportCallbacks {
  onStage: (stage: ExportStage, progress: number) => void;
}

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Render the timeline to a single MP4. In the desktop app this branches to
 * the native FFmpeg sidecar (src/lib/export-native.ts); in the browser it
 * uses the WebAssembly pipeline below. Both return the finished MP4 as a
 * Blob and report progress through the same callbacks.
 */
export async function exportVideo(
  clips: Clip[],
  assets: SourceAsset[],
  cb: ExportCallbacks
): Promise<Blob> {
  if (isTauri()) {
    const { exportVideoNative } = await import("./export-native");
    return exportVideoNative(clips, assets, cb);
  }
  return exportVideoWasm(clips, assets, cb);
}

/**
 * WebAssembly pipeline: each clip is cut and re-encoded to uniform
 * parameters (H.264 + AAC 48kHz stereo, normalized canvas), segments
 * without audio get a silent track, then the segments are concatenated
 * with stream copy.
 */
async function exportVideoWasm(
  clips: Clip[],
  assets: SourceAsset[],
  cb: ExportCallbacks
): Promise<Blob> {
  if (clips.length === 0) throw new Error("No clips to export");
  const byId = new Map(assets.map((a) => [a.id, a]));

  cb.onStage({ type: "preparing" }, 0);
  const ff = await ensureLoaded();

  // Uniform output canvas: largest source, capped at 1920x1080.
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

  const segNames: string[] = [];
  const total = clips.length;
  let progressHandler: ((e: { progress: number }) => void) | null = null;

  try {
    for (let i = 0; i < total; i++) {
      const clip = clips[i];
      const asset = byId.get(clip.sourceId)!;
      const dur = clipDuration(clip);
      const inName = `in${i}.${extOf(asset.name)}`;
      const segName = `seg${i}.mp4`;
      segNames.push(segName);

      cb.onStage({ type: "segment", index: i, total }, (i / (total + 0.25)) * 0.98);
      await ff.writeFile(inName, await fetchFile(asset.file));
      const hasAudio = await detectAudio(ff, inName);

      progressHandler = ({ progress }: { progress: number }) => {
        const p = Math.min(1, Math.max(0, progress || 0));
        cb.onStage(
          { type: "segment", index: i, total },
          ((i + p) / (total + 0.25)) * 0.98
        );
      };
      ff.on("progress", progressHandler);

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
        segName,
      ];
      const args = hasAudio
        ? ["-ss", clip.start.toFixed(3), "-i", inName, ...common]
        : [
            "-ss", clip.start.toFixed(3),
            "-i", inName,
            "-f", "lavfi",
            "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-map", "0:v:0",
            "-map", "1:a:0",
            ...common,
          ];
      const code = await ff.exec(args);
      ff.off("progress", progressHandler);
      progressHandler = null;
      await ff.deleteFile(inName).catch(() => undefined);
      if (code !== 0) throw new Error(`Encoder failed on segment ${i + 1} (exit ${code})`);
    }

    cb.onStage({ type: "joining" }, 0.97);
    const list = segNames.map((s) => `file '${s}'`).join("\n");
    await ff.writeFile("list.txt", new TextEncoder().encode(list));
    const outName = "uruk-cut-export.mp4";
    const code = await ff.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", outName]);
    if (code !== 0) throw new Error(`Joining segments failed (exit ${code})`);
    const data = await ff.readFile(outName);
    const blob =
      typeof data === "string"
        ? new Blob([data], { type: "video/mp4" })
        : new Blob([data as BlobPart], { type: "video/mp4" });
    cb.onStage({ type: "done" }, 1);
    return blob;
  } finally {
    if (progressHandler && ffmpeg) ffmpeg.off("progress", progressHandler);
    for (const s of segNames) await ff.deleteFile(s).catch(() => undefined);
    await ff.deleteFile("list.txt").catch(() => undefined);
    await ff.deleteFile("uruk-cut-export.mp4").catch(() => undefined);
  }
}
