import { createPrismaClient } from "@qch-hermes/db";

import { hashOpaqueToken, timingSafeStringEqual } from "./secrets";

const SESSION_COOKIE = "qch_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type Database = ReturnType<typeof createPrismaClient>;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const cookie of cookieHeader.split(";")) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export interface AuthenticatedSession {
  id: string;
  ownerGoogleSub: string;
  ownerEmail: string;
}

export async function createSession(
  db: Database,
  ownerGoogleSub: string,
  ownerEmail: string,
): Promise<{ session: AuthenticatedSession; token: string }> {
  const token = randomToken();
  const now = new Date();
  const session = await db.session.create({
    data: {
      tokenHash: await hashOpaqueToken(token),
      ownerGoogleSub,
      ownerEmail,
      expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
    },
    select: { id: true, ownerGoogleSub: true, ownerEmail: true },
  });

  return { session, token };
}

export async function getSession(
  db: Database,
  request: Request,
): Promise<AuthenticatedSession | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: await hashOpaqueToken(token) },
    select: { id: true, ownerGoogleSub: true, ownerEmail: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;

  return {
    id: session.id,
    ownerGoogleSub: session.ownerGoogleSub,
    ownerEmail: session.ownerEmail,
  };
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function bearerToken(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return undefined;
  return value.slice("Bearer ".length).trim();
}

export function safeTokenEqual(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && timingSafeStringEqual(left, right));
}
