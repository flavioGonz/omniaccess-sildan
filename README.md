# OmniAccess

Plataforma unificada de control de acceso y **control de filas (aforo)** con video en vivo, analíticas ONVIF, notificaciones multicanal (Telegram / WhatsApp / Email / Web Push) y PWAs instalables.

Repo: https://github.com/flavioGonz/OmniAccess

---

## 1. ¿Qué hace?

OmniAccess opera en **modos exclusivos** (se activa uno a la vez desde *Configuración → Modo*):

- **Control de Fila (Queue / aforo)** — cuenta personas por cámara (Bosch IVA Pro vía ONVIF), muestra video RTSP en vivo, dispara alertas por umbral, estima tiempo de espera, y notifica con foto o clip animado.
- **LPR** — lectura de matrículas (Hikvision / Avicam): monitor en vivo entrada/salida, permanencia, merodeo, plazas de parking, lista de vigilancia, historial con grabación del NVR y **búsqueda inteligente** (§6).
- **Face** — reconocimiento facial (terminales / intercom Akuvox).

Módulo **Guardia** (no exclusivo): PWA/APK para tablets con rondas NFC/QR, botón de pánico, hombre caído, GPS en el mapa del barrio y bitácora.

Funcionalidad transversal: dispositivos con **salud 24/7 y calibrador ANPR** (§7), topología de red, mapas (foto y geográfico), reportes (Excel/PDF con branding), branding del login, gestión de almacenamiento MinIO/S3, y PWAs.

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

## 6. Búsqueda inteligente (LPR + NVR Hikvision VPro)

`/admin/acuseek` — un solo buscador con **tres fuentes**. El ítem del menú aparece solo si hay un NVR VPro dado de alta.

| Fuente | Qué busca | Cobertura | Depende del NVR |
|---|---|---|---|
| **Accesos** | Lenguaje natural sobre los eventos LPR propios | Los portones (todas las cámaras ANPR) | **No** |
| **AcuSeek** (texto) | Lenguaje natural sobre el índice del NVR | Canales con análisis del NVR | Sí |
| **AcuSearch** (imagen) | Un recorte/foto de referencia | Canales con análisis del NVR | Sí |

### 6.1 Accesos (fuente propia, sin IA ni internet)

`src/lib/lpr-query.ts` traduce la consulta a filtros sobre `AccessEvent`: **color** (10), **tipo** (auto, camioneta/SUV, pickup, van, camión, ómnibus, buggy, moto), **marca** (~45), **matrícula**, **acceso** (`P1`…`P7`), **entradas/salidas**, **autorizados/denegados**, **franja del día** (madrugada/mañana/mediodía/tarde/noche) y **fechas relativas** ("hoy", "ayer", "esta semana", "últimos 3 días"). Devuelve *chips* con lo que interpretó.

- API: `GET /api/lpr/smart-search?q=&max=&days=`
- Ej.: *"camioneta blanca ayer a la tarde"*, *"autos negros por P7"*, *"entradas denegadas hoy"*, *"SCT4403"*.
- Se apoya en que el driver Hikvision guarda `Marca / Color / Tipo` en `AccessEvent.details` + snapshot + recorte de matrícula.

### 6.2 AcuSeek / AcuSearch (NVR)

`src/lib/acuseek.ts` implementa el protocolo ISAPI verificado en campo:

- **Texto (AcuSeek):** `POST /ISAPI/ContentMgmt/AsynSearchByTextTask?format=json` → `taskID`; estado/resultados con `SearchTextTaskStatus`.
- **Imagen, personas:** `POST /ISAPI/Intelligent/humanRecognition/searchByPic?format=json`, multipart con parte JSON `name=""` (**`dataType:"binary"` obligatorio**) + parte `name="Picture_Name"`.
- **Imagen, vehículos:** `POST /ISAPI/Intelligent/vehicleRecognition/searchByPic/async?format=json`, multipart `vehicleInfo` (JSON) + `vehicleImage`; **rango máximo 7 días**; progreso/resultados en `/async/progress/{task}` y `/async/result/{task}`.
- Rutas: `/api/acuseek/{status,search,image,image-search}`.

