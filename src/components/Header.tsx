"use client";

import { useEditorStore } from "../store/editor";
import { dict } from "../i18n";

export default function Header({ onExport }: { onExport: () => void }) {
  const lang = useEditorStore((s) => s.lang);
  const setLang = useEditorStore((s) => s.setLang);
  const exporting = useEditorStore((s) => s.exporting);
  const hasClips = useEditorStore((s) => s.clips.length > 0);
  const t = dict[lang];

  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 bg-[#0e0e11] px-3 py-2.5 sm:px-4">
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
    </header>
  );
}
