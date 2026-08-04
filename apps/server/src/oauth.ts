const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface GoogleAuthorizationOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes: readonly string[];
}

export interface GoogleAccountIdentity {
  email: string;
  emailVerified: boolean;
  hostedDomain?: string | null;
  allowedDomain: string;
  allowAnyVerifiedAccount?: boolean;
}

export function isGoogleEmailVerified(identity: {
  email_verified?: boolean | string;
  verified_email?: boolean | string;
}): boolean {
  const value = identity.email_verified ?? identity.verified_email;
  return value === true || value === "true";
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function createOAuthState(): string {
  return randomBase64Url(32);
}

export async function createPkcePair(): Promise<PkcePair> {
  const codeVerifier = randomBase64Url(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));

  return {
    codeVerifier,
    codeChallenge: base64Url(new Uint8Array(digest)),
  };
}

export function buildGoogleAuthorizationUrl(options: GoogleAuthorizationOptions): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    scope: options.scopes.join(" "),
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

export function validateOAuthState(expected: string, received: string): boolean {
  if (!expected || expected.length !== received.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  }
  return difference === 0;
}

export function isAllowedGoogleAccount(identity: GoogleAccountIdentity): boolean {
  const allowedDomain = identity.allowedDomain.trim().toLowerCase();
  const email = identity.email.trim().toLowerCase();
  const hostedDomain = identity.hostedDomain?.trim().toLowerCase();
  const emailDomain = email.split("@").at(-1);

  return (
    identity.emailVerified &&
    allowedDomain.length > 0 &&
    (identity.allowAnyVerifiedAccount ||
      (emailDomain === allowedDomain && hostedDomain === allowedDomain))
  );
}
