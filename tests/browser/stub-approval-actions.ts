// Test seam for tests/browser: stand-in for the approval Server Actions
// (which need Next.js + Supabase). It validates with the real zod schema so
// the decision panel's error and success states run in a plain browser. The
// real rules live in decide_approval() and are covered by scripts/test-db.mjs.
import type { FormState } from "@/lib/actions/types";
import { decideApprovalSchema } from "@/lib/validation/approvals";

type W = Window & { __decisions?: { approvalId: string; decision: string; note?: string }[] };
const w = window as W;

export async function decideApproval(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = Object.fromEntries(
    [...formData.entries()].filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  const parsed = decideApprovalSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[String(issue.path[0])] ??= []).push(issue.message);
    return { status: "error", fieldErrors, values };
  }
  (w.__decisions ??= []).push(parsed.data);
  return {
    status: "success",
    message:
      parsed.data.decision === "approved"
        ? "Approved. The team has been notified."
        : "Changes requested. The team has been notified.",
  };
}
