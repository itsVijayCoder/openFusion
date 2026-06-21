"use client";

import { RiGithubFill, RiLoader4Line, RiLock2Line, RiMailLine, RiShieldUserLine } from "@remixicon/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";

type AuthPanelProps = {
  error?: string;
};

type AuthMeResponse = {
  githubOAuthConfigured: boolean;
  devLoginEnabled: boolean;
};

export function AuthPanel({ error }: AuthPanelProps) {
  const router = useRouter();
  const [email, setEmail] = useState("developer@fusion.local");
  const [name, setName] = useState("Fusion Developer");
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [message, setMessage] = useState<string | undefined>(authErrorMessage(error));
  const [capabilities, setCapabilities] = useState<AuthMeResponse>({
    githubOAuthConfigured: true,
    devLoginEnabled: true,
  });

  useEffect(() => {
    fetch(apiUrl("/api/auth/me"), { credentials: "include" })
      .then((response) => response.json())
      .then((body) => setCapabilities(body as AuthMeResponse))
      .catch(() => undefined);
  }, []);

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage(undefined);

    try {
      const response = await fetch(apiUrl("/api/auth/dev-login"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Login failed with ${response.status}`);
      }
      router.push("/dashboard");
      router.refresh();
    } catch (loginError) {
      setMessage(loginError instanceof Error ? loginError.message : "Login failed");
    } finally {
      setStatus("idle");
    }
  }

  const githubHref = apiUrl("/api/auth/oauth/github/start?returnTo=/dashboard");

  return (
    <div className="min-h-screen overflow-hidden bg-[#070a0c] text-[#f5f0e8]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(54,132,150,0.30),transparent_30%),radial-gradient(circle_at_88%_15%,rgba(232,168,92,0.18),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent_38%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:72px_72px]" />
      <main className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-12 px-6 py-10 lg:grid-cols-[1fr_460px] lg:px-10">
        <section className="max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-cyan-200 shadow-2xl shadow-cyan-950/40">
              <RiShieldUserLine aria-hidden className="size-6" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Fusion Harness</span>
          </div>
          <h1 className="mt-10 max-w-3xl text-5xl font-semibold tracking-[-0.04em] text-balance sm:text-6xl">
            Secure control plane for local AI agents
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#aeb8b8]">
            Every run, GitHub account, PR review, and runner is scoped to your user identity.
          </p>
          <div className="mt-10 grid max-w-3xl gap-3 sm:grid-cols-3">
            {[
              ["Runs", "Private prompt, trace, artifacts"],
              ["GitHub", "Installations and PR queues isolated"],
              ["Runners", "Scoped bearer tokens per user"],
            ].map(([label, detail]) => (
              <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.055] p-4 shadow-2xl shadow-black/20 backdrop-blur">
                <p className="text-sm font-semibold text-[#f5f0e8]">{label}</p>
                <p className="mt-2 text-xs leading-5 text-[#8e9b9b]">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/12 bg-[#0d1214]/90 p-5 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="rounded-[1.5rem] border border-white/8 bg-[#10181b] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
                <p className="mt-2 text-sm leading-6 text-[#8e9b9b]">
                  Use GitHub OAuth in production, or email sign-in while developing locally.
                </p>
              </div>
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100">
                User scoped
              </span>
            </div>

            {message ? (
              <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                {message}
              </div>
            ) : null}

            <div className="mt-6 grid gap-3">
              <Button asChild size="lg" className="h-11 rounded-2xl bg-[#e7f7f7] text-[#071012] hover:bg-white">
                <a href={githubHref}>
                  <RiGithubFill aria-hidden className="size-5" />
                  Continue with GitHub
                </a>
              </Button>
              {!capabilities.githubOAuthConfigured ? (
                <p className="text-xs leading-5 text-[#8e9b9b]">
                  GitHub OAuth needs <code>GITHUB_OAUTH_CLIENT_ID</code> and <code>GITHUB_OAUTH_CLIENT_SECRET</code>.
                </p>
              ) : null}
            </div>

            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.22em] text-[#6f7d7d]">
              <span className="h-px flex-1 bg-white/10" />
              or
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <form className="grid gap-4" onSubmit={submitEmail}>
              <label className="grid gap-2 text-sm font-medium text-[#dce5e3]">
                Email
                <span className="flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 focus-within:border-cyan-200/60">
                  <RiMailLine aria-hidden className="size-4 text-[#6f7d7d]" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#f5f0e8] outline-none placeholder:text-[#6f7d7d]"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    type="email"
                    required
                  />
                </span>
              </label>
              <label className="grid gap-2 text-sm font-medium text-[#dce5e3]">
                Name
                <input
                  className="h-12 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-[#f5f0e8] outline-none placeholder:text-[#6f7d7d] focus:border-cyan-200/60"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                />
              </label>
              <Button disabled={!capabilities.devLoginEnabled || status === "loading"} size="lg" className="h-11 rounded-2xl bg-cyan-300 text-[#071012] hover:bg-cyan-200">
                {status === "loading" ? <RiLoader4Line aria-hidden className="size-4 animate-spin" /> : <RiLock2Line aria-hidden className="size-4" />}
                Continue with email
              </Button>
              {!capabilities.devLoginEnabled ? (
                <p className="text-xs leading-5 text-[#8e9b9b]">Email sign-in is disabled in this environment. Use GitHub OAuth.</p>
              ) : null}
            </form>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-xs leading-5 text-[#9aa8a8]">
              Protected by HttpOnly sessions and scoped runner tokens. Native runners receive bearer tokens instead of browser cookies.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function authErrorMessage(error?: string) {
  switch (error) {
    case "github_oauth_not_configured":
      return "GitHub OAuth is not configured yet.";
    case "github_oauth_state_expired":
      return "The OAuth session expired. Try signing in again.";
    case "github_oauth_failed":
      return "GitHub OAuth failed. Check Worker secrets and callback URL.";
    case "github_oauth_missing_code":
      return "GitHub did not return an authorization code.";
    default:
      return undefined;
  }
}
