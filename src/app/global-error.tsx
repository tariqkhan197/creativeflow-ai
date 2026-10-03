"use client";

import { useEffect } from "react";
import { ErrorView } from "@/components/app/error-view";
import "./globals.css";

/**
 * Errors in the root layout itself. It replaces the whole document, so it
 * renders its own <html>/<body> and imports the global styles; the theme
 * follows the operating system's light/dark preference.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  useEffect(() => {
    // No theme provider here: follow the OS preference like the app's "system" theme.
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.classList.add("dark");
  }, []);
  return (
    <html lang="en">
      <head>
        <title>Something went wrong · CreativeFlow AI</title>
        <meta name="color-scheme" content="light dark" />
      </head>
      <body className="min-h-full antialiased">
        <ErrorView digest={error.digest} onRetry={retry} />
      </body>
    </html>
  );
}
