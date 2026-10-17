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
import { dict } from "../i18n";

export default function Page() {
  const lang = useEditorStore((s) => s.lang);
  const clips = useEditorStore((s) => s.clips);
  const [panelOpen, setPanelOpen] = useState(false);

  // Keep <html> lang/dir in sync with the chosen UI language.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

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
