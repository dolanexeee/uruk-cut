"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useEditorStore,
  type CaptionStyleId,
  type SpeechLang,
  type WhisperModelId,
} from "../store/editor";
import { dict } from "../i18n";
import { cancelTranscription, transcribeAsset } from "../lib/stt";
import { seekTargetForCue } from "../lib/captions";
import { formatTime } from "./Preview";

const inputCls =
  "h-9 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-[#d9a441]";
const numCls = `${inputCls} w-[4.6rem] font-mono`;

const STYLES: CaptionStyleId[] = ["classic", "yellow", "minimal", "karaoke"];

export default function CaptionsPanel() {
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];
  const assets = useEditorStore((s) => s.assets);
  const clips = useEditorStore((s) => s.clips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const captionsByAsset = useEditorStore((s) => s.captionsByAsset);
  const captionsEnabled = useEditorStore((s) => s.captionsEnabled);
  const captionStyle = useEditorStore((s) => s.captionStyle);
  const whisperModel = useEditorStore((s) => s.whisperModel);
  const speechLang = useEditorStore((s) => s.speechLang);
  const captionJob = useEditorStore((s) => s.captionJob);
  const captionError = useEditorStore((s) => s.captionError);
  const selectedCue = useEditorStore((s) => s.selectedCue);

  const [assetId, setAssetId] = useState<string | null>(null);

  // Default target: the selected clip's source, else the first asset.
  useEffect(() => {
    if (assetId && assets.some((a) => a.id === assetId)) return;
    const sel = clips.find((c) => c.id === selectedClipId);
    setAssetId(sel?.sourceId ?? assets[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, clips, selectedClipId]);

  const asset = assets.find((a) => a.id === assetId) || null;
  const cues = useMemo(
    () => [...(asset ? captionsByAsset[asset.id] || [] : [])].sort((a, b) => a.start - b.start),
    [asset, captionsByAsset]
  );
  const busy = captionJob !== null;

  const styleLabel = (id: CaptionStyleId) =>
    id === "classic" ? t.styleClassic : id === "yellow" ? t.styleYellow : id === "minimal" ? t.styleMinimal : t.styleKaraoke;

  const runGenerate = async () => {
    const st = useEditorStore.getState();
    if (!asset || st.captionJob) return;
    st.setCaptionError(null);
    try {
      const result = await transcribeAsset(asset, st.whisperModel, st.speechLang, (job) =>
        useEditorStore.getState().setCaptionJob(job)
      );
      useEditorStore.getState().setAssetCaptions(asset.id, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "cancelled") {
        useEditorStore.getState().setCaptionError(msg);
      }
    } finally {
      useEditorStore.getState().setCaptionJob(null);
    }
  };

  const seekCue = (cueId: string) => {
    const st = useEditorStore.getState();
    if (!asset) return;
    const cue = (st.captionsByAsset[asset.id] || []).find((c) => c.id === cueId);
    if (!cue) return;
    st.selectCue({ assetId: asset.id, cueId });
    const target = seekTargetForCue(st.clips, asset.id, cue, st.project);
    if (target !== null) st.seekTo(target);
  };

  if (assets.length === 0) {
    return <p className="text-sm text-zinc-500">{t.noCuesYet}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          {t.captionsFor}
          <select
            className={inputCls}
            value={asset?.id || ""}
            onChange={(e) => setAssetId(e.target.value)}
            data-testid="caption-asset-select"
          >
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          {t.whisperModel}
          <select
            className={inputCls}
            value={whisperModel}
            onChange={(e) => useEditorStore.getState().setWhisperModel(e.target.value as WhisperModelId)}
            data-testid="whisper-model-select"
          >
            <option value="tiny">{t.modelTiny}</option>
            <option value="base">{t.modelBase}</option>
            <option value="small">{t.modelSmall}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          {t.speechLang}
          <select
            className={inputCls}
            value={speechLang}
            onChange={(e) => useEditorStore.getState().setSpeechLang(e.target.value as SpeechLang)}
            data-testid="speech-lang-select"
          >
            <option value="auto">{t.langAuto}</option>
            <option value="ar">{t.langArabic}</option>
            <option value="en">{t.langEnglish}</option>
          </select>
        </label>
        {!busy ? (
          <button
            type="button"
            onClick={runGenerate}
            disabled={!asset}
            className="h-9 rounded-md bg-[#d9a441] px-4 text-sm font-semibold text-zinc-950 transition hover:bg-[#e5b354] disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="generate-captions"
          >
            {t.generateCaptions}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => cancelTranscription()}
            className="h-9 rounded-md border border-red-800 bg-red-950/50 px-4 text-sm font-semibold text-red-200 transition hover:border-red-600"
            data-testid="cancel-captions"
          >
            {t.cancel}
          </button>
        )}
      </div>

      {busy && captionJob && (
        <div className="rounded-md border border-zinc-800 bg-[#121215] px-3 py-2" data-testid="caption-job">
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span>
              {captionJob.stage === "extract"
                ? t.captionStageExtract
                : captionJob.stage === "download"
                  ? t.captionStageDownload
                  : t.captionStageTranscribe}
            </span>
            <span className="font-mono text-zinc-500" dir="ltr">
              {captionJob.detail}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-[#d9a441] transition-all"
              style={{
                width:
                  captionJob.stage === "download"
                    ? `${Math.round(captionJob.progress * 100)}%`
                    : "100%",
                opacity: captionJob.stage === "download" ? 1 : 0.55,
              }}
            />
          </div>
        </div>
      )}
      {captionError && (
        <div
          className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300"
          data-testid="caption-error"
        >
          {t.captionError}: {captionError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={captionsEnabled}
            onChange={(e) => useEditorStore.getState().setCaptionsEnabled(e.target.checked)}
            className="h-4 w-4 accent-[#d9a441]"
            data-testid="captions-enabled"
          />
          {t.captionsOn}
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-400">{t.captionStyle}</span>
          {STYLES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => useEditorStore.getState().setCaptionStyle(id)}
              data-testid={`caption-style-${id}`}
              className={`h-8 rounded-md border px-2.5 text-xs transition ${
                captionStyle === id
                  ? "border-[#d9a441] bg-[#d9a441]/15 text-[#e5b354]"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              {styleLabel(id)}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-zinc-600">{t.manualCueHint}</p>

      <div className="flex flex-col gap-1.5" data-testid="cue-list">
        {cues.length === 0 && <p className="text-sm text-zinc-500">{t.noCuesYet}</p>}
        {cues.map((cue) => {
          const selected =
            selectedCue && selectedCue.assetId === asset?.id && selectedCue.cueId === cue.id;
          return (
            <div
              key={cue.id}
              data-testid="cue-row"
              data-cue-id={cue.id}
              className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 ${
                selected ? "border-[#d9a441] bg-[#d9a441]/5" : "border-zinc-800 bg-[#121215]"
              }`}
              onClick={() => asset && useEditorStore.getState().selectCue({ assetId: asset.id, cueId: cue.id })}
            >
              <button
                type="button"
                title={formatTime(cue.start)}
                onClick={(e) => {
                  e.stopPropagation();
                  seekCue(cue.id);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-xs text-[#e5b354] hover:border-[#d9a441]"
              >
                ▶
              </button>
              <input
                type="number"
                className={numCls}
                step={0.1}
                min={0}
                value={Number(cue.start.toFixed(2))}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  if (!asset) return;
                  const v = Math.max(0, Number(e.target.value) || 0);
                  useEditorStore.getState().updateCue(asset.id, cue.id, {
                    start: v,
                    end: Math.max(cue.end, v + 0.1),
                    words: undefined,
                  });
                }}
                aria-label={t.cueStart}
              />
              <span className="text-zinc-600">→</span>
              <input
                type="number"
                className={numCls}
                step={0.1}
                min={0}
                value={Number(cue.end.toFixed(2))}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  if (!asset) return;
                  const v = Math.max(cue.start + 0.1, Number(e.target.value) || 0);
                  useEditorStore.getState().updateCue(asset.id, cue.id, { end: v, words: undefined });
                }}
                aria-label={t.cueEnd}
              />
              <input
                type="text"
                className={`${inputCls} min-w-32 flex-1`}
                value={cue.text}
                placeholder={t.cueText}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  if (!asset) return;
                  useEditorStore
                    .getState()
                    .updateCue(asset.id, cue.id, { text: e.target.value, words: undefined });
                }}
                aria-label={t.cueText}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (asset) useEditorStore.getState().deleteCue(asset.id, cue.id);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-xs text-zinc-300 hover:border-red-700 hover:text-red-300"
                aria-label={t.deleteCue}
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
          onClick={() => {
            if (!asset) return;
            const st = useEditorStore.getState();
            const list = st.captionsByAsset[asset.id] || [];
            const last = list.length ? Math.max(...list.map((c) => c.end)) : 0;
            st.addCue(asset.id, last);
          }}
          className="h-9 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 transition hover:border-zinc-500"
          data-testid="add-cue"
        >
          ＋ {t.addCue}
        </button>
      </div>
    </div>
  );
}
