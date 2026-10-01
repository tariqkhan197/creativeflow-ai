"use client";

import { useTheme } from "next-themes";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Change theme">
          <SunIcon className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <MoonIcon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuCheckItem checked={theme === "light"} onSelect={() => setTheme("light")}>
          <SunIcon /> Light
        </DropdownMenuCheckItem>
        <DropdownMenuCheckItem checked={theme === "dark"} onSelect={() => setTheme("dark")}>
          <MoonIcon /> Dark
        </DropdownMenuCheckItem>
        <DropdownMenuCheckItem checked={theme === "system"} onSelect={() => setTheme("system")}>
          <MonitorIcon /> System
        </DropdownMenuCheckItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
