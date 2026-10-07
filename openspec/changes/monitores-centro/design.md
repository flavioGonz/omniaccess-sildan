# Design

## Context

Ver proposal.md — Why. Lo que ya existe y condiciona el cómo:

- Los datos en vivo llegan por un socket.io global (`server.js`, ruta `/io/socket.io`, polling) con los eventos `access_event`, `general_detection`, `detection_snapshot`; el panel los consume con `lib/tiempo-real.ts` (`useTiempoReal`, un socket compartido por pestaña). No hace falta tocar `server.js`.
- El monitor de intrusión (`admin/monitor-intrusion/page.tsx`, ~1.190 líneas) tiene el overlay de canal en alarma, la alerta global (`components/intrusion/AlertaIntrusionGlobal.tsx`, montada en `admin/layout.tsx` y oculta en el propio monitor) y las acciones `getActiveAlarms`, `getAttendingIds`.
- El mapa vive en `components/BarrioMap.tsx` (grande, con edición, Leaflet + MapLibre a medias según `claude/pendientes-san-nicolas.md` §5.1) y el monitor LPR en `admin/monitor-lpr`.
- La salud de dispositivos ya se muestrea cada minuto (`lib/device-health.ts`, `DeviceHealthSample`, tick exento de auth) y `/api/system-status` chequea base, MinIO y procesos — hoy sin auth.
- Autenticación: JWT en la cookie `session`, verificado en `middleware.ts` (con `puedeAbrir(perms, ruta)` de `lib/permisos.ts`) y en `lib/api-auth.ts` (`verifyApiAuth`) para las rutas `/api/*`. Los server actions no pasan por `verifyApiAuth`: usan la sesión por su cuenta.
- Reglas de diseño: `claude/DESIGN.md` y la skill `omniaccess-diseno` (piezas compartidas, un azul de acción, tonos = estado, sin sombras en lo que no flota). Un monitor de pared es una excepción deliberada en escala tipográfica, no en vocabulario.

## Goals / Non-Goals

**Goals:**
- Un marco único (`/monitor` layout) del que cuelgan las siete vistas, para que vitalidad, pantalla completa, reloj, reconexión y alerta global se escriban una vez.
- Las vistas reutilizan las piezas del panel extrayéndolas, no copiándolas: el overlay de canal en alarma sale de `monitor-intrusion/page.tsx` a `components/intrusion/CanalEnAlarma.tsx` y lo usan los dos.
- El token de pantalla es una credencial de segunda clase, con alcance explícito, verificable en un solo lugar.
- Cero escritura desde un monitor, por construcción (el token no autoriza ninguna acción) y no sólo por ocultar botones.

**Non-Goals:**
- Reescribir `BarrioMap` ni el monitor LPR: se les agrega un modo `pantalla` que apaga edición y controles; la deuda de §5.1 sigue siendo deuda.
- Streams de video en la vista Intrusión: muestra snapshots refrescados (como el mosaico del panel), no 4 streams go2rtc por monitor. El video en vivo queda para una etapa posterior si el hardware del centro lo pide.
- Un servidor de "estado del centro" nuevo: Salud agrega lo que ya se muestrea.

## Decisions

**D1. Rutas `/monitor/*` con layout propio, fuera de `/admin`.**
Un segmento de ruta propio con `src/app/monitor/layout.tsx` (tema oscuro forzado vía `data-theme="dark"` en el `html` del layout, sin `AdminLayout`). Alternativa descartada: una query `?kiosco=1` sobre las páginas del panel — obliga a condicionales en cada página y deja el menú a un refresco de distancia. El layout monta `MarcoMonitor` (encabezado, vitalidad, pantalla completa, cursor oculto) y `AlertaIntrusionGlobal` en modo `soloLectura`.

**D2. Token de pantalla: tabla `EnlacePantalla` con hash, cookie propia `pantalla`, alcance por vista.**
- Modelo: `id, nombre, vista, tokenHash (sha256), creadoPor, creadoEn, ultimoUsoEn, ultimoUsoIp, revocadoEn`. El token en claro (32 bytes aleatorios, base64url) se muestra una vez.
- Entrada: `/monitor/<vista>?pantalla=<token>` → el middleware verifica el hash, setea la cookie `pantalla` (HttpOnly, SameSite=Lax, 1 año) y redirige a la misma ruta sin el parámetro. En adelante la cookie basta.
- Verificación centralizada en `lib/pantalla-auth.ts` → `credencialDePantalla(req): { vista, enlaceId } | null`, usada por el middleware (rutas `/monitor/*` y la lista blanca de APIs de lectura por vista) y por `verifyApiAuth` (que devuelve `{ authenticated: true, pantalla: { vista } , role: "PANTALLA" }` para que las rutas de lectura puedan servir y las de escritura rechacen explícitamente con `if (auth.pantalla) return 403`).
- Alcance: un mapa estático `ALCANCE_POR_VISTA: Record<Vista, string[]>` con las APIs (prefijos) que cada vista puede leer; `rotacion` hereda la unión de las vistas que la componen. El socket no autentica hoy (es público detrás de `/io/`), así que no cambia; lo que protege el token es lo que se pide por HTTP.
- Alternativa descartada: JWT firmado con `JWT_SECRET` y rol `PANTALLA` sin tabla — no se puede revocar uno solo ni ver el último uso.

**D3. Server actions vs. rutas API para los monitores.**
Las vistas de pantalla consumen únicamente **rutas `/api/monitor/<vista>`** (JSON, `verifyApiAuth` + alcance), nunca server actions: una action no tiene forma de saber que la llama una pantalla sin sesión. Las rutas agregan lo que ya existe (reusan `getActiveAlarms`, `getAttendingIds`, salud, `history/unified` internamente, del lado servidor).

