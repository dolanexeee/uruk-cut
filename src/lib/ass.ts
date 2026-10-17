import { overlayAnimation, type CaptionStyleId, type TextOverlay } from "../store/editor";
import type { TimelineCue } from "./captions";

/**
 * ASS (Advanced Substation Alpha) generation for burned-in captions and
 * text overlays. libass renders this in both export pipelines (WASM core
 * and the native sidecar both ship the `subtitles`/`ass` filters + libass),
 * which also gives correct Arabic shaping/bidi — the reason ASS is used
 * instead of per-cue drawtext chains.
 *
 * Colors are &HAABBGGRR. The bundled font family is "Noto Sans Arabic"
 * (covers Arabic + Latin); "Inter" ships alongside as fallback.
 */

export const CAPTION_FONT = "Noto Sans Arabic";
export const BRONZE = "#d9a441";

function assColor(hex: string, alpha = 0): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const ss = s - h * 3600 - m * 60;
  return `${h}:${String(m).padStart(2, "0")}:${ss.toFixed(2).padStart(5, "0")}`;
}

/** Escape text for an ASS dialogue line. */
function esc(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

interface StyleDef {
  name: string;
  fontSize: number;
  primary: string;
  secondary: string;
  outlineColor: string;
  backColor: string;
  bold: 0 | 1;
  borderStyle: number; // 1 = outline+shadow, 3 = opaque box
  outline: number;
  shadow: number;
  alignment: number;
  marginV: number;
}

function styleLine(s: StyleDef): string {
  return [
    "Style: " + s.name,
    CAPTION_FONT,
    s.fontSize,
    s.primary,
    s.secondary,
    s.outlineColor,
    s.backColor,
    s.bold,
    "0", // italic
    "0", // underline
    "0", // strikeout
    "100", // scaleX
    "100", // scaleY
    "0", // spacing
    "0", // angle
    s.borderStyle,
    s.outline,
    s.shadow,
    s.alignment,
    "24", // marginL
    "24", // marginR
    s.marginV,
    "1", // encoding
  ].join(",");
}

function captionStyle(style: CaptionStyleId, H: number): StyleDef {
  const fs = Math.max(14, Math.round(H * 0.052));
  const base: StyleDef = {
    name: "Caption",
    fontSize: fs,
    primary: assColor("#ffffff"),
    secondary: assColor("#ffffff"),
    outlineColor: assColor("#000000"),
    backColor: assColor("#000000", 0.45),
    bold: 1,
    borderStyle: 3,
    outline: Math.max(6, Math.round(H * 0.012)),
    shadow: 0,
    alignment: 2,
    marginV: Math.round(H * 0.045),
  };
  switch (style) {
    case "classic":
      return base;
    case "karaoke":
      // libass karaoke: SecondaryColour = not-yet-sung, PrimaryColour = sung.
      return { ...base, primary: assColor(BRONZE), secondary: assColor("#ffffff") };
    case "yellow":
      return {
        ...base,
        primary: assColor("#ffe600"),
        borderStyle: 1,
        outline: Math.max(2, Math.round(H * 0.005)),
        shadow: 1,
        backColor: assColor("#000000", 0.25),
      };
    case "minimal":
      return {
        ...base,
        bold: 0,
        borderStyle: 1,
        outline: 0,
        shadow: 2,
        backColor: assColor("#000000", 0.55),
      };
  }
}

function overlayStyle(ov: TextOverlay, idx: number, H: number): StyleDef {
  const alignment = ov.position === "top" ? 8 : ov.position === "center" ? 5 : 2;
  return {
    name: `Ov${idx}`,
    fontSize: Math.max(12, Math.round(ov.size * H)),
    primary: assColor(ov.color),
    secondary: assColor(ov.color),
    outlineColor: assColor("#000000"),
    backColor: assColor("#000000", 0.5),
    bold: ov.bold ? 1 : 0,
    borderStyle: ov.pill ? 3 : 1,
    outline: ov.pill ? Math.max(5, Math.round(H * 0.01)) : Math.max(1.5, Math.round(H * 0.0035)),
    shadow: ov.pill ? 0 : 1,
    alignment,
    marginV:
      ov.position === "top"
        ? Math.round(H * 0.04)
        : ov.position === "bottom"
          ? Math.round(H * 0.13) // sit above the caption line
          : 0,
  };
}

/** Karaoke event text: {\k<centiseconds>} per word (libass sweeps the fill). */
function karaokeText(cue: TimelineCue): string {
  if (!cue.words || cue.words.length === 0) return esc(cue.text);
  const parts: string[] = [];
  let cursor = cue.timelineStart;
  for (const w of cue.words) {
    const gap = Math.max(0, w.start - cursor);
    if (gap > 0.05) parts.push(`{\\k${Math.round(gap * 100)}}`);
    const dur = Math.max(1, Math.round((w.end - w.start) * 100));
    parts.push(`{\\k${dur}}${esc(w.word)}`);
    cursor = w.end;
  }
  return parts.join(" ");
}

/**
 * Phase 4: animation override tags for a text overlay event.
 *
 * ASS has one mechanism per property: \fad (alpha in/out), \move (a single
 * position glide over a time window), and \t (transform of scale/alpha
 * between two timestamps). Each preset therefore maps to:
 *   fade     -> \fad(in, out)
 *   slide-up -> \move from below the resting spot into place (in), then
 *               \fad(0, out) for the exit (a second positional glide is not
 *               expressible in one Dialogue event)
 *   pop      -> \t scale 60% -> 108% (first half of the entrance) -> 100%,
 *               exit scales back to 60% with a fade
 * Windows are ~0.35 s per side, clamped to half the item duration so very
 * short items still animate symmetrically. Positions for \move are
 * absolute PlayRes coordinates of the alignment anchor, mirroring
 * overlayStyle()'s alignment + margins.
 */
export function overlayAnimTags(ov: TextOverlay, W: number, H: number): string {
  const anim = overlayAnimation(ov);
  if (anim === "none" || ov.duration <= 0.05) return "";
  const half = ov.duration / 2;
  const inS = Math.min(0.35, half);
  const outS = Math.min(0.35, half);
  const inMs = Math.round(inS * 1000);
  const outMs = Math.round(outS * 1000);
  const outStartMs = Math.round((ov.duration - outS) * 1000);
  const durMs = Math.round(ov.duration * 1000);
  if (anim === "fade") return `{\\fad(${inMs},${outMs})}`;
  if (anim === "slide-up") {
    const x = Math.round(W / 2);
    const y =
      ov.position === "top"
        ? Math.round(H * 0.04)
        : ov.position === "center"
          ? Math.round(H / 2)
          : Math.round(H - H * 0.13);
    const dist = Math.max(24, Math.round(H * 0.07));
    return `{\\move(${x},${y + dist},${x},${y},0,${inMs})\\fad(0,${outMs})}`;
  }
  // pop
  const midMs = Math.max(1, Math.round(inMs / 2));
  return (
    `{\\fscx60\\fscy60` +
    `\\t(0,${midMs},\\fscx108\\fscy108)` +
    `\\t(${midMs},${inMs},\\fscx100\\fscy100)` +
    `\\t(${outStartMs},${durMs},\\fscx60\\fscy60)\\fad(0,${outMs})}`
  );
}

export interface AssBuildInput {
  width: number;
  height: number;
  captionStyle: CaptionStyleId;
  cues: TimelineCue[]; // timeline-mapped (may be empty)
  overlays: TextOverlay[];
}

/** Build a complete .ass file, or return null when there is nothing to burn. */
export function buildAss(input: AssBuildInput): string | null {
  const { width: W, height: H, cues, overlays } = input;
  const styledCues = cues.filter((c) => c.text.trim().length > 0);
  const styledOverlays = overlays.filter((o) => o.text.trim().length > 0);
  if (styledCues.length === 0 && styledOverlays.length === 0) return null;

  const styles: string[] = [styleLine(captionStyle(input.captionStyle, H))];
  styledOverlays.forEach((ov, i) => styles.push(styleLine(overlayStyle(ov, i, H))));

  const events: string[] = [];
  for (const cue of styledCues) {
    const text =
      input.captionStyle === "karaoke" ? karaokeText(cue) : esc(cue.text);
    events.push(
      `Dialogue: 0,${assTime(cue.timelineStart)},${assTime(cue.timelineEnd)},Caption,,0,0,0,,${text}`
    );
  }
  styledOverlays.forEach((ov, i) => {
    const tags = overlayAnimTags(ov, W, H);
    events.push(
      `Dialogue: 1,${assTime(ov.start)},${assTime(ov.start + ov.duration)},Ov${i},,0,0,0,,${tags}${esc(ov.text)}`
    );
  });

  return [
    "[Script Info]",
    "Title: Uruk Cut captions",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
