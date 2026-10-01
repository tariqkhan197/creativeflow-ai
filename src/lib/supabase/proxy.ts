import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { getSupabasePublicConfig, isSupabaseConfigured } from "@/lib/env/public";
import { AUTH_ROUTES, PROTECTED_PREFIXES } from "@/lib/routes";

/**
 * Refreshes the Supabase session cookie on every matched request and applies
 * coarse route protection. Fine-grained authorisation (workspace membership,
 * roles) happens in server code and in Postgres RLS — never only here.
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isSupabaseConfigured) {
    // Honest setup state: protected areas explain what is missing.
    if (isProtected) {
      const url = request.nextUrl.clone();
      url.pathname = "/setup";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const { url, key } = getSupabasePublicConfig();

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [header, value] of Object.entries(headers ?? {})) response.headers.set(header, value);
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): it validates
  // the JWT and refreshes the session if needed.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);

  const redirectTo = (target: string, params?: Record<string, string>) => {
    const next = request.nextUrl.clone();
    next.pathname = target;
    next.search = "";
    for (const [k, v] of Object.entries(params ?? {})) next.searchParams.set(k, v);
    const redirect = NextResponse.redirect(next);
    // Carry over refreshed auth cookies.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (isProtected && !isSignedIn) {
    return redirectTo("/login", { next: pathname + request.nextUrl.search });
  }

  if (isSignedIn && AUTH_ROUTES.includes(pathname)) {
    return redirectTo("/app");
  }

  return response;
}
