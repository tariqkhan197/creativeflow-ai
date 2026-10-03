"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { FormField } from "@/components/forms/form-field";
import { FormMessage } from "@/components/forms/form-message";
import { SelectField } from "@/components/forms/select-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { TextareaField } from "@/components/forms/textarea-field";
import { generateScriptAction } from "@/lib/actions/ai-studio";
import { initialFormState } from "@/lib/actions/types";
import type { BriefDefaults } from "@/lib/ai/studio";

type Option = { id: string; name: string };

/**
 * The brief for a new script. Submitting runs the real generation on the
 * server (it can take a minute or two), then opens the result.
 */
export function ScriptBriefForm({
  projects,
  defaults,
  disabledReason,
}: {
  projects: Option[];
  defaults: BriefDefaults;
  /** Why generating isn't possible right now (not configured, limit reached); null when it is. */
  disabledReason: string | null;
}) {
  const [state, action, pending] = useActionState(generateScriptAction, initialFormState);
  const e = state.fieldErrors ?? {};
  const v = (key: keyof BriefDefaults) => state.values?.[key] ?? defaults[key];
  const failedRun = state.status === "error" ? state.data?.generationId : undefined;

  return (
    <form action={action} className="grid gap-5" noValidate aria-describedby="brief-note">
      {disabledReason ? (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          {disabledReason}
        </p>
      ) : null}
      {state.status === "error" ? (
        <div className="grid gap-2">
          <FormMessage state={state} />
          {failedRun ? (
            <Link href={`/app/ai-studio/${failedRun}`} className="text-sm font-medium text-brand hover:underline">
              View the failed run →
            </Link>
          ) : null}
        </div>
      ) : null}

      <fieldset disabled={Boolean(disabledReason) || pending} className="grid gap-5 disabled:opacity-80">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Title"
            name="title"
            maxLength={200}
            placeholder="Spring launch film"
            defaultValue={v("title")}
            errors={e.title}
            hint="Optional. The AI suggests one too."
          />
          <SelectField label="Project" name="projectId" defaultValue={v("projectId")} errors={e.projectId}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
        </div>

        <TextareaField
          label="Brief"
          name="brief"
          rows={6}
          required
          maxLength={4000}
          placeholder="What is the film for, what should people feel and remember, and what must be included?"
          defaultValue={v("brief")}
          errors={e.brief}
        />

        <div className="grid gap-5 sm:grid-cols-3">
          <FormField
            label="Length (seconds)"
            name="durationSeconds"
            type="number"
            inputMode="numeric"
            min={5}
            max={600}
            required
            defaultValue={v("durationSeconds")}
            errors={e.durationSeconds}
          />
          <FormField
            label="Tone"
            name="tone"
            maxLength={100}
            placeholder="Warm, confident"
            defaultValue={v("tone")}
            errors={e.tone}
          />
          <FormField
            label="Platform"
            name="platform"
            maxLength={100}
            placeholder="Instagram Reels"
            defaultValue={v("platform")}
            errors={e.platform}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Audience"
            name="audience"
            maxLength={300}
            placeholder="First-time runners, 25–40"
            defaultValue={v("audience")}
            errors={e.audience}
          />
          <FormField
            label="Call to action"
            name="callToAction"
            maxLength={200}
            placeholder="Find your first pair"
            defaultValue={v("callToAction")}
            errors={e.callToAction}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="brand" disabled={Boolean(disabledReason)} pendingLabel="Generating…">
          <SparklesIcon /> Generate script
        </SubmitButton>
        {pending ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Writing your script. This usually takes under a minute; keep
            this page open.
          </p>
        ) : null}
      </div>
      <p id="brief-note" className="text-xs text-muted-foreground">
        The brief is sent to Anthropic (Claude) to write the script. Don&apos;t include passwords or personal data you
        wouldn&apos;t share with a supplier.
      </p>
    </form>
  );
}
