import { loadSavedModel, type SavedValueModel } from "./savedModel";
import { readWorkspaceKey } from "@/lib/workspace/clientKey";

/**
 * Where a saved model lives.
 *
 * The downloaded JSON is the real artifact - it is the thing an advertiser
 * keeps, versions, and hands to the next person. The browser copy exists so
 * that coming back tomorrow does not mean finding a file first, which is the
 * difference between a model people actually reuse and one they refit every
 * time out of convenience.
 *
 * Scoped per workspace, because the browser copy was one fixed key. An
 * operator onboarding five customers from one laptop would overwrite each
 * customer's model with the next, and the symptom - the wrong multipliers
 * quietly applied to the wrong advertiser - is one nobody would catch by
 * looking at the screen.
 */

const LEGACY_KEY = "vbb.savedModel.v1";

/**
 * Which slot this browser is writing to.
 *
 * Derived from the workspace key rather than being the key, so a stored model
 * cannot be read back into a credential. Anyone with the storage already has
 * the key sitting beside it - this is about not colliding, not about secrecy.
 */
function slot(): string {
  try {
    const key = readWorkspaceKey();
    if (!key) return LEGACY_KEY;
    // The last twelve characters distinguish workspaces without reproducing
    // the credential in a second place.
    return `vbb.savedModel.v1.${key.slice(-12)}`;
  } catch {
    return LEGACY_KEY;
  }
}

export function rememberModel(model: SavedValueModel): void {
  try {
    localStorage.setItem(slot(), JSON.stringify(model));
  } catch {
    // A private window or a full quota is not worth interrupting the flow for;
    // the downloaded file is the copy that matters.
  }
}

export function recallModel(): SavedValueModel | null {
  try {
    const key = slot();
    // Falls back to the unscoped slot once, so a model saved before scoping
    // existed is not silently lost on the next visit.
    const raw = localStorage.getItem(key) ?? (key === LEGACY_KEY ? null : localStorage.getItem(LEGACY_KEY));
    if (!raw) return null;
    return loadSavedModel(JSON.parse(raw)).model;
  } catch {
    return null;
  }
}

export function forgetModel(): void {
  try {
    localStorage.removeItem(slot());
    // The unscoped copy goes too, or it would be recalled again by the
    // fallback above.
    localStorage.removeItem(LEGACY_KEY);
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
