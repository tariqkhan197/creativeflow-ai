"use client";

import { useState, useTransition } from "react";
import { Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { addProjectMember, removeProjectMember, setProjectStatus } from "@/lib/actions/projects";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@/lib/validation/projects";
import type { ProjectStatus } from "@/types/database";

export function ProjectStatusSelect({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        aria-label="Project status"
        value={value}
        disabled={pending}
        className="w-44"
        onChange={(e) => {
          const next = e.target.value as ProjectStatus;
          const previous = value;
          setValue(next);
          startTransition(async () => {
            const result = await setProjectStatus(projectId, next);
            if (!result.ok) {
              setValue(previous);
              toast.error(result.error);
            }
          });
        }}
      >
        {PROJECT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PROJECT_STATUS_LABELS[s]}
          </option>
        ))}
      </NativeSelect>
      {pending ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
    </div>
  );
}

type Person = { id: string; name: string };

export function AddProjectMember({ projectId, candidates }: { projectId: string; candidates: Person[] }) {
  const [userId, setUserId] = useState("");
  const [pending, startTransition] = useTransition();
  if (candidates.length === 0) {
    return <p className="text-xs text-muted-foreground">Everyone on the team is already on this project.</p>;
  }
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!userId) return;
        startTransition(async () => {
          const result = await addProjectMember(projectId, userId);
          if (!result.ok) toast.error(result.error);
          else setUserId("");
        });
      }}
    >
      <NativeSelect
        aria-label="Add a team member"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        className="flex-1"
      >
        <option value="">Add a team member…</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="outline" size="icon" disabled={!userId || pending} aria-label="Add to project">
        {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
      </Button>
    </form>
  );
}

export function RemoveProjectMember({ projectId, userId, name }: { projectId: string; userId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Remove ${name} from the project`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeProjectMember(projectId, userId);
          if (!result.ok) toast.error(result.error);
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <XIcon />}
    </Button>
  );
}
