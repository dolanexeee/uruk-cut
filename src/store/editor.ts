import { create } from "zustand";
import type { Lang } from "../i18n";
import { uid } from "../lib/media";

export interface SourceAsset {
  id: string;
  name: string;
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
  thumbnails: string[];
}

export interface Clip {
  id: string;
  sourceId: string;
  start: number; // in-point, seconds into the source
  end: number; // out-point, seconds into the source
}

export const clipDuration = (c: Clip) => Math.max(0, c.end - c.start);
export const totalDuration = (clips: Clip[]) =>
  clips.reduce((acc, c) => acc + clipDuration(c), 0);

export interface Located {
  index: number;
  clip: Clip;
  offsetInClip: number; // seconds from the clip's timeline start
  timelineStart: number; // clip's start position on the timeline
}

/** Find which clip contains timeline time `t` (clamped). */
export function locateTime(clips: Clip[], t: number): Located | null {
  if (clips.length === 0) return null;
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const d = clipDuration(clips[i]);
    if (t < acc + d || i === clips.length - 1) {
      return {
        index: i,
        clip: clips[i],
        offsetInClip: Math.min(Math.max(t - acc, 0), d),
        timelineStart: acc,
      };
    }
    acc += d;
  }
  return null;
}

export type ExportStage =
  | { type: "idle" }
  | { type: "preparing" }
  | { type: "segment"; index: number; total: number }
  | { type: "joining" }
  | { type: "finishing" }
  | { type: "done" }
  | { type: "error"; message: string };

/* ---------------- Phase 2 types ---------------- */

export interface WordTiming {
  word: string;
  start: number; // seconds, in the SOURCE asset's timeline
  end: number;
}

export interface CaptionCue {
  id: string;
  start: number; // seconds, in the SOURCE asset's timeline
  end: number;
  text: string;
  words?: WordTiming[];
}

export type CaptionStyleId = "classic" | "yellow" | "minimal" | "karaoke";
export type WhisperModelId = "tiny" | "base" | "small";
export type SpeechLang = "auto" | "ar" | "en";

export interface CaptionJob {
  assetId: string;
  stage: "extract" | "download" | "transcribe";
  progress: number; // 0..1 (download file progress; coarse otherwise)
  detail: string;
}

export interface TextOverlay {
  id: string;
  text: string;
  start: number; // timeline seconds
  duration: number; // seconds
  position: "top" | "center" | "bottom";
  size: number; // font size as a fraction of frame height (0.03..0.14)
  color: string; // #rrggbb
  bold: boolean;
  pill: boolean;
}

export interface MusicTrack {
  id: string;
  name: string;
  file: File;
  url: string;
  duration: number; // seconds in the audio file
  start: number; // timeline offset, seconds
  trimStart: number; // seconds into the audio file
  trimEnd: number;
  volume: number; // 0..1
  fadeIn: number; // seconds, 0..2
  fadeOut: number; // seconds, 0..2
  peaks: number[]; // normalized 0..1 amplitude bars
}

export const musicDuration = (m: MusicTrack) => Math.max(0, m.trimEnd - m.trimStart);

interface EditorState {
  lang: Lang;
  assets: SourceAsset[];
  clips: Clip[];
  selectedClipId: string | null;
  playhead: number;
  playing: boolean;
  pxPerSec: number;
  past: Clip[][];
  future: Clip[][];
  clipsVersion: number; // bumped on any clips change, lets Preview re-align
  seekNonce: number; // bumped on explicit seeks
  importRequest: number;
  importing: number;
  importError: string | null;
  exporting: boolean;
  exportProgress: number; // 0..1
  exportStage: ExportStage;
  exportUrl: string | null;

  setLang: (lang: Lang) => void;
  requestImport: () => void;
  setImporting: (n: number) => void;
  setImportError: (msg: string | null) => void;
  addAsset: (asset: SourceAsset) => void;
  selectClip: (id: string | null) => void;
  seekTo: (t: number) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (b: boolean) => void;
  setZoom: (px: number) => void;

  pushHistory: () => void;
  setClipsLive: (clips: Clip[]) => void;
  trimClip: (id: string, start: number, end: number) => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;

  setExportState: (
    p: Partial<Pick<EditorState, "exporting" | "exportProgress" | "exportStage" | "exportUrl">>
  ) => void;

