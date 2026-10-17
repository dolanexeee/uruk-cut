"use client";

import { useRef, useState } from "react";
import { useEditorStore } from "../store/editor";
import { dict } from "../i18n";
import { applyBundle, exportProjectBlob, resetProject } from "../lib/project";

const headerBtn =
  "h-10 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40";

export default function Header({ onExport }: { onExport: () => void }) {
  const lang = useEditorStore((s) => s.lang);
  const setLang = useEditorStore((s) => s.setLang);
  const exporting = useEditorStore((s) => s.exporting);
  const hasClips = useEditorStore((s) => s.clips.length > 0);
  const t = dict[lang];
  const openRef = useRef<HTMLInputElement | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const onSave = async () => {
    const blob = await exportProjectBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "project.urukcut";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const onOpenFile = async (file: File | undefined) => {
    if (!file) return;
    setOpenError(null);
    try {
      useEditorStore.getState().setPlaying(false);
      await applyBundle(new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      console.warn("Open project failed:", err);
      setOpenError(t.openProjectError);
    }
  };

  const onNew = async () => {
    if (!window.confirm(t.newProjectConfirm)) return;
    useEditorStore.getState().setPlaying(false);
    await resetProject();
  };

  return (
    <header className="relative flex items-center gap-3 border-b border-zinc-800 bg-[#0e0e11] px-3 py-2.5 sm:px-4">
      <div className="flex items-baseline gap-2" dir="ltr">
        <span className="text-lg font-black tracking-[0.18em] text-zinc-50">
          URUK
        </span>
        <span className="rounded-sm bg-[#d9a441] px-1.5 py-0.5 text-[11px] font-bold tracking-widest text-zinc-950">
          CUT
        </span>
        <span className="hidden text-[11px] font-medium text-zinc-500 sm:inline">{t.phase}</span>
      </div>
      <div className="ms-auto flex items-center gap-2">
        <button
          type="button"
          data-testid="save-project"
          onClick={() => void onSave()}
          disabled={!hasClips || exporting}
          className={headerBtn}
        >
          💾 {t.saveProject}
        </button>
        <button
          type="button"
          data-testid="open-project"
          onClick={() => openRef.current?.click()}
          disabled={exporting}
          className={headerBtn}
        >
          📂 {t.openProject}
        </button>
        <input
          ref={openRef}
          type="file"
          accept=".urukcut,application/zip"
          data-testid="open-input"
          className="hidden"
          onChange={(e) => {
            void onOpenFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          data-testid="new-project"
          onClick={() => void onNew()}
          disabled={exporting}
          className={headerBtn}
        >
          ✨ {t.newProject}
        </button>
        <button
          type="button"
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="h-10 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 transition hover:border-zinc-500"
        >
          {t.language}
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={!hasClips || exporting}
          className="h-10 rounded-md bg-[#d9a441] px-4 text-sm font-semibold text-zinc-950 transition hover:bg-[#e5b354] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {exporting ? t.exporting : t.export}
        </button>
      </div>
      {openError && (
        <div
          data-testid="open-error"
          className="absolute inset-x-0 top-full z-20 border-b border-red-900 bg-red-950/90 px-4 py-1.5 text-center text-xs text-red-200"
        >
          {openError}
        </div>
      )}
    </header>
  );
}
