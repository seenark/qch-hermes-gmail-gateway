import prisma from "@qch-hermes/db";

import {
  GMAIL_API_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  requireMcpGatewayKey,
  requireOAuthConfig,
} from "./config";
import { decryptSecret } from "./secrets";
import { bearerToken, getSession, safeTokenEqual, type AuthenticatedSession } from "./sessions";

interface GoogleRefreshResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export interface MailboxSummary {
  id: string;
  email: string;
  displayName: string | null;
  grantedScopes: string;
  createdAt: Date;
  revokedAt: Date | null;
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const config = requireOAuthConfig();
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const result = (await response.json()) as GoogleRefreshResponse;
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description ?? result.error ?? "Google token refresh failed");
  }
  return result.access_token;
}

async function getMailboxAccessToken(mailboxId: string): Promise<string> {
  const config = requireOAuthConfig();
  const mailbox = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
  if (!mailbox || mailbox.revokedAt) throw new Error("Mailbox is unavailable");

  const refreshToken = await decryptSecret(
    { ciphertext: mailbox.refreshTokenCiphertext, iv: mailbox.refreshTokenIv },
    config.encryptionKey,
  );
  return refreshAccessToken(refreshToken);
}

async function authorizedMailbox(
  request: Request,
  mailboxId: string,
): Promise<{ mailboxId: string; actorGoogleSub: string } | null> {
  const session = await getSession(prisma, request);
  if (!session) return null;

  const mailbox = await prisma.mailbox.findFirst({
    where: { id: mailboxId, revokedAt: null },
    select: { id: true },
  });
  return mailbox ? { mailboxId: mailbox.id, actorGoogleSub: session.ownerGoogleSub } : null;
}

async function mcpAuthorized(
  request: Request,
  mailboxId: string,
): Promise<{ mailboxId: string; actorGoogleSub: string } | null> {
  const configuredKey = (() => {
    try {
      return requireMcpGatewayKey();
    } catch {
      return undefined;
    }
  })();
  if (!safeTokenEqual(bearerToken(request), configuredKey)) return null;

  const mailbox = await prisma.mailbox.findFirst({
    where: { id: mailboxId, revokedAt: null },
    select: { id: true, ownerGoogleSub: true },
  });
  return mailbox ? { mailboxId: mailbox.id, actorGoogleSub: mailbox.ownerGoogleSub } : null;
}

async function gmailRequest(
  mailboxId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const accessToken = await getMailboxAccessToken(mailboxId);
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("accept", "application/json");
  return fetch(`${GMAIL_API_ENDPOINT}/users/me${path}`, { ...init, headers });
}

async function audit(
  actorGoogleSub: string,
  mailboxId: string,
  action: string,
  metadata?: unknown,
) {
  await prisma.auditEvent.create({
    data: {
      actorGoogleSub,
      mailboxId,
      action,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  });
}

async function findActiveMailboxes(): Promise<MailboxSummary[]> {
  return prisma.mailbox.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      displayName: true,
      grantedScopes: true,
      createdAt: true,
      revokedAt: true,
    },
  });
}

export async function listMailboxes(request: Request): Promise<Response> {
  const session = await getSession(prisma, request);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  return Response.json({ mailboxes: await findActiveMailboxes() });
}

export async function listMcpMailboxes(): Promise<MailboxSummary[]> {
  return findActiveMailboxes();
}

export async function revokeMailbox(request: Request, mailboxId: string): Promise<Response> {
  const authorized = await authorizedMailbox(request, mailboxId);
  if (!authorized) return Response.json({ error: "Mailbox not found" }, { status: 404 });

  await prisma.mailbox.update({ where: { id: mailboxId }, data: { revokedAt: new Date() } });
  await audit(authorized.actorGoogleSub, mailboxId, "mailbox.revoked");
  return Response.json({ status: "revoked" });
}

export async function gmailSearch(
  request: Request,
  mailboxId: string,
  mcp = false,
): Promise<Response> {
  const authorized = mcp
    ? await mcpAuthorized(request, mailboxId)
    : await authorizedMailbox(request, mailboxId);
  if (!authorized)
    return Response.json(
      { error: mcp ? "MCP authentication or mailbox authorization failed" : "Mailbox not found" },
      { status: mcp ? 401 : 404 },
    );

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const maxResults = Math.min(Math.max(Number(url.searchParams.get("max") ?? "20") || 20, 1), 100);
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (query) params.set("q", query);

  const response = await gmailRequest(authorized.mailboxId, `/messages?${params.toString()}`);
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    return Response.json(
      { error: "Gmail request failed", details: payload },
      { status: response.status },
    );

  await audit(authorized.actorGoogleSub, authorized.mailboxId, "gmail.search", {
    query,
    maxResults,
  });
  return Response.json({ mailboxId: authorized.mailboxId, query, ...payload });
}

export async function gmailGet(
  request: Request,
  mailboxId: string,
  messageId: string,
  mcp = false,
): Promise<Response> {
  const authorized = mcp
    ? await mcpAuthorized(request, mailboxId)
    : await authorizedMailbox(request, mailboxId);
  if (!authorized)
    return Response.json(
      { error: mcp ? "MCP authentication or mailbox authorization failed" : "Mailbox not found" },
      { status: mcp ? 401 : 404 },
    );

  const response = await gmailRequest(
    authorized.mailboxId,
    `/messages/${encodeURIComponent(messageId)}?format=full`,
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    return Response.json(
      { error: "Gmail request failed", details: payload },
      { status: response.status },
    );

  await audit(authorized.actorGoogleSub, authorized.mailboxId, "gmail.get", { messageId });
  return Response.json({ mailboxId: authorized.mailboxId, ...payload });
}

export async function getSessionForRequest(request: Request): Promise<AuthenticatedSession | null> {
  return getSession(prisma, request);
}
