import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FormState } from "@/lib/actions/types";

/** Form-level success / error message announced to screen readers. */
export function FormMessage({ state }: { state: FormState }) {
  if (!state.message || state.status === "idle") return null;
  const isError = state.status === "error";
  return (
    <Alert variant={isError ? "destructive" : "success"} aria-live="polite">
      {isError ? <AlertCircleIcon /> : <CheckCircle2Icon />}
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}
