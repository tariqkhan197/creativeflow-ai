"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "@/lib/actions/auth";
import { initialFormState } from "@/lib/actions/types";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

export function ForgotPasswordForm({ disabled }: { disabled?: boolean }) {
  const [state, action] = useActionState(requestPasswordReset, initialFormState);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@agency.com"
        required
        disabled={disabled}
        defaultValue={state.values?.email}
        errors={state.fieldErrors?.email}
      />
      <SubmitButton size="lg" variant="brand" pendingLabel="Sending…" disabled={disabled}>
        Send reset link
      </SubmitButton>
    </form>
  );
}
