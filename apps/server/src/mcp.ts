import { requireMcpGatewayKey } from "./config";
import { gmailGet, gmailSearch } from "./gmail-gateway";
import { bearerToken, safeTokenEqual } from "./sessions";

type JsonRpcRequest = {
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const TOOLS = [
  {
    name: "gmail_search",
    description: "Search messages in one explicitly selected authorized Gmail mailbox.",
    inputSchema: {
      type: "object",
      properties: {
        mailboxId: { type: "string", description: "Mailbox ID returned by the gateway UI" },
        q: { type: "string", description: "Gmail search query" },
        max: { type: "number", minimum: 1, maximum: 100 },
      },
      required: ["mailboxId"],
    },
  },
  {
    name: "gmail_get",
    description: "Read one message from one explicitly selected authorized Gmail mailbox.",
    inputSchema: {
      type: "object",
      properties: {
        mailboxId: { type: "string" },
        messageId: { type: "string" },
      },
      required: ["mailboxId", "messageId"],
    },
  },
];

function rpc(id: JsonRpcRequest["id"], result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status: 400 },
  );
}

function stringArg(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function handleMcp(request: Request): Promise<Response> {
  let configuredKey: string;
  try {
    configuredKey = requireMcpGatewayKey();
  } catch {
    return rpcError(null, -32001, "MCP gateway is not configured");
  }
  if (!safeTokenEqual(bearerToken(request), configuredKey)) {
    return rpcError(null, -32001, "MCP authentication failed");
  }

  let message: JsonRpcRequest;
  try {
    message = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Invalid JSON");
  }

  if (message.method === "initialize") {
    return rpc(message.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "qch-hermes-gmail-gateway", version: "0.1.0" },
    });
  }
  if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (message.method === "tools/list") return rpc(message.id, { tools: TOOLS });
  if (message.method !== "tools/call") return rpcError(message.id, -32601, "Method not found");

  const params = message.params ?? {};
  const name = stringArg(params, "name");
  const argumentsValue = params.arguments;
  const args =
    argumentsValue && typeof argumentsValue === "object"
      ? (argumentsValue as Record<string, unknown>)
      : {};
  const mailboxId = stringArg(args, "mailboxId");
  if (!name || !mailboxId) return rpcError(message.id, -32602, "name and mailboxId are required");

  let result: Response;
  if (name === "gmail_search") {
    const url = new URL("/mcp/gmail/search", request.url);
    url.searchParams.set("mailboxId", mailboxId);
    const query = stringArg(args, "q");
    if (query) url.searchParams.set("q", query);
    const max = typeof args.max === "number" ? String(args.max) : undefined;
    if (max) url.searchParams.set("max", max);
    result = await gmailSearch(
      new Request(url.toString(), { headers: request.headers }),
      mailboxId,
      true,
    );
  } else if (name === "gmail_get") {
    const messageId = stringArg(args, "messageId");
    if (!messageId) return rpcError(message.id, -32602, "messageId is required");
    result = await gmailGet(
      new Request(
        new URL(
          `/mcp/gmail/messages/${encodeURIComponent(messageId)}?mailboxId=${encodeURIComponent(mailboxId)}`,
          request.url,
        ).toString(),
        {
          headers: request.headers,
        },
      ),
      mailboxId,
      messageId,
      true,
    );
  } else {
    return rpcError(message.id, -32602, `Unknown tool: ${name}`);
  }

  const payload = await result.json();
  if (!result.ok) return rpcError(message.id, -32000, JSON.stringify(payload));
  return rpc(message.id, {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  });
}
