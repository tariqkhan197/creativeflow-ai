export function AuthHeader({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
