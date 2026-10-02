export type PortalFileRow = {
  id: string;
  name: string;
  kind: string;
  version_number: number;
  root_asset_id: string | null;
  created_at: string;
};

export type PortalFileGroup<T extends PortalFileRow> = { rootId: string; latest: T; versions: T[] };

/**
 * Groups the versions a client can see (already filtered by RLS to shared,
 * ready files) by original, newest version first; groups are ordered by their
 * newest upload.
 */
export function groupPortalFiles<T extends PortalFileRow>(rows: T[]): PortalFileGroup<T>[] {
  const byRoot = new Map<string, T[]>();
  for (const row of rows) {
    const root = row.root_asset_id ?? row.id;
    byRoot.set(root, [...(byRoot.get(root) ?? []), row]);
  }
  return [...byRoot.entries()]
    .map(([rootId, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version_number - a.version_number);
      return { rootId, latest: sorted[0], versions: sorted };
    })
    .sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
}
