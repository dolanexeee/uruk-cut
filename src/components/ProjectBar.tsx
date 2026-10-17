"use client";

import { useEditorStore, type CanvasPresetId, type TransitionType } from "../store/editor";
import { dict } from "../i18n";

const chip = (active: boolean, disabled = false) =>
  `h-8 rounded-md px-2.5 text-xs transition ${
    active
      ? "bg-[#d9a441] font-semibold text-zinc-950"
      : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
  } ${disabled ? "cursor-not-allowed opacity-35 hover:border-zinc-700" : ""}`;

const TRANSITIONS: { id: TransitionType; labelKey: "transNone" | "transCrossfade" | "transFadeblack" }[] = [
  { id: "none", labelKey: "transNone" },
  { id: "crossfade", labelKey: "transCrossfade" },
  { id: "fadeblack", labelKey: "transFadeblack" },
];

const DURATIONS = [0.3, 0.5, 1.0];
const CANVASES: CanvasPresetId[] = ["original", "9:16", "16:9", "1:1", "4:5"];

/** Phase-3 project-level bar: transition (type + duration) and canvas preset. */
export default function ProjectBar() {
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];
  const project = useEditorStore((s) => s.project);
  const setProject = useEditorStore((s) => s.setProject);
  const transOff = project.transitionType === "none";

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-800 bg-[#101013] px-3 py-2"
      data-testid="project-bar"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-zinc-400">{t.transition}</span>
        {TRANSITIONS.map((tr) => (
          <button
            key={tr.id}
            type="button"
            data-testid={`trans-${tr.id}`}
            className={chip(project.transitionType === tr.id)}
            onClick={() => setProject({ transitionType: tr.id })}
          >
            {t[tr.labelKey]}
          </button>
        ))}
        <span className="ms-1 text-xs text-zinc-500">{t.transDuration}</span>
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            data-testid={`trans-dur-${d}`}
            disabled={transOff}
            className={chip(project.transitionDuration === d, transOff)}
            onClick={() => setProject({ transitionDuration: d })}
          >
            {d}s
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-zinc-400">{t.canvas}</span>
        {CANVASES.map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`canvas-${c}`}
            className={chip(project.canvasPreset === c)}
            onClick={() => setProject({ canvasPreset: c })}
          >
            {c === "original" ? t.canvasOriginal : c}
          </button>
        ))}
      </div>
    </div>
  );
}
