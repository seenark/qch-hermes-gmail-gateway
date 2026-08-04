# QCH-Hermes Gmail Gateway

QCH-Hermes เป็น Gmail gateway แบบ self-hosted สำหรับเชื่อมต่อ Gmail หลาย mailbox ผ่าน OAuth แบบ explicit consent แล้วเปิดความสามารถอ่านอีเมลให้กับ web UI และ MCP client ผ่าน backend authorization boundary เดียวกัน

## โปรเจคนี้ทำอะไร

- เชื่อมต่อ Gmail ได้หลายบัญชี โดยให้แต่ละบัญชีอนุมัติ OAuth แยกกัน
- ใช้ Gmail scope แบบ least privilege เริ่มต้นที่ `gmail.readonly`
- เก็บ Gmail refresh token แบบเข้ารหัส AES-GCM ใน SQLite ฝั่ง server
- ตรวจ session, mailbox ownership และสิทธิ์ก่อนอ่าน Gmail ทุกครั้ง
- มี MCP JSON-RPC endpoint สำหรับ `gmail_search` และ `gmail_get`
- บังคับให้ทุก Gmail MCP tool ระบุ `mailboxId`
- รองรับ disconnect/revoke mailbox
- เสิร์ฟ web UI, API, OAuth และ MCP จาก **single Docker container** เดียว

โปรเจคนี้ยังเป็น gateway ขนาดเล็ก ไม่ใช่ Google Workspace Domain-Wide Delegation และไม่ได้ให้สิทธิ์อ่าน mailbox ของทั้งองค์กรโดยอัตโนมัติ แต่ละ mailbox ต้องได้รับ consent เอง เว้นแต่ภายหลังจะติดตั้ง Workspace Domain-Wide Delegation อย่างถูกต้องโดย Super Admin

## Architecture

```text
Browser ───────────────┐
                       │ same origin :3300
MCP client ── Bearer ──┤
                       ▼
                 Bun + Elysia server
                 ├── Web UI static files
                 ├── OAuth/session boundary
                 ├── Gmail gateway
                 └── MCP JSON-RPC /mcp
                       │
                       ├── data/local.db
                       │     └── encrypted refresh tokens
                       └── Gmail API
```

## Requirements

- Docker Desktop with Docker Compose
- Google Cloud project
- Gmail API enabled
- Google OAuth Web application client
- OAuth redirect URI ที่ตรงกันทุกตัวอักษร

ไม่จำเป็นต้องติดตั้ง Bun เพื่อใช้งาน runtime แบบ Docker

## Google OAuth setup

ใน Google Cloud Console:

1. Enable Gmail API
2. Configure OAuth consent screen
3. Create OAuth Client ID ประเภท Web application
4. เพิ่ม redirect URI:

```text
http://localhost:3300/oauth/google/callback
```

5. ถ้า OAuth app ยังอยู่ใน Testing ให้เพิ่ม Google accounts ที่จะใช้เป็น test users

Production ควรใช้ domain policy จริงและห้ามใช้ development bypass:

```env
NODE_ENV=production
ALLOW_ANY_VERIFIED_GOOGLE_ACCOUNT=false
GOOGLE_ALLOWED_DOMAIN=company.example
```

การอยู่ใน company domain อย่างเดียวไม่ถือเป็น authorization; ผู้ใช้แต่ละคนยังต้อง approve OAuth consent

## Local Docker setup: single container

### 1. เตรียม environment

```bash
cp apps/server/.env.docker.example apps/server/.env
```

แก้ค่าใน `apps/server/.env`:

```env
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3300/oauth/google/callback
GOOGLE_ALLOWED_DOMAIN=company.example
TOKEN_ENCRYPTION_KEY=...
MCP_GATEWAY_KEY=...
```

