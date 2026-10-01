"use client";

import { useActionState, useState } from "react";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { initialFormState } from "@/lib/actions/types";
import { createWorkspace } from "@/lib/actions/workspace";
import { slugify } from "@/lib/validation/workspace";

export function CreateWorkspaceForm() {
  const [state, action] = useActionState(createWorkspace, initialFormState);
  const [name, setName] = useState(state.values?.name ?? "");
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(state.values?.slug));

  return (
    <form action={action} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      <FormField
        label="Agency or team name"
        name="name"
        placeholder="Northlight Studio"
        autoComplete="organization"
        required
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugEdited) setSlug(slugify(e.target.value));
        }}
        errors={state.fieldErrors?.name}
      />
      <FormField
        label="Workspace URL"
        name="slug"
        placeholder="northlight-studio"
        required
        value={slug}
        onChange={(e) => {
          setSlugEdited(true);
          setSlug(e.target.value.toLowerCase());
        }}
        errors={state.fieldErrors?.slug}
        hint="Lowercase letters, numbers and hyphens. Used in links you share with clients."
      />
      <SubmitButton size="lg" variant="brand" pendingLabel="Creating workspace…">
        Create workspace
      </SubmitButton>
    </form>
  );
}
