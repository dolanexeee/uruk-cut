"use client";

import { useEffect, useRef } from "react";
import {
  clipDuration,
  locateTime,
  totalDuration,
  useEditorStore,
} from "../store/editor";
import { dict } from "../i18n";

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export default function Preview() {
  const clips = useEditorStore((s) => s.clips);
  const assets = useEditorStore((s) => s.assets);
  const playing = useEditorStore((s) => s.playing);
  const playhead = useEditorStore((s) => s.playhead);
  const seekNonce = useEditorStore((s) => s.seekNonce);
  const clipsVersion = useEditorStore((s) => s.clipsVersion);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const seekTo = useEditorStore((s) => s.seekTo);
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loadedClipId = useRef<string | null>(null);
  const loadedSrc = useRef<string | null>(null);
  const rafRef = useRef<number>(0);

  const total = totalDuration(clips);
  const assetById = (id: string) => assets.find((a) => a.id === id);

  /** Align the <video> element to the store playhead. */
  const align = (autoplay: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    const st = useEditorStore.getState();
    const loc = locateTime(st.clips, st.playhead);
    if (!loc) {
      video.removeAttribute("src");
      loadedClipId.current = null;
      loadedSrc.current = null;
      return;
    }
    const asset = assetById(loc.clip.sourceId);
    if (!asset) return;
    const targetTime = loc.clip.start + loc.offsetInClip;
    const needsLoad = loadedClipId.current !== loc.clip.id || loadedSrc.current !== asset.url;
    if (needsLoad) {
      loadedClipId.current = loc.clip.id;
      loadedSrc.current = asset.url;
      if (video.getAttribute("src") !== asset.url) video.src = asset.url;
      const onMeta = () => {
        video.currentTime = targetTime;
        if (autoplay) video.play().catch(() => undefined);
      };
      if (video.readyState >= 1) {
        video.currentTime = targetTime;
        if (autoplay) video.play().catch(() => undefined);
      } else {
        video.addEventListener("loadedmetadata", onMeta, { once: true });
      }
    } else {
      if (Math.abs(video.currentTime - targetTime) > 0.04) video.currentTime = targetTime;
      if (autoplay && video.paused) video.play().catch(() => undefined);
      if (!autoplay && !video.paused) video.pause();
    }
  };

  // Re-align on explicit seeks and on any edit to the clips array.
  useEffect(() => {
    align(useEditorStore.getState().playing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekNonce, clipsVersion]);

  // Play/pause transport.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      if (clips.length > 0 && totalDuration(clips) - useEditorStore.getState().playhead < 0.05) {
        seekTo(0);
      }
      align(true);
    } else {
      video.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Playback loop: sync playhead from the video clock, advance across clips.
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const video = videoRef.current;
      const st = useEditorStore.getState();
      if (video && loadedClipId.current) {
        const loc = locateTime(st.clips, st.playhead);
        const cur = st.clips.find((c) => c.id === loadedClipId.current);
        if (cur) {
          const idx = st.clips.indexOf(cur);
          let before = 0;
          for (let i = 0; i < idx; i++) before += clipDuration(st.clips[i]);
          if (video.currentTime >= cur.end - 0.02) {
            const next = st.clips[idx + 1];
            if (next) {
              loadedClipId.current = null; // force reload in align
              st.setPlayhead(before + clipDuration(cur) + 0.001);
              align(true);
            } else {
              st.setPlayhead(totalDuration(st.clips));
              st.setPlaying(false);
            }
          } else {
            st.setPlayhead(before + Math.max(0, video.currentTime - cur.start));
          }
          void loc;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, clipsVersion]);

  const togglePlay = () => {
    if (clips.length === 0) return;
    setPlaying(!playing);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-lg border border-zinc-800 bg-black">
        <div className="aspect-video w-full">
          <video
            ref={videoRef}
            className="h-full w-full object-contain"
            playsInline
            preload="auto"
            onClick={togglePlay}
          />
        </div>
        {clips.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
            {t.tagline}
          </div>
        )}
      </div>
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={clips.length === 0}
          aria-label={playing ? t.pause : t.play}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#d9a441] text-lg text-zinc-950 transition hover:bg-[#e5b354] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="font-mono text-sm text-zinc-300" dir="ltr">
          {formatTime(playhead)} <span className="text-zinc-600">/</span> {formatTime(total)}
        </div>
        <div className="ms-auto text-xs text-zinc-500">
          {clips.length} {t.clips} · {t.total} {formatTime(total)}
        </div>
      </div>
    </div>
  );
}
