import { z } from "zod";
import { emailSchema } from "./auth";

/** Invite a contact of a client to the client portal. */
export const inviteClientUserSchema = z.object({
  clientId: z.uuid("Choose a client"),
  email: emailSchema,
});

export const clientUserSchema = z.object({ clientId: z.uuid(), userId: z.uuid() });
export const clientInvitationSchema = z.object({ clientId: z.uuid(), invitationId: z.uuid() });
