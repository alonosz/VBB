import { loadSavedModel, type SavedValueModel } from "./savedModel";

/**
 * Where a saved model lives.
 *
 * The downloaded JSON is the real artifact — it is the thing an advertiser
 * keeps, versions, and hands to the next person. The browser copy exists so
 * that coming back tomorrow does not mean finding a file first, which is the
 * difference between a model people actually reuse and one they refit every
 * time out of convenience.
 */

const STORAGE_KEY = "vbb.savedModel.v1";

export function rememberModel(model: SavedValueModel): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch {
    // A private window or a full quota is not worth interrupting the flow for;
    // the downloaded file is the copy that matters.
  }
}

export function recallModel(): SavedValueModel | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return loadSavedModel(JSON.parse(raw)).model;
  } catch {
    return null;
  }
}

export function forgetModel(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

export function modelFilename(model: SavedValueModel): string {
  return `vbb-model-${model.fittedAt.slice(0, 10)}.json`;
}

export function downloadModel(model: SavedValueModel): void {
  const blob = new Blob([JSON.stringify(model, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = modelFilename(model);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function readModelFile(
  file: File
): Promise<{ model: SavedValueModel | null; error: string | null }> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { model: null, error: "That file could not be read." };
  }
  try {
    return loadSavedModel(JSON.parse(text));
  } catch {
    return { model: null, error: "That file isn't valid JSON, so it isn't a saved model." };
  }
}
