import type { Env } from "../env";

const GITHUB_API_BASE = "https://api.github.com";
const JWT_TTL_SECONDS = 9 * 60;
const INSTALLATION_TOKEN_TTL_SECONDS = 60 * 60;
const TOKEN_RENEW_BUFFER_MS = 5 * 60 * 1000;

type CachedInstallationToken = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<number, CachedInstallationToken>();

export class GitHubAppAuth {
  constructor(private readonly env: Env) {}

  async getAppJwt(): Promise<string> {
    const privateKey = await this.importPrivateKey();
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60,
      exp: now + JWT_TTL_SECONDS,
      iss: this.env.GITHUB_APP_ID,
    };
    const header = { alg: "RS256", typ: "JWT" };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      privateKey,
      new TextEncoder().encode(signingInput),
    );

    return `${signingInput}.${base64UrlEncode(signature)}`;
  }

  async getInstallationToken(installationId: number): Promise<string> {
    const cached = tokenCache.get(installationId);
    if (cached && cached.expiresAt > Date.now() + TOKEN_RENEW_BUFFER_MS) {
      return cached.token;
    }

    const appJwt = await this.getAppJwt();
    const response = await fetch(`${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${appJwt}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "fusion-harness-pr-review",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub installation token request failed (${response.status}): ${text}`);
    }

    const body = (await response.json()) as { token: string; expires_at: string };
    const expiresAt = new Date(body.expires_at).getTime();

    tokenCache.set(installationId, { token: body.token, expiresAt });
    return body.token;
  }

  async fetchAsApp(path: string, init: RequestInit = {}): Promise<Response> {
    const appJwt = await this.getAppJwt();
    return fetch(`${GITHUB_API_BASE}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${appJwt}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "fusion-harness-pr-review",
        ...init.headers,
      },
    });
  }

  async fetchAsInstallation(installationId: number, path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getInstallationToken(installationId);
    return fetch(`${GITHUB_API_BASE}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `token ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "fusion-harness-pr-review",
        ...init.headers,
      },
    });
  }

  async getAppDetails(): Promise<GitHubAppDetails> {
    const response = await this.fetchAsApp("/app");
    if (!response.ok) {
      throw new Error(`GitHub App lookup failed (${response.status})`);
    }
    const body = (await response.json()) as {
      id: number;
      slug: string;
      name: string;
      html_url: string;
      owner?: { id: number };
    };
    return {
      id: body.id,
      slug: body.slug,
      name: body.name,
      htmlUrl: body.html_url,
      ownerId: body.owner?.id,
    };
  }

  private async importPrivateKey(): Promise<CryptoKey> {
    const pem = this.env.GITHUB_APP_PRIVATE_KEY;
    if (!pem) {
      throw new Error("GITHUB_APP_PRIVATE_KEY is not configured");
    }

    const jwk = pemRsaPrivateKeyToJwk(pem);
    return crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
}

export type GitHubAppDetails = {
  id: number;
  slug: string;
  name: string;
  htmlUrl: string;
  ownerId?: number;
};

export function clearInstallationTokenCache(installationId?: number) {
  if (installationId !== undefined) {
    tokenCache.delete(installationId);
    return;
  }
  tokenCache.clear();
}

export function base64UrlEncode(input: string | ArrayBuffer | Uint8Array): string {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type RsaJwk = {
  kty: "RSA";
  n: string;
  e: string;
  d: string;
  p: string;
  q: string;
  dp: string;
  dq: string;
  qi: string;
};

export function pemRsaPrivateKeyToJwk(pem: string): RsaJwk {
  const der = pemToDer(pem);
  const components = parseRsaPrivateKeyDer(der);
  return {
    kty: "RSA",
    n: base64UrlEncode(stripLeadingZeros(components.modulus)),
    e: base64UrlEncode(stripLeadingZeros(components.publicExponent)),
    d: base64UrlEncode(stripLeadingZeros(components.privateExponent)),
    p: base64UrlEncode(stripLeadingZeros(components.prime1)),
    q: base64UrlEncode(stripLeadingZeros(components.prime2)),
    dp: base64UrlEncode(stripLeadingZeros(components.exponent1)),
    dq: base64UrlEncode(stripLeadingZeros(components.exponent2)),
    qi: base64UrlEncode(stripLeadingZeros(components.coefficient)),
  };
}

function stripLeadingZeros(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) {
    i += 1;
  }
  return bytes.subarray(i);
}

function pemToDer(pem: string): Uint8Array {
  const stripped = pem
    .replace(/-----BEGIN[^-]*-----/g, "")
    .replace(/-----END[^-]*-----/g, "")
    .replace(/\s+/g, "");

  const binary = atob(stripped);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

type RsaPrivateKeyComponents = {
  modulus: Uint8Array;
  publicExponent: Uint8Array;
  privateExponent: Uint8Array;
  prime1: Uint8Array;
  prime2: Uint8Array;
  exponent1: Uint8Array;
  exponent2: Uint8Array;
  coefficient: Uint8Array;
};

export function parseRsaPrivateKeyDer(der: Uint8Array): RsaPrivateKeyComponents {
  const outer = readAsn1(der, 0);
  if (outer.tag !== 0x30) {
    throw new Error("Invalid RSA private key: expected SEQUENCE");
  }

  let inner = outer.content;

  const firstElement = readAsn1(inner, 0);

  if (firstElement.tag === 0x02) {
    const version = firstElement.content;
    if (version.length === 1 && (version[0] === 0 || version[0] === 1)) {
      return parsePkcs1RsaPrivateKey(outer.content, 0);
    }
  }

  if (firstElement.tag === 0x30) {
    return parsePkcs8RsaPrivateKey(outer.content);
  }

  throw new Error("Unsupported RSA private key encoding");
}

function parsePkcs1RsaPrivateKey(sequenceContent: Uint8Array, offset: number): RsaPrivateKeyComponents {
  let cursor = offset;
  const fields: Uint8Array[] = [];
  while (cursor < sequenceContent.length && fields.length < 9) {
    const element = readAsn1(sequenceContent, cursor);
    fields.push(element.content);
    cursor += element.totalLength;
  }

  if (fields.length < 9) {
    throw new Error("PKCS#1 RSA private key is missing components");
  }

  return {
    modulus: fields[1],
    publicExponent: fields[2],
    privateExponent: fields[3],
    prime1: fields[4],
    prime2: fields[5],
    exponent1: fields[6],
    exponent2: fields[7],
    coefficient: fields[8],
  };
}

function parsePkcs8RsaPrivateKey(sequenceContent: Uint8Array): RsaPrivateKeyComponents {
  let cursor = 0;
  const version = readAsn1(sequenceContent, cursor);
  cursor += version.totalLength;

  const algorithm = readAsn1(sequenceContent, cursor);
  cursor += algorithm.totalLength;

  const privateKeyOctetString = readAsn1(sequenceContent, cursor);
  const inner = readAsn1(privateKeyOctetString.content, 0);
  return parsePkcs1RsaPrivateKey(inner.content, 0);
}

type Asn1Element = {
  tag: number;
  content: Uint8Array;
  totalLength: number;
};

function readAsn1(bytes: Uint8Array, offset: number): Asn1Element {
  if (offset >= bytes.length) {
    throw new Error("ASN.1 parse error: offset out of range");
  }

  const tag = bytes[offset];
  const lengthByte = bytes[offset + 1];
  let contentLength: number;
  let headerLength: number;

  if (lengthByte < 0x80) {
    contentLength = lengthByte;
    headerLength = 2;
  } else {
    const lengthBytes = lengthByte & 0x7f;
    if (lengthBytes === 0 || offset + 2 + lengthBytes > bytes.length) {
      throw new Error("ASN.1 parse error: invalid length encoding");
    }
    contentLength = 0;
    for (let i = 0; i < lengthBytes; i += 1) {
      contentLength = (contentLength << 8) | bytes[offset + 2 + i];
    }
    headerLength = 2 + lengthBytes;
  }

  const contentStart = offset + headerLength;
  if (contentStart + contentLength > bytes.length) {
    throw new Error("ASN.1 parse error: content exceeds buffer");
  }

  return {
    tag,
    content: bytes.subarray(contentStart, contentStart + contentLength),
    totalLength: headerLength + contentLength,
  };
}