สร้าง random secrets ตัวอย่าง:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
openssl rand -base64 48 | tr '+/' '-_' | tr -d '='
```

development-only ถ้าต้องการทดสอบ Gmail ส่วนตัว:

```env
NODE_ENV=development
ALLOW_ANY_VERIFIED_GOOGLE_ACCOUNT=true
```

ห้ามใช้ค่านี้ใน production

ตั้ง permission ของไฟล์ลับ:

```bash
chmod 600 apps/server/.env
```

### 2. เตรียม database

Docker Compose bind-mount database ที่:

```text
./data:/data
```

container ใช้:

```text
DATABASE_URL=file:/data/local.db
```

ถ้ามีฐานข้อมูลเดิมที่ root project ให้ย้ายครั้งแรกแบบไม่ overwrite database ที่มีอยู่แล้ว:

```bash
mkdir -p data
test -e data/local.db || cp local.db data/local.db
chmod 700 data
chmod 600 data/local.db
```

### 3. Build และ start

```bash
docker compose build
docker compose up -d
```

Single container นี้จะเปิด:

```text
Web UI:       http://localhost:3300
API:          http://localhost:3300
OAuth start:  http://localhost:3300/oauth/google/start
MCP:          http://localhost:3300/mcp
```

ตรวจสถานะ:

```bash
docker compose ps
curl http://localhost:3300/healthz
```

ควรได้:

```text
OK
```

ดู logs:

```bash
docker compose logs -f app
```

หยุด container โดยรักษา database:

```bash
docker compose down
```

อย่าใช้ `docker compose down -v` หากยังต้องการรักษาข้อมูล volume

## เชื่อมต่อ Gmail

1. เปิด `http://localhost:3300`
2. กด **เชื่อมต่อ Gmail**
3. เลือก Google account ที่ต้องการ
4. ตรวจสอบ OAuth consent และ approve scope ที่ร้องขอ
5. ทำซ้ำสำหรับ mailbox อื่น
6. หลัง callback สำเร็จ mailbox จะปรากฏใน web UI

ระบบเก็บเฉพาะ metadata ที่จำเป็นและ encrypted refresh token ฝั่ง server ไม่ส่ง refresh token ไป browser หรือ MCP client

การ disconnect จะทำให้ mailbox ไม่สามารถถูกใช้ผ่าน session/MCP ต่อ และเปิดทางให้ OAuth ใหม่สำหรับ mailbox นั้น

## Gmail credentials และ persistence

ใน SQLite ตาราง `Mailbox` จะเก็บ ciphertext และ IV ของ refresh token:

```text
refreshTokenCiphertext
refreshTokenIv
grantedScopes
```

`TOKEN_ENCRYPTION_KEY` อยู่นอก database และไม่อยู่ใน Docker image โดย Compose inject จาก `apps/server/.env`

ต้อง backup ทั้งสองอย่างแยกกัน:

1. `data/local.db`
2. `TOKEN_ENCRYPTION_KEY`

ถ้า database ยังอยู่แต่ encryption key หาย จะถอดรหัส refresh token เดิมไม่ได้

ห้ามเก็บ secret ใน:

- frontend หรือ `localStorage`
- URL หรือ query string
- committed file
- Dockerfile หรือ Docker image layer
- logs

## Customer deployment from Docker Hub

ลูกค้าไม่จำเป็นต้อง clone source code หรือ install Bun ลูกค้าสามารถ pull image จาก Docker Hub แล้วรัน container โดยตรงได้

Image:

```text
hadesgod/qch-hermes-gmail-gateway:latest
```

### Option A: Docker Compose สำหรับลูกค้า

ดาวน์โหลดไฟล์ customer Compose และ environment template:

```bash
mkdir qch-hermes-gmail-gateway
cd qch-hermes-gmail-gateway

curl -fsSLO https://raw.githubusercontent.com/seenark/qch-hermes-gmail-gateway/main/docker-compose.customer.yml
curl -fsSLO https://raw.githubusercontent.com/seenark/qch-hermes-gmail-gateway/main/apps/server/.env.docker.example
mv .env.docker.example .env
mkdir -p data
```

แก้ `.env` ก่อนเริ่ม โดยใส่ Google OAuth credentials, encryption key และ MCP gateway key:

```env
NODE_ENV=production
ALLOW_ANY_VERIFIED_GOOGLE_ACCOUNT=false
GOOGLE_OAUTH_CLIENT_ID=ลูกค้าใส่ค่าจริง
GOOGLE_OAUTH_CLIENT_SECRET=ลูกค้าใส่ค่าจริง
GOOGLE_OAUTH_REDIRECT_URI=https://gmail.example.com/oauth/google/callback
GOOGLE_ALLOWED_DOMAIN=customer.example.com
TOKEN_ENCRYPTION_KEY=สร้างค่า random ใหม่
MCP_GATEWAY_KEY=สร้างค่า random ใหม่
```

ใน Google Cloud Console ต้อง register redirect URI เดียวกันแบบ exact match ตัวอย่างด้านบน

เริ่มระบบ:

```bash
docker compose -f docker-compose.customer.yml pull
docker compose -f docker-compose.customer.yml up -d
```

ตรวจสถานะ:

```bash
docker compose -f docker-compose.customer.yml ps
curl -fsS http://localhost:3300/healthz
```

เปิด web UI ที่ `http://localhost:3300` หรือ public HTTPS URL ของ reverse proxy

ถ้า deploy หลัง reverse proxy ให้ใช้ HTTPS public URL ที่ proxy ส่งต่อมายัง container port `3300` และตั้งค่าใน `.env` ให้ตรงกัน:

```env
CORS_ORIGIN=https://gmail.example.com
GOOGLE_OAUTH_REDIRECT_URI=https://gmail.example.com/oauth/google/callback
```

