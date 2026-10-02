import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/server";
import { PENDING_INVITE_COOKIE } from "@/lib/cookies";
import { safeRedirectPath } from "@/lib/routes";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Landing point for links in Supabase auth emails (sign-up confirmation,
 * password recovery, email change). Supports both the token-hash template
 * (recommended, works across browsers) and the default PKCE `?code=` flow.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeRedirectPath(searchParams.get("next"), "/app");
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, origin));

  if (!isSupabaseConfigured) return NextResponse.redirect(new URL("/setup", origin));

  const supabase = await createClient();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return fail("link_invalid");
    if (type === "recovery") return NextResponse.redirect(new URL("/reset-password", origin));
    return continueTo(request, next, origin);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail("link_invalid");
    return continueTo(request, next, origin);
  }

  return fail("link_invalid");
}

/** After confirming a sign-up, resume a pending invitation if one was started in this browser. */
function continueTo(request: NextRequest, next: string, origin: string) {
  const pending = safeRedirectPath(request.cookies.get(PENDING_INVITE_COOKIE)?.value, "");
  const target = pending.startsWith("/invite/") ? pending : next;
  const response = NextResponse.redirect(new URL(target, origin));
  if (pending) response.cookies.delete(PENDING_INVITE_COOKIE);
  return response;
}
