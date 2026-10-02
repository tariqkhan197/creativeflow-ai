import { FileTextIcon, ImageIcon, MusicIcon, VideoIcon } from "lucide-react";
import type { AssetKind } from "@/types/database";

const ICONS = {
  video: VideoIcon,
  image: ImageIcon,
  audio: MusicIcon,
  document: FileTextIcon,
  other: FileTextIcon,
} as const;

export function AssetKindIcon({ kind, className }: { kind: AssetKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={className} aria-hidden />;
}
