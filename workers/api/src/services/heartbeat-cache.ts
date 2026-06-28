// =============================================================================
// heartbeat-cache.ts
// Strategy: Cache runner heartbeat responses in KV to avoid redundant D1 reads.
//
// Problem: Every heartbeat calls getRunner() which does:
//   1. SELECT * FROM runners WHERE org_id=? AND id=?
//   2. SELECT * FROM installed_tools WHERE runner_id=? ORDER BY detected_at DESC
// With N runners heartbeating every 15-30s, this burns 2 reads/second/runner.
//
// Solution: Cache runner data in KV with TTL matching heartbeat grace period.
// Only hit D1 on cache miss or when runner data actually changes (new tools).
// =============================================================================

import type { RunnerRef } from "@openfusion/shared";

const HEARTBEAT_CACHE_TTL = 90; // seconds — slightly above 2x heartbeat interval
const HEARTBEAT_CACHE_PREFIX = "runner:cache:";

/**
 * Try to serve runner data from KV cache.
 * Returns null on cache miss or KV failure.
 */
export async function getCachedRunner(
  kv: KVNamespace | undefined,
  orgId: string,
  runnerId: string,
): Promise<RunnerRef | null> {
  if (!kv) return null;

  const cacheKey = `${HEARTBEAT_CACHE_PREFIX}${orgId}:${runnerId}`;
  try {
    const cached = await kv.get(cacheKey);
    if (!cached) return null;

    const runner = JSON.parse(cached) as RunnerRef;
    // Validate the cache didn't serve stale data
    if (!runner?.id || runner.id !== runnerId) return null;
    return runner;
  } catch {
    return null;
  }
}

/**
 * Store runner data in KV for subsequent heartbeat reads.
 */
export async function setCachedRunner(
  kv: KVNamespace | undefined,
  orgId: string,
  runnerId: string,
  runner: RunnerRef,
): Promise<void> {
  if (!kv) return;

  const cacheKey = `${HEARTBEAT_CACHE_PREFIX}${orgId}:${runnerId}`;
  try {
    await kv.put(cacheKey, JSON.stringify(runner), { expirationTtl: HEARTBEAT_CACHE_TTL });
  } catch {
    // KV write failure is non-critical
  }
}

/**
 * Invalidate runner cache — call when runner data actually mutates
 * (tools change, models change, runner deleted, etc.)
 */
export async function invalidateRunnerCache(
  kv: KVNamespace | undefined,
  orgId: string,
  runnerId: string,
): Promise<void> {
  if (!kv) return;

  const cacheKey = `${HEARTBEAT_CACHE_PREFIX}${orgId}:${runnerId}`;
  try {
    await kv.delete(cacheKey);
  } catch {
    // KV write failure is non-critical
  }
}

/**
 * Invalidate the list-level runners cache so the dashboard/runners page
 * picks up the change on next request.
 */
export async function invalidateRunnersListCache(
  kv: KVNamespace | undefined,
  orgId: string,
): Promise<void> {
  if (!kv) return;

  try {
    await kv.delete(`runners:list:${orgId}`);
  } catch {
    // KV write failure is non-critical
  }
}

// =============================================================================
// Runner list-level caching (for GET /api/runners)
// =============================================================================

const RUNNERS_LIST_CACHE_TTL = 30; // seconds
const RUNNERS_LIST_CACHE_PREFIX = "runners:list:";

/**
 * Try to serve the full runners list from KV.
 */
export async function getCachedRunnersList(
  kv: KVNamespace | undefined,
  orgId: string,
): Promise<import("@openfusion/shared").RunnerRef[] | null> {
  if (!kv) return null;

  try {
    const cached = await kv.get(`${RUNNERS_LIST_CACHE_PREFIX}${orgId}`);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

/**
 * Store the full runners list in KV.
 */
export async function setCachedRunnersList(
  kv: KVNamespace | undefined,
  orgId: string,
  runners: import("@openfusion/shared").RunnerRef[],
): Promise<void> {
  if (!kv) return;

  try {
    await kv.put(`${RUNNERS_LIST_CACHE_PREFIX}${orgId}`, JSON.stringify(runners), {
      expirationTtl: RUNNERS_LIST_CACHE_TTL,
    });
  } catch {
    // KV write failure is non-critical
  }
}
