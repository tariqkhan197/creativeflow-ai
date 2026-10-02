"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { EyeIcon, EyeOffIcon, Loader2Icon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { ApprovalStatusBadge } from "@/components/approvals/approval-badges";
import { CancelApprovalButton } from "@/components/approvals/approval-controls";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextareaField } from "@/components/forms/textarea-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { requestApproval, setAssetShared } from "@/lib/actions/approvals";
import { initialFormState } from "@/lib/actions/types";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import type { ApprovalStatus } from "@/types/database";

export type VersionApproval = {
  id: string;
  title: string;
  message: string | null;
  status: ApprovalStatus;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  dueDate: string | null;
  createdAt: string;
  canCancel: boolean;
};

/** Review page (staff): share this version with the client and request / track its approval. */
export function AssetApprovalPanel({
  assetId,
  defaultTitle,
  shared,
  clientName,
  blockedReason,
  approvals,
}: {
  assetId: string;
  defaultTitle: string;
  shared: boolean;
  clientName: string | null;
  /** Why approval can't be requested (project not in the portal, archived…); null when it can. */
  blockedReason: string | null;
  approvals: VersionApproval[];
}) {
  const [pending, startTransition] = useTransition();
  const open = approvals.find((a) => a.status === "pending");
  const history = approvals.filter((a) => a.status !== "pending");

  const toggleShare = () =>
    startTransition(async () => {
      const result = await setAssetShared(assetId, !shared);
      if (result.ok) toast.success(result.message ?? "Saved");
      else toast.error(result.error);
    });

  return (
    <Card className="gap-3 py-4" data-testid="approval-panel">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Client approval</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            {shared ? (
              <>
                <EyeIcon className="size-4 text-success" /> Shared{clientName ? ` with ${clientName}` : ""}
              </>
            ) : (
              <>
                <EyeOffIcon className="size-4 text-muted-foreground" /> Not shared
              </>
            )}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleShare}
            disabled={pending || (shared && Boolean(open))}
            title={shared && open ? "Cancel the pending approval before unsharing" : undefined}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            {shared ? "Stop sharing" : "Share with client"}
          </Button>
        </div>
        {shared && blockedReason ? <p className="text-xs text-muted-foreground">{blockedReason}</p> : null}

        {open ? (
          <div className="grid gap-1.5 rounded-lg border p-3" data-approval-id={open.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{open.title}</span>
              <ApprovalStatusBadge status="pending" />
            </div>
            {open.message ? <p className="text-xs whitespace-pre-wrap text-muted-foreground">{open.message}</p> : null}
            <p className="text-xs text-muted-foreground">
              Requested by {open.requestedBy} {formatRelativeTime(open.createdAt)}
              {open.dueDate ? ` · due ${formatDate(open.dueDate)}` : ""}
            </p>
            {open.canCancel ? (
              <div>
                <CancelApprovalButton approvalId={open.id} title={open.title} />
              </div>
            ) : null}
          </div>
        ) : blockedReason ? (
          <Button variant="brand" size="sm" disabled title={blockedReason}>
            <SendIcon /> Request approval
          </Button>
        ) : (
          <RequestApprovalDialog
            assetId={assetId}
            defaultTitle={defaultTitle}
            shared={shared}
            clientName={clientName}
          />
        )}
        {!open && blockedReason && !shared ? <p className="text-xs text-muted-foreground">{blockedReason}</p> : null}

        {history.length ? (
          <ul className="grid gap-2 border-t pt-3" aria-label="Earlier approval requests for this version">
            {history.map((a) => (
              <li key={a.id} className="grid gap-1" data-approval-id={a.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{a.title}</span>
                  <ApprovalStatusBadge status={a.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {a.decidedBy ?? "Someone"} · {a.decidedAt ? formatRelativeTime(a.decidedAt) : ""}
                </p>
                {a.decisionNote ? (
                  <p className="rounded-md bg-muted px-2 py-1.5 text-xs whitespace-pre-wrap">{a.decisionNote}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RequestApprovalDialog({
  assetId,
  defaultTitle,
  shared,
  clientName,
}: {
  assetId: string;
  defaultTitle: string;
  shared: boolean;
  clientName: string | null;
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
        <Button variant="brand" size="sm">
          <SendIcon /> Request approval
        </Button>
      </DialogTrigger>
      <DialogContent>
        <RequestApprovalForm
          key={formKey}
          assetId={assetId}
          defaultTitle={defaultTitle}
          shared={shared}
          clientName={clientName}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function RequestApprovalForm({
  assetId,
  defaultTitle,
  shared,
  clientName,
  onDone,
}: {
  assetId: string;
  defaultTitle: string;
  shared: boolean;
  clientName: string | null;
  onDone: () => void;
}) {
  const [state, action] = useActionState(requestApproval, initialFormState);
  const e = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message ?? "Approval requested");
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={action} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>Request approval</DialogTitle>
        <DialogDescription>
          {clientName ? `${clientName}'s portal users` : "The client"} will be notified and can approve this version or
          request changes.
          {shared ? "" : " This version will be shared with them."}
        </DialogDescription>
      </DialogHeader>
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <input type="hidden" name="assetId" value={assetId} />
      <FormField
        label="Title"
        name="title"
        required
        maxLength={200}
        defaultValue={state.values?.title ?? defaultTitle}
        errors={e.title}
      />
      <TextareaField
        label="Message to the client"
        name="message"
        rows={3}
        maxLength={5000}
        placeholder="What should they look at? (optional)"
        defaultValue={state.values?.message ?? ""}
        errors={e.message}
      />
      <FormField
        label="Due date"
        name="dueDate"
        type="date"
        min={new Date().toISOString().slice(0, 10)}
        defaultValue={state.values?.dueDate ?? ""}
        errors={e.dueDate}
        hint="Optional."
      />
      <DialogFooter>
        <SubmitButton pendingLabel="Sending…">Send request</SubmitButton>
      </DialogFooter>
    </form>
  );
}
