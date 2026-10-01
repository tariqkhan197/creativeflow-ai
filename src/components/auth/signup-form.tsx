"use client";

import { useActionState } from "react";
import { MailCheckIcon } from "lucide-react";
import { signUp } from "@/lib/actions/auth";
import { initialFormState } from "@/lib/actions/types";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

export function SignupForm({ disabled }: { disabled?: boolean }) {
  const [state, action] = useActionState(signUp, initialFormState);

  if (state.status === "success") {
    return (
      <div className="grid justify-items-center gap-3 rounded-xl border bg-card p-8 text-center" aria-live="polite">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
          <MailCheckIcon className="size-6" />
        </span>
        <h2 className="text-lg font-semibold">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      <FormField
        label="Full name"
        name="fullName"
        autoComplete="name"
        placeholder="Alex Morgan"
        required
        disabled={disabled}
        defaultValue={state.values?.fullName}
        errors={state.fieldErrors?.fullName}
      />
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
        autoComplete="new-password"
        required
        disabled={disabled}
        errors={state.fieldErrors?.password}
        hint="At least 8 characters, including a letter and a number."
      />
      <SubmitButton size="lg" variant="brand" pendingLabel="Creating account…" disabled={disabled}>
        Create account
      </SubmitButton>
    </form>
  );
}
