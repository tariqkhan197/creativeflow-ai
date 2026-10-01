import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-8 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-brand to-[oklch(0.62_0.17_235)] text-brand-foreground shadow-sm shadow-brand/30",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none">
        <path d="M5 16.5c3-7 7.5-10 14-9.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path
          d="M5 11.5c2.2-3.3 5-5 8.5-5.2"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity=".55"
        />
        <circle cx="17.5" cy="16.5" r="2.2" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Logo({
  href = "/",
  className,
  compact = false,
}: {
  href?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <LogoMark />
      {!compact && (
        <span className="text-[15px]">
          CreativeFlow <span className="text-brand">AI</span>
        </span>
      )}
    </Link>
  );
}
