import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type {
  CaptionCue,
  CaptionJob,
  SourceAsset,
  SpeechLang,
  WhisperModelId,
} from "../store/editor";
import { cuesFromSegments, groupWordsIntoCues } from "./captions";

/**
 * On-device speech-to-text: extract 16 kHz mono audio with the same
 * self-hosted FFmpeg WASM core the exporter uses, then run Whisper in a
 * Web Worker (@huggingface/transformers). No audio ever leaves the device;
 * the only network traffic is the one-time model download from Hugging
 * Face, cached by the browser afterwards.
 */

export const WHISPER_MODELS: Record<WhisperModelId, string> = {
  tiny: "Xenova/whisper-tiny",
  base: "Xenova/whisper-base",
  small: "Xenova/whisper-small",
};

/* ---------- audio extraction (own FFmpeg instance, mirrors export.ts) ---------- */

let ff: FFmpeg | null = null;
let ffLoaded = false;

async function ensureFFmpeg(): Promise<FFmpeg> {
  if (!ff) ff = new FFmpeg();
  if (!ffLoaded) {
    const base = `${window.location.origin}/ffmpeg`;
    const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm");
    const classWorkerURL = `${window.location.origin}/ffmpeg-worker/worker.js`;
    await ff.load({ coreURL, wasmURL, classWorkerURL });
    ffLoaded = true;
  }
  return ff;
}

function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(name);
  return m ? m[1].toLowerCase() : "mp4";
}

/** Decode a PCM16 WAV blob into Float32Array samples in [-1, 1]. */
function decodeWavPcm16(data: Uint8Array): Float32Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  let dataStart = -1;
  let dataLen = 0;
  while (offset + 8 <= data.byteLength) {
    const id = String.fromCharCode(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3]
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      dataStart = offset + 8;
      dataLen = Math.min(size, data.byteLength - dataStart);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0) throw new Error("WAV data chunk not found");
  const n = Math.floor(dataLen / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = view.getInt16(dataStart + i * 2, true) / 32768;
  }
  return out;
}

async function extractSamples(asset: SourceAsset): Promise<Float32Array> {
  const ffmpeg = await ensureFFmpeg();
  const inName = `stt-in.${extOf(asset.name)}`;
  const outName = "stt-audio.wav";
  try {
    await ffmpeg.writeFile(inName, await fetchFile(asset.file));
    const code = await ffmpeg.exec([
      "-i", inName,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-f", "wav",
      outName,
    ]);
    if (code !== 0) throw new Error(`Audio extraction failed (exit ${code})`);
    const data = await ffmpeg.readFile(outName);
    if (typeof data === "string") throw new Error("Unexpected string WAV data");
    return decodeWavPcm16(data as Uint8Array);
  } finally {
    await ffmpeg.deleteFile(inName).catch(() => undefined);
    await ffmpeg.deleteFile(outName).catch(() => undefined);
  }
}

/* ---------- worker client ---------- */

let worker: Worker | null = null;
let activeReject: ((err: Error) => void) | null = null;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/whisper.worker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

export function cancelTranscription(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (activeReject) {
    activeReject(new Error("cancelled"));
    activeReject = null;
  }
}

interface WhisperChunk {
  text: string;
  timestamp: [number, number | null];
}

interface WhisperOutput {
  text: string;
  chunks?: WhisperChunk[];
}

export async function transcribeAsset(
  asset: SourceAsset,
  model: WhisperModelId,
  lang: SpeechLang,
  onJob: (job: CaptionJob | null) => void
): Promise<CaptionCue[]> {
  onJob({ assetId: asset.id, stage: "extract", progress: 0, detail: "" });
  const samples = await extractSamples(asset);

  const w = ensureWorker();
  const output = await new Promise<WhisperOutput>((resolve, reject) => {
    activeReject = reject;
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as {
        type: string;
        data?: { status?: string; file?: string; progress?: number };
        stage?: string;
        output?: WhisperOutput;
        message?: string;
      };
      if (msg.type === "progress" && msg.data) {
        const d = msg.data;
        if (d.status === "progress") {
          onJob({
            assetId: asset.id,
            stage: "download",
            progress: Math.min(1, Math.max(0, (d.progress || 0) / 100)),
            detail: d.file || "",
          });
        } else if (d.status === "initiate" || d.status === "downloading") {
          onJob({
            assetId: asset.id,
            stage: "download",
            progress: 0,
            detail: d.file || "",
          });
        }
      } else if (msg.type === "stage") {
        onJob({ assetId: asset.id, stage: "transcribe", progress: 0, detail: "" });
      } else if (msg.type === "result") {
        cleanup();
        resolve(msg.output as WhisperOutput);
      } else if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.message || "Transcription failed"));
      }
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || "Whisper worker failed to load"));
    };
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      activeReject = null;
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage(
      {
        type: "transcribe",
        samples,
        model: WHISPER_MODELS[model],
        language: lang === "auto" ? null : lang,
        origin: window.location.origin,
      },
      [samples.buffer]
    );
  });

  onJob(null);
  if (output.chunks && output.chunks.length > 0) {
    const words = output.chunks
      .filter((c) => typeof c.timestamp?.[0] === "number")
      .map((c) => ({
        word: c.text,
        start: c.timestamp[0],
        end: c.timestamp[1] ?? c.timestamp[0] + 0.3,
      }));
    const cues = groupWordsIntoCues(words);
    if (cues.length > 0) return cues;
  }
  if (output.text && output.text.trim()) {
    // No usable chunk timings — one cue spanning the speech as a last resort.
    return cuesFromSegments([
      { text: output.text, start: 0, end: Math.max(1, asset.duration) },
    ]);
  }
  return [];
}
