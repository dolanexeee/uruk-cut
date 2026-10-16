"use client";

import { useMemo, useRef } from "react";
import { clipDuration, totalDuration, useEditorStore } from "../store/editor";
import { dict } from "../i18n";

const TRACK_H = 76;
const HANDLE_W = 14;

type DragState =
  | { kind: "trim-left" | "trim-right"; clipId: string; startX: number; origStart: number; origEnd: number; sourceDur: number }
  | { kind: "reorder"; clipId: string; startX: number; moved: boolean }
  | { kind: "scrub"; startX: number }
  | null;

export default function Timeline() {
  const clips = useEditorStore((s) => s.clips);
  const assets = useEditorStore((s) => s.assets);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const playhead = useEditorStore((s) => s.playhead);
  const pxPerSec = useEditorStore((s) => s.pxPerSec);
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState>(null);

  const total = totalDuration(clips);
  const contentW = Math.max(total * pxPerSec + 80, 300);

  const offsets = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const c of clips) {
      arr.push(acc);
      acc += clipDuration(c);
    }
    return arr;
  }, [clips]);

  const assetById = (id: string) => assets.find((a) => a.id === id);

  const xToTime = (clientX: number): number => {
    const el = contentRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    const x = rtl ? rect.right - clientX : clientX - rect.left;
    return Math.min(Math.max(x / pxPerSec, 0), total);
  };

  // ---------- scrub on ruler ----------
  const onRulerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: "scrub", startX: e.clientX };
    useEditorStore.getState().seekTo(xToTime(e.clientX));
  };
  const onRulerMove = (e: React.PointerEvent) => {
    if (drag.current?.kind === "scrub") {
      useEditorStore.getState().seekTo(xToTime(e.clientX));
    }
  };

  // ---------- trim ----------
  const startTrim = (e: React.PointerEvent, clipId: string, side: "left" | "right") => {
    e.stopPropagation();
    const st = useEditorStore.getState();
    const clip = st.clips.find((c) => c.id === clipId);
    const asset = clip ? assetById(clip.sourceId) : undefined;
    if (!clip || !asset) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    st.pushHistory();
    st.selectClip(clipId);
    drag.current = {
      kind: side === "left" ? "trim-left" : "trim-right",
      clipId,
      startX: e.clientX,
      origStart: clip.start,
      origEnd: clip.end,
      sourceDur: asset.duration,
    };
  };
  const onTrimMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || (d.kind !== "trim-left" && d.kind !== "trim-right")) return;
    const rtl = document.documentElement.dir === "rtl";
    let dx = (e.clientX - d.startX) / pxPerSec;
    if (rtl) dx = -dx;
    const st = useEditorStore.getState();
    if (d.kind === "trim-left") {
      const ns = Math.min(Math.max(d.origStart + dx, 0), d.origEnd - 0.1);
      st.trimClip(d.clipId, ns, d.origEnd);
    } else {
      const ne = Math.max(Math.min(d.origEnd + dx, d.sourceDur), d.origStart + 0.1);
      st.trimClip(d.clipId, d.origStart, ne);
    }
  };

  // ---------- select / seek / reorder on clip body ----------
  const onClipDown = (e: React.PointerEvent, clipId: string) => {
    const st = useEditorStore.getState();
    st.selectClip(clipId);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: "reorder", clipId, startX: e.clientX, moved: false };
  };
  const onClipMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== "reorder") return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 7) return;
    if (!d.moved) {
      d.moved = true;
      useEditorStore.getState().pushHistory();
    }
    const st = useEditorStore.getState();
    const idx = st.clips.findIndex((c) => c.id === d.clipId);
    if (idx < 0) return;
    const pointerTime = xToTime(e.clientX);
    // Find the slot the pointer is over in the sequence without the dragged clip.
    const others = st.clips.filter((c) => c.id !== d.clipId);
    let acc = 0;
    let target = others.length;
    for (let i = 0; i < others.length; i++) {
      const mid = acc + clipDuration(others[i]) / 2;
      if (pointerTime < mid) {
        target = i;
        break;
      }
      acc += clipDuration(others[i]);
    }
    if (target !== idx) {
      const next = [...others.slice(0, target), st.clips[idx], ...others.slice(target)];
      st.setClipsLive(next);
    }
  };
  const onClipUp = (e: React.PointerEvent, clipId: string) => {
    const d = drag.current;
    if (d?.kind === "reorder" && !d.moved) {
      // plain click: seek into the clip
      useEditorStore.getState().seekTo(xToTime(e.clientX));
      void clipId;
    }
    drag.current = null;
  };
  const endDrag = () => {
    drag.current = null;
  };

  // ---------- ruler ticks ----------
  const tickStep = pxPerSec >= 40 ? 1 : pxPerSec >= 14 ? 5 : 10;
  const ticks: number[] = [];
  for (let tt = 0; tt <= Math.ceil(total); tt += tickStep) ticks.push(tt);

  return (
    <div className="flex flex-col">
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden rounded-lg border border-zinc-800 bg-[#121215]"
      >
        <div ref={contentRef} className="relative" style={{ width: contentW }}>
          {/* Ruler */}
          <div
            className="relative h-7 cursor-pointer touch-none border-b border-zinc-800"
            onPointerDown={onRulerDown}
            onPointerMove={onRulerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {ticks.map((tt) => (
              <div
                key={tt}
                className="absolute top-0 flex h-full flex-col justify-between"
                style={{ insetInlineStart: tt * pxPerSec }}
              >
                <span className="ps-1 font-mono text-[10px] leading-3 text-zinc-500">
                  {Math.floor(tt / 60)}:{String(tt % 60).padStart(2, "0")}
                </span>
                <span className="block h-1.5 w-px bg-zinc-700" />
              </div>
            ))}
          </div>

          {/* Track */}
          <div
            className="relative"
            style={{ height: TRACK_H }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                useEditorStore.getState().selectClip(null);
                useEditorStore.getState().seekTo(xToTime(e.clientX));
              }
            }}
          >
            {clips.map((clip, i) => {
              const asset = assetById(clip.sourceId);
              if (!asset) return null;
              const dur = clipDuration(clip);
              const w = Math.max(dur * pxPerSec, 8);
              const selected = clip.id === selectedClipId;
              // Filmstrip slots
              const thumbAspect = asset.height > 0 ? asset.width / asset.height : 16 / 9;
              const slotW = Math.max(20, Math.round((TRACK_H - 16) * thumbAspect));
              const slotCount = Math.max(1, Math.ceil(w / slotW));
              const thumbs: string[] = [];
              for (let sIdx = 0; sIdx < slotCount; sIdx++) {
                const frac = slotCount === 1 ? 0 : sIdx / slotCount;
                const srcTime = clip.start + frac * dur;
                const ti =
                  asset.thumbnails.length === 0
                    ? -1
                    : Math.min(
                        asset.thumbnails.length - 1,
                        Math.floor((srcTime / Math.max(asset.duration, 0.01)) * asset.thumbnails.length)
                      );
                thumbs.push(ti >= 0 ? asset.thumbnails[ti] : "");
              }
              return (
                <div
                  key={clip.id}
                  data-testid="clip-block"
                  data-clip-id={clip.id}
                  className={`absolute top-1.5 flex touch-none select-none overflow-hidden rounded-md border bg-zinc-900 ${
                    selected ? "border-[#d9a441] ring-1 ring-[#d9a441]" : "border-zinc-700"
                  }`}
                  style={{ insetInlineStart: offsets[i] * pxPerSec, width: w, height: TRACK_H - 12 }}
                  onPointerDown={(e) => onClipDown(e, clip.id)}
                  onPointerMove={onClipMove}
                  onPointerUp={(e) => onClipUp(e, clip.id)}
                  onPointerCancel={endDrag}
                >
                  <div className="pointer-events-none flex h-full flex-1 overflow-hidden">
                    {thumbs.map((src, sIdx) =>
                      src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={sIdx}
                          src={src}
                          alt=""
                          draggable={false}
                          className="h-full shrink-0 object-cover"
                          style={{ width: slotW }}
                        />
                      ) : (
                        <div key={sIdx} className="h-full shrink-0 bg-zinc-800" style={{ width: slotW }} />
                      )
                    )}
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-200">
                    {asset.name} · {dur.toFixed(1)}s
                  </div>
                  {/* trim handles */}
                  <div
                    data-testid="trim-left"
                    className="absolute inset-y-0 start-0 z-10 cursor-ew-resize touch-none bg-[#d9a441]/0 hover:bg-[#d9a441]/40"
                    style={{ width: HANDLE_W }}
                    onPointerDown={(e) => startTrim(e, clip.id, "left")}
                    onPointerMove={onTrimMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                  <div
                    data-testid="trim-right"
                    className="absolute inset-y-0 end-0 z-10 cursor-ew-resize touch-none bg-[#d9a441]/0 hover:bg-[#d9a441]/40"
                    style={{ width: HANDLE_W }}
                    onPointerDown={(e) => startTrim(e, clip.id, "right")}
                    onPointerMove={onTrimMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                </div>
              );
            })}
            {clips.length === 0 && (
              <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                {t.timeline}
              </div>
            )}
          </div>

          {/* Playhead */}
          {clips.length > 0 && (
            <div
              className="pointer-events-none absolute inset-y-0 z-20"
              style={{ insetInlineStart: playhead * pxPerSec }}
            >
              <div className="absolute inset-y-0 -ms-px w-0.5 bg-[#d9a441]" />
              <div className="absolute -start-[5px] top-0 h-3 w-3 rounded-sm bg-[#d9a441]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