  /* Phase 2 state */
  captionsByAsset: Record<string, CaptionCue[]>;
  captionsEnabled: boolean;
  captionStyle: CaptionStyleId;
  whisperModel: WhisperModelId;
  speechLang: SpeechLang;
  captionJob: CaptionJob | null;
  captionError: string | null;
  selectedCue: { assetId: string; cueId: string } | null;
  textOverlays: TextOverlay[];
  selectedTextId: string | null;
  music: MusicTrack | null;
  keepOriginalAudio: boolean;

  setCaptionsEnabled: (b: boolean) => void;
  setCaptionStyle: (s: CaptionStyleId) => void;
  setWhisperModel: (m: WhisperModelId) => void;
  setSpeechLang: (l: SpeechLang) => void;
  setCaptionJob: (j: CaptionJob | null) => void;
  setCaptionError: (msg: string | null) => void;
  setAssetCaptions: (assetId: string, cues: CaptionCue[]) => void;
  updateCue: (assetId: string, cueId: string, patch: Partial<CaptionCue>) => void;
  deleteCue: (assetId: string, cueId: string) => void;
  addCue: (assetId: string, start: number) => CaptionCue;
  selectCue: (sel: { assetId: string; cueId: string } | null) => void;
  addTextOverlay: () => void;
  updateTextOverlay: (id: string, patch: Partial<TextOverlay>) => void;
  deleteTextOverlay: (id: string) => void;
  selectText: (id: string | null) => void;
  setMusic: (m: MusicTrack | null) => void;
  updateMusic: (patch: Partial<MusicTrack>) => void;
  setKeepOriginalAudio: (b: boolean) => void;
}

const snapshot = (clips: Clip[]): Clip[] => clips.map((c) => ({ ...c }));

