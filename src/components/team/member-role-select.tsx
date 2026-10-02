"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { changeMemberRole } from "@/lib/actions/team";
import type { StaffInviteRole } from "@/lib/validation/team";
import { ROLE_LABELS } from "@/lib/roles";

export function MemberRoleSelect({
  userId,
  role,
  options,
  memberName,
}: {
  userId: string;
  role: StaffInviteRole;
  options: StaffInviteRole[];
  memberName: string;
}) {
  const [value, setValue] = useState(role);
  const [pending, startTransition] = useTransition();
  const choices = options.includes(role) ? options : [role, ...options];

  return (
    <NativeSelect
      aria-label={`Role for ${memberName}`}
      value={value}
      disabled={pending}
      className="w-36"
      onChange={(e) => {
        const next = e.target.value as StaffInviteRole;
        const previous = value;
        setValue(next);
        startTransition(async () => {
          const result = await changeMemberRole(userId, next);
          if (!result.ok) {
            setValue(previous);
            toast.error(result.error);
          } else if (result.message) {
            toast.success(result.message);
          }
        });
      }}
    >
      {choices.map((r) => (
        <option key={r} value={r} disabled={!options.includes(r)}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </NativeSelect>
  );
}
