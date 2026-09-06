/**
 * The caller's address, for the per-caller limits on minting workspaces and
 * recording addresses. First hop only: the rest of an x-forwarded-for chain is
 * written by whoever the request passed through and can say anything.
 */
export function callerIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}
