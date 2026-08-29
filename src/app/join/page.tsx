import { Suspense } from "react";
import { JoinView } from "@/components/workspace/JoinView";

/**
 * The link the customer clicks.
 *
 * Wrapped in Suspense because the token is a search param, and reading one
 * opts the page into client-side rendering - without a boundary the whole
 * route would have to be dynamic.
 */
export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinView />
    </Suspense>
  );
}
