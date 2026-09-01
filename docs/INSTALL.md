# OmniAccess — Guía de Instalación y Operación

Esta guía cubre **dos topologías** de despliegue, las **variables de entorno**, la **base de datos y persistencia**, y la **recuperación ante fallos**.

- [A. Topología A — Monolito (una sola VM)](#a-topología-a--monolito-una-sola-vm)
- [B. Topología B — Contenedores separados (Proxmox LXC)](#b-topología-b--contenedores-separados-proxmox-lxc)
- [C. Variables de entorno (.env)](#c-variables-de-entorno-env)
- [D. Base de datos y persistencia](#d-base-de-datos-y-persistencia)
- [E. Recuperación ante fallos](#e-recuperación-ante-fallos)
- [F. Componentes externos (OpenWA, go2rtc, ffmpeg, Redis, MinIO)](#f-componentes-externos)

---

## Requisitos comunes

- **Node.js 20+** y npm.
- **PostgreSQL 14+**.
- **Redis 8** (cualquier 6+ sirve).
- **MinIO** (o cualquier S3 compatible).
- **go2rtc** (binario).
- **ffmpeg** (para clips animados).
- **PM2** (`npm i -g pm2`).
- Reverse proxy con TLS: **NGX Proxy Manager** (recomendado) o Nginx.
- (Opcional pero recomendado) **OpenWA** en Docker para WhatsApp.

Debian/Ubuntu, paquetes base:
```bash
apt-get update
apt-get install -y curl git ffmpeg redis-server postgresql ca-certificates
npm i -g pm2
```

> **Nota Debian (apt roto):** si `apt-get update` da 404 en los Release, asegurate de que `/etc/apt/sources.list.d/debian.sources` use **https** y la ruta `https://security.debian.org/debian-security` para `*-security`.

---

## A. Topología A — Monolito (una sola VM)

Todo (app, PostgreSQL, Redis, MinIO, go2rtc, ffmpeg) en una sola máquina. OpenWA puede ir aparte (recomendado) o en la misma con Docker.

### A.1 Servicios base

```bash
# PostgreSQL
systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER omni WITH PASSWORD 'CAMBIAR';"
sudo -u postgres psql -c "CREATE DATABASE lpr_db OWNER omni;"

# Redis (localhost, sin password; bind 127.0.0.1 ::1, protected-mode yes)
systemctl enable --now redis-server
redis-cli ping   # -> PONG

# MinIO (ejemplo binario)
#   crear datadir, usuario, y systemd unit; exponer :9000 (S3) y :9001 (consola)
#   ó usar el contenedor oficial minio/minio.

# go2rtc (binario + systemd) — config en /opt/OmniAccess/go2rtc.yaml
#   define los streams bosch_<ip_con_guionbajo> apuntando al RTSP de cada cámara.
```

### A.2 La aplicación

```bash
git clone https://github.com/flavioGonz/OmniAccess.git /opt/OmniAccess
cd /opt/OmniAccess
cp .env.example .env          # editar (ver sección C)
npm ci
npx prisma generate
npx prisma db push            # aplica el esquema SIN borrar datos
npm run build
```

### A.3 Procesos PM2

`ecosystem.config.js` (o arrancar manual):

```bash
pm2 start next-server.js     --name omniaccess-web        # :10001
pm2 start server.js          --name omniaccess-webhooks   # :10000 (socket.io)
pm2 start dispatch-worker.js --name dispatch-worker        # BullMQ
pm2 save
pm2 startup    # genera el servicio para que PM2 levante todo al bootear
```

### A.4 Tareas programadas (cron)

```cron
* * * * * wget -qO- http://127.0.0.1:10001/api/queue/schedule/tick >/dev/null 2>&1
* * * * * wget -qO- http://127.0.0.1:10001/api/queue/report/tick   >/dev/null 2>&1
```
(reset de contadores por horario y disparo de reportes programados)

### A.5 Reverse proxy (NGX Proxy Manager)

Proxy host `omniaccess.<dominio>` → `127.0.0.1:10001`, con estas **rutas custom**:

| Ruta | Destino | Por qué |
|---|---|---|
| `/io/` | `http://127.0.0.1:10000/` (WebSocket ON) | Socket.io (eventos en vivo) |
| `/go2rtc/` | `http://127.0.0.1:1984/` | Video MP4-over-HTTP |
| resto | `http://127.0.0.1:10001` | App Next.js |

> **Importante:** el video usa **MP4-over-HTTP** (`/go2rtc/api/stream.mp4`), **no** WebSocket — el path `/go2rtc/api/ws` falla con *"Invalid frame header"* a través del proxy.

---

## B. Topología B — Contenedores separados (Proxmox LXC)

Un LXC/contenedor por servicio. Bridge `vmbr0`, IPs en la misma LAN.

| Contenedor | Servicio | Puerto | Persistencia |
|---|---|---|---|
| `omniaccess-app` | Next.js + PM2 (web, webhooks, worker) + go2rtc | 10001/10000/1984 | código + `public/` (branding, clips) |
| `postgres` | PostgreSQL | 5432 | `/var/lib/postgresql` |
| `redis` | Redis 8 | 6379 | (efímero) |
| `minio` | MinIO | 9000/9001 | volumen de datos |
| `openwa` | Docker (OpenWA) | 2785/2886 | volumen del contenedor |
| `npm` | NGX Proxy Manager | 80/443 | config + certs |

Pasos:
1. Crear cada LXC (Debian 13). El de **OpenWA** necesita Docker → LXC **unprivileged con `features nesting=1,keyctl=1`**, `onboot=1`.
2. En `omniaccess-app`: igual que la Topología A pasos A.2–A.5, pero apuntando el `.env` a las IPs de los contenedores (`DATABASE_URL` → IP de postgres, `REDIS_URL` → IP de redis, `S3_ENDPOINT` → IP de minio, `OPENWA_URL` → IP de openwa).
3. go2rtc puede ir en el LXC de la app (necesita ver el RTSP de las cámaras) o en uno propio.
4. Redis/Postgres/Minio: bindear a la IP de la LAN (no solo 127.0.0.1) y restringir por firewall a la red interna.

### B.1 OpenWA (Docker, LXC propio)

```bash
# Dentro del LXC openwa (Docker + compose instalados):
git clone <repo-openwa> /opt/OpenWA
cd /opt/OpenWA
# Exponer a la LAN (por defecto bindea 127.0.0.1): cambiar a 0.0.0.0 los puertos
#   api 2785 y dashboard(traefik) 2886 en docker-compose.yml
# Gotcha build: el Dockerfile copia package*.json pero NO el .npmrc (legacy-peer-deps),
#   por lo que npm ci falla ERESOLVE. Fix: en dashboard/Dockerfile y Dockerfile.traefik
#   cambiar 'RUN npm ci' por 'RUN npm ci --legacy-peer-deps'.
docker compose --profile with-dashboard --profile with-proxy up -d
```
- **API:** `http://<ip-openwa>:2785` (auth header `X-API-Key`, key en `/app/data/.api-key`).
- **Dashboard:** `http://<ip-openwa>:2886` → escanear el **QR** una vez para vincular el número de WhatsApp.
- En OmniAccess, *Configuración → Notificaciones → WhatsApp (OpenWA)*: cargar URL, API Key, Sesión.

---

## C. Variables de entorno (.env)

```ini
# --- Base de datos ---
DATABASE_URL="postgresql://omni:CAMBIAR@127.0.0.1:5432/lpr_db"

# --- Auth ---
JWT_SECRET="<cadena-larga-aleatoria>"

# --- Redis / cola ---
REDIS_URL="redis://127.0.0.1:6379"

# --- MinIO / S3 ---
S3_ENDPOINT="http://127.0.0.1:9000"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="CAMBIAR"
S3_BUCKET_LPR="lpr"
S3_BUCKET_FACE="face"

# --- Web Push (PWAs) — generar con: npx web-push generate-vapid-keys ---
NEXT_PUBLIC_VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
VAPID_SUBJECT="mailto:admin@empresa.com"

# --- Base pública (para que Telegram/links resuelvan imágenes/clips) ---
PUBLIC_BASE_URL="https://omniaccess.<dominio>"
```

Otros valores (tokens de Telegram, credenciales OpenWA, destinatarios, etc.) se guardan en la **tabla `Setting`** desde la UI (no en el `.env`).

---

## D. Base de datos y persistencia

### Esquema
- ORM **Prisma** (`prisma/schema.prisma`). Modelos clave: `Device`, `QueueEvent`, `QueueAlert`, `NotificationRule`, `DispatchJob`, `ReportSchedule`, `Setting`, `CameraOutage`, usuarios, etc.
- Aplicar cambios de esquema **sin perder datos**: `npx prisma db push`. (Para migraciones versionadas: `npx prisma migrate deploy`.)

### Qué se persiste y dónde
| Dato | Almacén |
|---|---|
| Eventos de aforo, alertas, reglas, despachos, settings, usuarios | **PostgreSQL** |
| Snapshots (fotos de eventos), logos/branding | **MinIO/S3** |
| Cola de envíos en vuelo | **Redis** (efímero; los `DispatchJob` quedan en Postgres como histórico) |
| Sesión de WhatsApp | volumen del contenedor **OpenWA** |
| Config de streams | `go2rtc.yaml` |
| Clips animados | `public/clips/` (efímeros, autoborrado a los ~2 min) |

### Backups (recomendado)
```bash
# PostgreSQL (diario)
pg_dump -U omni lpr_db | gzip > /backups/lpr_db_$(date +%F).sql.gz

# MinIO (mirror a otro destino)
mc mirror minio/lpr /backups/minio/lpr

# Restore Postgres
gunzip -c lpr_db_YYYY-MM-DD.sql.gz | psql -U omni lpr_db
```
> Redis **no** necesita backup crítico: si se pierde, solo se pierden los envíos en vuelo (se pueden reintentar desde *Despachos*).

---

## E. Recuperación ante fallos

Diseño "se levanta solo": cada pieza reinicia por su cuenta.

| Si cae… | Qué pasa | Recuperación automática |
|---|---|---|
| **omniaccess-web** | se corta el conteo de aforo y la UI | **PM2** lo reinicia (`pm2 startup`+`pm2 save`). Al volver, `next-server.js` re-arranca el polling ONVIF (~9s) automáticamente |
| **omniaccess-webhooks** | los eventos en vivo dejan de llegar al navegador (aforo "congelado") | PM2 lo reinicia. *(Si cambiás `server.js`, hay que `pm2 restart omniaccess-webhooks` manual)* |
| **dispatch-worker** | las notificaciones quedan en cola (PENDING) | PM2 lo reinicia y **BullMQ reanuda** los jobs pendientes desde Redis (con backoff). Nada se pierde |
| **Redis** | no se pueden encolar nuevos despachos | `systemd` reinicia `redis-server`. El worker reconecta solo (`ioredis` con `maxRetriesPerRequest:null`) |
| **PostgreSQL** | la app no lee/escribe | `systemd` reinicia. Prisma reconecta. Restaurar de backup si hay corrupción |
| **MinIO** | no se guardan/leen snapshots (alertas van sin foto, con fallback a frame en vivo) | reiniciar el servicio/contenedor |
| **go2rtc** | no hay video en vivo | `systemd` reinicia; el front reintenta el stream (hasta 6 veces) solo |
| **OpenWA** | no salen WhatsApp (Telegram/Email siguen) | Docker `restart: unless-stopped` + `onboot=1` lo levantan al reiniciar. Si se **desvincula** la sesión, re-escanear QR en `:2886` |
| **Reinicio total del host** | — | PM2 (`startup`), systemd (redis/postgres/minio/go2rtc) y Docker (`onboot=1`, `restart:unless-stopped`) levantan todo sin intervención |

Checklist de salud:
```bash
pm2 status
redis-cli ping
systemctl status postgresql redis-server go2rtc
curl -s http://127.0.0.1:1984/api/streams        # go2rtc
# OpenWA: curl -s http://<ip>:2785/api/health  -> {"status":"ok"}
```

Pasos de recuperación manual típicos:
```bash
pm2 restart omniaccess-web omniaccess-webhooks dispatch-worker
systemctl restart redis-server go2rtc
# reintentar despachos fallidos: botón "reintentar" en /admin/despachos
```

---

## F. Componentes externos

### Redis + encolamiento (BullMQ)
- Cola `dispatch`. Productor: la app (`enqueueDispatch`). Consumidor: `dispatch-worker` (concurrencia 4, reintentos con backoff exponencial).
- Cada envío deja un `DispatchJob` en Postgres (PENDING→PROCESSING→SENT/FAILED) para trazabilidad.

### ffmpeg (clips animados)
- `apt-get install -y ffmpeg`. El worker genera un MP4 de ~3s (480px, 10fps) desde `http://127.0.0.1:1984/api/stream.mp4?src=bosch_<ip>` y lo envía como video (WhatsApp) / animación (Telegram). Toggle: *Notificaciones → Clip animado en alertas*.

### go2rtc
- `go2rtc.yaml` define cada stream. RTSP Bosch correcto:
  `rtsp://user:pass@<ip>/rtsp_tunnel?p=1&line=1&inst=2&vcd=2` (sub) / `inst=1` (main).
- Front consume **MP4-over-HTTP**, nunca WS (por el proxy).

### MinIO / S3
- Buckets `lpr`, `face` (configurables). Snapshots y branding. Explorador y políticas de retención en *Configuración → Almacenamiento*.

### OpenWA
- Reemplaza a WAHA. API REST por sesión: `POST /api/sessions/{id}/messages/send-text|send-image|send-video`. Webhook entrante (chatbot) → `/api/webhooks/whatsapp` de OmniAccess (en la allowlist pública del middleware).
