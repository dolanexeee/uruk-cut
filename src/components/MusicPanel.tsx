"use client";

import { useRef, useState } from "react";
import { useEditorStore } from "../store/editor";
import { dict } from "../i18n";
import { buildMusicTrack } from "../lib/audio";

const inputCls =
  "h-9 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-[#d9a441]";
const numCls = `${inputCls} w-[4.6rem] font-mono`;

export default function MusicPanel() {
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];
  const music = useEditorStore((s) => s.music);
  const keepOriginalAudio = useEditorStore((s) => s.keepOriginalAudio);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const track = await buildMusicTrack(file);
      useEditorStore.getState().setMusic(track);
    } catch {
      setError(t.musicImportError);
    } finally {
      setBusy(false);
    }
  };

  const clampMusic = (patch: Parameters<ReturnType<typeof useEditorStore.getState>["updateMusic"]>[0]) => {
    const st = useEditorStore.getState();
    if (!st.music) return;
    const m = { ...st.music, ...patch };
    m.trimStart = Math.min(Math.max(0, m.trimStart), m.duration - 0.1);
    m.trimEnd = Math.min(Math.max(m.trimStart + 0.1, m.trimEnd), m.duration);
    m.start = Math.max(0, m.start);
    m.volume = Math.min(1, Math.max(0, m.volume));
    m.fadeIn = Math.min(2, Math.max(0, m.fadeIn));
    m.fadeOut = Math.min(2, Math.max(0, m.fadeOut));
    st.updateMusic(m);
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg"
        className="hidden"
        data-testid="music-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      {!music ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-zinc-500">{t.noMusicYet}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="h-9 rounded-md bg-[#d9a441] px-4 text-sm font-semibold text-zinc-950 transition hover:bg-[#e5b354] disabled:opacity-40"
            data-testid="add-music"
          >
            ♪ {t.addMusic}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-zinc-200">
            <span className="text-[#e5b354]">♪</span>
            <span className="truncate font-medium">{music.name}</span>
            <span className="font-mono text-xs text-zinc-500" dir="ltr">
              {music.duration.toFixed(1)}s
            </span>
            <button
              type="button"
              onClick={() => useEditorStore.getState().setMusic(null)}
              className="ms-auto flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-xs text-zinc-300 hover:border-red-700 hover:text-red-300"
              aria-label={t.deleteMusic}
              data-testid="delete-music"
            >
              🗑
            </button>
          </div>

          {/* waveform strip */}
          <div className="flex h-10 items-center gap-[1px] overflow-hidden rounded-md border border-zinc-800 bg-[#121215] px-1" dir="ltr">
            {music.peaks.map((p, i) => (
              <div
                key={i}
                className="min-w-[1px] flex-1 rounded-sm bg-[#d9a441]/70"
                style={{ height: `${Math.max(8, p * 100)}%` }}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              {t.musicStart}
              <input
                type="number"
                className={numCls}
                step={0.1}
                min={0}
                value={Number(music.start.toFixed(2))}
                onChange={(e) => clampMusic({ start: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              {t.musicTrimStart}
              <input
                type="number"
                className={numCls}
                step={0.1}
                min={0}
                value={Number(music.trimStart.toFixed(2))}
                onChange={(e) => clampMusic({ trimStart: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              {t.musicTrimEnd}
              <input
                type="number"
                className={numCls}
                step={0.1}
                min={0}
                value={Number(music.trimEnd.toFixed(2))}
                onChange={(e) => clampMusic({ trimEnd: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              {t.fadeIn}
              <input
                type="number"
                className={numCls}
                step={0.1}
                min={0}
                max={2}
                value={Number(music.fadeIn.toFixed(2))}
                onChange={(e) => clampMusic({ fadeIn: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              {t.fadeOut}
              <input
                type="number"
                className={numCls}
                step={0.1}
                min={0}
                max={2}
                value={Number(music.fadeOut.toFixed(2))}
                onChange={(e) => clampMusic({ fadeOut: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
              {t.musicVolume}
              <span className="flex h-9 items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={music.volume}
                  onChange={(e) => clampMusic({ volume: Number(e.target.value) })}
                  className="w-24 accent-[#d9a441]"
                  dir="ltr"
                  data-testid="music-volume"
                />
                <span className="font-mono text-xs text-zinc-400" dir="ltr">
                  {Math.round(music.volume * 100)}%
                </span>
              </span>
            </label>
          </div>
        </>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={keepOriginalAudio}
          onChange={(e) => useEditorStore.getState().setKeepOriginalAudio(e.target.checked)}
          className="h-4 w-4 accent-[#d9a441]"
          data-testid="keep-original-audio"
        />
        {t.keepOriginalAudio}
      </label>
      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
