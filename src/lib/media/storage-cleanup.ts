import "server-only";

import { ASSET_BUCKET } from "@/lib/media/server";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;

/** Lists the object names directly inside `folder` (files only). */
async function listFiles(supabase: Supabase, folder: string): Promise<{ files: string[]; folders: string[] } | null> {
  const files: string[] = [];
  const folders: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(ASSET_BUCKET).list(folder, { limit: PAGE, offset });
    if (error) return null;
    for (const entry of data) {
      // Folders are returned as entries without an id.
      if (entry.id === null) folders.push(`${folder}/${entry.name}`);
      else files.push(`${folder}/${entry.name}`);
    }
    if (data.length < PAGE) break;
  }
  return { files, folders };
}

async function removeInBatches(supabase: Supabase, paths: string[]): Promise<boolean> {
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await supabase.storage.from(ASSET_BUCKET).remove(paths.slice(i, i + PAGE));
    if (error) return false;
  }
  return true;
}

/**
 * Removes the given objects plus anything else left in their asset folders,
 * then verifies the folders are empty. Returns an error message on failure.
 */
export async function removeAssetObjects(
  supabase: Supabase,
  paths: string[],
  folders: string[],
): Promise<string | null> {
  if (paths.length && !(await removeInBatches(supabase, paths))) {
    return "Some files couldn't be removed from storage. Nothing was deleted — please try again.";
  }
  for (const folder of folders) {
    const listing = await listFiles(supabase, folder);
    if (!listing) return "Storage couldn't be checked after removing the files. Please try again.";
    if (listing.files.length && !(await removeInBatches(supabase, listing.files))) {
      return "Some files couldn't be removed from storage. Nothing was deleted — please try again.";
    }
    const after = await listFiles(supabase, folder);
    if (!after || after.files.length) {
      return "Some files are still in storage, so the record was kept. Please try again.";
    }
  }
  return null;
}

/** Removes every object under {workspace}/{project}/ (all asset folders). */
export async function removeProjectObjects(
  supabase: Supabase,
  workspaceId: string,
  projectId: string,
): Promise<string | null> {
  const prefix = `${workspaceId}/${projectId}`;
  const top = await listFiles(supabase, prefix);
  if (!top) return "The project's files couldn't be listed. Nothing was deleted — please try again.";
  return removeAssetObjects(supabase, top.files, top.folders);
}
