"use client";

import { useEditorStore } from "../store/editor";
import { dict } from "../i18n";

/** Modal progress surface for export, driven by store export state. */
export default function ExportPanel({ onClose }: { onClose: () => void }) {
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];
  const exporting = useEditorStore((s) => s.exporting);
  const progress = useEditorStore((s) => s.exportProgress);
  const stage = useEditorStore((s) => s.exportStage);
  const exportUrl = useEditorStore((s) => s.exportUrl);

  const stageText = (() => {
    switch (stage.type) {
      case "preparing":
        return t.preparingEngine;
      case "segment":
        return `${t.encodingSegment} ${stage.index + 1}/${stage.total}`;
      case "joining":
        return t.joiningSegments;
      case "finishing":
        return t.finishing;
      case "done":
        return t.exportDone;
      case "error":
        return `${t.exportError}: ${stage.message}`;
      default:
        return t.exportProgress;
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#141417] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">{t.export}</h2>
          {!exporting && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-sm text-zinc-300 hover:border-zinc-500"
            >
              {t.close}
            </button>
          )}
        </div>
        <p
          className={`mt-3 text-sm ${stage.type === "error" ? "text-red-300" : "text-zinc-300"}`}
          data-testid="export-stage"
        >
          {stageText}
        </p>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full transition-all ${stage.type === "error" ? "bg-red-500" : "bg-[#d9a441]"}`}
            style={{ width: `${Math.round(progress * 100)}%` }}
            data-testid="export-progress-bar"
          />
        </div>
        <div className="mt-1.5 text-end font-mono text-xs text-zinc-500" dir="ltr">
          {Math.round(progress * 100)}%
        </div>
        {stage.type === "done" && exportUrl && (
          <a
            href={exportUrl}
            download="uruk-cut-export.mp4"
            className="mt-3 block rounded-md bg-[#d9a441] px-4 py-2.5 text-center text-sm font-semibold text-zinc-950"
          >
            {t.download} — uruk-cut-export.mp4
          </a>
        )}
      </div>
    </div>
  );
}
