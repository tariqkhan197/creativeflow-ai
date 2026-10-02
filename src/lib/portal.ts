import "server-only";

import { redirect } from "next/navigation";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspace";

/**
 * Workspace context for client-portal pages. Staff are sent to /app. Access
 * to individual projects and files is decided by the database
 * (portal_project(), RLS on assets/approvals/comments), never by this check.
 */
export async function getPortalContext(): Promise<WorkspaceContext & { clientId: string }> {
  const ctx = await getWorkspaceContext();
  if (ctx.active.role !== "client" || !ctx.active.client_id) redirect("/app");
  return { ...ctx, clientId: ctx.active.client_id };
}
