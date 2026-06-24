"use client";

import { DropdownMenu } from "radix-ui";
import {
  RiArchiveLine,
  RiArrowDownSLine,
  RiCodeSSlashLine,
  RiDashboardLine,
  RiGitBranchLine,
  RiInformationLine,
  RiKey2Line,
  RiLogoutBoxRLine,
  RiMagicLine,
  RiMoonLine,
  RiRobot2Line,
  RiShieldCheckLine,
  RiStackLine,
  RiSunLine,
  RiUser3Line,
} from "@remixicon/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "@/features/theme/theme-provider";
import { apiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

const primaryNav = [
  { label: "Chat", href: "/chat", icon: RiRobot2Line },
  { label: "Agents", href: "/runners", icon: RiGitBranchLine },
  { label: "Models", href: "/models", icon: RiStackLine },
  { label: "Dashboard", href: "/dashboard", icon: RiDashboardLine },
] as const;

const secondaryNav = [
  { label: "Assistants", href: "/presets", icon: RiMagicLine },
  { label: "Workspaces", href: "/workspaces", icon: RiCodeSSlashLine },
  { label: "Team", href: "/settings/team", icon: RiShieldCheckLine },
  { label: "API", href: "/settings/api", icon: RiKey2Line },
  { label: "MCP", href: "/settings/mcp", icon: RiArchiveLine },
  { label: "About", href: "/", icon: RiInformationLine },
] as const;

type AuthMe = {
  authenticated: boolean;
  user: {
    email: string;
    name?: string;
    authMethod: string;
  } | null;
};

export function TopNav() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/80 px-3 backdrop-blur-md sm:px-4">
      <div className="flex min-w-0 items-center gap-1 sm:gap-4">
        <Link href="/chat" className="flex items-center gap-2 rounded-md px-1 py-1">
          <span className="flex size-6 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 shadow-sm">
            <RiRobot2Line aria-hidden className="size-3.5 text-primary-foreground" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">FusionLab</span>
        </Link>
        <nav className="hidden items-center gap-0.5 md:flex">
          {primaryNav.map((link) => {
            const Icon = link.icon;
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-150",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-3.5" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          {theme === "dark" ? <RiSunLine aria-hidden className="size-4" /> : <RiMoonLine aria-hidden className="size-4" />}
        </button>
        <ProfileMenu />
      </div>
    </header>
  );
}

function ProfileMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [auth, setAuth] = useState<AuthMe | undefined>();

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/auth/me"), { credentials: "include" })
      .then((response) => response.json())
      .then((body) => {
        if (!cancelled) setAuth(body as AuthMe);
      })
      .catch(() => {
        if (!cancelled) setAuth({ authenticated: false, user: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    window.location.href = "/login";
  }

  const isAuthenticated = Boolean(auth?.authenticated && auth.user);
  const displayName = auth?.user?.name ?? auth?.user?.email ?? "Guest";
  const displayEmail = auth?.user?.email ?? "Not signed in";
  const initials = displayName.charAt(0).toUpperCase() || "V";

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 transition-colors duration-150 hover:bg-muted"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-[11px] font-semibold text-white shadow-sm">
            {initials}
          </span>
          <RiArrowDownSLine aria-hidden className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[248px] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-semibold text-white shadow-sm">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{displayEmail}</p>
            </div>
          </div>

          <DropdownMenu.Separator className="my-1 h-px bg-border md:hidden" />

          <DropdownMenu.Label className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:hidden">
            Navigate
          </DropdownMenu.Label>

          {primaryNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <DropdownMenu.Item
                key={item.href}
                onSelect={() => router.push(item.href)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-muted md:hidden",
                  active ? "text-foreground" : "text-muted-foreground data-[highlighted]:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-4 text-muted-foreground" />
                {item.label}
              </DropdownMenu.Item>
            );
          })}

          <DropdownMenu.Label className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Workspace
          </DropdownMenu.Label>

          {secondaryNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <DropdownMenu.Item
                key={item.href}
                onSelect={() => router.push(item.href)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-muted",
                  active ? "text-foreground" : "text-muted-foreground data-[highlighted]:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-4 text-muted-foreground" />
                {item.label}
              </DropdownMenu.Item>
            );
          })}

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          <DropdownMenu.Label className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Account
          </DropdownMenu.Label>

          {!isAuthenticated ? (
            <DropdownMenu.Item
              onSelect={() => router.push("/login")}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-muted"
            >
              <RiUser3Line aria-hidden className="size-4 text-muted-foreground" />
              Sign in
            </DropdownMenu.Item>
          ) : null}

          <DropdownMenu.Item
            onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-muted"
          >
            {theme === "dark" ? <RiSunLine aria-hidden className="size-4 text-muted-foreground" /> : <RiMoonLine aria-hidden className="size-4 text-muted-foreground" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </DropdownMenu.Item>

          {isAuthenticated ? (
            <DropdownMenu.Item
              onSelect={logout}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-destructive outline-none transition-colors data-[highlighted]:bg-destructive/10"
            >
              <RiLogoutBoxRLine aria-hidden className="size-4" />
              Log out
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}