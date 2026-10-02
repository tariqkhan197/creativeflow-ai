"use client";

import { useActionState, useEffect, useState } from "react";
import { CheckIcon, PencilLineIcon } from "lucide-react";
import { toast } from "sonner";
import { ApprovalStatusBadge } from "@/components/approvals/approval-badges";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextareaField } from "@/components/forms/textarea-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { decideApproval } from "@/lib/actions/approvals";
import { initialFormState } from "@/lib/actions/types";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import type { ApprovalStatus } from "@/types/database";

export type PortalApproval = {
  id: string;
  title: string;
  message: string | null;
  status: ApprovalStatus;
  requestedBy: string;
  dueDate: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedByMe: boolean;
};

type Mode = "approved" | "changes_requested" | null;

/** Client portal: approve this version or request changes. */
export function DecisionPanel({ pending, history }: { pending: PortalApproval | null; history: PortalApproval[] }) {
  return (
    <Card className="gap-3 py-4" data-testid="decision-panel">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{pending ? "Your approval is requested" : "Approval"}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 text-sm">
        {pending ? (
          <PendingDecision key={pending.id} approval={pending} />
        ) : (
          <p className="text-muted-foreground">
            Nothing to approve on this version right now. You can still leave comments for the team.
          </p>
        )}
        {history.length ? (
          <ul className="grid gap-2 border-t pt-3" aria-label="Earlier decisions on this version">
            {history.map((a) => (
              <li key={a.id} className="grid gap-1" data-approval-id={a.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{a.title}</span>
                  <ApprovalStatusBadge status={a.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {a.decidedByMe ? "You · " : ""}
                  {a.decidedAt ? formatRelativeTime(a.decidedAt) : ""}
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

function PendingDecision({ approval }: { approval: PortalApproval }) {
  const [mode, setMode] = useState<Mode>(null);
  const [state, action] = useActionState(decideApproval, initialFormState);
  const e = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.status === "success") toast.success(state.message ?? "Decision recorded");
  }, [state]);

  if (state.status === "success") {
    return (
      <p role="status" className="text-success">
        {state.message}
      </p>
    );
  }

  return (
    <div className="grid gap-3" data-approval-id={approval.id}>
      <div className="grid gap-1">
        <p className="font-medium">{approval.title}</p>
        {approval.message ? <p className="whitespace-pre-wrap text-muted-foreground">{approval.message}</p> : null}
        <p className="text-xs text-muted-foreground">
          From {approval.requestedBy} · {formatRelativeTime(approval.createdAt)}
          {approval.dueDate ? ` · due ${formatDate(approval.dueDate)}` : ""}
        </p>
      </div>

      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="brand" size="sm" onClick={() => setMode("approved")}>
            <CheckIcon /> Approve
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMode("changes_requested")}>
            <PencilLineIcon /> Request changes
          </Button>
        </div>
      ) : (
        <form action={action} className="grid gap-3" noValidate>
          {state.status === "error" ? <FormMessage state={state} /> : null}
          <input type="hidden" name="approvalId" value={approval.id} />
          <input type="hidden" name="decision" value={mode} />
          <TextareaField
            label={mode === "approved" ? "Note for the team (optional)" : "What should change?"}
            name="note"
            rows={4}
            maxLength={5000}
            required={mode === "changes_requested"}
            placeholder={
              mode === "approved"
                ? "Anything the team should know?"
                : "Describe the changes. Timestamped comments on the file help too."
            }
            defaultValue={state.values?.note ?? ""}
            errors={e.note}
          />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Sending…">
              {mode === "approved" ? "Confirm approval" : "Send change request"}
            </SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>
              Back
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === "approved"
              ? "Approving signs off this version. It can't be undone here; contact the team if you change your mind."
              : "The team starts a new revision round with your notes."}
          </p>
        </form>
      )}
    </div>
  );
}
