import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

type SelectFieldProps = React.ComponentProps<typeof NativeSelect> & {
  label: string;
  name: string;
  errors?: string[];
  hint?: React.ReactNode;
};

/** Labelled native select with the same error/hint behaviour as FormField. */
export function SelectField({ label, name, errors, hint, className, id, children, ...props }: SelectFieldProps) {
  const inputId = id ?? name;
  const invalid = Boolean(errors?.length);
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <NativeSelect
        id={inputId}
        name={name}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        {...props}
      >
        {children}
      </NativeSelect>
      {hint && !invalid ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {invalid ? (
        <p id={`${inputId}-error`} className="text-xs font-medium text-destructive">
          {errors![0]}
        </p>
      ) : null}
    </div>
  );
}
