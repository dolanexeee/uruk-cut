import type {
  CaptionStyleId,
  Clip,
  MusicTrack,
  ProjectSettings,
  SourceAsset,
  TextOverlay,
  CaptionCue,
  TransitionType,
} from "../store/editor";
import { DEFAULT_PROJECT, musicDuration, totalDuration } from "../store/editor";
import { buildTimelineCues, outputCanvas } from "./captions";
import { buildAss } from "./ass";

/**
 * The Phase-2 "final pass": after the Phase-1 segment concat produces a
 * uniform base MP4, one more encode applies everything that lives on the
 * timeline rather than inside a clip —
 *   - caption + text-overlay burn-in (ASS via libass `subtitles` filter)
 *   - music track mixing (volume, fades, offset, trim) via amix
 *   - muting the original audio when the user turned it off
 * This module builds the ffmpeg argument list. It is PURE (no DOM/Tauri
 * imports) so both exporters — and the QA harness — construct identical
 * commands; only the concrete file paths differ per platform.
 */

export interface ExportExtras {
  assContent: string | null;
  music: {
    file: File;
    offset: number;
    trimStart: number;
    duration: number;
    volume: number;
    fadeIn: number;
    fadeOut: number;
  } | null;
  keepOriginalAudio: boolean;
  totalDuration: number;
  /** Phase 3: output canvas (aspect preset applied). */
  canvas: { width: number; height: number };
  /** Phase 3: requested transition (exporters clamp via transitionOverlap). */
  transition: { type: TransitionType; duration: number };
}

export interface FinalPassPaths {
  base: string; // joined base MP4
  out: string; // final MP4
  ass: string | null; // path of the .ass file (same FS as base)
  fontsDir: string | null; // directory with the bundled TTFs
  music: string | null; // path of the music file
}

export function needsFinalPass(extras: ExportExtras): boolean {
  return (
    extras.assContent !== null ||
    extras.music !== null ||
    !extras.keepOriginalAudio
  );
}

/** Assemble everything the exporters need from editor state. */
export function buildExportExtras(state: {
  clips: Clip[];
  assets: SourceAsset[];
  captionsByAsset: Record<string, CaptionCue[]>;
  captionsEnabled: boolean;
  captionStyle: CaptionStyleId;
  textOverlays: TextOverlay[];
  music: MusicTrack | null;
  keepOriginalAudio: boolean;
  project?: ProjectSettings;
}): ExportExtras {
  const project = state.project ?? DEFAULT_PROJECT;
  const total = totalDuration(state.clips, project);
  const canvas = outputCanvas(state.clips, state.assets, project.canvasPreset);
  let assContent: string | null = null;
  const cues = state.captionsEnabled
    ? buildTimelineCues(state.clips, state.captionsByAsset, project)
    : [];
  if (cues.length > 0 || state.textOverlays.length > 0) {
    assContent = buildAss({
      width: canvas.width,
      height: canvas.height,
      captionStyle: state.captionStyle,
      cues,
      overlays: state.textOverlays,
    });
  }
  return {
    assContent,
    music: state.music
      ? {
          file: state.music.file,
          offset: state.music.start,
          trimStart: state.music.trimStart,
          duration: musicDuration(state.music),
          volume: state.music.volume,
          fadeIn: state.music.fadeIn,
          fadeOut: state.music.fadeOut,
        }
      : null,
    keepOriginalAudio: state.keepOriginalAudio,
    totalDuration: total,
    canvas,
    transition: {
      type: project.transitionType,
      duration: project.transitionDuration,
    },
  };
}

/** Escape a path for use inside an ffmpeg filter argument value. */
export function escFilterPath(p: string): string {
  return `'${p.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:")}'`;
}

const f3 = (n: number) => n.toFixed(3);

/**
 * Build the ffmpeg args for the final pass. Assumes the base file always
 * carries an audio stream (Phase-1 segments guarantee one: real or silent).
 */
export function buildFinalPassArgs(
  extras: ExportExtras,
  paths: FinalPassPaths
): string[] {
  const args: string[] = ["-i", paths.base];
  if (extras.music && paths.music) args.push("-i", paths.music);

  const graph: string[] = [];
  let videoLabel = "0:v:0";
  if (extras.assContent && paths.ass) {
    const fonts = paths.fontsDir ? `:fontsdir=${escFilterPath(paths.fontsDir)}` : "";
    graph.push(`[0:v]subtitles=${escFilterPath(paths.ass)}${fonts}[vout]`);
    videoLabel = "[vout]";
  }

  let audioLabel: string | null = null;
  const total = Math.max(0.1, extras.totalDuration);
  if (extras.music) {
    const m = extras.music;
    const dur = Math.max(0.1, m.duration);
    const chain: string[] = [
      `[1:a]atrim=start=${f3(m.trimStart)}:end=${f3(m.trimStart + dur)}`,
      "asetpts=N/SR/TB",
      `volume=${m.volume.toFixed(3)}`,
    ];
    if (m.fadeIn > 0.01) chain.push(`afade=t=in:st=0:d=${f3(Math.min(m.fadeIn, dur))}`);
    if (m.fadeOut > 0.01) {
      chain.push(
        `afade=t=out:st=${f3(Math.max(0, dur - m.fadeOut))}:d=${f3(Math.min(m.fadeOut, dur))}`
      );
    }
    if (m.offset > 0.001) {
      chain.push(`adelay=${Math.round(m.offset * 1000)}:all=1`);
    }
    chain.push("aresample=48000");
    if (extras.keepOriginalAudio) {
      graph.push(chain.join(",") + "[ma]");
      graph.push(
        `[0:a]aresample=48000[oa];[oa][ma]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`
      );
    } else {
      graph.push(chain.join(",") + "[aout]");
    }
    audioLabel = "[aout]";
  } else if (!extras.keepOriginalAudio) {
    graph.push("[0:a]volume=0[aout]");
    audioLabel = "[aout]";
  }

  if (graph.length > 0) args.push("-filter_complex", graph.join(";"));
  args.push("-map", videoLabel);
  if (audioLabel) args.push("-map", audioLabel);
  else args.push("-map", "0:a:0");

  if (extras.assContent) {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p");
  } else {
    args.push("-c:v", "copy");
  }
  if (audioLabel) args.push("-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2");
  else args.push("-c:a", "copy");
  args.push("-t", f3(total + 0.1), "-movflags", "+faststart", paths.out);
  return args;
}
