import type { Env } from "../env";
import type { RunnerMetadata } from "../durable-objects/RunnerSessionDO";

export function notifyRunnerSessionObject(env: Env, runnerId: string, path: string, body: unknown) {
  const id = env.RUNNER_SESSION.idFromName(runnerId);
  const stub = env.RUNNER_SESSION.get(id);
  const url = new URL(`https://runner-session.internal${path}`);

  return stub.fetch(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Seed the RunnerSessionDO with runner metadata so subsequent heartbeats
 * can be served entirely from DO storage without D1 reads.
 */
export async function seedRunnerSessionDO(env: Env, meta: RunnerMetadata): Promise<void> {
  await notifyRunnerSessionObject(env, meta.id, "/seed", meta);
}
