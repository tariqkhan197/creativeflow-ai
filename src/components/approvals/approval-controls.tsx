"use client";

import { useState, useTransition } from "react";
import { Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/app/confirm-action";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { cancelApproval, setRevisionStatus } from "@/lib/actions/approvals";
import { REVISION_STATUSES, REVISION_STATUS_LABELS } from "@/lib/validation/approvals";
import type { RevisionStatus } from "@/types/database";

export function CancelApprovalButton({ approvalId, title }: { approvalId: string; title: string }) {
  return (
    <ConfirmAction
      title={`Cancel the approval request “${title}”?`}
      description="The client can no longer approve or request changes on it. The version stays shared."
      confirmLabel="Cancel request"
      action={cancelApproval.bind(null, approvalId)}
      trigger={
        <Button variant="ghost" size="sm">
          <XIcon /> Cancel request
        </Button>
      }
    />
  );
}

export function RevisionStatusSelect({
  revisionId,
  round,
  status,
}: {
  revisionId: string;
  round: number;
  status: RevisionStatus;
}) {
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        aria-label={`Status of revision round ${round}`}
        value={value}
        disabled={pending}
        className="w-36"
        onChange={(e) => {
          const next = e.target.value as RevisionStatus;
          const previous = value;
          setValue(next);
          startTransition(async () => {
            const result = await setRevisionStatus(revisionId, next);
            if (!result.ok) {
              setValue(previous);
              toast.error(result.error);
            }
          });
        }}
      >
        {REVISION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {REVISION_STATUS_LABELS[s]}
          </option>
        ))}
      </NativeSelect>
      {pending ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
    </div>
  );
}
