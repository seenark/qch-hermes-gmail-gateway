import { describe, expect, mock, test } from "bun:test";

const mailboxSummaries = [
  {
    id: "mailbox-one",
    email: "one@example.com",
    displayName: "one@example.com",
    grantedScopes: "https://www.googleapis.com/auth/gmail.readonly",
    createdAt: new Date("2026-08-05T00:00:00.000Z"),
    revokedAt: null,
  },
  {
    id: "mailbox-two",
    email: "two@example.com",
    displayName: "two@example.com",
    grantedScopes: "https://www.googleapis.com/auth/gmail.readonly",
    createdAt: new Date("2026-08-05T00:01:00.000Z"),
    revokedAt: null,
  },
];
type MailboxPayload = Omit<(typeof mailboxSummaries)[number], "createdAt"> & {
  createdAt: string;
};

mock.module("./config", () => ({
  requireMcpGatewayKey: () => "test-mcp-key",
}));
mock.module("./gmail-gateway", () => ({
  gmailGet: async () => Response.json({}),
  gmailSearch: async () => Response.json({}),
  listMcpMailboxes: async () => mailboxSummaries,
}));
mock.module("./sessions", () => ({
  bearerToken: (request: Request) => request.headers.get("authorization")?.slice("Bearer ".length),
  safeTokenEqual: (left: string | undefined, right: string | undefined) => left === right,
}));

// Load the handler after installing module mocks so the test stays isolated from Prisma and Google APIs.
const { handleMcp } = await import("./mcp");

describe("MCP global mailbox access", () => {
  test("lists every active mailbox without requiring a mailbox ID", async () => {
    const response = await handleMcp(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test-mcp-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "gmail_list_mailboxes", arguments: {} },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result: { structuredContent: { mailboxes: MailboxPayload[] } };
    };
    expect(payload.result.structuredContent.mailboxes).toEqual(
      mailboxSummaries.map((mailbox) => ({
        ...mailbox,
        createdAt: mailbox.createdAt.toISOString(),
      })),
    );
  });
  test("advertises mailbox discovery to MCP clients", async () => {
    const response = await handleMcp(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { authorization: "Bearer test-mcp-key", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(payload.result.tools.some((tool) => tool.name === "gmail_list_mailboxes")).toBe(true);
  });

  test("still requires the gateway key", async () => {
    const response = await handleMcp(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { authorization: "Bearer wrong-key", "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "gmail_list_mailboxes", arguments: {} },
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: number; message: string } };
    expect(payload.error.code).toBe(-32001);
    expect(payload.error.message).toBe("MCP authentication failed");
  });
});
