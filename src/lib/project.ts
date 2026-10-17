import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from "fflate";
import {
  DEFAULT_ADJUST,
  DEFAULT_PROJECT,
  clipAdjust,
  clipMuted,
  clipPreset,
  clipSpeed,
  clipVolume,
  overlayAnimation,
  useEditorStore,
  type CaptionCue,
  type Clip,
  type MusicTrack,
  type SourceAsset,
  type TextOverlay,
} from "../store/editor";
import { probeVideo, generateThumbnails } from "./media";
import { buildMusicTrack } from "./audio";

/**
 * Phase 4 — project persistence (#30).
 *
 * A project is a single `.urukcut` file: a ZIP (fflate, stored/no
 * compression — media is already compressed) containing `project.json`
 * plus every media file under `media/`. The JSON carries the full
 * serializable editor state EXCEPT live object URLs / File handles, which
 * are rehydrated from the bundled files on load (assets are re-probed and
 * their filmstrips regenerated, so a project file stays valid even if a
 * probe result was never stored).
 *
 * The same bundle is debounce-saved to IndexedDB on every meaningful state
 * change; on app start the saved bundle (if any) is restored automatically.
 * All storage failures are non-fatal: they surface as a warning banner.
 */

export const PROJECT_FORMAT = "uruk-cut-project";
export const PROJECT_VERSION = 1;
const DB_NAME = "uruk-cut";
const DB_STORE = "kv";
const AUTOSAVE_KEY = "autosave-v1";

/* ---------------- serialization ---------------- */

interface AssetJson {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  file: string; // path inside the zip
}

interface MusicJson extends Omit<MusicTrack, "file" | "url" | "peaks"> {
  file: string;
  peaks: number[];
}

export interface ProjectJson {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
  assets: AssetJson[];
  clips: Clip[];
  captionsByAsset: Record<string, CaptionCue[]>;
  captionsEnabled: boolean;
  captionStyle: string;
  textOverlays: TextOverlay[];
  music: MusicJson | null;
  keepOriginalAudio: boolean;
  project: typeof DEFAULT_PROJECT;
}

function extOf(name: string): string {
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(name);
  return m ? m[1].toLowerCase() : "bin";
}

function serializeClip(c: Clip): Clip {
  return {
    id: c.id,
    sourceId: c.sourceId,
    start: c.start,
    end: c.end,
    speed: clipSpeed(c),
    adjust: { ...clipAdjust(c) },
    presetId: clipPreset(c),
    volume: clipVolume(c),
    muted: clipMuted(c),
  };
}

function serializeOverlay(o: TextOverlay): TextOverlay {
  return { ...o, animation: overlayAnimation(o) };
}

/** Build the (project.json object, zip files) pair from live store state. */
async function buildBundle(): Promise<{ json: ProjectJson; blob: Blob }> {
  const st = useEditorStore.getState();
  const files: Zippable = {};
  const assetsJson: AssetJson[] = [];
  for (const a of st.assets) {
    const path = `media/asset-${a.id}.${extOf(a.name)}`;
    files[path] = [new Uint8Array(await a.file.arrayBuffer()), { level: 0 }];
    assetsJson.push({
      id: a.id,
      name: a.name,
      duration: a.duration,
      width: a.width,
      height: a.height,
      file: path,
    });
  }
  let musicJson: MusicJson | null = null;
  if (st.music) {
    const path = `media/music.${extOf(st.music.name)}`;
    files[path] = [new Uint8Array(await st.music.file.arrayBuffer()), { level: 0 }];
    const { file: _f, url: _u, ...rest } = st.music;
    musicJson = { ...rest, file: path };
  }
  const json: ProjectJson = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    assets: assetsJson,
    clips: st.clips.map(serializeClip),
    captionsByAsset: st.captionsByAsset,
    captionsEnabled: st.captionsEnabled,
    captionStyle: st.captionStyle,
    textOverlays: st.textOverlays.map(serializeOverlay),
    music: musicJson,
    keepOriginalAudio: st.keepOriginalAudio,
    project: { ...st.project },
  };
  files["project.json"] = [strToU8(JSON.stringify(json, null, 1)), { level: 0 }];
  const zipped = zipSync(files);
  return { json, blob: new Blob([zipped as BlobPart], { type: "application/octet-stream" }) };
}

/** Rebuild one asset from its bundled file, preserving the saved id. */
async function restoreAsset(meta: AssetJson, file: File): Promise<SourceAsset> {
  const url = URL.createObjectURL(file);
  let duration = meta.duration;
  let width = meta.width;
  let height = meta.height;
  try {
    const probed = await probeVideo(url);
    duration = probed.duration;
    width = probed.width;
    height = probed.height;
  } catch {
    // Keep the stored metadata if the probe fails in this browser.
  }
  let thumbnails: string[] = [];
  try {
    thumbnails = await generateThumbnails(url, duration, width, height);
  } catch {
    thumbnails = [];
  }
  return { id: meta.id, name: meta.name, file, url, duration, width, height, thumbnails };
}

