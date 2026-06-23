export type ApiResult<T> = {
  data: T;
  source: "api" | "fallback";
  error?: string;
};

const localApiBaseUrl = "http://localhost:8787";
const productionApiBaseUrl = "https://fusion-api.asthrix.workers.dev";

export function apiUrl(path: string) {
  const baseUrl = apiBaseUrl();
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function apiBaseUrl() {
  const configured = process.env.FUSION_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (!isLocalHost(hostname) && (!configured || isLocalApiBaseUrl(configured))) {
      return productionApiBaseUrl;
    }
  }

  return configured || localApiBaseUrl;
}

async function serverCookieHeader(): Promise<Record<string, string>> {
  if (typeof window !== "undefined") return {};
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    if (allCookies.length === 0) return {};
    const cookieHeader = allCookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join("; ");
    return { cookie: cookieHeader };
  } catch {
    return {};
  }
}

export async function apiGet<T>(path: string, fallback: T): Promise<ApiResult<T>> {
  try {
    const response = await fetch(apiUrl(path), {
      cache: "no-store",
      credentials: "include",
      headers: {
        ...devHeaders(),
        ...(await serverCookieHeader()),
      },
    });

    if (!response.ok) {
      return { data: fallback, source: "fallback", error: `API returned ${response.status}` };
    }

    return { data: (await response.json()) as T, source: "api" };
  } catch (error) {
    return {
      data: fallback,
      source: "fallback",
      error: error instanceof Error ? error.message : "API unavailable",
    };
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...devHeaders(),
      ...(await serverCookieHeader()),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(readErrorMessage(error) ?? `API returned ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "DELETE",
    credentials: "include",
    headers: {
      ...devHeaders(),
      ...(await serverCookieHeader()),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(readErrorMessage(error) ?? `API returned ${response.status}`);
  }

  return (await response.json()) as T;
}

export function devHeaders(): Record<string, string> {
  if (typeof window !== "undefined" && !isLocalHost(window.location.hostname)) {
    return {};
  }
  if (typeof window === "undefined" && process.env.NODE_ENV === "production") {
    return {};
  }

  return {
    "x-fusion-dev-email": "developer@fusion.local",
    "x-fusion-dev-name": "Fusion Developer",
  };
}

function readErrorMessage(value: unknown) {
  if (!value || typeof value !== "object" || !("error" in value)) return undefined;
  const error = (value as { error: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isLocalApiBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return isLocalHost(url.hostname);
  } catch {
    return false;
  }
}