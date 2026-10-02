import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TextareaFieldProps = React.ComponentProps<typeof Textarea> & { label: string; name: string; errors?: string[] };

export function TextareaField({ label, name, errors, className, id, ...props }: TextareaFieldProps) {
  const inputId = id ?? name;
  const invalid = Boolean(errors?.length);
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <Textarea
        id={inputId}
        name={name}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${inputId}-error` : undefined}
        {...props}
      />
      {invalid ? (
        <p id={`${inputId}-error`} className="text-xs font-medium text-destructive">
          {errors![0]}
        </p>
      ) : null}
    </div>
  );
}
