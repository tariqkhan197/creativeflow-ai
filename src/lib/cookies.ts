export const ACTIVE_WORKSPACE_COOKIE = "cf_workspace";
/** Set during an invite-driven sign-up so the email confirmation returns to the invite. */
export const PENDING_INVITE_COOKIE = "cf_pending_invite";

export const ACTIVE_WORKSPACE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

export const PENDING_INVITE_COOKIE_OPTIONS = {
  ...ACTIVE_WORKSPACE_COOKIE_OPTIONS,
  maxAge: 60 * 60 * 24, // one day
};