> ⚠️ **ANPR y AcuSearch son excluyentes por cámara.** En cámaras con analítica propia (iDS-2CD7A46 y similares) el recurso inteligente tiene un solo modo:
> `GET|PUT /ISAPI/System/Video/inputs/channels/1/VCAResource` → `roadDetection` (matrículas) **o** `smart` (targets para AcuSearch).
> Al agregar un canal LPR a `PicSearchByCoordinate` (config de AcuSearch por canal del NVR), **el NVR fuerza la cámara a `smart` y el ANPR deja de leer matrículas**. Para revertir, en este orden: 1) sacar el canal de `PicSearchByCoordinate`, 2) `PUT VCAResource roadDetection`, 3) `PUT /ISAPI/System/reboot`.
> El monitor de salud (§7) vigila el modo VCA y alerta si una cámara ANPR sale de `roadDetection`. Un acceso que necesite ambas cosas requiere una **segunda cámara de contexto**.

### 6.3 Popup de evento

`EventDetailsDialog` (monitor, historial, usuarios, calendario):

- **Encuadrar** sobre la foto → recorta con canvas y lanza AcuSearch **dentro del mismo modal** (`AcuSearchPanel`), con rango centrado en el evento y filtro de similitud.
- Acciones: grabación del NVR, similares, descarga de clip, **exportar ZIP** (`GET /api/events/[id]/export` → captura + recorte + `evento.json` + `clip_30s.mp4`), registrar usuario, lista negra.
- **Perfil de la matrícula** (`GET /api/lpr/plate-stats`): frecuencia (pasadas/día + sparkline 30 d), cámaras habituales con desglose entrada/salida, y horarios típicos con histograma 24 h.
- Tira de últimas capturas de esa matrícula (clic = cambia la foto, se puede encuadrar sobre ella).

---

## 7. Salud de dispositivos y calibración ANPR

- **Sondeo 24/7** (`src/lib/device-health.ts`, cron por minuto vía `/api/devices/health/tick`): alcance ISAPI, latencia, uptime, memoria, desfase de reloj, discos del NVR, espectadores go2rtc y **modo VCA** de las cámaras LPR. Persiste en `DeviceHealthSample` (14 días) y abre/cierra `DeviceAlert` con aviso por Telegram.
- Alertas: `offline`, `disk`, `mem`, `drift`, **`vca`** (ANPR apagado).
- `/admin/devices`: estado real, hora/NTP con **sincronización en 1 clic**, salud del NVR, historial con gráfica, **calibrador ANPR** (video + parámetros ISAPI + región de detección editable + auto-calibración barrio-noche) y **tasa de lectura** por cámara y hora.

---

## 8. PWAs

- `/pwa/filas` — app instalable para el **supervisor de filas**: video en vivo, aforo, **feed de eventos** (entradas/salidas + alertas) y **Web Push** en vivo. Pestañas: Vivo / Eventos / Alertas.
- `/guard` — PWA (y APK WebView) del **guardia**: rondas por NFC/QR, pánico, hombre caído, GPS, bitácora, historial LPR y plazas.
- (LPR y Face: pendientes, mismo patrón.)

Push: el navegador se suscribe (`/api/subscribe` → `push_subs.json`), y las alertas llaman `sendWebPushToAll`.

---

## 9. Mantenimiento rápido

```bash
pm2 status                       # estado de procesos
pm2 logs dispatch-worker         # logs del worker de despacho
pm2 restart omniaccess-web       # reiniciar la app
pm2 restart omniaccess-webhooks  # reiniciar socket.io (necesario si cambia server.js)
redis-cli ping                   # PONG = Redis ok
systemctl status go2rtc redis-server
```

### Diagnóstico LPR: "dejaron de entrar matrículas"

```bash
# 1) ¿llegan webhooks pero sin matrícula? → la cámara no está haciendo ANPR
tail -f logs/webhooks-out.log | grep -i "ANPR\|without plate"

# 2) modo del recurso inteligente (debe ser roadDetection)
curl -s --digest -u user:pass "http://<cam>/ISAPI/System/Video/inputs/channels/1/VCAResource"

# 3) motor ANPR habilitado
curl -s --digest -u user:pass "http://<cam>/ISAPI/Traffic/channels/1/vehicleDetect" | grep enabled

# fix (ver aviso de §6.2): sacar el canal de PicSearchByCoordinate en el NVR,
# luego PUT VCAResource roadDetection + PUT /ISAPI/System/reboot
```

Detalles, backups y recuperación: **[docs/INSTALL.md](docs/INSTALL.md)**.
