import { Suspense } from "react";
import { SignupView } from "@/components/workspace/SignupView";

/** Wrapped in Suspense because `next` is a search param. */
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupView />
    </Suspense>
  );
}
