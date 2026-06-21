import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import {
  createOAuthState,
  createRunnerToken,
  createSession,
  consumeOAuthState,
  expiredSessionCookie,
  getOptionalAccessIdentity,
  identityForEmail,
  requireAccessIdentity,
  revokeSession,
  upsertOAuthAccount,
  type AccessIdentity,
} from "../services/auth";

type GitHubOAuthTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GitHubUserResponse = {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string;
};

type GitHubEmailResponse = {
  email: string;
  primary: boolean;
  verified: boolean;
};

const devLoginSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120).optional(),
});

const runnerTokenSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
});

export const authRoutes = new Hono<AppBindings>()
  .get("/me", async (c) => {
    const principal = await getOptionalAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    return c.json({
      authenticated: Boolean(principal),
      user: principal ? publicIdentity(principal) : null,
      githubOAuthConfigured: Boolean(c.env.GITHUB_OAUTH_CLIENT_ID && c.env.GITHUB_OAUTH_CLIENT_SECRET),
      devLoginEnabled: c.env.AUTH_DEV_LOGIN_ENABLED === "true" || c.env.ENVIRONMENT !== "production",
    });
  })
  .post("/dev-login", async (c) => {
    if (c.env.ENVIRONMENT === "production" && c.env.AUTH_DEV_LOGIN_ENABLED !== "true") {
      return c.json({ error: "Email development login is disabled in production" }, 403);
    }

    const body = devLoginSchema.parse(await c.req.json());
    const identity = identityForEmail(body.email, body.name, "session");
    const session = await createSession(c.env.DB, c.env, identity, c.req.raw.headers);

    return c.json(
      {
        user: publicIdentity(identity),
        expiresAt: session.expiresAt,
      },
      200,
      { "set-cookie": session.cookie },
    );
  })
  .post("/logout", async (c) => {
    await revokeSession(c.env.DB, c.req.raw.headers);
    return c.json({ status: "logged_out" }, 200, { "set-cookie": expiredSessionCookie(c.env) });
  })
  .post("/runner-token", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const body = runnerTokenSchema.parse(await c.req.json().catch(() => ({})));
    const token = await createRunnerToken(c.env.DB, principal, body.name);
    return c.json(token, 201);
  })
  .get("/oauth/github/start", async (c) => {
    if (!c.env.GITHUB_OAUTH_CLIENT_ID || !c.env.GITHUB_OAUTH_CLIENT_SECRET) {
      return c.redirect(loginUrl(c.env.PUBLIC_APP_URL, "github_oauth_not_configured"));
    }

    const returnTo = c.req.query("returnTo") ?? "/dashboard";
    const state = await createOAuthState(c.env.DB, "github", returnTo);
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", c.env.GITHUB_OAUTH_CLIENT_ID);
    url.searchParams.set("redirect_uri", githubRedirectUri(c));
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", state);
    return c.redirect(url.toString());
  })
  .get("/oauth/github/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      return c.redirect(loginUrl(c.env.PUBLIC_APP_URL, "github_oauth_missing_code"));
    }
    if (!c.env.GITHUB_OAUTH_CLIENT_ID || !c.env.GITHUB_OAUTH_CLIENT_SECRET) {
      return c.redirect(loginUrl(c.env.PUBLIC_APP_URL, "github_oauth_not_configured"));
    }

    const returnTo = await consumeOAuthState(c.env.DB, "github", state);
    if (!returnTo) {
      return c.redirect(loginUrl(c.env.PUBLIC_APP_URL, "github_oauth_state_expired"));
    }

    try {
      const token = await exchangeGitHubCode(c, code);
      const githubUser = await fetchGitHubUser(token);
      const email = githubUser.email ?? (await fetchPrimaryGitHubEmail(token)) ?? `${githubUser.login}@users.noreply.github.com`;
      const identity: AccessIdentity = {
        orgId: `org_usr_github_${githubUser.id}`,
        orgName: `${githubUser.login}'s workspace`,
        userId: `usr_github_${githubUser.id}`,
        email: email.toLowerCase(),
        name: githubUser.name ?? githubUser.login,
        authMethod: "session",
      };

      await upsertOAuthAccount(c.env.DB, {
        identity,
        provider: "github",
        providerAccountId: String(githubUser.id),
        email,
        username: githubUser.login,
        avatarUrl: githubUser.avatar_url,
      });

      const session = await createSession(c.env.DB, c.env, identity, c.req.raw.headers);
      c.header("set-cookie", session.cookie);
      return c.redirect(appUrl(c.env.PUBLIC_APP_URL, returnTo));
    } catch (error) {
      console.error("GitHub OAuth failed:", error instanceof Error ? error.stack : String(error));
      return c.redirect(loginUrl(c.env.PUBLIC_APP_URL, "github_oauth_failed"));
    }
  });

function publicIdentity(identity: AccessIdentity) {
  return {
    orgId: identity.orgId,
    orgName: identity.orgName,
    userId: identity.userId,
    email: identity.email,
    name: identity.name,
    authMethod: identity.authMethod,
  };
}

async function exchangeGitHubCode(c: Context<AppBindings>, code: string) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: c.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: c.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: githubRedirectUri(c),
    }),
  });

  const body = (await response.json()) as GitHubOAuthTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description ?? body.error ?? `GitHub token exchange failed (${response.status})`);
  }
  return body.access_token;
}

async function fetchGitHubUser(token: string) {
  const response = await fetch("https://api.github.com/user", {
    headers: gitHubApiHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`GitHub user lookup failed (${response.status})`);
  }
  return (await response.json()) as GitHubUserResponse;
}

async function fetchPrimaryGitHubEmail(token: string) {
  const response = await fetch("https://api.github.com/user/emails", {
    headers: gitHubApiHeaders(token),
  });
  if (!response.ok) return undefined;
  const emails = (await response.json()) as GitHubEmailResponse[];
  return emails.find((email) => email.primary && email.verified)?.email ?? emails.find((email) => email.verified)?.email;
}

function gitHubApiHeaders(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "fusion-harness",
    "x-github-api-version": "2022-11-28",
  };
}

function githubRedirectUri(c: Context<AppBindings>) {
  return new URL("/api/auth/oauth/github/callback", c.req.url).toString();
}

function loginUrl(publicAppUrl: string, error: string) {
  const url = new URL("/login", publicAppUrl);
  url.searchParams.set("error", error);
  return url.toString();
}

function appUrl(publicAppUrl: string, path: string) {
  return new URL(path.startsWith("/") ? path : `/${path}`, publicAppUrl).toString();
}