### Option B: Docker CLI โดยตรง

หากใช้ Docker CLI โดยไม่ใช้ Compose ให้ดาวน์โหลดและแก้ `.env` template ตามขั้นตอน OAuth ด้านบนก่อน แล้วใช้คำสั่งต่อไปนี้:

```bash
mkdir -p qch-hermes-data
docker pull hadesgod/qch-hermes-gmail-gateway:latest

docker run -d \\
  --name qch-hermes-gmail-gateway \\
  --restart unless-stopped \\
  --env-file .env \\
  -e DATABASE_URL=file:/data/local.db \\
  -e PORT=3300 \\
  -e WEB_DIST_DIR=/app/public \\
  -p 3300:3300 \\
  -v "$PWD/qch-hermes-data:/data" \\
  hadesgod/qch-hermes-gmail-gateway:latest
```

ดู logs และหยุด container:

```bash
docker logs -f qch-hermes-gmail-gateway
docker stop qch-hermes-gmail-gateway
```

### Updating an existing customer deployment

Database อยู่ใน bind mount จึงไม่ควรถูกลบตอน update:

```bash
docker compose -f docker-compose.customer.yml pull
docker compose -f docker-compose.customer.yml up -d
```

ก่อน update ควร backup ทั้ง database และ encryption key:

```bash
cp data/local.db "data/local.db.backup.$(date +%Y%m%d%H%M%S)"
chmod 600 .env
```

ห้ามใช้ `docker compose down -v` และห้ามเปลี่ยน `TOKEN_ENCRYPTION_KEY` โดยไม่มีกระบวนการ key rotation ที่รองรับ เพราะ refresh token เดิมจะถอดรหัสไม่ได้

### Customer operations

```bash
# logs
docker compose -f docker-compose.customer.yml logs -f app

# status
docker compose -f docker-compose.customer.yml ps

# stop without deleting data
docker compose -f docker-compose.customer.yml down

# start again
docker compose -f docker-compose.customer.yml up -d
```

ลูกค้าควรจำกัดสิทธิ์ของเครื่องที่เก็บ `.env`, `data/local.db` และ `TOKEN_ENCRYPTION_KEY` ผู้ใช้งาน MCP ไม่ควรได้รับค่า Google client secret, refresh token หรือ encryption key

## MCP connection

MCP endpoint:

```text
http://localhost:3300/mcp
```

ใช้ header:

```text
Authorization: Bearer <MCP_GATEWAY_KEY>
Content-Type: application/json
```

MCP methods ที่มี:

- `initialize`
- `tools/list`
- `tools/call` สำหรับ `gmail_search`
- `tools/call` สำหรับ `gmail_get`

ทุก tool ต้องส่ง `mailboxId` ที่ได้จาก authenticated mailbox listing; ห้ามให้ MCP client ส่ง refresh token หรือ Google client secret

ตัวอย่าง shape ของ tool arguments:

```json
{
  "mailboxId": "mailbox-id-from-the-server",
  "query": "newer_than:1d"
}
```

สำหรับ `gmail_get` ให้ส่ง `mailboxId` และ `messageId`

## Development without Docker

Docker เป็นวิธีรันหลักที่แนะนำ แต่ยังสามารถทำ development แยก process ได้:

```bash
bun install
bun run db:generate
bun run db:push
bun run dev
```

โหมดนี้ใช้ web dev server และ API แยก port ตาม environment ของโปรเจค ส่วนการใช้งานจริง local ให้ใช้ Docker Compose single container ตามขั้นตอนด้านบน

## Verification commands

```bash
bun run lint
bun run check
bun run build
git diff --check
docker compose config --quiet
docker compose build
```

## Project structure

```text
apps/server/                 Elysia API, OAuth, Gmail gateway, MCP
apps/web/                    React/TanStack Router UI
packages/db/                 Prisma schema and SQLite adapter
packages/env/                server/web environment validation
Dockerfile                   single-container build
docker-compose.yml           runtime, bind mount, healthcheck
data/local.db                ignored persistent SQLite database
```

## Security notes

- ใช้ explicit OAuth consent ต่อ mailbox
- ใช้ PKCE และ one-time OAuth state
- ใช้ HTTP-only session cookie
- ใช้ encrypted refresh token at rest
- ใช้ exact-domain policy ใน production
- development allow-any account ต้องไม่เปิดใน production
- MCP ทุก operation ต้องผ่าน backend authorization
- Google client secret, encryption key และ gateway key ต้องอยู่นอก Git และ image

## License / public repository note

ก่อน push public ให้ตรวจว่าไม่มี `.env`, database, token, client secret หรือ generated credential อยู่ใน Git และตรวจ `git status` กับ secret scan ทุกครั้ง
