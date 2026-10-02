import { ROLE_LABELS } from "@/lib/roles";
import { PROJECT_STATUS_LABELS } from "@/lib/validation/projects";
import type { Json, ProjectStatus, WorkspaceRole } from "@/types/database";

export type ActivityEntry = { action: string; entity_type: string; entity_id: string | null; metadata: Json };

function meta(entry: ActivityEntry): Record<string, unknown> {
  return entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
    ? (entry.metadata as Record<string, unknown>)
    : {};
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const quoted = (v: unknown) => (str(v) ? `“${str(v)}”` : "");
const role = (v: unknown) => ROLE_LABELS[v as WorkspaceRole] ?? str(v);
const status = (v: unknown) => PROJECT_STATUS_LABELS[v as ProjectStatus] ?? str(v);

/**
 * Human sentence (after the actor's name) for an activity_log row.
 * `nameOf` resolves user ids (e.g. the member whose role changed).
 */
export function describeActivity(entry: ActivityEntry, nameOf: (userId: string | null) => string): string {
  return sentence(entry, nameOf).trim();
}

function sentence(entry: ActivityEntry, nameOf: (userId: string | null) => string): string {
  const m = meta(entry);
  switch (entry.action) {
    case "workspace.created":
      return "created the workspace";
    case "member.joined":
      return `joined the workspace as ${role(m.role)}`;
    case "member.left":
      return "left the workspace";
    case "member.removed":
      return `removed ${nameOf(entry.entity_id)} from the workspace`;
    case "member.role_changed":
      return `changed ${nameOf(entry.entity_id)}'s role from ${role(m.from)} to ${role(m.to)}`;
    case "invitation.created":
      return `invited ${str(m.email)} as ${role(m.role)}`;
    case "invitation.revoked":
      return `revoked the invitation for ${str(m.email)}`;
    case "client.created":
      return `added client ${quoted(m.name)}`;
    case "client.deleted":
      return `deleted client ${quoted(m.name)}`;
    case "project.created":
      return `created project ${quoted(m.name)}`;
    case "project.deleted":
      return `deleted project ${quoted(m.name)}`;
    case "project.archived":
      return `archived project ${quoted(m.name)}`;
    case "project.restored":
      return `restored project ${quoted(m.name)}`;
    case "project.status_changed":
      return `moved ${quoted(m.name)} from ${status(m.from)} to ${status(m.to)}`;
    case "task.created":
      return `added task ${quoted(m.title)}`;
    case "task.completed":
      return `completed task ${quoted(m.title)}`;
    case "asset.uploaded":
      return `uploaded ${quoted(m.name)}`;
    case "asset.version_added":
      return `added version ${String(m.version ?? "")} of ${quoted(m.name)}`;
    case "asset.deleted":
      return Number(m.version) > 1
        ? `deleted version ${String(m.version)} of ${quoted(m.name)}`
        : `deleted ${quoted(m.name)}`;
    case "comment.created":
      return m.internal ? "added an internal note" : m.reply ? "replied to a comment" : "commented on a file";
    case "comment.resolved":
      return "resolved a comment";
    case "approval.requested":
      return `requested approval of ${quoted(m.title)}`;
    case "approval.approved":
      return str(m.title) ? `approved ${quoted(m.title)}` : "approved a deliverable";
    case "approval.changes_requested":
      return str(m.title) ? `requested changes on ${quoted(m.title)}` : "requested changes";
    case "approval.cancelled":
      return `cancelled the approval request ${quoted(m.title)}`;
    case "revision.opened":
      return `opened revision round ${String(m.round ?? "")}`;
    case "revision.in_progress":
      return `started revision round ${String(m.round ?? "")}`;
    case "revision.completed":
      return `completed revision round ${String(m.round ?? "")}`;
    case "revision.open":
      return `reopened revision round ${String(m.round ?? "")}`;
    default:
      return entry.action.replace(/[._]/g, " ");
  }
}

/** Link to the thing an activity row is about, when it still exists. */
export function activityHref(entry: ActivityEntry): string | null {
  if (!entry.entity_id || entry.action.endsWith(".deleted")) return null;
  if (entry.entity_type === "project") return `/app/projects/${entry.entity_id}`;
  if (entry.entity_type === "client") return `/app/clients/${entry.entity_id}`;
  if (entry.entity_type === "task") {
    const projectId = meta(entry).project_id;
    return typeof projectId === "string" ? `/app/projects/${projectId}` : null;
  }
  if (entry.entity_type === "member" || entry.entity_type === "invitation") return "/app/team";
  if (entry.entity_type === "asset") {
    const projectId = meta(entry).project_id;
    return typeof projectId === "string" ? `/app/projects/${projectId}/assets/${entry.entity_id}` : null;
  }
  if (entry.entity_type === "approval") {
    const m = meta(entry);
    if (typeof m.project_id !== "string") return null;
    return typeof m.asset_id === "string"
      ? `/app/projects/${m.project_id}/assets/${m.asset_id}`
      : `/app/projects/${m.project_id}`;
  }
  if (entry.entity_type === "revision") {
    const projectId = meta(entry).project_id;
    return typeof projectId === "string" ? `/app/projects/${projectId}` : null;
  }
  if (entry.entity_type === "comment") {
    const m = meta(entry);
    return typeof m.project_id === "string" && typeof m.asset_id === "string"
      ? `/app/projects/${m.project_id}/assets/${m.asset_id}#comment-${entry.entity_id}`
      : null;
  }
  return null;
}

/** User ids referenced by activity rows (actors and member targets). */
export function referencedUserIds(entries: (ActivityEntry & { actor_id: string | null })[]): string[] {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.actor_id) ids.add(e.actor_id);
    if (e.entity_type === "member" && e.entity_id) ids.add(e.entity_id);
  }
  return [...ids];
}