export const useEditorStore = create<EditorState>((set, get) => ({
  lang: "en",
  assets: [],
  clips: [],
  selectedClipId: null,
  playhead: 0,
  playing: false,
  pxPerSec: 48,
  past: [],
  future: [],
  clipsVersion: 0,
  seekNonce: 0,
  importRequest: 0,
  importing: 0,
  importError: null,
  exporting: false,
  exportProgress: 0,
  exportStage: { type: "idle" },
  exportUrl: null,

  setLang: (lang) => set({ lang }),
  requestImport: () => set((s) => ({ importRequest: s.importRequest + 1 })),
  setImporting: (n) => set({ importing: n }),
  setImportError: (msg) => set({ importError: msg }),

  addAsset: (asset) => {
    get().pushHistory();
    const clip: Clip = { id: uid("clip"), sourceId: asset.id, start: 0, end: asset.duration };
    set((s) => ({
      assets: [...s.assets, asset],
      clips: [...s.clips, clip],
      selectedClipId: clip.id,
      clipsVersion: s.clipsVersion + 1,
    }));
  },

  selectClip: (id) => set({ selectedClipId: id }),

  seekTo: (t) => {
    const total = totalDuration(get().clips);
    set((s) => ({
      playhead: Math.min(Math.max(t, 0), total),
      seekNonce: s.seekNonce + 1,
    }));
  },
  setPlayhead: (t) => {
    const total = totalDuration(get().clips);
    set({ playhead: Math.min(Math.max(t, 0), total) });
  },
  setPlaying: (b) => set({ playing: b }),
  setZoom: (px) => set({ pxPerSec: Math.min(240, Math.max(6, px)) }),

  pushHistory: () =>
    set((s) => ({
      past: [...s.past.slice(-99), snapshot(s.clips)],
      future: [],
    })),

  setClipsLive: (clips) =>
    set((s) => ({
      clips,
      clipsVersion: s.clipsVersion + 1,
      playhead: Math.min(s.playhead, totalDuration(clips)),
    })),

  trimClip: (id, start, end) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, start, end } : c)),
      clipsVersion: s.clipsVersion + 1,
    })),

  splitAtPlayhead: () => {
    const { clips, playhead } = get();
    const loc = locateTime(clips, playhead);
    if (!loc) return;
    const d = clipDuration(loc.clip);
    if (loc.offsetInClip <= 0.05 || loc.offsetInClip >= d - 0.05) return;
    get().pushHistory();
    const cutSourceTime = loc.clip.start + loc.offsetInClip;
    const left: Clip = { ...loc.clip, end: cutSourceTime };
    const right: Clip = { id: uid("clip"), sourceId: loc.clip.sourceId, start: cutSourceTime, end: loc.clip.end };
    const next = [...clips.slice(0, loc.index), left, right, ...clips.slice(loc.index + 1)];
    set((s) => ({ clips: next, selectedClipId: right.id, clipsVersion: s.clipsVersion + 1 }));
  },

  deleteSelected: () => {
    const { clips, selectedClipId } = get();
    if (!selectedClipId) return;
    get().pushHistory();
    const next = clips.filter((c) => c.id !== selectedClipId);
    set((s) => ({
      clips: next,
      selectedClipId: null,
      playhead: Math.min(s.playhead, totalDuration(next)),
      clipsVersion: s.clipsVersion + 1,
    }));
  },

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        future: [snapshot(s.clips), ...s.future].slice(0, 100),
        clips: prev,
        selectedClipId: s.selectedClipId && prev.some((c) => c.id === s.selectedClipId) ? s.selectedClipId : null,
        playhead: Math.min(s.playhead, totalDuration(prev)),
        clipsVersion: s.clipsVersion + 1,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return s;
      const [next, ...rest] = s.future;
      return {
        future: rest,
        past: [...s.past, snapshot(s.clips)],
        clips: next,
        playhead: Math.min(s.playhead, totalDuration(next)),
        clipsVersion: s.clipsVersion + 1,
      };
    }),

  setExportState: (p) => set(p),

  captionsByAsset: {},
  captionsEnabled: true,
  captionStyle: "classic",
  whisperModel: "small",
  speechLang: "auto",
  captionJob: null,
  captionError: null,
  selectedCue: null,
  textOverlays: [],
  selectedTextId: null,
  music: null,
  keepOriginalAudio: true,

  setCaptionsEnabled: (b) => set({ captionsEnabled: b }),
  setCaptionStyle: (s) => set({ captionStyle: s }),
  setWhisperModel: (m) => set({ whisperModel: m }),
  setSpeechLang: (l) => set({ speechLang: l }),
  setCaptionJob: (j) => set({ captionJob: j }),
  setCaptionError: (msg) => set({ captionError: msg }),
  setAssetCaptions: (assetId, cues) =>
    set((s) => ({ captionsByAsset: { ...s.captionsByAsset, [assetId]: cues } })),
  updateCue: (assetId, cueId, patch) =>
    set((s) => ({
      captionsByAsset: {
        ...s.captionsByAsset,
        [assetId]: (s.captionsByAsset[assetId] || []).map((c) =>
          c.id === cueId ? { ...c, ...patch } : c
        ),
      },
    })),
  deleteCue: (assetId, cueId) =>
    set((s) => ({
      captionsByAsset: {
        ...s.captionsByAsset,
        [assetId]: (s.captionsByAsset[assetId] || []).filter((c) => c.id !== cueId),
      },
      selectedCue:
        s.selectedCue && s.selectedCue.assetId === assetId && s.selectedCue.cueId === cueId
          ? null
          : s.selectedCue,
    })),
  addCue: (assetId, start) => {
    const cue: CaptionCue = {
      id: uid("cue"),
      start: Math.max(0, start),
      end: Math.max(0, start) + 2,
      text: "",
    };
    set((s) => ({
      captionsByAsset: {
        ...s.captionsByAsset,
        [assetId]: [...(s.captionsByAsset[assetId] || []), cue].sort((a, b) => a.start - b.start),
      },
      selectedCue: { assetId, cueId: cue.id },
    }));
    return cue;
  },
  selectCue: (sel) => set({ selectedCue: sel }),

  addTextOverlay: () =>
    set((s) => {
      const ov: TextOverlay = {
        id: uid("txt"),
        text: "",
        start: Math.max(0, s.playhead),
        duration: 3,
        position: "top",
        size: 0.07,
        color: "#ffffff",
        bold: true,
        pill: true,
      };
      return { textOverlays: [...s.textOverlays, ov], selectedTextId: ov.id };
    }),
  updateTextOverlay: (id, patch) =>
    set((s) => ({
      textOverlays: s.textOverlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    })),
  deleteTextOverlay: (id) =>
    set((s) => ({
      textOverlays: s.textOverlays.filter((o) => o.id !== id),
      selectedTextId: s.selectedTextId === id ? null : s.selectedTextId,
    })),
  selectText: (id) => set({ selectedTextId: id }),

  setMusic: (m) => set({ music: m }),
  updateMusic: (patch) =>
    set((s) => (s.music ? { music: { ...s.music, ...patch } } : s)),
  setKeepOriginalAudio: (b) => set({ keepOriginalAudio: b }),
}));
