import { RiFlashlightLine, RiGitBranchLine, RiRobot2Line } from "@remixicon/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
	return (
		<main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10">
			<header className="flex flex-col gap-4">
				<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
					<RiFlashlightLine aria-hidden data-icon="inline-start" />
					<span>Internal multi-model coding platform</span>
				</div>
				<div className="flex flex-col gap-3">
					<h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-foreground">Fusion Harness</h1>
					<p className="max-w-3xl text-base text-muted-foreground">
						Coordinate OpenCode, Codex, and future adapters through a Cloudflare control plane and Go local runner.
					</p>
				</div>
				<div className="flex flex-wrap gap-3">
					<Button asChild>
						<Link href="/chat">
							<RiRobot2Line aria-hidden data-icon="inline-start" />
							Open task console
						</Link>
					</Button>
					<Button asChild variant="outline">
						<Link href="/runners">
							<RiGitBranchLine aria-hidden data-icon="inline-start" />
							View runners
						</Link>
					</Button>
				</div>
			</header>
			<section className="grid gap-4 md:grid-cols-3">
				{[
					["Cloud control plane", "Workers, D1, Durable Objects, KV, R2, Workflows, AI Gateway, and MCP."],
					["Go execution plane", "Native runner for detection, command execution, patch generation, and artifact upload."],
					["Fusion pipeline", "Panel models, judge JSON, final writer, trace UI, and audit events."],
				].map(([title, description]) => (
					<article key={title} className="rounded-lg border border-border bg-card p-5">
						<h2 className="text-base font-semibold text-card-foreground">{title}</h2>
						<p className="mt-2 text-sm text-muted-foreground">{description}</p>
					</article>
				))}
			</section>
		</main>
	);
}
