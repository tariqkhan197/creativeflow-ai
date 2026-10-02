import { z } from "zod";
import { emailSchema } from "./auth";

/** Roles that can be granted through the Team page (client invites arrive in Phase 4). */
export const STAFF_INVITE_ROLES = ["admin", "manager", "member"] as const;
export type StaffInviteRole = (typeof STAFF_INVITE_ROLES)[number];

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(STAFF_INVITE_ROLES, "Choose a role"),
});

export const changeRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(STAFF_INVITE_ROLES, "Choose a role"),
});

export const memberIdSchema = z.object({ userId: z.uuid() });
export const invitationIdSchema = z.object({ invitationId: z.uuid() });

/** Raw invitation tokens are 32 random bytes, base64url-encoded (43 chars). */
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invitation link");
