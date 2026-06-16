export type McpAuthContext = {
  authenticated: boolean;
  subject?: string;
};

export function authenticateMcpRequest(headers: Headers): McpAuthContext {
  const subject = headers.get("cf-access-authenticated-user-email") ?? headers.get("x-fusion-dev-email") ?? undefined;
  return {
    authenticated: Boolean(subject),
    subject,
  };
}
