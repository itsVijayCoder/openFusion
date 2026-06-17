import type { Env } from "../env";

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
