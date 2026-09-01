# OmniAccess

Plataforma unificada de control de acceso y **control de filas (aforo)** con video en vivo, analíticas ONVIF, notificaciones multicanal (Telegram / WhatsApp / Email / Web Push) y PWAs instalables.

Repo: https://github.com/flavioGonz/OmniAccess

---

## 1. ¿Qué hace?

OmniAccess opera en **modos exclusivos** (se activa uno a la vez desde *Configuración → Modo*):

- **Control de Fila (Queue / aforo)** — cuenta personas por cámara (Bosch IVA Pro vía ONVIF), muestra video RTSP en vivo, dispara alertas por umbral, estima tiempo de espera, y notifica con foto o clip animado.
- **LPR** — lectura de matrículas (Hikvision / Avicam).
- **Face** — reconocimiento facial (terminales / intercom Akuvox).

Funcionalidad transversal: dispositivos, topología de red, mapas (foto y geográfico), reportes (Excel/PDF con branding), branding del login, gestión de almacenamiento MinIO/S3, y PWAs.

---

## 2. Arquitectura

```
                        Internet / LAN
                              │
                  ┌───────────▼───────────┐
                  │   NGX Proxy Manager    │  (TLS, reverse proxy)
                  │  omniaccess.<dominio>  │
                  └───┬─────────┬──────────┘
        /  ,/admin,/api│         │/io  (socket.io)   /go2rtc (video)
                       │         │                    │
              ┌────────▼───┐ ┌───▼─────────┐  ┌───────▼────────┐
              │ Next.js app│ │ server.js   │  │   go2rtc       │
              │ (web :10001)│ │(webhooks    │  │  (:1984)       │
              │  PM2        │ │ :10000) PM2 │  │  systemd       │
              │  - UI/API   │ │ - Socket.io │  │  RTSP→MP4/WS   │
              │  - actions  │ │ - global.io │  └───────┬────────┘
              │  - onvif-   │ │ - ONVIF push│          │ RTSP
              │    polling  │ │ - /internal/│          ▼
              └──┬───┬───┬──┘ │   emit      │      Cámaras Bosch
                 │   │   │    └─────────────┘      (172.26.20.x)
                 │   │   │
     ┌───────────┘   │   └──────────────┐
     ▼               ▼                  ▼
┌─────────┐   ┌────────────┐    ┌──────────────┐
│PostgreSQL│   │  MinIO/S3  │    │   Redis 8    │
│ (Prisma) │   │ (snapshots,│    │  (BullMQ)    │
│          │   │  branding) │    └──────┬───────┘
└─────────┘   └────────────┘           │ cola "dispatch"
                                        ▼
                               ┌──────────────────┐
                               │ dispatch-worker  │ PM2
                               │ (BullMQ Worker)  │
                               │ envía: Telegram, │
                               │ WhatsApp(OpenWA),│
                               │ Email, clips     │
                               └────────┬─────────┘
                                        │ HTTP API
                                        ▼
                               ┌──────────────────┐
                               │ OpenWA (Docker)  │  LXC aparte
                               │ WhatsApp gateway │  :2785 / :2886
                               └──────────────────┘
```

### Procesos PM2 (en el host de la app)

| Proceso | Archivo | Puerto | Rol |
|---|---|---|---|
| `omniaccess-web` | `next-server.js` | 10001 | UI, API routes, server actions, **onvif-polling** (conteo de aforo) |
| `omniaccess-webhooks` | `server.js` | 10000 | **Socket.io** (`global.io`), ONVIF push (WSBaseNotification), `/internal/emit` |
| `dispatch-worker` | `dispatch-worker.js` | — | **BullMQ Worker** de la cola `dispatch`: envía alertas/reportes/clips con reintentos |

`onvif-polling` (en el proceso web) detecta los eventos de la cámara → POST a `127.0.0.1:10000/internal/emit` → `global.io.emit` → el navegador (admin y PWAs) recibe `queue_update` / `queue_alert` en vivo.

### Servicios de plataforma

| Servicio | Cómo corre | Persistencia |
|---|---|---|
| **PostgreSQL** | systemd / contenedor | `/var/lib/postgresql` (datos) |
| **Redis 8** | systemd (`redis-server`) | Cola efímera (BullMQ). No requiere persistencia crítica |
| **MinIO / S3** | systemd / contenedor | buckets `lpr`, `face`, etc. (snapshots, branding) |
| **go2rtc** | systemd | `go2rtc.yaml` (config de streams) |
| **ffmpeg** | binario del SO | — (genera clips MP4 efímeros en `public/clips`, autoborrado) |
| **OpenWA** | Docker (LXC aparte) | SQLite + sesión WhatsApp en el volumen del contenedor |

