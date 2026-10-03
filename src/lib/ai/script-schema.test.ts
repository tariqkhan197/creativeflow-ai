import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { scriptBriefSchema, scriptOutputSchema } from "./script-schema";
import { validScript } from "./test-fixtures";

const brief = {
  brief: "A 30-second launch film for a lightweight running shoe aimed at new runners.",
  durationSeconds: "30",
};

describe("scriptBriefSchema", () => {
  it("trims, coerces the duration and drops empty optional fields", () => {
    expect(scriptBriefSchema.parse({ ...brief, title: "  Launch ", tone: " ", projectId: "" })).toEqual({
      brief: brief.brief,
      durationSeconds: 30,
      title: "Launch",
    });
  });
  it("requires a real brief and a sensible duration", () => {
    expect(scriptBriefSchema.safeParse({ ...brief, brief: "too short" }).success).toBe(false);
    expect(scriptBriefSchema.safeParse({ ...brief, brief: "x".repeat(4001) }).success).toBe(false);
    for (const durationSeconds of ["", "4", "601", "12.5", "abc"]) {
      expect(scriptBriefSchema.safeParse({ ...brief, durationSeconds }).success).toBe(false);
    }
    expect(scriptBriefSchema.safeParse({ ...brief, projectId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("scriptOutputSchema", () => {
  it("accepts a complete script", () => {
    expect(scriptOutputSchema.parse(validScript)).toEqual(validScript);
  });
  it("rejects missing scenes, missing fields and oversized text", () => {
    expect(scriptOutputSchema.safeParse({ ...validScript, scenes: [] }).success).toBe(false);
    const noVisuals = Object.fromEntries(Object.entries(validScript.scenes[0]).filter(([key]) => key !== "visuals"));
    expect(scriptOutputSchema.safeParse({ ...validScript, scenes: [noVisuals] }).success).toBe(false);
    expect(
      scriptOutputSchema.safeParse({ ...validScript, scenes: [{ ...validScript.scenes[0], seconds: 0 }] }).success,
    ).toBe(false);
    expect(scriptOutputSchema.safeParse({ ...validScript, logline: "x".repeat(501) }).success).toBe(false);
  });
  it("converts to a structured-output JSON schema (closed objects, all properties required, no unsupported keywords)", () => {
    const format = zodOutputFormat(scriptOutputSchema) as unknown as {
      type: string;
      schema: { additionalProperties: boolean; required: string[]; $defs: Record<string, { required: string[] }> };
    };
    expect(format.type).toBe("json_schema");
    expect(format.schema.additionalProperties).toBe(false);
    expect(format.schema.required.sort()).toEqual(["logline", "scenes", "title", "totalSeconds"]);
    const scene = Object.values(format.schema.$defs).find((d) => d.required.includes("visuals"))!;
    expect(scene.required.sort()).toEqual(
      ["audio", "dialogue", "heading", "onScreenText", "seconds", "visuals", "voiceover"].sort(),
    );
    // Limits the API doesn't support are moved into descriptions and checked client-side;
    // only "at least one scene" (minItems 1, which the API supports) stays in the schema.
    const json = JSON.stringify(format.schema);
    expect(json).not.toMatch(/"(minLength|maxLength|minimum|maximum|maxItems)"/);
    expect(json.match(/"minItems":\d+/g)).toEqual(['"minItems":1']);
  });
});
