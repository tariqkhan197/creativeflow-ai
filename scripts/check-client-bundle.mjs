#!/usr/bin/env node
/**
 * Fails if anything secret or server-only appears in the browser bundles
 * (.next/static) of the last `next build`. Run after `npm run build`:
 *
 *   npm run check:bundle
 *
 * Checks names of server-only variables, the Anthropic and Gemini SDKs and endpoints,
 * key-shaped strings, and - when they are set in this environment - the
 * actual secret values (which are never printed).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, ".next", "static");
if (!existsSync(dir)) {
  console.error("No .next/static directory. Run `npm run build` first.");
  process.exit(1);
}

const files = [];
(function walk(d) {
  for (const name of readdirSync(d)) {
    const p = path.join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|css|html|json|map)$/.test(name)) files.push(p);
  }
})(dir);

const markers = [
  [
    "server-only variable name",
    /\b(GEMINI_API_KEY|GEMINI_MODEL|ANTHROPIC_API_KEY|ANTHROPIC_MODEL|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET)\b/,
  ],
  ["Anthropic SDK or endpoint", /@anthropic-ai\/sdk|api\.anthropic\.com|anthropic-version/],
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{16,}/],
  ["Gemini SDK or endpoint", /@google\/genai|generativelanguage\.googleapis\.com/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{16,}/],
  ["Stripe secret key", /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/],
];
const secretValues = [
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
]
  .map((name) => [name, process.env[name]?.trim()])
  .filter(([, value]) => value && value.length >= 12);

const problems = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  for (const [label, re] of markers) if (re.test(text)) problems.push(`${rel}: ${label}`);
  for (const [name, value] of secretValues) if (text.includes(value)) problems.push(`${rel}: the value of ${name}`);
}

if (problems.length) {
  console.error(`✗ Server-only content found in browser bundles:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(
  `✓ ${files.length} browser bundle files contain no server-only names, AI SDK code or secret keys` +
    (secretValues.length ? ` (also checked the values of ${secretValues.map(([n]) => n).join(", ")})` : ""),
);
