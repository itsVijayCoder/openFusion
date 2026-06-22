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
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_SLUG?: string;
  FEATURE_NEW_PROMPTS?: string;
  KV?: KVNamespace;
};

export type AppBindings = {
  Bindings: Env;
};
