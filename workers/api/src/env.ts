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
  AUTH_DEV_LOGIN_ENABLED?: string;
  AUTH_TRUST_CLOUDFLARE_ACCESS?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  FEATURE_NEW_PROMPTS?: string;
};

export type AppBindings = {
  Bindings: Env;
};
