"use client";

import {
  overlayAnimation,
  useEditorStore,
  type TextAnimation,
  type TextOverlay,
} from "../store/editor";
import { dict } from "../i18n";

const inputCls =
  "h-9 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-[#d9a441]";
const numCls = `${inputCls} w-[4.6rem] font-mono`;

export default function TextPanel() {
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];
  const overlays = useEditorStore((s) => s.textOverlays);
  const selectedTextId = useEditorStore((s) => s.selectedTextId);

  const posLabel = (p: TextOverlay["position"]) =>
    p === "top" ? t.posTop : p === "center" ? t.posCenter : t.posBottom;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {overlays.length === 0 && <p className="text-sm text-zinc-500">{t.noTextYet}</p>}
        {overlays.map((ov) => {
          const selected = ov.id === selectedTextId;
          return (
            <div
              key={ov.id}
              data-testid="text-row"
              data-text-id={ov.id}
              className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 ${
                selected ? "border-[#d9a441] bg-[#d9a441]/5" : "border-zinc-800 bg-[#121215]"
              }`}
              onClick={() => useEditorStore.getState().selectText(ov.id)}
            >
              <input
                type="text"
                className={`${inputCls} min-w-28 flex-1`}
                value={ov.text}
                placeholder={t.textContent}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  useEditorStore.getState().updateTextOverlay(ov.id, { text: e.target.value })
                }
                aria-label={t.textContent}
              />
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                {t.textStart}
                <input
                  type="number"
                  className={numCls}
                  step={0.1}
                  min={0}
                  value={Number(ov.start.toFixed(2))}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    useEditorStore
                      .getState()
                      .updateTextOverlay(ov.id, { start: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                {t.textDuration}
                <input
                  type="number"
                  className={numCls}
                  step={0.1}
                  min={0.2}
                  value={Number(ov.duration.toFixed(2))}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    useEditorStore
                      .getState()
                      .updateTextOverlay(ov.id, {
                        duration: Math.max(0.2, Number(e.target.value) || 0.2),
                      })
                  }
                />
              </label>
              <select
                className={inputCls}
                value={ov.position}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  useEditorStore
                    .getState()
                    .updateTextOverlay(ov.id, { position: e.target.value as TextOverlay["position"] })
                }
                aria-label={t.textPosition}
              >
                {(["top", "center", "bottom"] as const).map((p) => (
                  <option key={p} value={p}>
                    {posLabel(p)}
                  </option>
                ))}
              </select>
              <select
                className={inputCls}
                value={overlayAnimation(ov)}
                data-testid="text-anim"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  useEditorStore
                    .getState()
                    .updateTextOverlay(ov.id, { animation: e.target.value as TextAnimation })
                }
                aria-label={t.animLabel}
              >
                <option value="none">{t.animNone}</option>
                <option value="fade">{t.animFade}</option>
                <option value="slide-up">{t.animSlideUp}</option>
                <option value="pop">{t.animPop}</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                {t.textSize}
                <input
                  type="range"
                  min={0.03}
                  max={0.14}
                  step={0.005}
                  value={ov.size}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    useEditorStore.getState().updateTextOverlay(ov.id, { size: Number(e.target.value) })
                  }
                  className="w-20 accent-[#d9a441]"
                  dir="ltr"
                />
              </label>
              <input
                type="color"
                value={ov.color}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  useEditorStore.getState().updateTextOverlay(ov.id, { color: e.target.value })
                }
                className="h-9 w-10 cursor-pointer rounded-md border border-zinc-700 bg-zinc-900"
                aria-label={t.textColor}
              />
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={ov.bold}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    useEditorStore.getState().updateTextOverlay(ov.id, { bold: e.target.checked })
                  }
                  className="h-4 w-4 accent-[#d9a441]"
                />
                {t.textBold}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={ov.pill}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    useEditorStore.getState().updateTextOverlay(ov.id, { pill: e.target.checked })
                  }
                  className="h-4 w-4 accent-[#d9a441]"
                />
                {t.textPill}
              </label>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  useEditorStore.getState().deleteTextOverlay(ov.id);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-xs text-zinc-300 hover:border-red-700 hover:text-red-300"
                aria-label={t.deleteText}
              >
                🗑
              </button>
            </div>
          );
        })}
      </div>
      <div>
        <button
          type="button"
          onClick={() => useEditorStore.getState().addTextOverlay()}
          className="h-9 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 transition hover:border-zinc-500"
          data-testid="add-text"
        >
          ＋ {t.addText}
        </button>
      </div>
    </div>
  );
}
