"use client";

import { useCallback, useRef, useState } from "react";
import { readContactEmail } from "@/lib/leads/contactEmail";
import { SignupModal } from "./SignupModal";

/**
 * "Do this, once the workspace has an owner."
 *
 * `guard(run)` runs the action straight away for somebody signed up, and for
 * everybody else opens the signup over the screen and runs it the moment
 * they are done. Closing the modal drops the action. Render `modal` once,
 * anywhere in the tree.
 */
export function useSignupGate() {
  const [email, setEmail] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readContactEmail()
  );
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const guard = useCallback(
    (run: () => void) => {
      if (email || readContactEmail()) {
        run();
        return;
      }
      pending.current = run;
      setOpen(true);
    },
    [email]
  );

  const close = useCallback(() => {
    pending.current = null;
    setOpen(false);
  }, []);

  const done = useCallback((address: string) => {
    setEmail(address);
    setOpen(false);
    const run = pending.current;
    pending.current = null;
    run?.();
  }, []);

  const modal = <SignupModal open={open} onClose={close} onDone={done} />;
  return { email, guard, modal };
}
