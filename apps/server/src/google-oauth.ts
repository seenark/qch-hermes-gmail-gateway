import prisma from "@qch-hermes/db";
import { env } from "@qch-hermes/env/server";

import {
  buildGoogleAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  isGoogleEmailVerified,
  isAllowedGoogleAccount,
} from "./oauth";
import {
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  GOOGLE_IDENTITY_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_TOKENINFO_ENDPOINT,
  requireOAuthConfig,
} from "./config";
import { encryptSecret, hashOpaqueToken } from "./secrets";
import { createSession, getSession, sessionCookie } from "./sessions";

const WEB_AFTER_OAUTH = env.CORS_ORIGIN;
const STATE_TTL_MS = 10 * 60 * 1000;

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  verified_email?: boolean | string;
  hd?: string;
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function failure(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<GoogleTokenResponse & { access_token: string }> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });
  const result = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description ?? result.error ?? "Google token exchange failed");
  }
  return result as GoogleTokenResponse & { access_token: string };
}

async function fetchGoogleIdentity(accessToken: string): Promise<GoogleTokenInfo> {
  const response = await fetch(
    `${GOOGLE_TOKENINFO_ENDPOINT}?access_token=${encodeURIComponent(accessToken)}`,
  );
  const identity = (await response.json()) as GoogleTokenInfo;
  if (!response.ok || !identity.sub || !identity.email) {
    throw new Error("Google identity verification failed");
  }
  return identity;
}

export async function startGoogleOAuth(request: Request): Promise<Response> {
  const config = requireOAuthConfig();
  const pkce = await createPkcePair();
  const state = createOAuthState();
  const session = await getSession(prisma, request);

  await prisma.oAuthState.create({
    data: {
      stateHash: await hashOpaqueToken(state),
      codeVerifier: pkce.codeVerifier,
      sessionId: session?.id,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });

  return redirect(
    buildGoogleAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      codeChallenge: pkce.codeChallenge,
      scopes: [...GOOGLE_IDENTITY_SCOPES, GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE],
    }),
  );
}

export async function completeGoogleOAuth(
  code: string | undefined,
  state: string | undefined,
): Promise<Response> {
  if (!code || !state) return failure(400, "Missing OAuth code or state");

  const config = requireOAuthConfig();
  const oauthState = await prisma.oAuthState.findUnique({
    where: { stateHash: await hashOpaqueToken(state) },
  });
  if (!oauthState || oauthState.expiresAt <= new Date()) {
    return failure(400, "Invalid or expired OAuth state");
  }
  await prisma.oAuthState.delete({ where: { id: oauthState.id } });

  const token = await exchangeCode(
    code,
    oauthState.codeVerifier,
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
  const identity = await fetchGoogleIdentity(token.access_token);
  const emailVerified = isGoogleEmailVerified(identity);

  if (
    !isAllowedGoogleAccount({
      email: identity.email as string,
      emailVerified,
      hostedDomain: identity.hd,
      allowedDomain: config.allowedDomain,
      allowAnyVerifiedAccount: config.allowAnyVerifiedAccount,
    })
  ) {
    return failure(403, "This Google account is not allowed by the company-domain policy");
  }

  const existingMailbox = await prisma.mailbox.findUnique({
    where: { googleSub: identity.sub as string },
  });
  const session = oauthState.sessionId
    ? await prisma.session.findUnique({
        where: { id: oauthState.sessionId },
        select: { id: true, ownerGoogleSub: true, ownerEmail: true, expiresAt: true },
      })
    : null;
  const activeSession = session && session.expiresAt > new Date() ? session : null;

  const actorGoogleSub = activeSession?.ownerGoogleSub ?? (identity.sub as string);
  const ownerGoogleSub = existingMailbox?.ownerGoogleSub ?? actorGoogleSub;
  const encryptedRefreshToken = token.refresh_token
    ? await encryptSecret(token.refresh_token, config.encryptionKey)
    : null;
  if (!encryptedRefreshToken && !existingMailbox) {
    return failure(400, "Google did not return a refresh token; retry with consent");
  }

  await prisma.$transaction(async (tx) => {
    await tx.mailbox.upsert({
      where: { googleSub: identity.sub as string },
      create: {
        ownerGoogleSub,
        googleSub: identity.sub as string,
        email: identity.email as string,
        displayName: identity.email as string,
        refreshTokenCiphertext: encryptedRefreshToken?.ciphertext ?? "",
        refreshTokenIv: encryptedRefreshToken?.iv ?? "",
        grantedScopes: token.scope ?? `${GMAIL_READONLY_SCOPE} ${GMAIL_SEND_SCOPE}`,
      },
      update: {
        email: identity.email as string,
        revokedAt: null,
        ...(encryptedRefreshToken
          ? {
              refreshTokenCiphertext: encryptedRefreshToken.ciphertext,
              refreshTokenIv: encryptedRefreshToken.iv,
            }
          : {}),
        grantedScopes: token.scope ?? `${GMAIL_READONLY_SCOPE} ${GMAIL_SEND_SCOPE}`,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorGoogleSub,
        action: existingMailbox ? "mailbox.reauthorized" : "mailbox.authorized",
        mailboxId: existingMailbox?.id,
        metadata: JSON.stringify({ email: identity.email, scopes: token.scope }),
      },
    });
  });

  const responseSession = activeSession
    ? { session: activeSession, token: undefined }
    : await createSession(prisma, actorGoogleSub, identity.email as string);
  return redirect(
    `${WEB_AFTER_OAUTH}?gmail=connected`,
    responseSession.token
      ? sessionCookie(responseSession.token, process.env.NODE_ENV === "production")
      : undefined,
  );
}

export function oauthErrorResponse(error: unknown): Response {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error("Google OAuth error", detail);
  return failure(500, "Google OAuth could not be completed");
}
