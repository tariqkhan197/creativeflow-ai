"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PENDING_INVITE_COOKIE, PENDING_INVITE_COOKIE_OPTIONS } from "@/lib/cookies";
import { isSupabaseConfigured, publicEnv } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/routes";
import { forgotPasswordSchema, resetPasswordSchema, signInSchema, signUpSchema } from "@/lib/validation/auth";
import { echoValues, fieldErrorsFrom, type FormState } from "./types";

const NOT_CONFIGURED: FormState = {
  status: "error",
  message: "Authentication is not available yet: Supabase is not configured. See /setup.",
};

function authErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Please confirm your email address first — check your inbox for the confirmation link.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Try signing in instead.";
    case "weak_password":
      return "That password is too weak. Choose a longer, less common password.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Please wait a minute and try again.";
    case "same_password":
      return "Your new password must be different from the current one.";
    case "signup_disabled":
      return "New sign-ups are currently disabled.";
    default:
      return fallback;
  }
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  const values = echoValues(formData);
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      status: "error",
      message: authErrorMessage(error.code, "Could not sign you in. Please try again."),
      values,
    };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  const values = echoValues(formData);
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  // Only invitation links are honoured as a post-sign-up destination.
  const next = safeRedirectPath(formData.get("next"), "/onboarding");
  const afterSignup = next.startsWith("/invite/") ? next : "/onboarding";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/onboarding`,
    },
  });
  if (error) {
    return {
      status: "error",
      message: authErrorMessage(error.code, "Could not create your account. Please try again."),
      values,
    };
  }

  // Email confirmation disabled in Supabase → the user is signed in already.
  if (data.session) redirect(afterSignup);

  // The confirmation email returns to /auth/confirm; this cookie lets it continue
  // to the invitation when the link is opened in the same browser.
  if (afterSignup !== "/onboarding") {
    (await cookies()).set(PENDING_INVITE_COOKIE, afterSignup, PENDING_INVITE_COOKIE_OPTIONS);
  }

  return {
    status: "success",
    message: `We sent a confirmation link to ${parsed.data.email}. Open it to activate your account.`,
  };
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  const values = echoValues(formData);
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/reset-password`,
  });

  if (error && (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")) {
    return { status: "error", message: authErrorMessage(error.code, ""), values };
  }
  // Network failures and server errors are real failures, not "maybe sent".
  if (error && (!error.status || error.status >= 500)) {
    return {
      status: "error",
      message: "We couldn't reach the authentication service. Please try again in a moment.",
      values,
    };
  }

  // Same response whether or not the account exists, to prevent enumeration.
  return {
    status: "success",
    message: "If an account exists for that email, a password reset link is on its way.",
  };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { status: "error", message: "Your reset link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      status: "error",
      message: authErrorMessage(error.code, "Could not update your password. Please try again."),
    };
  }

  redirect("/app?password=updated");
}

export async function signOut(formData?: FormData): Promise<void> {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  const next = formData ? safeRedirectPath(formData.get("next"), "") : "";
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
}
