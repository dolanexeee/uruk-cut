"use client";

import { useEffect } from "react";
import { clipDuration, locateTime, useEditorStore } from "../store/editor";
import { dict } from "../i18n";

const btn =
  "flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-sm text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-35";

export default function Toolbar() {
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];
  const clips = useEditorStore((s) => s.clips);
  const playhead = useEditorStore((s) => s.playhead);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const past = useEditorStore((s) => s.past);
  const future = useEditorStore((s) => s.future);
  const pxPerSec = useEditorStore((s) => s.pxPerSec);
  const setZoom = useEditorStore((s) => s.setZoom);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const requestImport = useEditorStore((s) => s.requestImport);
  const project = useEditorStore((s) => s.project);

  const loc = locateTime(clips, playhead, project);
  const canSplit =
    !!loc && loc.offsetInClip > 0.05 && loc.offsetInClip < clipDuration(loc.clip) - 0.05;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} onClick={requestImport} aria-label={t.addVideos}>
        ＋ <span className="hidden sm:inline">{t.addVideos}</span>
      </button>
      <div className="mx-1 h-6 w-px bg-zinc-800" />
      <button type="button" className={btn} onClick={undo} disabled={past.length === 0} aria-label={t.undo} title={t.undo}>
        ↩
      </button>
      <button type="button" className={btn} onClick={redo} disabled={future.length === 0} aria-label={t.redo} title={t.redo}>
        ↪
      </button>
      <button
        type="button"
        className={btn}
        onClick={splitAtPlayhead}
        disabled={!canSplit}
        aria-label={t.split}
        title={t.split}
      >
        ✂ <span className="hidden sm:inline">{t.split}</span>
      </button>
      <button
        type="button"
        className={btn}
        onClick={deleteSelected}
        disabled={!selectedClipId}
        aria-label={t.deleteClip}
        title={t.deleteClip}
      >
        🗑 <span className="hidden sm:inline">{t.deleteClip}</span>
      </button>
      <div className="ms-auto flex items-center gap-2">
        <span className="hidden text-xs text-zinc-500 sm:inline">{t.zoom}</span>
        <button type="button" className={btn} onClick={() => setZoom(pxPerSec / 1.4)} aria-label={t.zoomOut}>
          −
        </button>
        <input
          type="range"
          min={6}
          max={240}
          step={1}
          value={pxPerSec}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-24 accent-[#d9a441] sm:w-32"
          aria-label={t.zoom}
          dir="ltr"
        />
        <button type="button" className={btn} onClick={() => setZoom(pxPerSec * 1.4)} aria-label={t.zoomIn}>
          ＋
        </button>
      </div>
      <div className="w-full text-[11px] text-zinc-600">{t.dragClipHint}</div>
    </div>
  );
}
