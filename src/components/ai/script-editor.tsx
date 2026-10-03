"use client";

import { useState, useTransition } from "react";
import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveScriptDocument } from "@/lib/actions/ai-studio";
import { formatSeconds } from "@/lib/ai/studio";
import type { ScriptOutput } from "@/lib/ai/script-schema";

type Scene = ScriptOutput["scenes"][number];
/** Editable copy: optional texts are strings here and become null when empty on save. */
type DraftScene = Omit<Scene, "seconds" | "voiceover" | "onScreenText" | "audio"> & {
  key: number;
  seconds: string;
  voiceover: string;
  onScreenText: string;
  audio: string;
};
type Draft = { title: string; logline: string; scenes: DraftScene[] };

let nextKey = 1;
const toDraft = (s: ScriptOutput): Draft => ({
  title: s.title,
  logline: s.logline,
  scenes: s.scenes.map((sc) => ({
    ...sc,
    key: nextKey++,
    seconds: String(sc.seconds),
    voiceover: sc.voiceover ?? "",
    onScreenText: sc.onScreenText ?? "",
    audio: sc.audio ?? "",
    dialogue: sc.dialogue.map((d) => ({ ...d })),
  })),
});
const blank = (v: string) => (v.trim() ? v.trim() : null);
const fromDraft = (d: Draft) => ({
  title: d.title.trim(),
  logline: d.logline.trim(),
  scenes: d.scenes.map((sc) => ({
    heading: sc.heading.trim(),
    seconds: Number(sc.seconds),
    visuals: sc.visuals.trim(),
    voiceover: blank(sc.voiceover),
    dialogue: sc.dialogue.map((l) => ({ speaker: l.speaker.trim(), line: l.line.trim() })),
    onScreenText: blank(sc.onScreenText),
    audio: blank(sc.audio),
  })),
});

/**
 * Shows a script and, for its creator or a manager, edits it in place: text,
 * scene lengths, dialogue, adding, removing and reordering scenes. Saving
 * stores the edited version; the model's original output is kept.
 */
