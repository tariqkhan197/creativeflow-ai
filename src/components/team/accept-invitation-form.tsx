"use client";

import { useActionState } from "react";
import { acceptInvitation } from "@/lib/actions/team";
import { initialFormState } from "@/lib/actions/types";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";

export function AcceptInvitationForm({ token, workspaceName }: { token: string; workspaceName: string }) {
  const [state, action] = useActionState(acceptInvitation, initialFormState);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <SubmitButton size="lg" variant="brand" pendingLabel="Joining…">
        Join {workspaceName}
      </SubmitButton>
    </form>
  );
}
