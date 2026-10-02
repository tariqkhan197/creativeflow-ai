"use client";

import { useActionState, useState } from "react";
import { UserPlusIcon } from "lucide-react";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { InviteLinkResult } from "@/components/team/invite-link-result";
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
import { createClientInvitation } from "@/lib/actions/portal-access";
import { initialFormState } from "@/lib/actions/types";

export function ClientInviteDialog({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  // Remount the form on every open so a previous result never lingers.
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
          <UserPlusIcon /> Invite to portal
        </Button>
      </DialogTrigger>
      <DialogContent>
        <ClientInviteForm
          key={formKey}
          clientId={clientId}
          clientName={clientName}
          onDone={() => setOpen(false)}
          onAnother={() => setFormKey((k) => k + 1)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ClientInviteForm({
  clientId,
  clientName,
  onDone,
  onAnother,
}: {
  clientId: string;
  clientName: string;
  onDone: () => void;
  onAnother: () => void;
}) {
  const [state, action] = useActionState(createClientInvitation, initialFormState);
  const inviteUrl = state.status === "success" ? state.data?.inviteUrl : undefined;
  if (inviteUrl) {
    return <InviteLinkResult inviteUrl={inviteUrl} email={state.data?.email} onAnother={onAnother} onDone={onDone} />;
  }

  return (
    <form action={action} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>Invite to the client portal</DialogTitle>
        <DialogDescription>
          They&apos;ll see only {clientName}&apos;s projects that you show in the portal, the files you share, and
          non-internal comments. They can comment and approve or request changes.
        </DialogDescription>
      </DialogHeader>
      <FormMessage state={state} />
      <input type="hidden" name="clientId" value={clientId} />
      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="off"
        placeholder="contact@client.com"
        required
        defaultValue={state.values?.email}
        errors={state.fieldErrors?.email}
      />
      <DialogFooter>
        <SubmitButton pendingLabel="Creating link…">Create invite link</SubmitButton>
      </DialogFooter>
    </form>
  );
}