export function ScriptEditor({
  generationId,
  script,
  canEdit,
}: {
  generationId: string;
  script: ScriptOutput;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  if (!draft) {
    return (
      <div className="grid gap-4">
        {canEdit ? (
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setDraft(toDraft(script))}>
              <PencilIcon /> Edit script
            </Button>
          </div>
        ) : null}
        <ScriptView script={script} />
      </div>
    );
  }

  const total = draft.scenes.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0);
  const setScene = (index: number, patch: Partial<DraftScene>) =>
    setDraft({ ...draft, scenes: draft.scenes.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const move = (index: number, by: number) => {
    const scenes = [...draft.scenes];
    const [scene] = scenes.splice(index, 1);
    scenes.splice(index + by, 0, scene);
    setDraft({ ...draft, scenes });
  };

  const save = () =>
    startSaving(async () => {
      setErrors(null);
      const result = await saveScriptDocument(generationId, fromDraft(draft));
      if (!result.ok) {
        setErrors(result.error);
        return;
      }
      toast.success(result.message ?? "Script saved.");
      setDraft(null);
    });

  return (
    <form
      className="grid gap-5"
      aria-label="Edit script"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {errors ? (
        <Alert variant="destructive">
          <AlertDescription>{errors}</AlertDescription>
        </Alert>
      ) : null}
      <fieldset disabled={saving} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="script-title">Script title</Label>
          <Input
            id="script-title"
            value={draft.title}
            maxLength={200}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="script-logline">Logline</Label>
          <Textarea
            id="script-logline"
            rows={2}
            value={draft.logline}
            maxLength={500}
            onChange={(e) => setDraft({ ...draft, logline: e.target.value })}
          />
        </div>

        <ol className="grid gap-4" aria-label="Scenes">
          {draft.scenes.map((scene, i) => (
            <li key={scene.key} className="grid gap-4 rounded-xl border bg-card p-4" aria-label={`Scene ${i + 1}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Scene {i + 1}</p>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move scene ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move scene ${i + 1} down`}
                    disabled={i === draft.scenes.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove scene ${i + 1}`}
                    disabled={draft.scenes.length === 1}
                    onClick={() => setDraft({ ...draft, scenes: draft.scenes.filter((_, j) => j !== i) })}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <Field label="Heading" id={`s${scene.key}-heading`}>
                  <Input
                    id={`s${scene.key}-heading`}
                    value={scene.heading}
                    maxLength={120}
                    onChange={(e) => setScene(i, { heading: e.target.value })}
                  />
                </Field>
                <Field label="Seconds" id={`s${scene.key}-seconds`}>
                  <Input
                    id={`s${scene.key}-seconds`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={600}
                    value={scene.seconds}
                    onChange={(e) => setScene(i, { seconds: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Visuals" id={`s${scene.key}-visuals`}>
                <Textarea
                  id={`s${scene.key}-visuals`}
                  rows={3}
                  maxLength={1500}
                  value={scene.visuals}
                  onChange={(e) => setScene(i, { visuals: e.target.value })}
                />
              </Field>
              <Field label="Voiceover" id={`s${scene.key}-voiceover`}>
                <Textarea
                  id={`s${scene.key}-voiceover`}
                  rows={2}
                  maxLength={1500}
                  value={scene.voiceover}
                  onChange={(e) => setScene(i, { voiceover: e.target.value })}
                />
              </Field>

              <div className="grid gap-2">
                <p className="text-sm font-medium">Dialogue</p>
                {scene.dialogue.map((line, j) => (
                  <div key={j} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                    <Input
                      aria-label={`Scene ${i + 1} line ${j + 1} speaker`}
                      placeholder="Speaker"
                      maxLength={60}
                      value={line.speaker}
                      onChange={(e) =>
                        setScene(i, {
                          dialogue: scene.dialogue.map((l, k) => (k === j ? { ...l, speaker: e.target.value } : l)),
                        })
                      }
                    />
                    <Input
                      aria-label={`Scene ${i + 1} line ${j + 1}`}
                      placeholder="Line"
                      maxLength={600}
                      value={line.line}
                      onChange={(e) =>
                        setScene(i, {
                          dialogue: scene.dialogue.map((l, k) => (k === j ? { ...l, line: e.target.value } : l)),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove scene ${i + 1} line ${j + 1}`}
                      onClick={() => setScene(i, { dialogue: scene.dialogue.filter((_, k) => k !== j) })}
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={scene.dialogue.length >= 20}
                    onClick={() => setScene(i, { dialogue: [...scene.dialogue, { speaker: "", line: "" }] })}
                  >
                    <PlusIcon /> Add line
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="On-screen text" id={`s${scene.key}-ost`}>
                  <Input
                    id={`s${scene.key}-ost`}
                    maxLength={300}
                    value={scene.onScreenText}
                    onChange={(e) => setScene(i, { onScreenText: e.target.value })}
                  />
                </Field>
                <Field label="Music & sound" id={`s${scene.key}-audio`}>
                  <Input
                    id={`s${scene.key}-audio`}
                    maxLength={500}
                    value={scene.audio}
                    onChange={(e) => setScene(i, { audio: e.target.value })}
                  />
                </Field>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={draft.scenes.length >= 40}
            onClick={() =>
              setDraft({
                ...draft,
                scenes: [
                  ...draft.scenes,
                  {
                    key: nextKey++,
                    heading: "",
                    seconds: "5",
                    visuals: "",
                    voiceover: "",
                    dialogue: [],
                    onScreenText: "",
                    audio: "",
                  },
                ],
              })
            }
          >
            <PlusIcon /> Add scene
          </Button>
        </div>
      </fieldset>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur">
        <Button type="submit" variant="brand" disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : null}
          {saving ? "Saving…" : "Save script"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={() => {
            setDraft(null);
            setErrors(null);
          }}
        >
          Cancel
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Total length: {formatSeconds(total)}
        </p>
      </div>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Read-only script layout (also what the page shows to people who can't edit). */
export function ScriptView({ script }: { script: ScriptOutput }) {
  return (
    <article className="grid gap-5" aria-label="Script">
      <header className="grid gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{script.title}</h2>
        <p className="text-muted-foreground">{script.logline}</p>
        <p className="text-sm text-muted-foreground">
          {script.scenes.length} {script.scenes.length === 1 ? "scene" : "scenes"} ·{" "}
          {formatSeconds(script.totalSeconds)}
        </p>
      </header>
      <ol className="grid gap-4">
        {script.scenes.map((scene, i) => (
          <li key={i} className="grid gap-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Scene {i + 1}</span>
              <h3 className="font-medium">{scene.heading}</h3>
              <Badge variant="outline">{formatSeconds(scene.seconds)}</Badge>
            </div>
            <Block label="Visuals" text={scene.visuals} />
            {scene.voiceover ? <Block label="Voiceover" text={scene.voiceover} /> : null}
            {scene.dialogue.length ? (
              <div className="grid gap-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Dialogue</p>
                <ul className="grid gap-1 text-sm">
                  {scene.dialogue.map((l, j) => (
                    <li key={j}>
                      <span className="font-medium">{l.speaker}:</span> {l.line}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {scene.onScreenText ? <Block label="On-screen text" text={scene.onScreenText} /> : null}
            {scene.audio ? <Block label="Music & sound" text={scene.audio} /> : null}
          </li>
        ))}
      </ol>
    </article>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="grid gap-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase">{label}</p>
      <p className="text-sm whitespace-pre-line">{text}</p>
    </div>
  );
}
