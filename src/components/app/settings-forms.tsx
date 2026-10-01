"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { initialFormState, type FormState } from "@/lib/actions/types";
import { updateProfile, updateWorkspace } from "@/lib/actions/workspace";

function useSuccessToast(state: FormState) {
  useEffect(() => {
    if (state.status === "success" && state.message) toast.success(state.message);
  }, [state]);
}

export function ProfileForm({ fullName, jobTitle, email }: { fullName: string; jobTitle: string; email: string }) {
  const [state, action] = useActionState(updateProfile, initialFormState);
  useSuccessToast(state);
  return (
    <form action={action} className="grid gap-5" noValidate>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Full name"
          name="fullName"
          autoComplete="name"
          defaultValue={state.values?.fullName ?? fullName}
          errors={state.fieldErrors?.fullName}
          required
        />
        <FormField
          label="Job title"
          name="jobTitle"
          placeholder="Creative director"
          defaultValue={state.values?.jobTitle ?? jobTitle}
          errors={state.fieldErrors?.jobTitle}
        />
      </div>
      <FormField label="Email" name="email-readonly" value={email} readOnly disabled hint="Your sign-in email." />
      <div>
        <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
      </div>
    </form>
  );
}

export function WorkspaceForm({ workspaceId, name, canEdit }: { workspaceId: string; name: string; canEdit: boolean }) {
  const [state, action] = useActionState(updateWorkspace, initialFormState);
  useSuccessToast(state);
  return (
    <form action={action} className="grid gap-5" noValidate>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <FormField
        label="Workspace name"
        name="name"
        defaultValue={state.values?.name ?? name}
        errors={state.fieldErrors?.name}
        disabled={!canEdit}
        hint={canEdit ? undefined : "Only owners and admins can rename the workspace."}
        required
      />
      {canEdit ? (
        <div>
          <SubmitButton pendingLabel="Saving…">Save workspace</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
