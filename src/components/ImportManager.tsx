"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAsset } from "../lib/media";
import { useEditorStore } from "../store/editor";
import { dict } from "../i18n";

/** Owns the hidden file input, global drag & drop, and the empty-state dropzone. */
export default function ImportManager() {
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];
  const importRequest = useEditorStore((s) => s.importRequest);
  const importing = useEditorStore((s) => s.importing);
  const importError = useEditorStore((s) => s.importError);
  const hasClips = useEditorStore((s) => s.clips.length > 0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv)$/i.test(f.name)
    );
    if (list.length === 0) return;
    const st = useEditorStore.getState();
    st.setImportError(null);
    st.setImporting(st.importing + list.length);
    for (const file of list) {
      try {
        const asset = await buildAsset(file);
        useEditorStore.getState().addAsset(asset);
      } catch {
        useEditorStore.getState().setImportError(t.importError);
      } finally {
        const s2 = useEditorStore.getState();
        s2.setImporting(Math.max(0, s2.importing - 1));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (importRequest > 0) inputRef.current?.click();
  }, [importRequest]);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        dragDepth.current += 1;
        setDragging(true);
      }
    };
    const onDragLeave = () => {
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) setDragging(false);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) handleFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFiles]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mov,.mkv"
        multiple
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-xl border-2 border-dashed border-[#d9a441] px-10 py-8 text-center">
            <div className="text-3xl">✂</div>
            <div className="mt-2 text-lg font-semibold text-zinc-100">{t.dropTitle}</div>
            <div className="text-sm text-zinc-400">{t.dropHint}</div>
          </div>
        </div>
      )}

      {!hasClips && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-700 bg-[#121215] px-6 py-10 text-center transition hover:border-[#d9a441]"
        >
          <span className="text-4xl text-[#d9a441]">✂</span>
          <span className="text-lg font-semibold text-zinc-100">{t.emptyTitle}</span>
          <span className="max-w-md text-sm leading-6 text-zinc-400">{t.emptyHint}</span>
          <span className="mt-2 rounded-md bg-[#d9a441] px-4 py-2 text-sm font-semibold text-zinc-950">
            {t.addVideos}
          </span>
          <span className="text-xs text-zinc-500">{t.dropHint}</span>
        </button>
      )}

      {importing > 0 && (
        <div className="rounded-md border border-zinc-800 bg-[#121215] px-3 py-2 text-sm text-zinc-300">
          {t.probing}
        </div>
      )}
      {importError && (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {importError}
        </div>
      )}
    </>
  );
}
