"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/lib/actions/auth";
import { initialFormState } from "@/lib/actions/types";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

export function LoginForm({ next, disabled }: { next?: string; disabled?: boolean }) {
  const [state, action] = useActionState(signIn, initialFormState);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormField
        label="Work email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@agency.com"
        required
        disabled={disabled}
        defaultValue={state.values?.email}
        errors={state.fieldErrors?.email}
      />
      <FormField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        disabled={disabled}
        errors={state.fieldErrors?.password}
        labelAction={
          <Link href="/forgot-password" className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Forgot password?
          </Link>
        }
      />
      <SubmitButton size="lg" variant="brand" pendingLabel="Signing in…" disabled={disabled}>
        Sign in
      </SubmitButton>
    </form>
  );
}
