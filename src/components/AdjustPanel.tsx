"use client";

import { useRef } from "react";
import {
  clipAdjust,
  clipPreset,
  clipSpeed,
  DEFAULT_ADJUST,
  useEditorStore,
  type ClipAdjust,
  type LookPresetId,
} from "../store/editor";
import { LOOK_PRESETS } from "../lib/looks";
import { dict, type DictKey } from "../i18n";

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

const PRESET_LABEL: Record<string, DictKey> = {
  original: "presetOriginal",
  warm: "presetWarm",
  cool: "presetCool",
  vivid: "presetVivid",
  vintage: "presetVintage",
  fade: "presetFade",
  golden: "presetGolden",
  noir: "presetNoir",
  custom: "presetCustom",
};

const chip = (active: boolean) =>
  `h-9 rounded-md px-3 text-sm transition ${
    active
      ? "bg-[#d9a441] font-semibold text-zinc-950"
      : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
  }`;

/** Phase-3 "Adjust" tab: per-clip look (presets or manual sliders) + speed. */
export default function AdjustPanel() {
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];
  const clips = useEditorStore((s) => s.clips);
  const assets = useEditorStore((s) => s.assets);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const historyPushed = useRef(false);

  const clip = clips.find((c) => c.id === selectedClipId) ?? null;
  if (!clip) {
    return <p className="text-sm text-zinc-500">{t.adjustSelectClip}</p>;
  }
  const asset = assets.find((a) => a.id === clip.sourceId);
  const adjust = clipAdjust(clip);
  const preset = clipPreset(clip);
  const speed = clipSpeed(clip);
  const st = useEditorStore.getState();

  const setPreset = (id: LookPresetId) => {
    st.pushHistory();
    st.updateClip(clip.id, { presetId: id });
  };
  const setSlider = (patch: Partial<ClipAdjust>) => {
    // Dragging a slider switches the clip to the manual ("custom") look.
    st.updateClip(clip.id, { adjust: { ...adjust, ...patch }, presetId: "custom" });
  };
  const setSpeed = (v: number) => {
    st.pushHistory();
    st.updateClip(clip.id, { speed: v });
  };

  const slider = (
    label: string,
    key: keyof ClipAdjust,
    min: number,
    max: number,
    testid: string
  ) => (
    <label className="flex items-center gap-3 text-sm text-zinc-300">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={adjust[key]}
        data-testid={testid}
        dir="ltr"
        className="min-w-0 flex-1 accent-[#d9a441]"
        onPointerDown={() => {
          if (!historyPushed.current) {
            historyPushed.current = true;
            st.pushHistory();
          }
        }}
        onPointerUp={() => {
          historyPushed.current = false;
        }}
        onChange={(e) => setSlider({ [key]: Number(e.target.value) })}
      />
      <span className="w-10 shrink-0 text-end font-mono text-xs text-zinc-400" dir="ltr">
        {adjust[key].toFixed(2)}
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="adjust-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-200">{t.adjustClip}</span>
        {asset && (
          <span className="max-w-56 truncate text-xs text-zinc-500">
            {asset.name} · {(clip.end - clip.start).toFixed(1)}s
          </span>
        )}
        <button
          type="button"
          className="ms-auto h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-300 transition hover:border-zinc-500"
          onClick={() => {
            st.pushHistory();
            st.updateClip(clip.id, { presetId: "original", adjust: { ...DEFAULT_ADJUST } });
          }}
        >
          {t.resetLook}
        </button>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-zinc-400">
          {t.lookPreset}
          {preset === "custom" && (
            <span className="ms-2 rounded bg-[#d9a441]/20 px-1.5 py-0.5 text-[11px] text-[#f3cd8a]">
              {t.presetCustom}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LOOK_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid={`preset-${p.id}`}
              className={chip(preset === p.id)}
              onClick={() => setPreset(p.id)}
            >
              {t[PRESET_LABEL[p.id]]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {slider(t.brightness, "brightness", -0.5, 0.5, "slider-brightness")}
        {slider(t.contrast, "contrast", 0.5, 1.5, "slider-contrast")}
        {slider(t.saturation, "saturation", 0, 2, "slider-saturation")}
      </div>

      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-zinc-400">{t.clipSpeed}</div>
        <div className="flex flex-wrap gap-1.5" dir="ltr">
          {SPEEDS.map((v) => (
            <button
              key={v}
              type="button"
              data-testid={`speed-${v}`}
              className={chip(speed === v)}
              onClick={() => setSpeed(v)}
            >
              {v}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
