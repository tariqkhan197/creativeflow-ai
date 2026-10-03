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
  /** "gemini" (default) or "anthropic"; src/lib/ai/config.ts validates it. */
  aiProvider: clean(process.env.AI_PROVIDER),
  geminiApiKey: clean(process.env.GEMINI_API_KEY),
  /** The Gemini model code (required for Gemini); src/lib/ai/config.ts validates it. */
  geminiModel: clean(process.env.GEMINI_MODEL),
  anthropicApiKey: clean(process.env.ANTHROPIC_API_KEY),
  /** Optional override; src/lib/ai/config.ts validates it and supplies the default model. */
  anthropicModel: clean(process.env.ANTHROPIC_MODEL),
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
  const { isAiConfigured } = await import("@/lib/ai/config");
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
      purpose: "Records AI Studio results on the server (and, later, Stripe payments).",
    },
    {
      key: "ai",
      label: "AI Studio (scripts & storyboards)",
      configured: isAiConfigured(),
      required: false,
      envVars: [
        "AI_PROVIDER (gemini or anthropic; default gemini)",
        "GEMINI_API_KEY and GEMINI_MODEL, or ANTHROPIC_API_KEY",
        "SUPABASE_SECRET_KEY",
      ],
      purpose: "Generates scripts and storyboards in AI Studio with the selected provider.",
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
