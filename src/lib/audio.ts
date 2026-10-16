import type { MusicTrack } from "../store/editor";
import { uid } from "./media";

/** Decode an audio file and compute ~160 normalized peak bars for the timeline. */
export async function buildMusicTrack(file: File): Promise<MusicTrack> {
  const url = URL.createObjectURL(file);
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const channel = buf.getChannelData(0);
    const bars = 160;
    const peaks: number[] = [];
    const per = Math.max(1, Math.floor(channel.length / bars));
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const start = i * per;
      for (let j = start; j < Math.min(channel.length, start + per); j += 16) {
        const v = Math.abs(channel[j]);
        if (v > max) max = v;
      }
      peaks.push(Math.min(1, max));
    }
    // Normalize to the file's own peak so quiet files still draw a waveform.
    const peakMax = Math.max(0.01, ...peaks);
    for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / peakMax;
    return {
      id: uid("mus"),
      name: file.name,
      file,
      url,
      duration: buf.duration,
      start: 0,
      trimStart: 0,
      trimEnd: buf.duration,
      volume: 0.6,
      fadeIn: 0,
      fadeOut: 0,
      peaks,
    };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
