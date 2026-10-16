/**
 * Whisper transcription worker (@huggingface/transformers, ONNX Runtime Web).
 * Runs fully on-device: the model is downloaded once from Hugging Face into
 * the browser cache and inference happens locally in this worker.
 *
 * Protocol:
 *   in : { type: "transcribe", samples: Float32Array, model: string,
 *          language: string | null, origin: string }
 *   out: { type: "progress", data }   — model download progress events
 *        { type: "stage", stage: "transcribe" }
 *        { type: "result", output }   — raw pipeline output (text + chunks)
 *        { type: "error", message }
 */
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;
env.allowRemoteModels = true;

type ProgressData = {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

type AsrFn = (
  samples: Float32Array,
  opts: Record<string, unknown>
) => Promise<unknown>;

let transcriber: AsrFn | null = null;
let loadedModel: string | null = null;

async function getTranscriber(model: string): Promise<AsrFn> {
  if (transcriber && loadedModel === model) return transcriber;
  const fn = await pipeline("automatic-speech-recognition", model, {
    dtype: "q8",
    progress_callback: (data: ProgressData) => {
      (self as unknown as Worker).postMessage({ type: "progress", data });
    },
  });
  transcriber = fn as unknown as AsrFn;
  loadedModel = model;
  return transcriber;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as {
    type: string;
    samples?: Float32Array;
    model?: string;
    language?: string | null;
    origin?: string;
  };
  if (msg.type !== "transcribe" || !msg.samples || !msg.model) return;
  try {
    const wasmEnv = env.backends?.onnx?.wasm;
    if (wasmEnv) {
      if (msg.origin) {
        // Self-hosted ONNX Runtime wasm binaries (see scripts/copy-ffmpeg.mjs).
        wasmEnv.wasmPaths = `${msg.origin}/ort/`;
      }
      wasmEnv.numThreads = (
        self as unknown as { crossOriginIsolated?: boolean }
      ).crossOriginIsolated
        ? 4
        : 1;
    }
    const asr = await getTranscriber(msg.model);
    (self as unknown as Worker).postMessage({ type: "stage", stage: "transcribe" });
    const options: Record<string, unknown> = {
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
      task: "transcribe",
    };
    if (msg.language) options.language = msg.language;
    const output = await asr(msg.samples, options);
    (self as unknown as Worker).postMessage({ type: "result", output });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
