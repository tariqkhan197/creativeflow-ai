import { describe, expect, it } from "vitest";
import { clientInvitationSchema, clientUserSchema, inviteClientUserSchema } from "./portal";

const uuid = "4f7c2e1a-9b3d-4c5e-8f6a-1b2c3d4e5f60";

describe("inviteClientUserSchema", () => {
  it("normalises the email and requires a client id", () => {
    expect(inviteClientUserSchema.parse({ clientId: uuid, email: " Pat@Client.COM " })).toEqual({
      clientId: uuid,
      email: "pat@client.com",
    });
    expect(inviteClientUserSchema.safeParse({ email: "pat@client.com" }).success).toBe(false);
    expect(inviteClientUserSchema.safeParse({ clientId: "nope", email: "pat@client.com" }).success).toBe(false);
  });
  it("rejects invalid emails", () => {
    expect(inviteClientUserSchema.safeParse({ clientId: uuid, email: "nope" }).success).toBe(false);
  });
  it("ignores extra fields such as a role", () => {
    expect(inviteClientUserSchema.parse({ clientId: uuid, email: "a@b.co", role: "admin" })).not.toHaveProperty("role");
  });
});

describe("portal access id schemas", () => {
  it("require uuids", () => {
    expect(clientUserSchema.safeParse({ clientId: uuid, userId: uuid }).success).toBe(true);
    expect(clientUserSchema.safeParse({ clientId: uuid, userId: "x" }).success).toBe(false);
    expect(clientInvitationSchema.safeParse({ clientId: "x", invitationId: uuid }).success).toBe(false);
  });
});
