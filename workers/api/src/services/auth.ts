import { ensurePrincipal } from "@fusion-harness/db";
import { formatEntityId } from "@fusion-harness/shared";
import type { Env } from "../env";

export type AccessIdentity = {
  orgId: string;
  orgName: string;
  userId: string;
  email: string;
  name?: string;
  authMethod: "session" | "runner_token" | "api_token" | "cloudflare_access" | "dev";
  tokenId?: string;
};

type AccessOptions = {
  allowBearerToken?: boolean;
};

type SessionRow = {
  id: string;
  org_id: string;
  user_id: string;
  email: string;
  name: string | null;
  expires_at: string;
  revoked_at: string | null;
};

type TokenRow = {
  id: string;
  org_id: string;
  user_id: string;
  email: string;
  name: string | null;
  kind: "runner" | "api";
  expires_at: string | null;
  revoked_at: string | null;
};

export class AuthenticationError extends Error {
  readonly statusCode = 401;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export const sessionCookieName = "fh_session";
const sessionTtlSeconds = 60 * 60 * 24 * 14;
const runnerTokenTtlSeconds = 60 * 60 * 24 * 90;

export async function requireAccessIdentity(db: D1Database, env: Env, headers: Headers, options: AccessOptions = {}): Promise<AccessIdentity> {
  const identity = await getOptionalAccessIdentity(db, env, headers);
  if (!identity) {
    throw new AuthenticationError();
  }
  if (!options.allowBearerToken && (identity.authMethod === "runner_token" || identity.authMethod === "api_token")) {
    throw new AuthenticationError("Browser session required");
  }
  return identity;
}

export async function requireRunnerAccessIdentity(db: D1Database, env: Env, headers: Headers): Promise<AccessIdentity> {
  const identity = await requireAccessIdentity(db, env, headers, { allowBearerToken: true });
  if (identity.authMethod === "runner_token") {
    return identity;
  }
  if (env.ENVIRONMENT !== "production" && identity.authMethod === "dev") {
    return identity;
  }
  throw new AuthenticationError("Runner token required");
}

export async function getOptionalAccessIdentity(db: D1Database, env: Env, headers: Headers): Promise<AccessIdentity | null> {
  const sessionIdentity = await identityFromSession(db, headers);
  if (sessionIdentity) return sessionIdentity;

  const tokenIdentity = await identityFromBearerToken(db, headers);
  if (tokenIdentity) return tokenIdentity;

  const accessIdentity = identityFromCloudflareAccess(env, headers);
  if (accessIdentity) {
    await ensureAccessIdentity(db, accessIdentity);
    return accessIdentity;
  }

  const devIdentity = identityFromDevHeaders(env, headers);
  if (devIdentity) {
    await ensureAccessIdentity(db, devIdentity);
    return devIdentity;
  }

  return null;
}

export async function createSession(db: D1Database, env: Env, identity: AccessIdentity, headers: Headers) {
  const now = new Date().toISOString();
  await ensureAccessIdentity(db, identity, now);

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO auth_sessions (
         id, org_id, user_id, session_hash, user_agent, ip_hash,
         expires_at, created_at, updated_at, last_seen_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      formatEntityId("sess", crypto.randomUUID()),
      identity.orgId,
      identity.userId,
      tokenHash,
      headers.get("user-agent"),
      await optionalHeaderHash(headers.get("cf-connecting-ip")),
      expiresAt,
      now,
      now,
      now,
    )
    .run();

  return {
    token,
    expiresAt,
    cookie: serializeSessionCookie(env, token, sessionTtlSeconds),
  };
}

export async function revokeSession(db: D1Database, headers: Headers) {
  const token = readCookie(headers, sessionCookieName);
  if (!token) return;

  await db
    .prepare("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE session_hash = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), new Date().toISOString(), await sha256Hex(token))
    .run();
}

export async function createRunnerToken(db: D1Database, identity: AccessIdentity, name = "Fusion Runner") {
  const now = new Date().toISOString();
  await ensureAccessIdentity(db, identity, now);

  const token = `fhr_${randomToken()}`;
  const expiresAt = new Date(Date.now() + runnerTokenTtlSeconds * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO auth_tokens (
         id, org_id, user_id, name, token_hash, kind, scopes_json,
         expires_at, created_at
       )
       VALUES (?, ?, ?, ?, ?, 'runner', ?, ?, ?)`,
    )
    .bind(
      formatEntityId("tok", crypto.randomUUID()),
      identity.orgId,
      identity.userId,
      name,
      await sha256Hex(token),
      JSON.stringify(["runner:register", "runner:jobs"]),
      expiresAt,
      now,
    )
    .run();

  return { token, expiresAt };
}

export async function createOAuthState(db: D1Database, provider: "github", returnTo?: string) {
  const state = randomToken();
  await db
    .prepare("INSERT INTO oauth_states (id, state_hash, provider, return_to, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(
      formatEntityId("oauth_state", crypto.randomUUID()),
      await sha256Hex(state),
      provider,
      safeReturnTo(returnTo),
      new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      new Date().toISOString(),
    )
    .run();
  return state;
}

export async function consumeOAuthState(db: D1Database, provider: "github", state: string) {
  const hash = await sha256Hex(state);
  const row = await db
    .prepare("SELECT return_to FROM oauth_states WHERE state_hash = ? AND provider = ? AND expires_at > ?")
    .bind(hash, provider, new Date().toISOString())
    .first<{ return_to: string | null }>();

  await db.prepare("DELETE FROM oauth_states WHERE state_hash = ?").bind(hash).run();
  return row?.return_to ?? undefined;
}

export async function upsertOAuthAccount(
  db: D1Database,
  input: {
    identity: AccessIdentity;
    provider: "github";
    providerAccountId: string;
    email?: string;
    username?: string;
    avatarUrl?: string;
  },
) {
  const now = new Date().toISOString();
  await ensureAccessIdentity(db, input.identity, now);
  await db
    .prepare(
      `INSERT INTO oauth_accounts (
         id, org_id, user_id, provider, provider_account_id,
         email, username, avatar_url, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_account_id) DO UPDATE SET
         org_id = excluded.org_id,
         user_id = excluded.user_id,
         email = excluded.email,
         username = excluded.username,
         avatar_url = excluded.avatar_url,
         updated_at = excluded.updated_at`,
    )
    .bind(
      formatEntityId("oauth", `${input.provider}_${input.providerAccountId}`),
      input.identity.orgId,
      input.identity.userId,
      input.provider,
      input.providerAccountId,
      input.email ?? null,
      input.username ?? null,
      input.avatarUrl ?? null,
      now,
      now,
    )
    .run();
}

export function identityForEmail(email: string, name?: string, authMethod: AccessIdentity["authMethod"] = "session"): AccessIdentity {
  const normalizedEmail = email.trim().toLowerCase();
  const userId = `usr_${slugify(normalizedEmail)}`;
  return {
    orgId: `org_${userId}`,
    orgName: `${normalizedEmail}'s workspace`,
    userId,
    email: normalizedEmail,
    name,
    authMethod,
  };
}

export function expiredSessionCookie(env: Env) {
  return serializeSessionCookie(env, "", 0);
}

async function identityFromSession(db: D1Database, headers: Headers): Promise<AccessIdentity | null> {
  const token = readCookie(headers, sessionCookieName);
  if (!token) return null;

  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT
         auth_sessions.id,
         auth_sessions.org_id,
         auth_sessions.user_id,
         auth_sessions.expires_at,
         auth_sessions.revoked_at,
         users.email,
         users.name
       FROM auth_sessions
       INNER JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.session_hash = ?
         AND auth_sessions.revoked_at IS NULL
         AND auth_sessions.expires_at > ?`,
    )
    .bind(await sha256Hex(token), now)
    .first<SessionRow>();

  if (!row) return null;

  await db
    .prepare("UPDATE auth_sessions SET last_seen_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, row.id)
    .run();

  return {
    orgId: row.org_id,
    orgName: `${row.email}'s workspace`,
    userId: row.user_id,
    email: row.email,
    name: row.name ?? undefined,
    authMethod: "session",
  };
}

async function identityFromBearerToken(db: D1Database, headers: Headers): Promise<AccessIdentity | null> {
  const authorization = headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;

  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT
         auth_tokens.id,
         auth_tokens.org_id,
         auth_tokens.user_id,
         auth_tokens.kind,
         auth_tokens.expires_at,
         auth_tokens.revoked_at,
         users.email,
         users.name
       FROM auth_tokens
       INNER JOIN users ON users.id = auth_tokens.user_id
       WHERE auth_tokens.token_hash = ?
         AND auth_tokens.revoked_at IS NULL
         AND (auth_tokens.expires_at IS NULL OR auth_tokens.expires_at > ?)`,
    )
    .bind(await sha256Hex(token), now)
    .first<TokenRow>();

  if (!row) return null;

  await db.prepare("UPDATE auth_tokens SET last_used_at = ? WHERE id = ?").bind(now, row.id).run();

  return {
    orgId: row.org_id,
    orgName: `${row.email}'s workspace`,
    userId: row.user_id,
    email: row.email,
    name: row.name ?? undefined,
    authMethod: row.kind === "runner" ? "runner_token" : "api_token",
    tokenId: row.id,
  };
}

