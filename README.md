# OmniAccess

Control de acceso para barrios privados: lectura de matrículas (LPR), reconocimiento facial,
conteo de filas, consola de guardia y mapa del barrio en vivo.

Desarrollado por **IES — Ingeniería en Seguridad** (Uruguay).

---

## Instalaciones

Cada barrio vive en su propia rama. **No hay una rama común**: lo que se hace para un barrio se
sube a la suya, y solo las correcciones transversales se llevan a las demás.

| Rama | Barrio | Estado |
|---|---|---|
| `los-olivos` | Los Olivos | En producción. Es la línea viva del proyecto. |
| `san-nicolas` | San Nicolás | En montaje. Deriva de `los-olivos`. |

> `main` quedó atrás respecto de lo que hay desplegado; no tomarla como referencia.

---

## Cómo está armado

| Capa | Qué usa |
|---|---|
| Interfaz | Next.js 16 (Turbopack) · React · Tailwind · framer-motion |
| Servidor de eventos | `server.js` — webhooks de cámaras, decisión de acceso, Socket.IO |
| Base | PostgreSQL 17 con Prisma |
| Colas | Redis + BullMQ (`dispatch-worker`) |
| Archivos | MinIO / S3 (capturas, rostros, filas) |
| Video | go2rtc + ffmpeg (vivo, playback, clips) |
| Procesos | pm2: `omniaccess-web`, `omniaccess-webhooks`, `dispatch-worker`, `tracking-worker` |

### Módulos

- **LPR** — matrículas en entradas y salidas, listas blanca y negra, watchlist, merodeo.
- **Face** — reconocimiento facial en accesos peatonales.
- **Filas** — conteo de personas y turnos, con PWA propia.
- **Guardia** — consola para tablets, con posición en vivo en el mapa.
- **Seguimiento** *(opcional)* — cámaras interiores comunes leídas por un contenedor Omni-LPR,
  para dibujar el recorrido de un vehículo dentro del barrio.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env          # completar con los datos de la instalación
npx prisma migrate deploy
npm run build
pm2 start ecosystem.config.js
```

### Variables principales

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `REDIS_URL` | Redis, para las colas |
| `JWT_SECRET` | Sesiones |
| `PORT` / `WEBHOOK_PORT` | Interfaz (10001) y servidor de eventos (10000) |
| `S3_*` | MinIO: endpoint, credenciales y buckets |
| `OMNI_LPR_URL` | Lector de matrículas en contenedor |
| `TRACKING_TOKEN` | Autentica la pasarela de seguimiento y las notificaciones internas |
| `TRACKING_MIN_CONFIDENCE`, `TRACKING_DEDUPE_SECONDS` | Umbrales por defecto del seguimiento |

Credenciales de servicios (MinIO, WhatsApp, Telegram) se cargan **desde la interfaz**, no del
`.env`, para poder cambiarlas sin desplegar.

---

## Seguimiento de vehículos (opcional)

Se prende y apaga en **Modos → LPR**. Apagado, no corre nada y el control de acceso queda igual.

1. **Contenedor Omni-LPR** sobre la GPU del servidor. Imagen propia (`Dockerfile.gpu`) con CUDA 13
   y cuDNN 9 — `onnxruntime-gpu` exige CUDA 13; con CUDA 12 arranca y cae a CPU en silencio.
2. **Cámaras interiores**: dispositivos de tipo `LPR_INTERIOR` con su URL RTSP por canal. No abren
   la barrera.
3. **Pasarela** (`tracking-worker`): un ffmpeg por cámara que solo emite cuadros cuando la escena
   cambia, los manda al lector y guarda el avistamiento.
4. **Calibrador**: por cámara, zona de interés, sensibilidad, confianza y ritmo, con lectura real
   sobre un cuadro en vivo.

En un LXC no privilegiado, Docker necesita `no-cgroups = true` en
`/etc/nvidia-container-runtime/config.toml` y los `/dev/nvidia*` pasados a mano.

---

## Notificaciones

Un solo motor de reglas para los tres modos. Una regla define **qué la dispara** (umbral en Filas,
evento en LPR y Face), en qué cámara, qué días y horas, con qué antirrebote y por qué canales.

Canales: Telegram, WhatsApp (OpenWA), Email SMTP, Webhook HTTP y web push (PWA). Todo sale por una
cola con reintentos; el botón **Probar** usa esa misma cola, así que prueba el camino real.

---

## Mapa del barrio

Capas Híbrido, Táctico, Satélite y Calles, más vista 3D para girar e inclinar. Sobre eso se dibuja
el perímetro, las calles, las cámaras y **los lotes de cada casa**, que se pueden asociar a una
unidad. La vista, el zoom y la capa elegida se guardan con el mapa.

---

## Convenciones

- **Comentarios y mensajes de commit en español**, explicando *por qué*, no *qué*.
- Sin credenciales en el repositorio: van en `.env` o en los ajustes de la aplicación.
- `go2rtc.yaml` no se versiona: lo escribe `go2rtc-sync` con las claves de cada cámara. La
  plantilla es `go2rtc.example.yaml`. Cada stream lleva dos orígenes, el RTSP y un
  `ffmpeg:<nombre>#video=h264` de respaldo, porque hay cámaras que entregan H.265 y el
  navegador no las reproduce.
- Las migraciones se crean con `prisma migrate dev` y se aplican con `migrate deploy`.
- Antes de subir: `npm run build` tiene que pasar limpio.

---

## Documentación

Cada instalación tiene su documento de entrega con las credenciales, la topología y los
pendientes. No viven en el repositorio.
