import { forgetContactEmail } from "@/lib/leads/contactEmail";
import { forgetModel } from "@/lib/model/storage";
import { clearFlow } from "@/lib/state/persist";
import { forgetWorkspaceKey } from "@/lib/workspace/clientKey";

/**
 * Signing out, for a browser that holds a workspace.
 *
 * There is no server session to end: the key in this browser is the whole
 * credential, and the address beside it is what the header greets by. So
 * signing out is forgetting, and it has to forget everything, not just the
 * address. A shared machine that keeps the key stays signed in under another
 * name; one that keeps the saved model prices the next visitor's file on
 * this one's rules; one that keeps the flow shows the last file's rows.
 *
 * Order matters once: the model slot is named after the key, so the model
 * goes before the key does.
 */
export function forgetEverything(): void {
  forgetModel();
  forgetWorkspaceKey();
  forgetContactEmail();
  clearFlow();
}