**D4. El overlay de canal en alarma sale a una pieza compartida.**
`components/intrusion/CanalEnAlarma.tsx` recibe `{ estado: "pendiente" | "confirmada", tipo, hace, camara, eventos, accion?: ReactNode }`. El panel le pasa el botón "Ver evento"; la pantalla no le pasa nada. La CSS (`.intr-conf*`) ya es global.

**D5. Mosaico que crece.**
La vista Intrusión usa CSS grid con `grid-template-areas` recalculadas: sin alarma, N columnas cuadradas; con alarma, la cámara en alarma toma `area: grande` (2×2 en una grilla de 4 columnas) y las demás se apilan a la derecha. Transición con `framer-motion` `layout`. Alternativa descartada: abrir un modal — en una pared no hay quien lo cierre.

**D6. Vitalidad.**
`MarcoMonitor` mantiene `ultimoDato: Date` que actualiza cualquier vista vía contexto (`useVitalidad().latir()`), más `conectado` del socket compartido. Estados: en vivo (conectado y `ahora - ultimoDato < 60 s`), reconectando (desconectado < 60 s), sin datos (lo demás). Cada vista además refresca por HTTP cada 30 s aunque el socket esté quieto, para que "en vivo" no dependa de que pase algo en el barrio.

**D7. Sonido.**
`lib/sonido-monitor.ts` con un `AudioContext` perezoso y dos tonos sintetizados (sin archivos: no hay que servir ni cachear mp3). Si `AudioContext.state === "suspended"` tras el primer intento, la vista muestra el aviso "tocá la pantalla para habilitar el sonido" y reintenta en el primer `pointerdown`. Ajuste por vista en `Setting` (`MONITOR_INTRUSION_SONIDO = off|una|repetir`, `MONITOR_LPR_SONIDO = off|denegado|lista`), editable desde Monitores; silenciar desde la pantalla es local al navegador (`localStorage`), no cambia el ajuste.

**D8. Rotación.**
`/monitor/rotacion` renderiza la vista activa como componente (no iframe): mismo socket, misma vitalidad, fundido con `AnimatePresence`. Orden e intervalo en `Setting` (`MONITOR_ROTACION_VISTAS`, `MONITOR_ROTACION_SEG`, mínimo 10). La alerta global confirmada fija la rotación en Intrusión mientras exista (lee el mismo estado que `AlertaIntrusionGlobal`).

**D9. Retiro de los tableros viejos.**
`src/app/dashboard-*/page.tsx` pasan a `redirect("/admin/monitores")`; `UnifiedDashboard.tsx` se borra si ningún otro lo importa (verificar con grep antes).

**D10. Permiso y menú.**
Nueva clave `monitores` en `lib/permisos.ts` (grupo Operación, rutas `/admin/monitores`), agregada al rol `rol-administrador` por migración de datos; `rol-operador` no la recibe por defecto. El menú lo gatea `ve("monitores")` como el resto.

## Risks / Trade-offs

- [Un token filtrado abre esa vista para siempre] → revocable desde Monitores, último uso con IP visible, y las vistas no exponen nada que no se vea en la pared; además el middleware rechaza el token en todo lo que no sea su vista.
- [`/api/system-status` deja de ser pública y algo externo la usaba] → se busca en el repo y en nginx antes; si un chequeo externo la consume, se le emite un enlace de pantalla de Salud.
- [Snapshots de N cámaras cada 4 s desde varios monitores] → la vista Intrusión refresca sólo las cámaras visibles y baja a cada 8 s cuando no hay alarma; la caché de miniaturas del 7/10 no aplica (son snapshots en vivo), así que se mide en el CT con dos monitores abiertos antes de dar por buena la cadencia.
- [Extraer el overlay rompe el monitor del panel] → la extracción se hace primero, sola, y se verifica `/admin/monitor-intrusion` con una alarma pendiente y una confirmada antes de seguir.
- [Chrome bloquea pantalla completa y audio sin gesto] → se documenta en la tarjeta de Monitores cómo arrancar Chrome en modo kiosco (`--kiosk --autoplay-policy=no-user-gesture-required <url>`); la vista igual funciona sin eso, con el aviso.
- [El mapa pesa y la PC del centro es modesta] → la vista Mapa usa el modo `pantalla` de `BarrioMap` que apaga capas de edición y limita a 200 marcadores; si no alcanza, se anota para la etapa 2 de MapLibre.

## Migration Plan

1. Migración Prisma `EnlacePantalla` + permiso `monitores` en `rol-administrador` (`npx prisma migrate deploy`).
2. Build y restart de `omniaccess-web`. No se reinicia `omniaccess-webhooks`.
3. Verificar en orden: `/admin/monitor-intrusion` (overlay extraído), `/admin/monitores`, crear un enlace, abrir cada `/monitor/*` con sesión y con enlace, revocar y ver el rechazo, `/dashboard-lpr` → redirección, `/api/system-status` sin sesión → 401.
4. Rollback: `git revert` del merge + build + restart; la tabla `EnlacePantalla` puede quedar (nadie la lee sin el código).

## Open Questions

- Nombre y encuadre inicial del barrio para la vista Mapa: hoy el encuadre lo guarda el panel por usuario; se puede tomar el del primer administrador y permitir fijarlo desde Monitores en la etapa 2.
- Si el centro va a tener parlantes: decide cuánto invertir en los tonos (dos sintetizados alcanzan para empezar).
