# Design

## Context

Ver proposal.md — Why. Lo que condiciona el cómo (medido en San Nicolás el 7/10):

- **Dos generadores de clips distintos hoy.** `src/app/api/nvr/playback/route.ts` corta desde la grabación del NVR (RTSP de playback Hikvision/Dahua, `-c:v copy` si H.264 o transcode a H.264 si HEVC, modo `whole=1` que escribe un MP4 completo a `os.tmpdir()`), con la ventana de `lib/ventana-playback.ts` y el nombre de `lib/clips.ts`. `dispatch-worker.js` tiene su propio ffmpeg (`buildClip`/`buildClipLive`) atado a `QUEUE_COUNTER` y al stream `bosch_<ip>`, escribe en `/opt/OmniAccess/public/clips`, y lo sirve `/api/clip/[file]`.
- **Fuentes de video en SN:** LPR Entrada/Salida → NVR 6; Perimetral 19/22/36 → NVR 2 (HEVC; el CT 200 no tiene GPU, transcodifica por software a ~1×); **LPR Interior .86 no está en ningún NVR** y es la única lectora que produce accesos. go2rtc ya expone `lpr_<deviceId>` (sub-stream) y `lpr_<deviceId>_hd` para todas (`lib/go2rtc-sync.ts`).
- **Despacho:** `lib/reglas-notificacion.ts` → `enqueueDispatch` (BullMQ, admite `delayMs`) → `dispatch-worker.js` (PM2, proceso siempre arriba, ya corre el anillo Bosch con `ensureRecorders` cada 30 s). `EventoNotificable` **no trae el instante del evento**: el worker usa `p.alertTs || p.timestamp || Date.now()`.
- **WAHA** en SN: `OPENWA_URL=http://127.0.0.1:3000`, sesión `default`; `sendVideo` acepta `file.url` o `file.data` (base64). `INTERNAL_BASE_URL` no está en `Setting` y su valor por defecto en el worker es `http://192.168.99.99:10001` (el primer barrio).
- **Allowlist** (`WHATSAPP_ALLOWLIST`) es de entrada al chatbot, no de salida. Los destinatarios de salida viven en `DISPATCH_RECIPIENTS` (JSON en `Setting`); los residentes tienen teléfono en `User.phone`.
- **Reglas de la casa:** nada hardcodeado (ajustes en `Setting`, constantes con porqué), un control nunca aparenta hacer lo que no hace, `server.js` no se toca en este cambio, diseño con las piezas de `omniaccess-diseno`.

## Goals / Non-Goals

**Goals**
- Un solo lugar que produce clips (`lib/clips.ts: clipDeInstante`) y tres consumidores: playback (ver/bajar), alerta (worker) y envío manual.
- El worker deja de tener ffmpeg propio para clips de alerta; sólo mantiene los anillos (proceso persistente) y pide el corte a la web.
- Cada clip que no se pudo hacer deja un motivo visible (despachos, diálogo de envío, interruptor).

**Non-Goals**
- No se cambia el formato de `DispatchJob` (sin migración): el tipo `CLIP` y los campos nuevos van en `payload`/`lastError`.
- No se agrega GPU ni se cambia la calidad del transcode HEVC; se acepta la demora y se mide.
- No se mueve el anillo a MinIO ni se graba de forma continua: 80 s en disco local alcanza para un pre-roll de alerta.

## Decisions

**D1. `clipDeInstante` vive en la web (`lib/clips.ts`) y el worker le pide el corte por HTTP interno.**
La web ya tiene resolución de NVR, mapa de canales, códec cacheado, ventana y nombre. Duplicarlo en el worker fue el origen de la deuda. Nueva ruta `POST /api/clip/instante` `{ deviceId, instante, antes, despues, para: "alerta"|"envio" }` → `{ ok, archivo, url, fuente, motivo, ventana }`, protegida con `x-tracking-token` (mismo patrón que `/api/notifications/event`) o sesión con permiso. Alternativa descartada: importar `lib/clips` desde el worker con `tsx` — el worker es JS plano bajo PM2 y no comparte el runtime de Next; la ruta ya existe como patrón.