---

## 3. Tecnologías

- **Next.js 16** (App Router, Turbopack), React 19, Tailwind v4 + shadcn (tokens semánticos, light/dark).
- **Prisma 5** + **PostgreSQL**.
- **Redis 8** + **BullMQ** (cola de despacho con reintentos/backoff).
- **Socket.io** (eventos en vivo).
- **go2rtc** (RTSP unificado → MP4-over-HTTP / WS).
- **ffmpeg** (clips animados para alertas).
- **web-push** (VAPID) para las PWAs.
- **OpenWA** (NestJS + whatsapp-web.js, autohospedado) para WhatsApp.
- **Telegram Bot API**.
- **MinIO** (S3 compatible) para objetos.
- **PM2** (gestor de procesos) + **NGX Proxy Manager** (TLS/reverse proxy).

---

## 4. Instalación

Ver guía detallada: **[docs/INSTALL.md](docs/INSTALL.md)**

Cubre:
- Instalación **monolito** (todo en una sola VM) y **contenedores separados** (Proxmox LXC por servicio).
- Variables de entorno (`.env`).
- Base de datos y **persistencia de datos**.
- **Recuperación ante fallos** (qué pasa si cae cada servicio y cómo se reinicia solo).
- OpenWA, Redis + encolamiento, ffmpeg, go2rtc, MinIO, PM2, proxy.

### Quick start (monolito, resumen)

```bash
git clone https://github.com/flavioGonz/OmniAccess.git /opt/OmniAccess
cd /opt/OmniAccess
cp .env.example .env          # editar credenciales (ver INSTALL.md)
npm ci
npx prisma generate
npx prisma db push            # crea/actualiza el esquema (no borra datos)
npm run build
pm2 start ecosystem.config.js # o los 3 procesos manualmente
pm2 save
```

Servicios base que deben estar arriba: PostgreSQL, Redis, MinIO, go2rtc, ffmpeg instalado, y (opcional) OpenWA.

---

## 5. Notificaciones / Despachos (Redis + cola)

1. **Disparo:** una *Alerta de aforo* (`/admin/filas`) o una *Regla de notificación* (`/admin/notificaciones`) que supera su umbral.
2. **Encolado:** se crea un `DispatchJob` (PENDING) y se agrega un job a la cola **`dispatch`** de BullMQ (Redis).
3. **Envío:** `dispatch-worker` consume el job y envía al **destinatario** por su canal:
   - **Telegram** → `sendPhoto` / `sendAnimation` (con foto o clip).
   - **WhatsApp** → OpenWA `send-image` / `send-video` (base64) o `send-text`.
   - **Email** (SMTP).
4. **Foto / Clip:** si la alerta trae snapshot lo adjunta; si no, usa el **frame en vivo** de la cámara. Si *Clip animado* está activo, genera un MP4 de ~3s con ffmpeg desde go2rtc.
5. **Trazabilidad:** *Despachos* muestra la cola (izquierda) y las notificaciones enviadas con destinatario (derecha).

**Destinatarios** y **plantillas** se gestionan en *Notificaciones → Destinatarios / Plantillas*.

---

## 6. PWAs

- `/pwa/filas` — app instalable para el **supervisor de filas**: video en vivo, aforo, **feed de eventos** (entradas/salidas + alertas) y **Web Push** en vivo. Pestañas: Vivo / Eventos / Alertas.
- (LPR y Face: pendientes, mismo patrón.)

Push: el navegador se suscribe (`/api/subscribe` → `push_subs.json`), y las alertas llaman `sendWebPushToAll`.

---

## 7. Mantenimiento rápido

```bash
pm2 status                       # estado de procesos
pm2 logs dispatch-worker         # logs del worker de despacho
pm2 restart omniaccess-web       # reiniciar la app
pm2 restart omniaccess-webhooks  # reiniciar socket.io (necesario si cambia server.js)
redis-cli ping                   # PONG = Redis ok
systemctl status go2rtc redis-server
```

Detalles, backups y recuperación: **[docs/INSTALL.md](docs/INSTALL.md)**.
