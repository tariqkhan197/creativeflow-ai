"use client";

import { useActionState, useEffect, useState } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/forms/form-field";
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
import { createClientRecord, updateClientRecord } from "@/lib/actions/clients";
import { initialFormState } from "@/lib/actions/types";

export type ClientFormValues = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

export function ClientFormDialog({ client, trigger }: { client?: ClientFormValues; trigger?: React.ReactNode }) {
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
        {trigger ?? (
          <Button variant={client ? "outline" : "brand"}>
            {client ? <PencilIcon /> : <PlusIcon />} {client ? "Edit" : "New client"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <ClientForm key={formKey} client={client} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ClientForm({ client, onSaved }: { client?: ClientFormValues; onSaved: () => void }) {
  const [state, action] = useActionState(client ? updateClientRecord : createClientRecord, initialFormState);
  const v = (name: keyof ClientFormValues) => state.values?.[name] ?? (client?.[name] as string | null) ?? "";

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message ?? "Saved");
      onSaved();
    }
  }, [state, onSaved]);

  return (
    <form action={action} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{client ? "Edit client" : "New client"}</DialogTitle>
        <DialogDescription>Clients group your projects and invoices.</DialogDescription>
      </DialogHeader>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      {client ? <input type="hidden" name="clientId" value={client.id} /> : null}
      <FormField
        label="Name"
        name="name"
        required
        defaultValue={v("name")}
        errors={state.fieldErrors?.name}
        placeholder="Jordan Lee"
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Company"
          name="company"
          defaultValue={v("company")}
          errors={state.fieldErrors?.company}
          placeholder="Acme Corp"
        />
        <FormField label="Phone" name="phone" type="tel" defaultValue={v("phone")} errors={state.fieldErrors?.phone} />
      </div>
      <FormField
        label="Email"
        name="email"
        type="email"
        defaultValue={v("email")}
        errors={state.fieldErrors?.email}
        placeholder="jordan@acme.com"
      />
      <TextareaField label="Notes" name="notes" defaultValue={v("notes")} errors={state.fieldErrors?.notes} rows={3} />
      <DialogFooter>
        <SubmitButton pendingLabel="Saving…">{client ? "Save changes" : "Add client"}</SubmitButton>
      </DialogFooter>
    </form>
  );
}
