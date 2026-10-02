"use client";

import { useActionState, useEffect, useState } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SelectField } from "@/components/forms/select-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextareaField } from "@/components/forms/textarea-field";
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
import { createProject, updateProject } from "@/lib/actions/projects";
import { initialFormState } from "@/lib/actions/types";
import {
  PROJECT_PRIORITIES,
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
} from "@/lib/validation/projects";
import type { Project } from "@/types/database";

type Option = { id: string; name: string };

export function ProjectFormDialog({
  project,
  clients,
  defaultCurrency,
  defaultClientId,
  defaultOpen = false,
}: {
  project?: Project;
  clients: Option[];
  defaultCurrency: string;
  defaultClientId?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
        <Button variant={project ? "outline" : "brand"}>
          {project ? <PencilIcon /> : <PlusIcon />} {project ? "Edit" : "New project"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <ProjectForm
          key={formKey}
          project={project}
          clients={clients}
          defaultCurrency={defaultCurrency}
          defaultClientId={defaultClientId}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function centsToInput(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function ProjectForm({
  project,
  clients,
  defaultCurrency,
  defaultClientId,
  onSaved,
}: {
  project?: Project;
  clients: Option[];
  defaultCurrency: string;
  defaultClientId?: string;
  onSaved: () => void;
}) {
  const [state, action] = useActionState(project ? updateProject : createProject, initialFormState);
  const e = state.fieldErrors ?? {};
  const v = (key: string, fallback: string) => state.values?.[key] ?? fallback;

  useEffect(() => {
    // createProject redirects to the new project; updateProject returns success.
    if (state.status === "success") {
      toast.success(state.message ?? "Saved");
      onSaved();
    }
  }, [state, onSaved]);

  return (
    <form action={action} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
        <DialogDescription>
          {project ? "Update the project details." : "Set up the brief, timing and budget."}
        </DialogDescription>
      </DialogHeader>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      {project ? <input type="hidden" name="projectId" value={project.id} /> : null}

      <FormField
        label="Project name"
        name="name"
        required
        defaultValue={v("name", project?.name ?? "")}
        errors={e.name}
        placeholder="Spring launch film"
      />

      <div className="grid gap-5 sm:grid-cols-3">
        <SelectField
          label="Client"
          name="clientId"
          defaultValue={v("clientId", project?.client_id ?? defaultClientId ?? "")}
          errors={e.clientId}
        >
          <option value="">No client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Status"
          name="status"
          defaultValue={v("status", project?.status ?? "planning")}
          errors={e.status}
        >
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Priority"
          name="priority"
          defaultValue={v("priority", project?.priority ?? "medium")}
          errors={e.priority}
        >
          {PROJECT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PROJECT_PRIORITY_LABELS[p]}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Start date"
          name="startDate"
          type="date"
          defaultValue={v("startDate", project?.start_date ?? "")}
          errors={e.startDate}
        />
        <FormField
          label="Due date"
          name="dueDate"
          type="date"
          defaultValue={v("dueDate", project?.due_date ?? "")}
          errors={e.dueDate}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
        <FormField
          label="Budget"
          name="budget"
          inputMode="decimal"
          placeholder="25,000"
          defaultValue={v("budget", centsToInput(project?.budget_cents ?? null))}
          errors={e.budget}
          hint="Optional. Used later for invoicing and analytics."
        />
        <FormField
          label="Currency"
          name="currency"
          maxLength={3}
          defaultValue={v("currency", project?.currency ?? defaultCurrency)}
          errors={e.currency}
        />
      </div>

      <TextareaField
        label="Brief / description"
        name="description"
        rows={4}
        defaultValue={v("description", project?.description ?? "")}
        errors={e.description}
      />

      <DialogFooter>
        <SubmitButton pendingLabel={project ? "Saving…" : "Creating…"}>
          {project ? "Save changes" : "Create project"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
