# Proposal

## Why

El interruptor "Clip animado en alertas" del Centro de Notificaciones está prendido en San Nicolás y **nunca mandó un clip**: la función nació para los contadores de fila Bosch de Olivos (anillo de grabación sólo para `QUEUE_COUNTER`, stream go2rtc `bosch_<ip>`), así que acá cada alerta espera, falla (`[wa-video] SIN CLIP (null)` en todos los despachos del 6/10) y sale con foto. Un control que se ve prendido y no hace nada. A la vez, la mitad que sí anda —cortar un MP4 de un instante desde la grabación del NVR, con ventana antes/después— vive sólo en el botón de descarga del playback, y el operador que ve algo en la grabación no tiene forma de mandárselo a nadie sin bajarlo y reenviarlo a mano.

## What Changes

- **Una sola fuente de clips: el "clip de un instante".** Una función de servidor `clipDeInstante(cámara, instante, antes, después)` que devuelve un MP4 en disco con la fuente que usó, en este orden: (1) la grabación del NVR por el mapa de canales (el mismo ffmpeg del playback); (2) un anillo de grabación go2rtc para las cámaras que **no** están en ningún NVR (hoy LPR Interior .86) y tienen una regla de notificación activa; (3) nada, y lo dice (`motivo`). El ffmpeg propio de `dispatch-worker.js` (`buildClip`/`buildClipLive`) se retira; el anillo Bosch de Olivos queda cubierto por la misma pieza (stream `bosch_<ip>` para `QUEUE_COUNTER`).
- **Clip animado en alertas que funciona.** Las reglas LPR/intrusión encolan el despacho con el retardo necesario para que exista el tramo posterior; el worker pide el clip a la web por una ruta interna y lo manda por WhatsApp (URL interna correcta, base64 de último recurso) o Telegram; si no hay clip, va la foto y el despacho registra por qué. **Ventana propia de alerta** (por defecto 5 s antes + 5 s después, configurable en Ajustes → Video del evento), separada de la de playback: una alerta que tarda 20 s pierde la mitad de su gracia.
- **El interruptor dice la verdad.** Su texto describe lo que hace (clip de N+M s desde la grabación; si la cámara no graba o falla, foto) y muestra qué cámaras con regla activa tienen fuente de video y cuáles no.
- **Enviar por WhatsApp desde el playback.** El diálogo `DescargaClip` (que ya pregunta los segundos antes/después) suma "Enviar por WhatsApp": destinatarios del Centro de Notificaciones ya tildados, más residentes/usuarios con teléfono buscables (no se tipea un número suelto: un video del barrio no sale a cualquier lado). El operador espera con estados visibles ("Armando el clip… → Enviando…") hasta 90 s y recibe el resultado; el envío queda en `/admin/despachos` como tipo `CLIP` con quién lo mandó.
- Corrección de configuración: `INTERNAL_BASE_URL` deja de tener un IP de Olivos como valor por defecto (pasa a `http://127.0.0.1:10001`).

**Out of scope:** streams de video en vivo en las alertas; clips para Telegram desde el playback (sólo WhatsApp, que es el canal del barrio); cambiar el motor de reglas; reactivar `regla-lpr-wa` / `regla-intrusion-wa` (decisión del cliente, siguen apagadas); retención/limpieza histórica de `public/clips` más allá de la purga del propio clip.

## Capabilities

### New Capabilities
- `clips-de-video`: cómo el sistema produce el clip de un instante de una cámara (fuentes, orden, ventana, nombre, limpieza) y qué informa cuando no puede.
- `notificaciones-con-video`: cómo una alerta por WhatsApp/Telegram lleva un clip del evento en vez de la foto, con qué retardo, y qué pasa cuando no hay clip.
- `envio-de-clip-desde-playback`: el envío manual de un clip por WhatsApp desde la ventana de grabación, a quién puede ir y cómo se registra.

### Modified Capabilities
- (ninguna: `whatsapp` no cambia sus requisitos; el envío usa la configuración única que esa spec ya exige)

## Impact

- **Código:** `src/lib/clips.ts` (crece con `clipDeInstante`, la ventana de alerta y el anillo), `src/app/api/nvr/playback/route.ts` (el modo `whole=1` pasa a usar la función compartida), nueva ruta interna `src/app/api/clip/instante/route.ts` (sólo 127.0.0.1 o sesión con permiso), `src/app/api/clip/[file]/route.ts` (sin cambios de contrato), `src/lib/reglas-notificacion.ts` (`instante` en el evento y `delayMs`), `src/lib/dispatch-queue.ts` (tipo `CLIP`), `dispatch-worker.js` (pide el clip a la web; retira `buildClip*`, el anillo Bosch y `INTERNAL_BASE_URL` de Olivos), `src/components/intrusion/LiveModal.tsx` (`DescargaClip` con envío), `src/app/actions/clips.ts` (nueva: enviar clip), `src/app/admin/notificaciones/AnimatedAlertToggle.tsx` (texto honesto + cobertura), Ajustes → Video del evento (ventana de alerta), `src/app/admin/despachos` (muestra tipo `CLIP`).
- **Datos:** sin migración de esquema (`DispatchJob.type` es texto; los ajustes nuevos van a `Setting`: `ALERTA_CLIP_ANTES_SEG`, `ALERTA_CLIP_DESPUES_SEG`). Un anillo por cámara sin NVR con regla activa: ~80 s de sub-stream en `tmp/omniaccess-anillo/<deviceId>` (decenas de MB, no GB).
- **Procesos PM2 a reiniciar:** `omniaccess-web` (build + restart) y `dispatch-worker` (restart). **No** se reinicia `omniaccess-webhooks` (no se toca `server.js`).
- **Páginas a verificar:** `/admin/notificaciones` (interruptor y cobertura), `/admin/settings` → Video del evento, `/admin/monitor-intrusion` → grabación → Descargar/Enviar, `/admin/history` → ficha → video → enviar, `/admin/despachos` (fila `CLIP`), y `/api/nvr/playback?whole=1` sigue entregando el clip al WebView.
- **Riesgo principal:** la CPU del CT 200 sin GPU transcodifica HEVC por software (perimetrales en NVR 2): un clip de 10 s tarda del orden de 10–20 s. La alerta se demora eso; la foto sigue siendo el respaldo.

## Decisiones durante la aplicación (7/10)

- **Sin video en las alertas de San Nicolás.** Medido: el NVR 6 entrega la grabación ~85 s después de que pasa (el NVR 2, menos de 48 s), así que un clip de alerta desde el NVR llegaría 1,5–2 min tarde; la alternativa (grabación local del sub-stream) no compensa para el cliente. El interruptor «Clip animado en alertas» queda **apagado** en SN; el código queda (honesto y probado) para un barrio que lo quiera. Las alertas salen con foto.
- **El clip sigue siendo manual**: desde el botón de la grabación, con su diálogo (descargar o enviar por WhatsApp).
- **Logo de OmniAccess** sobre lo que sale por WhatsApp: la foto de cada alerta y el clip enviado a mano. Con placa oscura translúcida (el primer intento, logo blanco suelto, no se leía sobre fondos claros). Se apaga en Ajustes → Video del evento. Las descargas no lo llevan.
