"use client";

import { useCallback, useEffect, useState } from "react";
import Header from "../components/Header";
import Preview from "../components/Preview";
import Timeline from "../components/Timeline";
import Toolbar from "../components/Toolbar";
import ImportManager from "../components/ImportManager";
import ExportPanel from "../components/ExportPanel";
import Panels from "../components/Panels";
import ProjectBar from "../components/ProjectBar";
import { useEditorStore } from "../store/editor";
import { exportVideo } from "../lib/export";
import { buildExportExtras } from "../lib/finalpass";
import { initProjectPersistence } from "../lib/project";
import { dict } from "../i18n";

export default function Page() {
  const lang = useEditorStore((s) => s.lang);
  const clips = useEditorStore((s) => s.clips);
  const restoredNotice = useEditorStore((s) => s.restoredNotice);
  const storageWarning = useEditorStore((s) => s.storageWarning);
  const [panelOpen, setPanelOpen] = useState(false);

  // Keep <html> lang/dir in sync with the chosen UI language.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  // Phase 4: restore the IndexedDB autosave (if any), then keep saving.
  useEffect(() => {
    void initProjectPersistence();
  }, []);

  // Test hook: expose the store when ?test=1 (used by the QA smoke test only).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("test")) {
      (window as unknown as { __urukStore: typeof useEditorStore }).__urukStore = useEditorStore;
    }
  }, []);

  const startExport = useCallback(async () => {
    const st = useEditorStore.getState();
    const t = dict[st.lang];
    if (st.clips.length === 0 || st.exporting) return;
    st.setPlaying(false);
    st.setExportState({
      exporting: true,
      exportProgress: 0,
      exportStage: { type: "preparing" },
      exportUrl: null,
    });
    setPanelOpen(true);
    try {
      const extras = buildExportExtras(st);
      const blob = await exportVideo(st.clips, st.assets, extras, {
        onStage: (stage, progress) =>
          useEditorStore.getState().setExportState({ exportStage: stage, exportProgress: progress }),
      });
      const url = URL.createObjectURL(blob);
      useEditorStore.getState().setExportState({ exporting: false, exportUrl: url, exportProgress: 1 });
      // Auto-download
      const a = document.createElement("a");
      a.href = url;
      a.download = "uruk-cut-export.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      useEditorStore.getState().setExportState({
        exporting: false,
        exportStage: {
          type: "error",
          message: err instanceof Error ? err.message : String(err) || t.exportError,
        },
      });
    }
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col">
      <Header onExport={startExport} />
      {restoredNotice && (
        <div
          data-testid="restored-note"
          className="flex items-center justify-center gap-3 border-b border-[#d9a441]/40 bg-[#d9a441]/10 px-4 py-1.5 text-center text-xs text-[#f3cd8a]"
        >
          <span>{dict[lang].projectRestored}</span>
          <button
            type="button"
            className="rounded border border-[#d9a441]/50 px-1.5 py-0.5 text-[11px] hover:bg-[#d9a441]/20"
            onClick={() => useEditorStore.getState().setRestoredNotice(false)}
          >
            ✕
          </button>
        </div>
      )}
      {storageWarning && (
        <div
          data-testid="storage-warning"
          className="flex items-center justify-center gap-3 border-b border-red-900 bg-red-950/80 px-4 py-1.5 text-center text-xs text-red-200"
        >
          <span>{dict[lang].storageWarning}</span>
          <button
            type="button"
            className="rounded border border-red-800 px-1.5 py-0.5 text-[11px] hover:bg-red-900/40"
            onClick={() => useEditorStore.getState().setStorageWarning(null)}
          >
            ✕
          </button>
        </div>
      )}
      <main className="flex flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
        <Preview />
        <ImportManager />
        {clips.length > 0 && <Panels />}
        <div className="mt-auto flex flex-col gap-2 pb-2">
          {clips.length > 0 && <ProjectBar />}
          <Toolbar />
          <Timeline />
          {clips.length === 0 && (
            <p className="text-center text-xs text-zinc-600">{dict[lang].selectClipHint}</p>
          )}
        </div>
      </main>
      {panelOpen && <ExportPanel onClose={() => setPanelOpen(false)} />}
    </div>
  );
}
