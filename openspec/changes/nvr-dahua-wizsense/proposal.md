# Proposal

## Why

SST quiere mostrar OmniAccess con un **NVR inteligente Dahua** (línea WizSense, el equivalente de los VPro/AcuSeek de Hikvision). El equipo de prueba es el de Distribuidora Nicolás, relevado el 12/11:

- **Modelo:** `DHI-NVR5464-EI` (64 canales, WizSense AI), firmware `5.001.0000000.2.R` (build 2026-03-31, web V5). 39 cámaras con nombre (Frente oficinas, Plaza de pedidos, Alero de carga…).
- **Acceso desde afuera:** sólo `80` (HTTP/CGI/RPC2) y `37777` (protocolo propio Dahua). **El `554` (RTSP) no está publicado**: desde SST no hay vivo ni playback por RTSP.
- **Lo que responde por HTTP (probado):** login RPC2 (`/RPC2_Login`, hash MD5 de Dahua), `magicBox`, `ChannelTitle`, `snapshot.cgi` (foto de 1,8 MB del canal 1), `mediaFileFind.cgi` (lista los archivos `.dav` grabados por hora y canal).
- **Su IA (servicios RPC2 presentes):** `SmdDataFinder` (búsqueda de **personas y vehículos** por detección de movimiento inteligente; SMD habilitado en los canales con `Human`/`Vehicle`), `objectMediaFind` (búsqueda de objetos con atributos), `faceRecognitionServer` (rostros), `RecordSecondaryAnalyse` (análisis IA sobre lo grabado) y algoritmos `HumanTrait`/`VehicleDetect`/`FaceAnalysis` con licencia sin vencimiento. **No hay búsqueda por texto libre en el firmware** (el servicio `openAI` es la gestión de paquetes de algoritmos, no lenguaje natural).

En `lab` ya existe la base: `DahuaDriver`, `dahua-rpc2.ts` (sesión RPC2), `grabaciones.ts` (búsqueda de archivos con `mediaFileFind`), vivo y playback por RTSP vía go2rtc, y **`lib/grabador-busqueda`**, la capa de "buscar en el grabador" sin nombre de fabricante (hoy sólo con el driver de Hikvision, AcuSeek/AcuSearch). Lo que falta es **el driver de búsqueda de Dahua** y que **vivo/playback funcionen cuando el NVR sólo expone HTTP**.

## What Changes

- **Alta del NVR Dahua por dominio** (no sólo IP), con puerto HTTP y RTSP separados. Ya está dado de alta en `omniaccess.sst.uy` como `NVR Dahua Nicolás (WizSense)` → `nicolas.dvrdns.org`, HTTP 80, RTSP 554.
- **Importar sus canales** con el nombre real (`ChannelTitle`) como cámaras de OmniAccess (`ImportarCanalesNvr` ya existe; se verifica con 64 canales y nombres con espacios/acentos).
- **Vivo, dos caminos:**
  1. *RTSP* (lo existente, go2rtc) cuando el `554` es alcanzable — requiere publicar el puerto en el router del cliente o una VPN.
  2. *Sólo HTTP*: si el RTSP no responde, el vivo cae a **snapshot periódico** (`snapshot.cgi`, sub-stream) para el muro y la ficha, avisando "vista por fotos". Evaluar en `design.md` el **RTSP sobre WebSocket** del web V5 (`/rtspoverwebsocket` en el puerto 80) como vivo real sin abrir puertos.
- **Playback:** por RTSP (`cam/playback`) si hay `554`; si no, **descarga del tramo por HTTP** (`mediaFileFind` → `RPC_Loadfile` del `.dav`) y remux/transcode con ffmpeg a MP4 para el reproductor y los clips.
- **Búsqueda IA del NVR (nuevo `DriverBusqueda` "WizSense" en `lib/grabador-busqueda/dahua.ts`):**
  - *Por atributos*: personas (sexo, ropa/colores, mochila, gorro…) y vehículos (tipo, color) con `SmdDataFinder` / `objectMediaFind`, devolviendo `HallazgoGrabador` (canal, momento, foto, recorte, caja) igual que Hikvision.
  - *Por texto*: el firmware no la tiene; OmniAccess **traduce la frase a filtros** ("hombre de campera roja en el alero de carga ayer a la tarde" → persona + color + canales + rango) con el parser de búsqueda inteligente que ya existe, y se la pasa al NVR. Se muestra como búsqueda IA del grabador.
  - *Por imagen* (rostro/persona): `faceRecognitionServer.startFind` / `objectMediaFind` con imagen, si el equipo lo acepta (a confirmar en `design.md`).
  - *Canales con IA*: leer qué canales analiza (SMD/IVS habilitados) y permitir encender/apagar, como `canales()`/`ponerCanales()` en Hikvision.
- **Eventos en vivo** (opcional, fase 2): suscripción a `eventManager.attach` por HTTP para recibir `SmartMotionHuman/Vehicle` y mostrarlos en el monitor de intrusión.

## Capabilities

### New Capabilities

- `grabador-dahua`: integración de NVR Dahua WizSense — alta por dominio, canales, vivo/playback con o sin RTSP publicado, y su búsqueda IA (atributos, texto traducido a filtros, imagen) a través de `lib/grabador-busqueda`.

### Modified Capabilities

- (ninguna spec existente; `lib/grabador-busqueda` gana un driver, sin cambiar su contrato)

## Impact

- Código: `src/lib/grabador-busqueda/dahua.ts` (nuevo) + registro en `index.ts`; `src/lib/dahua-rpc2.ts` (sesión reutilizable con keep-alive); `src/lib/grabaciones.ts` y `src/lib/clip-nvr.ts` (playback por HTTP); `src/lib/go2rtc-sync.ts` (fallback a snapshot); `src/app/api/grabador/*` (sin cambios de contrato).
- Procesos PM2 a reiniciar: `omniaccess-web` (todo lo anterior); `omniaccess-webhooks` sólo si se hace la fase de eventos.
- Páginas a verificar: `/admin/devices?type=NVR`, importación de canales, monitor/muro con canales del NVR, ficha de evento con playback, y la búsqueda del grabador (`/admin/acuseek` o la que la reemplace).
- Red del cliente: para vivo/playback reales por RTSP hace falta publicar el `554` (o VPN). Sin eso, funciona en modo HTTP (fotos + descarga de tramos).

## Out of scope

- Reconocimiento facial propio de OmniAccess (es el change `modo-face`).
- Configurar las analíticas de las cámaras (líneas/zonas IVS) desde OmniAccess: sólo se lee qué canales tienen IA y se prende/apaga la búsqueda.
- El protocolo binario del puerto `37777` (SDK de Dahua): no se usa; todo por HTTP/RPC2.
- Lista de vigilancia por rostro en el NVR (grupos de `faceRecognitionServer`).
