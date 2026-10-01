import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FormFieldProps = React.ComponentProps<typeof Input> & {
  label: string;
  name: string;
  errors?: string[];
  hint?: React.ReactNode;
  labelAction?: React.ReactNode;
};

/** Labelled input with accessible inline validation errors. */
export function FormField({ label, name, errors, hint, labelAction, className, id, ...props }: FormFieldProps) {
  const inputId = id ?? name;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const invalid = Boolean(errors?.length);

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={inputId}>{label}</Label>
        {labelAction}
      </div>
      <Input
        id={inputId}
        name={name}
        aria-invalid={invalid || undefined}
        aria-describedby={[invalid ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
        {...props}
      />
      {hint && !invalid ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {invalid ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {errors![0]}
        </p>
      ) : null}
    </div>
  );
}
