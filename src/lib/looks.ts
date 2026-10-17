import {
  clipAdjust,
  clipPreset,
  type Clip,
  type ClipAdjust,
  type LookPresetId,
} from "../store/editor";

/**
 * Phase-3 looks: per-clip manual adjustments (brightness / contrast /
 * saturation) and one-tap look presets.
 *
 * Model (documented in README): a clip carries BOTH a `presetId` and an
 * `adjust` triple. If `presetId` is "custom", the manual sliders rule;
 * "original" means no filtering; any other preset is a named FFmpeg filter
 * chain. Choosing a preset in the UI sets `presetId`; touching a slider
 * switches the clip to "custom". Preview uses CSS `filter` approximations
 * of the same looks — close, not pixel-identical; export is exact.
 *
 * This module is PURE (no DOM imports) so both exporters and the QA
 * harness share the exact same math.
 */

export interface LookPreset {
  id: Exclude<LookPresetId, "custom">;
  /** FFmpeg video-filter chain (comma-separated), "" = no filtering. */
  ffmpeg: string;
  /** CSS filter approximation for the preview, "" = none. */
  css: string;
}

const f2 = (n: number) => {
  const s = n.toFixed(3);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

export const LOOK_PRESETS: LookPreset[] = [
  { id: "original", ffmpeg: "", css: "" },
  {
    id: "warm",
    ffmpeg:
      "colorbalance=rs=0.12:gs=0.04:bs=-0.12:rm=0.08:gm=0.02:bm=-0.08,eq=saturation=1.08",
    css: "sepia(0.32) saturate(1.12) hue-rotate(-8deg)",
  },
  {
    id: "cool",
    ffmpeg:
      "colorbalance=rs=-0.10:gs=-0.02:bs=0.12:rm=-0.06:gm=0.00:bm=0.08,eq=saturation=0.95",
    css: "saturate(0.92) hue-rotate(10deg) brightness(1.02)",
  },
  {
    id: "vivid",
    ffmpeg: "eq=saturation=1.45:contrast=1.08",
    css: "saturate(1.45) contrast(1.08)",
  },
  {
    id: "vintage",
    ffmpeg:
      "colorchannelmixer=0.393:0.769:0.189:0:0.349:0.686:0.168:0:0.272:0.534:0.131,eq=saturation=0.72:contrast=0.94:brightness=0.03",
    css: "sepia(0.5) saturate(0.78) contrast(0.94) brightness(1.03)",
  },
  {
    id: "fade",
    ffmpeg: "eq=contrast=0.82:brightness=0.10:saturation=0.75",
    css: "contrast(0.82) brightness(1.10) saturate(0.75)",
  },
  {
    id: "golden",
    ffmpeg:
      "colorbalance=rs=0.15:gs=0.06:bs=-0.18:rm=0.10:gm=0.03:bm=-0.10,eq=saturation=1.15:brightness=0.03",
    css: "sepia(0.28) saturate(1.22) brightness(1.04) hue-rotate(-10deg)",
  },
  {
    id: "noir",
    ffmpeg: "eq=saturation=0:contrast=1.18",
    css: "grayscale(1) contrast(1.18)",
  },
];

export const presetById = (id: LookPresetId): LookPreset =>
  LOOK_PRESETS.find((p) => p.id === id) ?? LOOK_PRESETS[0];

export const isNeutralAdjust = (a: ClipAdjust): boolean =>
  Math.abs(a.brightness) < 0.001 &&
  Math.abs(a.contrast - 1) < 0.001 &&
  Math.abs(a.saturation - 1) < 0.001;

/** FFmpeg chain for the manual sliders, "" when neutral. */
export function adjustToFfmpeg(a: ClipAdjust): string {
  if (isNeutralAdjust(a)) return "";
  return `eq=brightness=${f2(a.brightness)}:contrast=${f2(a.contrast)}:saturation=${f2(a.saturation)}`;
}

/** CSS filter for the manual sliders, "" when neutral. */
export function adjustToCss(a: ClipAdjust): string {
  if (isNeutralAdjust(a)) return "";
  return `brightness(${f2(1 + a.brightness)}) contrast(${f2(a.contrast)}) saturate(${f2(a.saturation)})`;
}

/** The clip's effective FFmpeg look chain ("" = untouched picture). */
export function clipLookFfmpeg(clip: Clip): string {
  const preset = clipPreset(clip);
  if (preset === "custom") return adjustToFfmpeg(clipAdjust(clip));
  return presetById(preset).ffmpeg;
}

/** The clip's effective CSS filter for the preview ("" = untouched). */
export function clipLookCss(clip: Clip): string {
  const preset = clipPreset(clip);
  if (preset === "custom") return adjustToCss(clipAdjust(clip));
  return presetById(preset).css;
}
