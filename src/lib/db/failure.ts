/**
 * Turning a database error into something the operator can act on.
 *
 * A route that lets an exception escape returns whatever the framework's
 * error page is, which is not JSON, so the browser reports it as "could not
 * reach the server" - sending somebody to check their internet connection
 * when the real answer is a migration that was never run. The message below
 * is the whole difference between a five minute fix and an afternoon.
 *
 * Shown only to the operator, who is authenticated before any of this runs
 * and is the one person who can do something about it.
 */

/** PostgREST's ways of saying "that column or table is not there". */
const MISSING_SCHEMA = /does not exist|schema cache|could not find the/i;

export function describeDatabaseFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Postgres messages rarely end in one, and the sentence after this does not
  // read as a sentence without it.
  const message = /[.!?]$/.test(raw.trim()) ? raw.trim() : `${raw.trim()}.`;

  if (MISSING_SCHEMA.test(message)) {
    return (
      `The database is missing something this needs: ${message} ` +
      "That is a migration in supabase/migrations that has not been run on this " +
      "database yet. Run the ones that are missing, newest last, and try again."
    );
  }

  return `The database refused that request: ${message}`;
}
