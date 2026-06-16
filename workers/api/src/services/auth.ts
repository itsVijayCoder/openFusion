export type AccessIdentity = {
  email: string;
  name?: string;
};

export function requireAccessIdentity(headers: Headers): AccessIdentity | null {
  const email = headers.get("cf-access-authenticated-user-email");
  return email ? { email } : null;
}
