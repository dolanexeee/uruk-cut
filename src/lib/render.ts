import {
  clipDuration,
  clipMuted,
  clipSpeed,
  clipVolume,
  transitionOverlap,
  type Clip,
  type ProjectSettings,
  type TransitionType,
} from "../store/editor";
import { clipLookFfmpeg } from "./looks";

/**
 * Phase-3 render plan: the per-segment filter chains and the sequence join,
 * shared verbatim by the WASM exporter, the native (Tauri) exporter, and
 * the QA harness. Pure module — only the concrete file names differ per
 * platform.
 *
 * Segment recipe (unchanged uniform parameters from Phase 1, extended):
 *   scale/pad to the canvas → setsar → look chain (preset or eq) →
 *   format → setpts (speed) → fps=30
 * Audio gets the matching `atempo` so pitch is preserved.
 *
 * Join: stream-copy concat when no transition is active; otherwise an
 * xfade chain (fade / fadeblack) with acrossfade audio, whose output is
 * shorter than the segment sum by overlap × (n − 1) — the same math
 * `totalDuration` in the store uses.
 */

/** Fixed 3-decimal formatting with trailing zeros trimmed ("0.5", "4.5", "2"). */
const f3 = (n: number) => {
  const s = n.toFixed(3);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

/** Video filter chain for one segment: canvas normalize + look + speed. */
export function segmentVideoFilter(clip: Clip, width: number, height: number): string {
  const parts = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
  ];
  const look = clipLookFfmpeg(clip);
  if (look) parts.push(look);
  parts.push("format=yuv420p");
  const speed = clipSpeed(clip);
  if (speed !== 1) parts.push(`setpts=PTS/${f3(speed)}`);
  parts.push("fps=30");
  return parts.join(",");
}

/**
 * Audio filter chain for one segment: the Phase-3 atempo chain (speed)
 * followed by the Phase-4 per-clip gain. A muted clip — or a volume of 0 —
 * renders as digital silence (`volume=0`) so the segment still carries a
 * well-formed audio track and the join logic stays uniform. Returns null
 * only when nothing needs doing (1× speed, volume 1, not muted).
 */
export function segmentAudioFilter(clip: Clip): string | null {
  const chain: string[] = [];
  const speed = clipSpeed(clip);
  if (speed !== 1) {
    // atempo accepts 0.5..100 per instance in current FFmpeg; our speed
    // range is 0.5..2, but chain defensively for any value.
    let s = speed;
    while (s > 2) {
      chain.push("atempo=2");
      s /= 2;
    }
    while (s < 0.5) {
      chain.push("atempo=0.5");
      s *= 2;
    }
    chain.push(`atempo=${f3(s)}`);
  }
  if (clipMuted(clip) || clipVolume(clip) === 0) {
    chain.push("volume=0");
  } else if (clipVolume(clip) !== 1) {
    chain.push(`volume=${f3(clipVolume(clip))}`);
  }
  return chain.length > 0 ? chain.join(",") : null;
}

/** Expected duration of the joined sequence (== the store's totalDuration). */
export function sequenceDuration(
  clips: Clip[],
  project?: ProjectSettings | null
): number {
  const sum = clips.reduce((acc, c) => acc + clipDuration(c), 0);
  return sum - transitionOverlap(clips, project) * Math.max(0, clips.length - 1);
}

export interface JoinPlan {
  args: string[];
  /** True when the plan is the concat-demuxer plan and `listName` was written. */
  usesList: boolean;
  /** The transition actually applied (after clamping); null = plain concat. */
  applied: { type: TransitionType; duration: number } | null;
}

const XFADE_NAME: Record<string, string> = {
  crossfade: "fade",
  fadeblack: "fadeblack",
};

/**
 * Build the join step. `segNames[i]` is the i-th encoded segment (same FS
 * namespace as `outName`); `listName` is where the caller writes the concat
 * list when the plan needs one.
 */
export function buildJoinArgs(
  segNames: string[],
  clips: Clip[],
  project: ProjectSettings | null | undefined,
  outName: string,
  listName: string
): JoinPlan {
  const overlap = transitionOverlap(clips, project);
  const type = project?.transitionType ?? "none";
  if (overlap <= 0 || !XFADE_NAME[type] || segNames.length < 2) {
    return {
      args: ["-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", outName],
      usesList: true,
      applied: null,
    };
  }

  const durs = clips.map((c) => clipDuration(c));
  const inputs: string[] = [];
  segNames.forEach((s) => inputs.push("-i", s));

  const graph: string[] = [];
  segNames.forEach((_, i) => {
    graph.push(`[${i}:v]settb=AVTB,format=yuv420p[v${i}]`);
    graph.push(`[${i}:a]aresample=48000[a${i}]`);
  });
  // Video: chain xfade; the offset of each join is where the accumulated
  // stream must start blending = its duration so far minus the overlap.
  let vLabel = "[v0]";
  let aLabel = "[a0]";
  let acc = durs[0];
  for (let i = 1; i < segNames.length; i++) {
    const offset = Math.max(0, acc - overlap);
    graph.push(
      `${vLabel}[v${i}]xfade=transition=${XFADE_NAME[type]}:duration=${f3(overlap)}:offset=${f3(offset)}[x${i}]`
    );
    graph.push(`${aLabel}[a${i}]acrossfade=d=${f3(overlap)}[ax${i}]`);
    vLabel = `[x${i}]`;
    aLabel = `[ax${i}]`;
    acc = acc + durs[i] - overlap;
  }

  return {
    args: [
      ...inputs,
      "-filter_complex", graph.join(";"),
      "-map", vLabel,
      "-map", aLabel,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-c:a", "aac",
      "-b:a", "160k",
      "-ar", "48000",
      "-ac", "2",
      "-movflags", "+faststart",
      outName,
    ],
    usesList: false,
    applied: { type, duration: overlap },
  };
}
