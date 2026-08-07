import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { env } from "@qch-hermes/env/web";

import { buildServerPath } from "../server-url";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

type Mailbox = {
  id: string;
  email: string;
  displayName: string | null;
  grantedScopes: string;
  createdAt: string;
  revokedAt: string | null;
};

const serverUrl = env.VITE_SERVER_URL;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(buildServerPath(path, serverUrl), {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

function HomeComponent() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMailboxes = useCallback(async () => {
    setLoading(true);
    try {
      const sessionResponse = await api("/api/session");
      const session = (await sessionResponse.json()) as { authenticated: boolean };
      setAuthenticated(session.authenticated);
      if (!session.authenticated) {
        setMailboxes([]);
        return;
      }

      const mailboxResponse = await api("/api/mailboxes");
      if (!mailboxResponse.ok) throw new Error("ไม่สามารถโหลด mailbox ได้");
      const payload = (await mailboxResponse.json()) as { mailboxes: Mailbox[] };
      setMailboxes(payload.mailboxes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMailboxes();
  }, [loadMailboxes]);

  async function revokeMailbox(id: string) {
    setError(null);
    try {
      const response = await api(`/api/mailboxes/${encodeURIComponent(id)}/revoke`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "ยกเลิกการเชื่อมต่อไม่สำเร็จ");
        return;
      }
      await loadMailboxes();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "ยกเลิกการเชื่อมต่อไม่สำเร็จ");
    }
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8 max-w-2xl">
        <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          QCH-Hermes Gmail Gateway
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">เชื่อมต่อ Gmail หลายบัญชีให้ MCP ใช้งาน</h1>
        <p className="mt-4 text-muted-foreground">
          แต่ละบัญชีต้องกดยินยอมกับ Google เอง ระบบจะเก็บเฉพาะ token ที่เข้ารหัสฝั่ง server และไม่ส่ง token ให้
          browser หรือโมเดล
        </p>
      </div>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-medium">Mailbox ที่เชื่อมต่อแล้ว</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              ทุก browser ที่ authenticate แล้วจะเห็น mailbox ที่ยังใช้งานได้ทั้งหมด และ MCP ต้องระบุ mailbox ID
            </p>
          </div>
          <a
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            href={buildServerPath("/oauth/google/start", serverUrl)}
          >
            {authenticated ? "เพิ่ม Gmail อีกบัญชี" : "เชื่อมต่อ Gmail"}
          </a>
        </div>

        {error ? (
          <p className="mt-5 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {loading ? <p className="mt-6 text-sm text-muted-foreground">กำลังโหลด...</p> : null}
        {!loading && mailboxes.length === 0 ? (
          <p className="mt-6 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            ยังไม่มี mailbox — กดเชื่อมต่อเพื่อเริ่ม OAuth consent
          </p>
        ) : null}
        <div className="mt-6 grid gap-3">
          {mailboxes.map((mailbox) => (
            <div
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
              key={mailbox.id}
            >
              <div>
                <p className="font-medium">{mailbox.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">Mailbox ID: {mailbox.id}</p>
                <p className="text-xs text-muted-foreground">Scope: {mailbox.grantedScopes}</p>
              </div>
              <button
                className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                onClick={() => void revokeMailbox(mailbox.id)}
                type="button"
              >
                ยกเลิกการเชื่อมต่อ
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
