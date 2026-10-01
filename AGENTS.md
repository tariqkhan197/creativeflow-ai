<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CreativeFlow AI — project notes

- Read `docs/ARCHITECTURE.md` and `docs/DATABASE.md` before changing data access.
- All user data access goes through `src/lib/supabase/server.ts` (user JWT, RLS applies). Use
  `src/lib/supabase/admin.ts` only for already-authorised trusted tasks (e.g. verified webhooks).
- Schema changes: add a new file in `supabase/migrations/`, add tests to `scripts/test-db.mjs`, update
  `src/types/database.ts`, and run `npm run check`.
- No mock data or placeholder features: unbuilt modules stay disabled in `src/lib/navigation.ts` with their phase.
- Validate every Server Action input with zod (`src/lib/validation/`) and return `FormState`.
