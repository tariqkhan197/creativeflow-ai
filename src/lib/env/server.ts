import "server-only";

/**
 * Server-only configuration. Importing this module from a Client Component
 * fails the build (via `server-only`), so secrets can never reach the browser.
 */

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const serverEnv = {
  supabaseSecretKey:
    clean(process.env.SUPABASE_SECRET_KEY) ??
    // Legacy name, still supported by Supabase.
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  anthropicApiKey: clean(process.env.ANTHROPIC_API_KEY),
  anthropicModel: clean(process.env.ANTHROPIC_MODEL) ?? "claude-sonnet-5-5",
  stripeSecretKey: clean(process.env.STRIPE_SECRET_KEY),
  stripeWebhookSecret: clean(process.env.STRIPE_WEBHOOK_SECRET),
  /**
   * Optional: the project-wide Storage upload limit in bytes (Supabase
   * Dashboard → Storage → Settings). It is plan dependent and cannot be read
   * through the API, so set it to get a clear error before an upload starts.
   */
  storageMaxUploadBytes: (() => {
    const n = Number(clean(process.env.STORAGE_MAX_UPLOAD_BYTES));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  })(),
} as const;

export type IntegrationStatus = {
  key: string;
  label: string;
  configured: boolean;
  required: boolean;
  envVars: string[];
  purpose: string;
};

/**
 * Which integrations are configured. Returns booleans only — never values —
 * so it is safe to render in the UI.
 */
export async function getIntegrationStatus(): Promise<IntegrationStatus[]> {
  const { isSupabaseConfigured } = await import("./public");
  return [
    {
      key: "supabase",
      label: "Supabase (database, auth & storage)",
      configured: isSupabaseConfigured,
      required: true,
      envVars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      purpose: "Accounts, workspaces, projects and every other record.",
    },
    {
      key: "supabase-secret",
      label: "Supabase secret key",
      configured: Boolean(serverEnv.supabaseSecretKey),
      required: false,
      envVars: ["SUPABASE_SECRET_KEY"],
      purpose: "Trusted server tasks such as recording Stripe payments.",
    },
    {
      key: "anthropic",
      label: "Anthropic (AI scripts & storyboards)",
      configured: Boolean(serverEnv.anthropicApiKey),
      required: false,
      envVars: ["ANTHROPIC_API_KEY"],
      purpose: "Generates scripts and storyboards in AI Studio.",
    },
    {
      key: "stripe",
      label: "Stripe (invoice payments)",
      configured: Boolean(serverEnv.stripeSecretKey && serverEnv.stripeWebhookSecret),
      required: false,
      envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      purpose: "Online invoice payments and transaction tracking.",
    },
  ];
}
