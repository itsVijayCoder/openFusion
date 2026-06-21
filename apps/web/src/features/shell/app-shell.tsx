"use client";

import {
  RiArchiveLine,
  RiCodeSSlashLine,
  RiDashboardLine,
  RiGitBranchLine,
  RiGitPullRequestLine,
  RiGithubFill,
  RiInformationLine,
  RiKey2Line,
  RiMoonLine,
  RiRobot2Line,
  RiSettings3Line,
  RiShieldCheckLine,
  RiStackLine,
  RiSunLine,
} from "@remixicon/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/features/theme/theme-provider";

const navGroups = [
  {
    label: "AI Core",
    items: [
      { href: "/chat", label: "Chat", icon: RiRobot2Line },
      { href: "/runners", label: "Agents", icon: RiGitBranchLine },
      { href: "/models", label: "Model", icon: RiStackLine },
      { href: "/presets", label: "Assistants", icon: RiSettings3Line },
      { href: "/dashboard", label: "Capabilities", icon: RiDashboardLine },
    ],
  },
  {
    label: "Application",
    items: [
      { href: "/workspaces", label: "Workspaces", icon: RiCodeSSlashLine },
      { href: "/pr-reviews", label: "PR Reviews", icon: RiGitPullRequestLine },
      { href: "/settings/github", label: "GitHub", icon: RiGithubFill },
      { href: "/settings/team", label: "Team", icon: RiShieldCheckLine },
      { href: "/settings/api", label: "API", icon: RiKey2Line },
      { href: "/settings/mcp", label: "MCP", icon: RiArchiveLine },
    ],
  },
  {
    label: "Other",
    items: [{ href: "/", label: "About", icon: RiInformationLine }],
  },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/chat" || pathname.startsWith("/runs/")) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-sidebar lg:block">
        <div className="flex h-full flex-col">
          <Link href="/" className="flex h-16 items-center gap-3 px-5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <RiRobot2Line aria-hidden className="size-5" />
            </span>
            <span className="truncate text-sm font-semibold text-sidebar-foreground">Fusion</span>
          </Link>

          <nav className="flex flex-1 flex-col gap-5 px-2">
            {navGroups.map((group) => (
              <div key={group.label} className="flex flex-col gap-1">
                <span className="px-3 text-xs font-medium text-muted-foreground">{group.label}</span>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        active && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon aria-hidden className="size-4 text-muted-foreground" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="border-t border-border p-2">
            <div className="flex items-center gap-2">
              <Link href="/chat" className="flex h-9 flex-1 items-center gap-2 rounded-md bg-sidebar-accent px-3 text-sm font-medium text-sidebar-accent-foreground hover:text-sidebar-accent-foreground">
                <RiRobot2Line aria-hidden className="size-4" />
                Back to Chat
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <div className="flex min-h-screen flex-col">
          <div className="flex h-14 items-center gap-2 border-b border-border bg-sidebar px-4 lg:hidden">
            <Link href="/" className="text-sm font-semibold text-foreground">
              Fusion
            </Link>
            <nav className="ml-auto flex gap-1 overflow-x-auto">
              {[...navGroups[0].items.slice(0, 5), ...navGroups[1].items.slice(0, 2)].map((item) => (
                <Link key={item.href} href={item.href} className="rounded-md px-2 py-1 text-xs text-muted-foreground">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={toggleTheme}
      className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      {theme === "dark" ? <RiSunLine aria-hidden className="size-4" /> : <RiMoonLine aria-hidden className="size-4" />}
    </button>
  );
}