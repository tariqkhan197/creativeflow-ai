"use client";

import { useActionState, useState } from "react";
import { CheckIcon, CopyIcon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { createInvitation } from "@/lib/actions/team";
import { initialFormState } from "@/lib/actions/types";
import type { StaffInviteRole } from "@/lib/validation/team";

const ROLE_HELP: Record<StaffInviteRole, string> = {
  admin: "Admin: manages settings, team, clients, projects and finance",
  manager: "Manager: manages clients, projects and invoices",
  member: "Member: works on projects and tasks",
};

export function InviteMemberDialog({ roles }: { roles: StaffInviteRole[] }) {
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
        <Button variant="brand">
          <UserPlusIcon /> Invite people
        </Button>
      </DialogTrigger>
      <DialogContent>
        <InviteForm
          key={formKey}
          roles={roles}
          onDone={() => setOpen(false)}
          onAnother={() => setFormKey((k) => k + 1)}
        />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  roles,
  onDone,
  onAnother,
}: {
  roles: StaffInviteRole[];
  onDone: () => void;
  onAnother: () => void;
}) {
  const [state, action] = useActionState(createInvitation, initialFormState);
  const [copied, setCopied] = useState(false);
  const inviteUrl = state.status === "success" ? state.data?.inviteUrl : undefined;

  if (inviteUrl) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
        toast.success("Invite link copied");
      } catch {
        toast.error("Couldn't copy automatically — select the link and copy it.");
      }
    };
    return (
      <>
        <DialogHeader>
          <DialogTitle>Share the invite link</DialogTitle>
          <DialogDescription>
            Send this link to {state.data?.email}. It works once, only for that email address, and expires in 7 days.
            For security it is shown only now — if it&apos;s lost, revoke the invitation and create a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            readOnly
            value={inviteUrl}
            aria-label="Invite link"
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Copy invite link">
            {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onAnother}>
            Invite someone else
          </Button>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form action={action} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>Invite people</DialogTitle>
        <DialogDescription>They&apos;ll get access to this workspace once they accept.</DialogDescription>
      </DialogHeader>
      <FormMessage state={state} />
      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="off"
        placeholder="colleague@agency.com"
        required
        defaultValue={state.values?.email}
        errors={state.fieldErrors?.email}
      />
      <SelectField
        label="Role"
        name="role"
        defaultValue={state.values?.role ?? "member"}
        errors={state.fieldErrors?.role}
        hint="You can change roles later."
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_HELP[r]}
          </option>
        ))}
      </SelectField>
      <DialogFooter>
        <SubmitButton pendingLabel="Creating link…">Create invite link</SubmitButton>
      </DialogFooter>
    </form>
  );
}
