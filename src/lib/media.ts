import type { SourceAsset } from "../store/editor";

let uidCounter = 0;
export function uid(prefix = "id"): string {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/** Probe duration/dimensions of a video File using a detached <video> element. */
export function probeVideo(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };

    const onLoaded = () => {
      const finish = () => {
        const out = {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        };
        cleanup();
        if (!isFinite(out.duration) || out.duration <= 0 || out.width === 0) {
          reject(new Error("Could not probe video metadata"));
        } else {
          resolve(out);
        }
      };
      // Some WebM files report Infinity duration until a seek happens.
      if (!isFinite(video.duration)) {
        const onDurationChange = () => {
          if (isFinite(video.duration)) {
            video.removeEventListener("durationchange", onDurationChange);
            finish();
          }
        };
        video.addEventListener("durationchange", onDurationChange);
        video.currentTime = Number.MAX_SAFE_INTEGER;
        setTimeout(() => {
          video.removeEventListener("durationchange", onDurationChange);
          finish();
        }, 1500);
      } else {
        finish();
      }
    };

    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener(
      "error",
      () => {
        cleanup();
        reject(new Error("Video failed to load"));
      },
      { once: true }
    );
    video.src = url;
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Seek failed"));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = time;
  });
}

/**
 * Generate filmstrip thumbnails across the whole source duration.
 * Returns JPEG data URLs; `count` frames spaced evenly.
 */
export async function generateThumbnails(
  url: string,
  duration: number,
  width: number,
  height: number,
  count = 24
): Promise<string[]> {
  const thumbs: string[] = [];
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("Thumbnail load failed")), { once: true });
  });

  const thumbH = 56;
  const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
  const thumbW = Math.max(24, Math.round(thumbH * aspect));
  const canvas = document.createElement("canvas");
  canvas.width = thumbW;
  canvas.height = thumbH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return thumbs;

  const n = Math.max(2, Math.min(count, Math.ceil(duration / 0.25)));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * Math.max(0, duration - 0.05);
    try {
      await seekTo(video, Math.min(t, Math.max(0, duration - 0.05)));
      ctx.drawImage(video, 0, 0, thumbW, thumbH);
      thumbs.push(canvas.toDataURL("image/jpeg", 0.55));
    } catch {
      // Skip a failed frame; the filmstrip repeats the nearest available thumb.
    }
  }
  video.removeAttribute("src");
  video.load();
  return thumbs;
}

/** Probe + thumbnail a File into a SourceAsset. */
export async function buildAsset(file: File): Promise<SourceAsset> {
  const url = URL.createObjectURL(file);
  const meta = await probeVideo(url);
  let thumbnails: string[] = [];
  try {
    thumbnails = await generateThumbnails(url, meta.duration, meta.width, meta.height);
  } catch {
    thumbnails = [];
  }
  return {
    id: uid("src"),
    name: file.name,
    file,
    url,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    thumbnails,
  };
}
