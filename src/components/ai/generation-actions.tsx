"use client";

import { useActionState, useEffect, useState } from "react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/app/confirm-action";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SelectField } from "@/components/forms/select-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteGeneration, updateGenerationDetails } from "@/lib/actions/ai-studio";
import { initialFormState } from "@/lib/actions/types";

type Option = { id: string; name: string };

/** Rename a generation or link it to a project (the creator or a manager). */
export function GenerationDetailsDialog({
  generationId,
  title,
  projectId,
  projects,
}: {
  generationId: string;
  title: string;
  projectId: string;
  projects: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setFormKey((k) => k + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <PencilIcon /> Details
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DetailsForm
          key={formKey}
          generationId={generationId}
          title={title}
          projectId={projectId}
          projects={projects}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DetailsForm({
  generationId,
  title,
  projectId,
  projects,
  onSaved,
}: {
  generationId: string;
  title: string;
  projectId: string;
  projects: Option[];
  onSaved: () => void;
}) {
  const [state, action] = useActionState(updateGenerationDetails, initialFormState);
  const e = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message ?? "Saved");
      onSaved();
    }
  }, [state, onSaved]);

  return (
    <form action={action} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>Script details</DialogTitle>
        <DialogDescription>Name it and link it to a project so the team can find it.</DialogDescription>
      </DialogHeader>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <input type="hidden" name="generationId" value={generationId} />
      <FormField
        label="Title"
        name="title"
        maxLength={200}
        defaultValue={state.values?.title ?? title}
        errors={e.title}
      />
      <SelectField
        label="Project"
        name="projectId"
        defaultValue={state.values?.projectId ?? projectId}
        errors={e.projectId}
      >
        <option value="">No project</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <DialogFooter>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </DialogFooter>
    </form>
  );
}

export function DeleteGenerationButton({ generationId, label }: { generationId: string; label: string }) {
  return (
    <ConfirmAction
      trigger={
        <Button variant="ghost" className="text-destructive">
          <Trash2Icon /> Delete
        </Button>
      }
      title={`Delete ${label}?`}
      description="The script and its edits are removed for everyone in the workspace. Usage already counted against the AI limits stays counted."
      confirmLabel="Delete"
      action={() => deleteGeneration(generationId)}
    />
  );
}
