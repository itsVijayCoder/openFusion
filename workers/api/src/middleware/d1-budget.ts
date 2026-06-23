import type { Env } from "../env";

const D1_READS_DAILY_LIMIT = 150_000;

export async function trackD1Reads(env: Env, orgId: string, reads: number): Promise<number> {
  if (!env.CONFIG_KV) return 0;

  const today = new Date().toISOString().slice(0, 10);
  const key = `d1reads:${orgId}:${today}`;
  const current = Number(await env.CONFIG_KV.get(key)) ?? 0;
  const total = current + reads;
  await env.CONFIG_KV.put(key, String(total), { expirationTtl: 86400 });
  return total;
}

export function getBudgetTier(total: number): "normal" | "caution" | "degraded" | "critical" {
  if (total < D1_READS_DAILY_LIMIT * 0.7) return "normal";
  if (total < D1_READS_DAILY_LIMIT * 0.85) return "caution";
  if (total < D1_READS_DAILY_LIMIT) return "degraded";
  return "critical";
}

export function shouldUseCache(tier: ReturnType<typeof getBudgetTier>): boolean {
  return tier === "degraded" || tier === "critical";
}

export function shouldRejectReads(tier: ReturnType<typeof getBudgetTier>): boolean {
  return tier === "critical";
}