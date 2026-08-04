import { env } from "@qch-hermes/env/server";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"] as const;
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";
export const GMAIL_API_ENDPOINT = "https://gmail.googleapis.com/gmail/v1";

export function requireOAuthConfig() {
  const values = {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
    allowedDomain: env.GOOGLE_ALLOWED_DOMAIN,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    allowAnyVerifiedAccount:
      env.ALLOW_ANY_VERIFIED_GOOGLE_ACCOUNT === "true" && env.NODE_ENV !== "production",
  };

  if (
    !values.clientId ||
    !values.clientSecret ||
    !values.redirectUri ||
    !values.allowedDomain ||
    !values.encryptionKey
  ) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, GOOGLE_ALLOWED_DOMAIN, and TOKEN_ENCRYPTION_KEY.",
    );
  }

  const encryptionKey = new Uint8Array(Buffer.from(values.encryptionKey as string, "base64url"));
  if (encryptionKey.byteLength !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a base64url-encoded 32-byte key");
  }

  return {
    clientId: values.clientId as string,
    clientSecret: values.clientSecret as string,
    redirectUri: values.redirectUri as string,
    allowedDomain: values.allowedDomain as string,
    encryptionKey,
    allowAnyVerifiedAccount: values.allowAnyVerifiedAccount,
  };
}

export function requireMcpGatewayKey(): string {
  if (!env.MCP_GATEWAY_KEY) {
    throw new Error("MCP_GATEWAY_KEY is not configured");
  }
  return env.MCP_GATEWAY_KEY;
}
