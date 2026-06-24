"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { TopNav } from "@/features/fusion/top-nav";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <main className="min-h-screen">{children}</main>;
  }

  const isChatRoute = pathname === "/chat" || pathname.startsWith("/runs/");

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        {isChatRoute ? (
          children
        ) : (
          <main className="flex-1 overflow-y-auto">{children}</main>
        )}
      </div>
    </div>
  );
}