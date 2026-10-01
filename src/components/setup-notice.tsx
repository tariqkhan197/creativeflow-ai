import Link from "next/link";
import { SettingsIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Shown wherever a feature cannot work because Supabase is not configured. */
export function SupabaseSetupNotice({ className }: { className?: string }) {
  return (
    <Alert variant="warning" className={className}>
      <SettingsIcon />
      <AlertTitle>Supabase is not connected yet</AlertTitle>
      <AlertDescription>
        <p>
          Accounts can&apos;t be created until the Supabase environment variables are set.{" "}
          <Link href="/setup" className="font-medium text-foreground underline underline-offset-4">
            Open the setup guide
          </Link>
          .
        </p>
      </AlertDescription>
    </Alert>
  );
}
