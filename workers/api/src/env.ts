export type Env = {
  DB: D1Database;
  CONFIG_KV: KVNamespace;
  ARTIFACTS: R2Bucket;
  AI: Ai;
  FUSION_RUN: DurableObjectNamespace;
  RUNNER_SESSION: DurableObjectNamespace;
  FUSION_WORKFLOW: unknown;
  ENVIRONMENT: string;
  PUBLIC_APP_URL: string;
};

export type AppBindings = {
  Bindings: Env;
};