/** Parse + apply a project bundle (from a .urukcut file or IndexedDB). */
export async function applyBundle(data: Uint8Array | ArrayBuffer): Promise<void> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entries = unzipSync(bytes);
  const jsonEntry = entries["project.json"];
  if (!jsonEntry) throw new Error("project.json missing from bundle");
  const json = JSON.parse(strFromU8(jsonEntry)) as ProjectJson;
  if (json.format !== PROJECT_FORMAT) throw new Error("not an Uruk Cut project");

  const assets: SourceAsset[] = [];
  for (const meta of json.assets || []) {
    const raw = entries[meta.file];
    if (!raw) throw new Error(`media missing from bundle: ${meta.file}`);
    const file = new File([raw as BlobPart], meta.name, { type: "application/octet-stream" });
    assets.push(await restoreAsset(meta, file));
  }
  let music: MusicTrack | null = null;
  if (json.music) {
    const raw = entries[json.music.file];
    if (!raw) throw new Error("music file missing from bundle");
    const file = new File([raw as BlobPart], json.music.name ?? "music", {
      type: "application/octet-stream",
    });
    const built = await buildMusicTrack(file);
    const { file: _path, ...fields } = json.music;
    music = { ...built, ...fields, file, url: built.url };
  }

  const st = useEditorStore.getState();
  for (const a of st.assets) URL.revokeObjectURL(a.url);
  if (st.music) URL.revokeObjectURL(st.music.url);
  useEditorStore.setState({
    assets,
    clips: (json.clips || []).map((c) => ({
      ...c,
      speed: clipSpeed(c),
      adjust: { ...DEFAULT_ADJUST, ...clipAdjust(c) },
      presetId: clipPreset(c),
      volume: clipVolume(c),
      muted: clipMuted(c),
    })),
    selectedClipId: null,
    playhead: 0,
    playing: false,
    past: [],
    future: [],
    clipsVersion: st.clipsVersion + 1,
    captionsByAsset: json.captionsByAsset || {},
    captionsEnabled: json.captionsEnabled !== false,
    captionStyle: (json.captionStyle as never) || "classic",
    textOverlays: (json.textOverlays || []).map((o) => ({
      ...o,
      animation: overlayAnimation(o),
    })),
    selectedTextId: null,
    selectedCue: null,
    music,
    keepOriginalAudio: json.keepOriginalAudio !== false,
    project: { ...DEFAULT_PROJECT, ...(json.project || {}) },
    exportUrl: null,
  });
}

/** Serialize the current state to a downloadable `.urukcut` Blob. */
export async function exportProjectBlob(): Promise<Blob> {
  return (await buildBundle()).blob;
}

/** Reset the editor to an empty project (state + autosave). */
export async function resetProject(): Promise<void> {
  const st = useEditorStore.getState();
  for (const a of st.assets) URL.revokeObjectURL(a.url);
  if (st.music) URL.revokeObjectURL(st.music.url);
  useEditorStore.setState({
    assets: [],
    clips: [],
    selectedClipId: null,
    playhead: 0,
    playing: false,
    past: [],
    future: [],
    clipsVersion: st.clipsVersion + 1,
    captionsByAsset: {},
    textOverlays: [],
    selectedTextId: null,
    selectedCue: null,
    music: null,
    keepOriginalAudio: true,
    project: { ...DEFAULT_PROJECT },
    exportUrl: null,
  });
  await deleteAutosave().catch(() => undefined);
}

/* ---------------- IndexedDB autosave ---------------- */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) {
        req.result.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: Blob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbGet(key: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function deleteAutosave(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(AUTOSAVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function stateSignature(): string {
  const s = useEditorStore.getState();
  return JSON.stringify({
    assets: s.assets.map((a) => [a.id, a.name, a.file.size]),
    clips: s.clips,
    captionsByAsset: s.captionsByAsset,
    captionsEnabled: s.captionsEnabled,
    captionStyle: s.captionStyle,
    textOverlays: s.textOverlays,
    music: s.music
      ? [s.music.id, s.music.file.size, s.music.start, s.music.trimStart, s.music.trimEnd, s.music.volume, s.music.fadeIn, s.music.fadeOut]
      : null,
    keepOriginalAudio: s.keepOriginalAudio,
    project: s.project,
  });
}

function isNonEmptyProject(): boolean {
  const s = useEditorStore.getState();
  return s.assets.length > 0 || s.clips.length > 0;
}

let persistenceStarted = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSignature = "";
let saveInFlight = false;
let saveQueued = false;

async function runAutosave(): Promise<void> {
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  saveInFlight = true;
  try {
    if (!isNonEmptyProject()) {
      await deleteAutosave().catch(() => undefined);
      lastSignature = stateSignature();
      return;
    }
    const { blob } = await buildBundle();
    await idbSet(AUTOSAVE_KEY, blob);
    lastSignature = stateSignature();
    useEditorStore.getState().setStorageWarning(null);
  } catch (err) {
    // Quota / private-mode failures must never break editing.
    console.warn("Uruk Cut autosave failed:", err);
    useEditorStore.getState().setStorageWarning("autosave-failed");
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      void runAutosave();
    }
  }
}

function scheduleAutosave(): void {
  if (stateSignature() === lastSignature) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void runAutosave(), 800);
}

/**
 * App-start entry point (called once from the page): restore the autosaved
 * project if one exists, THEN start watching for changes. The ordering
 * matters — subscribing first would let the initial empty state overwrite
 * the saved bundle before it is read.
 */
export async function initProjectPersistence(): Promise<void> {
  if (persistenceStarted) return;
  persistenceStarted = true;
  try {
    const saved = await idbGet(AUTOSAVE_KEY);
    if (saved && saved.size > 0) {
      await applyBundle(new Uint8Array(await saved.arrayBuffer()));
      useEditorStore.getState().setRestoredNotice(true);
    }
  } catch (err) {
    console.warn("Uruk Cut autosave restore failed:", err);
  }
  lastSignature = stateSignature();
  useEditorStore.subscribe(scheduleAutosave);
}

/** Test/QA helper: force any pending autosave to complete now. */
export async function flushAutosave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await runAutosave();
}
