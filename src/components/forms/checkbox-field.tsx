import { cn } from "@/lib/utils";

/** Native checkbox with a label, description and accessible inline error. */
export function CheckboxField({
  label,
  name,
  description,
  errors,
  className,
  id,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & {
  label: string;
  name: string;
  description?: React.ReactNode;
  errors?: string[];
}) {
  const inputId = id ?? name;
  const invalid = Boolean(errors?.length);
  return (
    <div className={cn("grid gap-1", className)}>
      <div className="flex items-start gap-3">
        <input
          id={inputId}
          name={name}
          type="checkbox"
          aria-invalid={invalid || undefined}
          aria-describedby={
            [description ? `${inputId}-desc` : null, invalid ? `${inputId}-error` : null].filter(Boolean).join(" ") ||
            undefined
          }
          className="mt-0.5 size-4 shrink-0 accent-brand"
          {...props}
        />
        <div className="grid gap-0.5">
          <label htmlFor={inputId} className="text-sm leading-none font-medium">
            {label}
          </label>
          {description ? (
            <p id={`${inputId}-desc`} className="text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {invalid ? (
        <p id={`${inputId}-error`} className="pl-7 text-xs font-medium text-destructive">
          {errors![0]}
        </p>
      ) : null}
    </div>
  );
}
