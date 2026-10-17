"use client";

import { useState } from "react";
import { useEditorStore } from "../store/editor";
import { dict } from "../i18n";
import CaptionsPanel from "./CaptionsPanel";
import TextPanel from "./TextPanel";
import MusicPanel from "./MusicPanel";
import AdjustPanel from "./AdjustPanel";

type Tab = "captions" | "text" | "music" | "adjust";

/** Tabbed panel area: captions / text overlays / music / clip adjust (Phase 2–3). */
export default function Panels() {
  const lang = useEditorStore((s) => s.lang);
  const t = dict[lang];
  const [tab, setTab] = useState<Tab>("captions");

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      data-testid={`tab-${id}`}
      className={`h-9 rounded-md px-3.5 text-sm transition ${
        tab === id
          ? "bg-[#d9a441] font-semibold text-zinc-950"
          : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="rounded-lg border border-zinc-800 bg-[#101013] p-3">
      <div className="mb-3 flex flex-wrap gap-2">
        {tabBtn("captions", `CC ${t.tabCaptions}`)}
        {tabBtn("text", `T ${t.tabText}`)}
        {tabBtn("music", `♪ ${t.tabMusic}`)}
        {tabBtn("adjust", `◐ ${t.tabAdjust}`)}
      </div>
      {tab === "captions" && <CaptionsPanel />}
      {tab === "text" && <TextPanel />}
      {tab === "music" && <MusicPanel />}
      {tab === "adjust" && <AdjustPanel />}
    </section>
  );
}
