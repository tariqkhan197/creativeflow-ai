"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Shows a freshly created one-time invite link with copy, "invite another" and "done" actions. */
export function InviteLinkResult({
  inviteUrl,
  email,
  onAnother,
  onDone,
}: {
  inviteUrl: string;
  email?: string;
  onAnother: () => void;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
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
          Send this link to {email}. It works once, only for that email address, and expires in 7 days. For security it
          is shown only now — if it&apos;s lost, revoke the invitation and create a new one.
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