**D2. Orden de fuentes: NVR → anillo → nada.**
`fuenteDeVideo(deviceId)`: si la IP de la cámara está en `NVR_CHANNEL_MAP` → NVR (reusa el armado de URL RTSP de playback, extraído de la ruta a `lib/clips.ts` como `cortarDesdeNvr`); si no, si existe `tmp/omniaccess-anillo/<deviceId>/` con segmentos que cubren el tramo → `cortarDesdeAnillo` (concat de `.ts` + recorte exacto con `-ss/-t`); si no → `{ archivo: null, motivo }`. El modo `whole=1` de playback pasa a llamar `cortarDesdeNvr` (misma salida, un solo lugar).

**D3. El anillo lo mantiene `dispatch-worker.js` (único proceso persistente sin build) y lo lee la web (mismo disco).**
`ensureRecorders` se generaliza: cada 30 s calcula el conjunto `{ deviceId, stream }` a grabar = (cámaras alcanzadas por reglas activas, sin IP en `NVR_CHANNEL_MAP`, stream `lpr_<deviceId>`) ∪ (`QUEUE_COUNTER` Bosch, stream `bosch_<ip>`, como hoy). Arranca los que faltan, mata y borra los que sobran. Directorio `tmp/omniaccess-anillo/<deviceId>` (no `public/`: nada del anillo debe servirse). `-c:v copy` del sub-stream; `SEG_DUR=2`, `SEG_WRAP=40` (80 s) se mantienen con su porqué. Alternativa descartada: anillo en la web — Next bajo PM2 se reinicia en cada build y no es lugar para hijos ffmpeg permanentes.

**D4. Ventana propia de alerta.**
`Setting` `ALERTA_CLIP_ANTES_SEG` / `ALERTA_CLIP_DESPUES_SEG` (por defecto 5/5, topes 15/15) en `lib/clips.ts` (`ventanaAlerta()`), editable en Ajustes → Video del evento junto a la de playback. El `delayMs` del despacho = `despues + MARGEN_GRABACION_SEG` (constante: 4 s, lo que tarda el NVR en exponer el tramo por RTSP; medido en playback como "no hay cuadros si el final está a menos de ~3 s del ahora"), sólo cuando `DISPATCH_ANIMATED=true` y el canal es WhatsApp/Telegram.

**D5. El instante viaja en el evento.**
`EventoNotificable.instante?: string` (ISO). `notificarEvento` lo copia a `payload.instante`; si falta, usa la hora de encolado. Los emisores (`server.js` vía `/api/notifications/event`, `paso-por-acceso.ts`, `estadias.ts`, `ocupaciones.ts`) lo mandan cuando lo tienen; `server.js` no se toca ahora (su `timestamp` ya viaja en `extra` para LPR; el worker lee `p.instante || p.timestamp`).

**D6. Qué manda el worker y cómo registra.**
Con clip: `sendVideo` por URL `INTERNAL_BASE_URL/api/clip/<archivo>` (por defecto `http://127.0.0.1:10001` — WAHA corre en el mismo CT; en el primer barrio `Setting` lo pisa) y, si falla, base64. Sin clip o si el video falla: foto/texto **en el mismo despacho**, y `DispatchJob.lastError` guarda `sin video: <motivo>` aunque el estado sea `SENT`; `/admin/despachos` lo muestra como nota, no como error. Alternativa descartada: un despacho aparte para el video — duplica mensajes al destinatario.

**D7. Envío manual: server action síncrona con estados, no cola.**
`src/app/actions/clips.ts: enviarClipPorWhatsApp({ deviceId, instante, antes, despues, destinatarios, matricula? })`: exige sesión con permiso de la pantalla de video (reusa `permisosDeSesion`; la cookie `pantalla` no llega a actions), valida que cada destinatario sea un `DISPATCH_RECIPIENTS` de WhatsApp o un `User` con ese teléfono, crea el `DispatchJob` tipo `CLIP` (status `PROCESSING`, `payload` con todo y `createdBy`), produce el clip con `clipDeInstante`, manda por WAHA (misma función que el worker, movida a `lib/whatsapp.ts: enviarVideoWaha`), y cierra el job `SENT`/`FAILED` con resultado por destinatario. Tope 90 s (constante con porqué: copy ~5 s, transcode HEVC de 20 s ~20–40 s en este CT). El diálogo muestra fases por estado local (armando → enviando → resultado); no hace falta progreso del servidor. Alternativa descartada: encolar — el operador no sabría si salió.

