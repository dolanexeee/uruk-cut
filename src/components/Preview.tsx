"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  clipDuration,
  locateTime,
  musicDuration,
  totalDuration,
  useEditorStore,
  type CaptionCue,
} from "../store/editor";
import { dict } from "../i18n";

const CAPTION_FONT_STACK = '"Noto Sans Arabic", "Inter", system-ui, sans-serif';

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
  const captionsByAsset = useEditorStore((s) => s.captionsByAsset);
  const captionsEnabled = useEditorStore((s) => s.captionsEnabled);
  const captionStyle = useEditorStore((s) => s.captionStyle);
  const textOverlays = useEditorStore((s) => s.textOverlays);
  const music = useEditorStore((s) => s.music);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameH, setFrameH] = useState(0);

  // Measure the preview frame so overlay font sizes scale like the export's
  // (ASS sizes are fractions of frame height).
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameH(el.clientHeight));
    ro.observe(el);
    setFrameH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  /** Sync the music <audio> element to a timeline position. */
  const syncMusic = (tPos: number, autoplay: boolean) => {
    const a = audioRef.current;
    const m = useEditorStore.getState().music;
    if (!a) return;
    if (!m) {
      if (!a.paused) a.pause();
      return;
    }
    const dur = musicDuration(m);
    const local = tPos - m.start;
    if (local < 0 || local > dur) {
      if (!a.paused) a.pause();
      return;
    }
    const target = m.trimStart + local;
    if (Math.abs(a.currentTime - target) > 0.35) {
      try {
        a.currentTime = target;
      } catch {
        // metadata not ready yet; next tick retries
      }
    }
    let fade = 1;
    if (m.fadeIn > 0.01) fade = Math.min(fade, Math.max(0, local / m.fadeIn));
    if (m.fadeOut > 0.01) fade = Math.min(fade, Math.max(0, (dur - local) / m.fadeOut));
    a.volume = Math.min(1, Math.max(0, m.volume * fade));
    if (autoplay && a.paused) a.play().catch(() => undefined);
    if (!autoplay && !a.paused) a.pause();
  };
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
      syncMusic(useEditorStore.getState().playhead, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Keep the music element aligned after seeks / music edits while paused.
  useEffect(() => {
    if (!useEditorStore.getState().playing) {
      syncMusic(useEditorStore.getState().playhead, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekNonce, music]);

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
          syncMusic(st.playhead, true);
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

  // Active caption cue + text overlays at the current playhead.
  const locNow = locateTime(clips, playhead);
  const assetTime = locNow ? locNow.clip.start + locNow.offsetInClip : 0;
  const activeCue: CaptionCue | undefined =
    captionsEnabled && locNow
      ? (captionsByAsset[locNow.clip.sourceId] || []).find(
          (c) => assetTime >= c.start && assetTime < c.end && c.text.trim().length > 0
        )
      : undefined;
  const activeOverlays = textOverlays.filter(
    (o) => o.text.trim().length > 0 && playhead >= o.start && playhead < o.start + o.duration
  );
  const captionFontPx = Math.max(12, frameH * 0.052);

  const captionBox = (() => {
    if (!activeCue) return null;
    const base: CSSProperties = {
      fontFamily: CAPTION_FONT_STACK,
      fontSize: captionFontPx,
      lineHeight: 1.25,
    };
    if (captionStyle === "karaoke" && activeCue.words && activeCue.words.length > 0) {
      return (
        <div
          data-testid="caption-overlay"
          className="rounded-md bg-black/70 px-3 py-1 text-center font-bold text-white"
          style={base}
        >
          {activeCue.words.map((w, i) => (
            <span key={i} style={{ color: assetTime >= w.start ? "#d9a441" : "#ffffff" }}>
              {w.word}
              {i < (activeCue.words?.length || 0) - 1 ? " " : ""}
            </span>
          ))}
        </div>
      );
    }
    if (captionStyle === "yellow") {
      return (
        <div
          data-testid="caption-overlay"
          className="text-center font-bold text-[#ffe600]"
          style={{
            ...base,
            textShadow:
              "2px 2px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 0 2px 6px rgba(0,0,0,.6)",
          }}
        >
          {activeCue.text}
        </div>
      );
    }
    if (captionStyle === "minimal") {
      return (
        <div
          data-testid="caption-overlay"
          className="text-center text-white"
          style={{ ...base, textShadow: "0 1px 8px rgba(0,0,0,.9), 0 0 2px rgba(0,0,0,.9)" }}
        >
          {activeCue.text}
        </div>
      );
    }
    return (
      <div
        data-testid="caption-overlay"
        className="rounded-md bg-black/70 px-3 py-1 text-center font-bold text-white"
        style={base}
      >
        {activeCue.text}
      </div>
    );
  })();

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={frameRef}
        className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-lg border border-zinc-800 bg-black"
      >
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
        {/* Text overlays */}
        {activeOverlays.map((o) => (
          <div
            key={o.id}
            data-testid="text-overlay-preview"
            className="pointer-events-none absolute inset-x-0 flex justify-center px-4"
            style={
              o.position === "top"
                ? { top: "4%" }
                : o.position === "bottom"
                  ? { bottom: "13%" }
                  : { top: "50%", transform: "translateY(-50%)" }
            }
          >
            <div
              className={`text-center ${o.pill ? "rounded-md bg-black/60 px-3 py-1" : ""}`}
              style={{
                fontFamily: CAPTION_FONT_STACK,
                fontSize: Math.max(11, frameH * o.size),
                fontWeight: o.bold ? 700 : 400,
                color: o.color,
                lineHeight: 1.25,
                textShadow: o.pill ? undefined : "0 1px 6px rgba(0,0,0,.85)",
              }}
            >
              {o.text}
            </div>
          </div>
        ))}
        {/* Caption line */}
        {captionBox && (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center px-4" style={{ bottom: "4.5%" }}>
            {captionBox}
          </div>
        )}
        {/* Music element (preview only; export mixes with ffmpeg) */}
        <audio ref={audioRef} src={music?.url} preload="auto" className="hidden" />
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
