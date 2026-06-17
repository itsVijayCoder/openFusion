export type ApiResult<T> = {
  data: T;
  source: "api" | "fallback";
  error?: string;
};

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8787";

export function apiUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || defaultApiBaseUrl;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export async function apiGet<T>(path: string, fallback: T): Promise<ApiResult<T>> {
  try {
    const response = await fetch(apiUrl(path), {
      cache: "no-store",
      headers: devHeaders(),
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
    headers: {
      "content-type": "application/json",
      ...devHeaders(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(readErrorMessage(error) ?? `API returned ${response.status}`);
  }

  return (await response.json()) as T;
}

function devHeaders() {
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
