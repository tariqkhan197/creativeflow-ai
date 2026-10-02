type PgError = { code?: string; message?: string } | null | undefined;

/**
 * Turns a Postgres/PostgREST error into a message that is safe to show users.
 * Our own trigger/RPC exceptions (RAISE ... ) carry human-written messages;
 * everything else falls back to a generic message so internals never leak.
 */
export function dbErrorMessage(error: PgError, fallback: string): string {
  if (!error) return fallback;
  const message = error.message ?? "";
  if (error.code === "P0001") return message; // RAISE EXCEPTION without errcode
  if (
    (error.code === "23514" || error.code === "22023" || error.code === "42501") &&
    !/constraint|policy|permission denied/i.test(message)
  ) {
    return message; // RAISE ... USING errcode = ...
  }
  if (error.code === "42501") return "You don't have permission to do that.";
  return fallback;
}
