import {
  clipDuration,
  type CaptionCue,
  type Clip,
  type WordTiming,
} from "../store/editor";
import { uid } from "./media";

/** Uniform output canvas: largest source, capped at 1920x1080 (same rule as the exporters). */
export function outputCanvas(
  clips: Clip[],
  assets: { id: string; width: number; height: number }[]
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const byId = new Map(assets.map((a) => [a.id, a]));
  let W = 2;
  let H = 2;
  for (const c of clips) {
    const a = byId.get(c.sourceId);
    if (!a) continue;
    W = Math.max(W, Math.min(a.width, 1920));
    H = Math.max(H, Math.min(a.height, 1080));
  }
  return { width: even(W), height: even(H) };
}

/**
 * Group word-level timings into caption cues: a new cue starts when the cue
 * would exceed ~4 s, ~7 words, ~38 chars, or after a >0.9 s silence gap —
 * keeping each cue to at most two short lines on screen.
 */
export function groupWordsIntoCues(words: WordTiming[]): CaptionCue[] {
  const clean = words
    .filter((w) => w.word && w.word.trim().length > 0 && isFinite(w.start) && isFinite(w.end))
    .map((w) => ({ word: w.word.trim(), start: Math.max(0, w.start), end: Math.max(w.start, w.end) }))
    .sort((a, b) => a.start - b.start);
  const cues: CaptionCue[] = [];
  let cur: WordTiming[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    cues.push({
      id: uid("cue"),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.word).join(" "),
      words: [...cur],
    });
    cur = [];
  };
  for (const w of clean) {
    if (cur.length > 0) {
      const cueStart = cur[0].start;
      const prev = cur[cur.length - 1];
      const textLen = cur.map((x) => x.word).join(" ").length + w.word.length + 1;
      if (
        w.end - cueStart > 4 ||
        cur.length >= 7 ||
        textLen > 38 ||
        w.start - prev.end > 0.9
      ) {
        flush();
      }
    }
    cur.push(w);
  }
  flush();
  return cues;
}

/** Fallback grouping when only segment-level chunks are available. */
export function cuesFromSegments(
  segments: { text: string; start: number; end: number }[]
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const seg of segments) {
    const text = (seg.text || "").trim();
    if (!text) continue;
    const dur = Math.max(0, seg.end - seg.start);
    if (dur <= 4.5 || text.length <= 40) {
      cues.push({ id: uid("cue"), start: seg.start, end: seg.end, text });
      continue;
    }
    // Split long segments proportionally at word boundaries.
    const words = text.split(/\s+/);
    const per = Math.ceil(dur / 4);
    const chunkSize = Math.max(1, Math.ceil(words.length / per));
    for (let i = 0; i < words.length; i += chunkSize) {
      const part = words.slice(i, i + chunkSize);
      const f0 = i / words.length;
      const f1 = Math.min(1, (i + part.length) / words.length);
      cues.push({
        id: uid("cue"),
        start: seg.start + f0 * dur,
        end: seg.start + f1 * dur,
        text: part.join(" "),
      });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** A cue mapped onto the export/preview timeline (times in timeline seconds). */
export interface TimelineCue extends CaptionCue {
  assetId: string;
  clipId: string;
  timelineStart: number;
  timelineEnd: number;
}

/**
 * Map per-asset cues through the timeline clips: each clip contributes the
 * slice of its asset's cues that intersects its [start, end] trim, shifted
 * into timeline coordinates. Word timings are clipped + shifted along.
 */
export function buildTimelineCues(
  clips: Clip[],
  captionsByAsset: Record<string, CaptionCue[]>
): TimelineCue[] {
  const out: TimelineCue[] = [];
  let acc = 0;
  for (const clip of clips) {
    const dur = clipDuration(clip);
    const cues = captionsByAsset[clip.sourceId] || [];
    for (const cue of cues) {
      const s = Math.max(cue.start, clip.start);
      const e = Math.min(cue.end, clip.end);
      if (e - s <= 0.01) continue;
      const shift = acc - clip.start;
      let words: WordTiming[] | undefined;
      if (cue.words && cue.words.length > 0) {
        words = cue.words
          .filter((w) => w.end > s && w.start < e)
          .map((w) => ({
            word: w.word,
            start: Math.max(w.start, s) + shift,
            end: Math.min(w.end, e) + shift,
          }));
        if (words.length === 0) words = undefined;
      }
      out.push({
        id: cue.id,
        assetId: clip.sourceId,
        clipId: clip.id,
        start: s + shift,
        end: e + shift,
        timelineStart: s + shift,
        timelineEnd: e + shift,
        text: cue.text,
        words,
      });
    }
    acc += dur;
  }
  return out.sort((a, b) => a.timelineStart - b.timelineStart);
}

/** Find the timeline position a cue (asset-space) maps to, for seeking. */
export function seekTargetForCue(
  clips: Clip[],
  assetId: string,
  cue: CaptionCue
): number | null {
  let acc = 0;
  for (const clip of clips) {
    const dur = clipDuration(clip);
    if (clip.sourceId === assetId) {
      const s = Math.max(cue.start, clip.start);
      const e = Math.min(cue.end, clip.end);
      if (e - s > 0.01) return acc + (s - clip.start) + 0.01;
    }
    acc += dur;
  }
  return null;
}
