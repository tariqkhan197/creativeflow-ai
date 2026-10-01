"use client";

import { useActionState } from "react";
import { updatePassword } from "@/lib/actions/auth";
import { initialFormState } from "@/lib/actions/types";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

export function ResetPasswordForm() {
  const [state, action] = useActionState(updatePassword, initialFormState);
  return (
    <form action={action} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      <FormField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.password}
        hint="At least 8 characters, including a letter and a number."
      />
      <FormField
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />
      <SubmitButton size="lg" variant="brand" pendingLabel="Saving…">
        Update password
      </SubmitButton>
    </form>
  );
}
