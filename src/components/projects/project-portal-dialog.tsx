"use client";

import { useActionState, useEffect, useState } from "react";
import { SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { FormMessage } from "@/components/forms/form-message";
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
import { updateProjectPortal } from "@/lib/actions/approvals";
import { initialFormState } from "@/lib/actions/types";

type PortalSettings = {
  id: string;
  client_visible: boolean;
  client_summary: string | null;
  allow_client_downloads: boolean;
};

export function ProjectPortalDialog({ project, clientName }: { project: PortalSettings; clientName: string | null }) {
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
        <Button variant="outline" size="sm">
          <SettingsIcon /> Portal settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <PortalForm key={formKey} project={project} clientName={clientName} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PortalForm({
  project,
  clientName,
  onSaved,
}: {
  project: PortalSettings;
  clientName: string | null;
  onSaved: () => void;
}) {
  const [state, action] = useActionState(updateProjectPortal, initialFormState);
  const e = state.fieldErrors ?? {};
  // After a failed submit, show what was submitted (unticked boxes send nothing).
  const submitted = state.status === "error" ? state.values : undefined;
  const checked = (key: string, fallback: boolean) => (submitted ? submitted[key] === "on" : fallback);

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message ?? "Saved");
      onSaved();
    }
  }, [state, onSaved]);

  return (
    <form action={action} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>Client portal</DialogTitle>
        <DialogDescription>
          {clientName
            ? `Choose what ${clientName}'s portal users see. They never see the budget, internal brief, tasks or internal notes.`
            : "This project has no client yet. Choose one with Edit before showing it in the portal."}
        </DialogDescription>
      </DialogHeader>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <input type="hidden" name="projectId" value={project.id} />
      <CheckboxField
        label="Show in the client portal"
        name="clientVisible"
        defaultChecked={checked("clientVisible", project.client_visible)}
        description="Portal users see the project name, status, dates, the summary below and the files you share."
        errors={e.clientVisible}
      />
      <TextareaField
        label="Summary for the client"
        name="clientSummary"
        rows={4}
        maxLength={2000}
        placeholder="What this project delivers, in client-friendly words."
        defaultValue={submitted?.clientSummary ?? project.client_summary ?? ""}
        errors={e.clientSummary}
      />
      <CheckboxField
        label="Allow downloads"
        name="allowClientDownloads"
        defaultChecked={checked("allowClientDownloads", project.allow_client_downloads)}
        description="When off, the portal hides download buttons and refuses download links. Clients can still watch or view shared files, so this can't stop someone recording their screen."
        errors={e.allowClientDownloads}
      />
      <DialogFooter>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </DialogFooter>
    </form>
  );
}
