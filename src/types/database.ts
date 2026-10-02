/**
 * Database types for supabase-js, mirroring supabase/migrations.
 *
 * Once your Supabase project is linked you can regenerate the exact types with:
 *   npm run db:types
 * (see docs/SETUP.md). Keep this file in sync with the migrations until then.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type WorkspaceRole = "owner" | "admin" | "manager" | "member" | "client";
export type ProjectStatus =
  "planning" | "in_progress" | "in_review" | "revisions" | "approved" | "delivered" | "on_hold" | "cancelled";
export type ProjectPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type AssetKind = "video" | "image" | "audio" | "document" | "other";
export type AssetStatus = "uploading" | "ready" | "failed";
export type ApprovalStatus = "pending" | "approved" | "changes_requested" | "cancelled";
export type RevisionStatus = "open" | "in_progress" | "completed";
export type AiGenerationKind = "script" | "storyboard";
export type AiGenerationStatus = "pending" | "completed" | "failed";
export type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "void";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";

/**
 * Builds the Row/Insert/Update shape supabase-js expects.
 * `Required` lists the columns that have no database default.
 */
type Table<Row, Required extends keyof Row, Generated extends keyof Row = never> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required | Generated>>;
  Update: Partial<Omit<Row, Generated>>;
  Relationships: [];
};

type Timestamps = { created_at: string; updated_at: string };

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
} & Timestamps;

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  logo_url: string | null;
  default_currency: string;
} & Timestamps;

export type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  client_id: string | null;
} & Timestamps;

export type WorkspaceInvitation = {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  client_id: string | null;
  token_hash: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
};

export type Client = {
  id: string;
  workspace_id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_by: string | null;
} & Timestamps;

export type Project = {
  id: string;
  workspace_id: string;
  client_id: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  start_date: string | null;
  due_date: string | null;
  budget_cents: number | null;
  currency: string;
  client_visible: boolean;
  created_by: string | null;
  archived_at: string | null;
} & Timestamps;

export type ProjectMember = {
  project_id: string;
  workspace_id: string;
  user_id: string;
  created_at: string;
};

export type Task = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
  created_by: string | null;
  completed_at: string | null;
} & Timestamps;

export type Asset = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  version_number: number;
  root_asset_id: string | null;
  shared_with_client: boolean;
  uploaded_by: string | null;
} & Timestamps;

export type ReviewComment = {
  id: string;
  workspace_id: string;
  asset_id: string;
  parent_id: string | null;
  author_id: string | null;
  body: string;
  timestamp_seconds: number | null;
  annotation: Json | null;
  is_internal: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
} & Timestamps;

export type Approval = {
  id: string;
  workspace_id: string;
  project_id: string;
  asset_id: string | null;
  title: string;
  message: string | null;
  status: ApprovalStatus;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  due_date: string | null;
} & Timestamps;

export type Revision = {
  id: string;
  workspace_id: string;
  project_id: string;
  approval_id: string | null;
  asset_id: string | null;
  round_number: number;
  summary: string;
  status: RevisionStatus;
  requested_by: string | null;
  completed_at: string | null;
} & Timestamps;

export type AiGeneration = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  kind: AiGenerationKind;
  title: string | null;
  prompt: string;
  input: Json;
  output: Json | null;
  model: string | null;
  status: AiGenerationStatus;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
  created_by: string | null;
} & Timestamps;

export type Invoice = {
  id: string;
  workspace_id: string;
  client_id: string;
  project_id: string | null;
  number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string | null;
  currency: string;
  tax_rate_bps: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  notes: string | null;
  stripe_checkout_session_id: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_by: string | null;
} & Timestamps;

export type InvoiceItem = {
  id: string;
  workspace_id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
  position: number;
  created_at: string;
};

export type Payment = {
  id: string;
  workspace_id: string;
  invoice_id: string;
  provider: "stripe" | "manual";
  provider_payment_id: string | null;
  amount_cents: number;
  currency: string;
  status: PaymentStatus;
  paid_at: string | null;
  raw_event: Json | null;
  recorded_by: string | null;
  created_at: string;
};

export type Notification = {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type ActivityLogEntry = {
  id: number;
  workspace_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  metadata: Json;
  created_at: string;
};

export type WorkspaceOverview = {
  active_projects: number;
  projects_in_review: number;
  pending_approvals: number;
  clients: number;
  members: number;
  overdue_tasks: number;
  /** null when the caller's role may not see finance figures */
  outstanding_cents: number | null;
  revenue_30d_cents: number | null;
};

/** Result of public.get_invitation(token). */
export type InvitationInfo = {
  workspace_name: string;
  email: string;
  role: WorkspaceRole;
  inviter_name: string | null;
  expires_at: string;
  status: "pending" | "accepted" | "expired";
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: "12" };
  public: {
    Tables: {
      profiles: Table<Profile, "id" | "email">;
      workspaces: Table<Workspace, "name" | "slug" | "owner_id">;
      workspace_members: Table<WorkspaceMember, "workspace_id" | "user_id">;
      workspace_invitations: Table<WorkspaceInvitation, "workspace_id" | "email" | "role" | "token_hash">;
      clients: Table<Client, "workspace_id" | "name">;
      projects: Table<Project, "workspace_id" | "name">;
      project_members: Table<ProjectMember, "project_id" | "workspace_id" | "user_id">;
      tasks: Table<Task, "workspace_id" | "project_id" | "title">;
      assets: Table<
        Asset,
        "workspace_id" | "project_id" | "name" | "kind" | "storage_path" | "mime_type" | "size_bytes"
      >;
      review_comments: Table<ReviewComment, "workspace_id" | "asset_id" | "body">;
      approvals: Table<Approval, "workspace_id" | "project_id" | "title">;
      revisions: Table<Revision, "workspace_id" | "project_id" | "round_number" | "summary">;
      ai_generations: Table<AiGeneration, "workspace_id" | "kind" | "prompt">;
      invoices: Table<Invoice, "workspace_id" | "client_id">;
      invoice_items: Table<
        InvoiceItem,
        "workspace_id" | "invoice_id" | "description" | "unit_price_cents",
        "amount_cents"
      >;
      payments: Table<Payment, "workspace_id" | "invoice_id" | "amount_cents" | "currency" | "status">;
      notifications: Table<Notification, "workspace_id" | "user_id" | "type" | "title">;
      activity_log: Table<ActivityLogEntry, "workspace_id" | "entity_type" | "action", "id">;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_workspace: { Args: { p_name: string; p_slug: string }; Returns: string };
      accept_invitation: { Args: { p_token: string }; Returns: string };
      decide_approval: {
        Args: { p_approval: string; p_decision: ApprovalStatus; p_note?: string | null };
        Returns: undefined;
      };
      workspace_overview: { Args: { p_workspace: string }; Returns: WorkspaceOverview };
      get_invitation: { Args: { p_token: string }; Returns: InvitationInfo | null };
    };
    Enums: {
      workspace_role: WorkspaceRole;
      project_status: ProjectStatus;
      project_priority: ProjectPriority;
      task_status: TaskStatus;
      asset_kind: AssetKind;
      asset_status: AssetStatus;
      approval_status: ApprovalStatus;
      revision_status: RevisionStatus;
      ai_generation_kind: AiGenerationKind;
      ai_generation_status: AiGenerationStatus;
      invoice_status: InvoiceStatus;
      payment_status: PaymentStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
