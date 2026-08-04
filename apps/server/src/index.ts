import path from "node:path";

import { cors } from "@elysiajs/cors";
import { env } from "@qch-hermes/env/server";
import { Elysia } from "elysia";

import { completeGoogleOAuth, oauthErrorResponse, startGoogleOAuth } from "./google-oauth";
import {
  getSessionForRequest,
  gmailGet,
  gmailSearch,
  listMailboxes,
  revokeMailbox,
} from "./gmail-gateway";
import { handleMcp } from "./mcp";

const webRoot = process.env.WEB_DIST_DIR ?? path.join(process.cwd(), "public");

async function serveWeb(request: Request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  if (relativePath.includes("..")) return new Response("Not found", { status: 404 });

  const requestedFile = Bun.file(path.join(webRoot, relativePath));
  const fileExists = await requestedFile.exists();
  const file = fileExists ? requestedFile : Bun.file(path.join(webRoot, "index.html"));
  const extension = path.extname(fileExists ? relativePath : "index.html");
  const contentType =
    extension === ".html"
      ? "text/html; charset=utf-8"
      : extension === ".js"
        ? "text/javascript; charset=utf-8"
        : extension === ".css"
          ? "text/css; charset=utf-8"
          : extension === ".json"
            ? "application/json; charset=utf-8"
            : undefined;

  return (await file.exists())
    ? new Response(file, contentType ? { headers: { "content-type": contentType } } : undefined)
    : new Response("Not found", { status: 404 });
}

const app = new Elysia()
  .use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
    }),
  )
  .get("/healthz", () => "OK")
  .get("/oauth/google/start", async ({ request }) => {
    try {
      return await startGoogleOAuth(request);
    } catch (error) {
      return oauthErrorResponse(error);
    }
  })
  .get("/oauth/google/callback", async ({ query }) => {
    try {
      return await completeGoogleOAuth(query.code, query.state);
    } catch (error) {
      return oauthErrorResponse(error);
    }
  })
  .get("/api/session", async ({ request }) => {
    const session = await getSessionForRequest(request);
    return session ? { authenticated: true, email: session.ownerEmail } : { authenticated: false };
  })
  .get("/api/mailboxes", async ({ request }) => listMailboxes(request))
  .post("/api/mailboxes/:mailboxId/revoke", async ({ request, params }) =>
    revokeMailbox(request, params.mailboxId),
  )
  .get("/api/mailboxes/:mailboxId/gmail/search", async ({ request, params }) =>
    gmailSearch(request, params.mailboxId),
  )
  .get("/api/mailboxes/:mailboxId/gmail/messages/:messageId", async ({ request, params }) =>
    gmailGet(request, params.mailboxId, params.messageId),
  )
  .get("/mcp/gmail/search", async ({ request, query }) => {
    if (!query.mailboxId) return Response.json({ error: "mailboxId is required" }, { status: 400 });
    return gmailSearch(request, query.mailboxId, true);
  })
  .get("/mcp/gmail/messages/:messageId", async ({ request, params, query }) => {
    if (!query.mailboxId) return Response.json({ error: "mailboxId is required" }, { status: 400 });
    return gmailGet(request, query.mailboxId, params.messageId, true);
  })
  .post("/mcp", ({ request }) => handleMcp(request))
  .get("/*", ({ request }) => serveWeb(request))
  .listen(env.PORT, () => {
    console.log(`Server is running on http://localhost:${env.PORT}`);
  });

export type App = typeof app;
