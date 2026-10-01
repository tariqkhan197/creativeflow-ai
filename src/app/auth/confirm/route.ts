import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/server";
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
    return NextResponse.redirect(new URL(type === "recovery" ? "/reset-password" : next, origin));
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail("link_invalid");
    return NextResponse.redirect(new URL(next, origin));
  }

  return fail("link_invalid");
}
