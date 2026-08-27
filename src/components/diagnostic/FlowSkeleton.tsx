/**
 * What a diagnostic screen shows for the one render before the saved flow is
 * readable.
 *
 * A skeleton rather than a spinner, and rather than nothing: nothing would
 * flash the page background between a refresh and the work reappearing, which
 * reads as "it lost my file" for exactly as long as it takes to worry.
 */
export function FlowSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="skeleton h-3 w-24 rounded" />
      <div className="skeleton mt-4 h-8 w-2/3 rounded" />
      <div className="skeleton mt-3 h-4 w-full rounded" />
      <div className="skeleton mt-2 h-4 w-5/6 rounded" />
      <div className="skeleton mt-8 h-40 w-full rounded-2xl" />
      <span className="sr-only">Restoring your work…</span>
    </div>
  );
}