function identityFromCloudflareAccess(env: Env, headers: Headers): AccessIdentity | null {
  if (env.AUTH_TRUST_CLOUDFLARE_ACCESS !== "true") return null;
  if (!headers.get("cf-access-jwt-assertion")) return null;

  const email = headers.get("cf-access-authenticated-user-email");
  if (!email) return null;
  return identityForEmail(email, headers.get("cf-access-authenticated-user-name") ?? undefined, "cloudflare_access");
}

function identityFromDevHeaders(env: Env, headers: Headers): AccessIdentity | null {
  if (!devAuthEnabled(env)) return null;
  const email = headers.get("x-fusion-dev-email") ?? (env.ENVIRONMENT === "production" ? null : "developer@fusion.local");
  if (!email) return null;
  return identityForEmail(email, headers.get("x-fusion-dev-name") ?? "Fusion Developer", "dev");
}

async function ensureAccessIdentity(db: D1Database, identity: AccessIdentity, now = new Date().toISOString()) {
  await ensurePrincipal(db, {
    orgId: identity.orgId,
    orgName: identity.orgName,
    userId: identity.userId,
    email: identity.email,
    name: identity.name,
    now,
  });
}

function serializeSessionCookie(env: Env, value: string, maxAgeSeconds: number) {
  const secure = isSecureCookieEnvironment(env);
  const sameSite = secure ? "None" : "Lax";
  return [
    `${sessionCookieName}=${value}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
    secure ? "Secure" : undefined,
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function isSecureCookieEnvironment(env: Env) {
  return env.PUBLIC_APP_URL?.startsWith("https://") || env.ENVIRONMENT === "production";
}

function devAuthEnabled(env: Env) {
  return env.AUTH_DEV_LOGIN_ENABLED === "true" || env.ENVIRONMENT !== "production";
}

function readCookie(headers: Headers, name: string) {
  const cookie = headers.get("cookie");
  if (!cookie) return undefined;
  const prefix = `${name}=`;
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function optionalHeaderHash(value: string | null) {
  return value ? sha256Hex(value) : null;
}

function safeReturnTo(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value.slice(0, 200);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}