**D8. Diálogo `DescargaClip`.**
Se mantiene como diálogo oscuro sobre el video (ya es la excepción del playback) y suma: segunda acción "Enviar por WhatsApp" (azul de acción; Descargar pasa a secundaria sólo cuando se despliega el envío), lista de destinatarios con casillas (`DISPATCH_RECIPIENTS` WhatsApp habilitados ya tildados) y un `Seek` para sumar usuario/residente por nombre, lote o teléfono (acción `buscarDestinatariosClip`), leyenda previsualizada (cámara · fecha hora · matrícula), estados y resultado con `Chip` de tono.

**D9. Interruptor honesto.**
`AnimatedAlertToggle` lee una acción `coberturaClipAlertas()` → por cámara alcanzada por reglas activas: `{ nombre, fuente: "nvr"|"anillo"|null }`; texto: "Clip de A s antes y D s después del evento desde la grabación; si la cámara no graba o falla, va la foto". Lista corta con `Chip bien/neutro`: "LPR Interior · anillo", "Perimetral 19 · NVR 2", "X · sin video (va con foto)".

**D10. Limpieza.**
Clips de alerta y de envío en `public/clips` se borran a los 10 min (constante: lo que tarda WAHA/Telegram en bajar por URL con margen); un barrido al arrancar la web y cada hora borra lo que quedó de reinicios. `/api/clip/[file]` no cambia.

## Risks / Trade-offs

- [Transcode HEVC por software demora la alerta 10–40 s] → ventana de alerta corta (5+5), `-preset veryfast`, altura 480 para `para:"alerta"` (480p alcanza en un teléfono) y foto como respaldo; se mide en 10.x antes de dar por buena la cadencia.
- [Anillo: un ffmpeg por cámara sin NVR] → sólo cámaras alcanzadas por reglas activas (hoy: ninguna, porque las reglas están apagadas; al prenderlas: LPR Interior); `-c:v copy` del sub-stream, sin transcode; se mata cuando deja de hacer falta.
- [El pedido de clip llega antes de que el NVR tenga el tramo] → `delayMs` + `MARGEN_GRABACION_SEG`, y `clipDeInstante` espera hasta `instante + despues + margen` con tope antes de cortar.
- [WAHA no puede bajar la URL interna] → base64 de respaldo (ya existe) y log con la URL probada.
- [Un operador manda video del barrio a un número ajeno] → sólo destinatarios configurados o usuarios con teléfono; queda registrado quién y a quién.
- [Romper el playback al extraer `cortarDesdeNvr`] → se extrae primero, se verifica `?whole=1` y el streaming normal en `/admin/monitor-intrusion` antes de seguir.

## Migration Plan

1. Merge; `npm run build`; `pm2 restart omniaccess-web --update-env`; `pm2 restart dispatch-worker`. Sin migración Prisma. No se reinicia `omniaccess-webhooks`.
2. Verificar: `/api/nvr/playback?whole=1` (WebView) y el streaming normal; `/admin/notificaciones` (texto y cobertura); Ajustes → Video del evento (ventana de alerta); grabación → Descargar/Enviar con un destinatario de prueba; `/admin/despachos` fila `CLIP`; alerta de prueba (`/api/notifications/test`) con clip animado activo → video por WhatsApp o foto con nota.
3. Rollback: `git revert` del merge + build + restart de los dos procesos; los clips temporales se purgan solos.

## Open Questions

- Si el cliente prende `regla-intrusion-wa` con las tres perimetrales (HEVC en NVR 2), conviene medir si el CT aguanta tres transcodes simultáneos en una ráfaga de detecciones; si no, bajar la alerta a 360p o serializar los cortes en el worker (BullMQ `concurrency`).
