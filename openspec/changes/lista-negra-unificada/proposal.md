# Proposal

## Why

Hoy la "lista negra" vive en dos lugares que no se hablan —el rol `BLACKLISTED` de un usuario en
`/admin/users` y la "Lista de vigilancia" (`PlateWatch`) del monitor LPR— y **ninguno de los dos
decide nada en la barrera**: la decisión del servidor mira sólo si la matrícula tiene credencial y
el modo LPR, y todas las credenciales (incluidas las de usuarios en lista negra) se cargan en la
cámara como `whiteList`. Resultado medido en el código: un vehículo en lista negra con matrícula
registrada **entra con PERMITIDO** y la lista negra sólo pinta la tarjeta de rojo después del hecho.
Además no hay forma de poner a alguien en lista negra desde `/admin/users` (el rol no está en el
selector; sólo lo pone el módulo facial), sacarlo lo convierte en `WHITELISTED`, y la categoría se
escribe en dos vocabularios (`negra|vip|busca` y `BLACKLISTED|WHITELISTED|SEARCH`) que una
pantalla lee y otra no. Sentido común: **una sola lista, un solo lugar para cargarla, y que la
barrera la respete.**

## What Changes

- **Una sola verdad por matrícula: `PlateWatch`** (la lista de vigilancia), con tres categorías
  canónicas —`BLACKLISTED` (lista negra), `WHITELISTED` (VIP / autorizado), `SEARCH` (en búsqueda)—
  y, nuevo, el vínculo opcional con el usuario dueño (`userId`), el motivo, quién la cargó y cuándo.
  Las filas viejas en `negra|vip|busca` se migran; una categoría desconocida ya no se convierte en
  lista negra en silencio.
- **El rol `BLACKLISTED` deja de ser el modelo para LPR.** Marcar a una persona en lista negra desde
  `/admin/users` pone **todas sus matrículas** en la lista de vigilancia como `BLACKLISTED` (con el
  vínculo al usuario y el motivo) y no toca su rol. Sacarla las desactiva. Para no romper el módulo
  facial de Olivos, el rol `BLACKLISTED` sigue existiendo y **también** se lee como lista negra
  (compatibilidad), pero ya nada nuevo lo escribe desde LPR.
- **La barrera respeta la lista negra.** En toda decisión de acceso por matrícula (lectoras ANPR en
  `server.js`, lecturas por RTSP en cámaras de acceso, carga manual de matrícula en un evento), una
  matrícula en `BLACKLISTED` activa **o** cuya credencial pertenece a un usuario con rol
  `BLACKLISTED` se resuelve **DENY**, pase lo que pase con la credencial, el modo LPR o la lista de la
  cámara. Una decisión que la lista negra fuerza queda marcada en el evento (`Lista negra: <motivo>`).
- **Las cámaras dejan de recibir a la lista negra como permitida.** Toda sincronización de
  matrículas a las lectoras Hikvision excluye las matrículas en lista negra de la `whiteList` y las
  carga en la `blackList` de la cámara; al entrar o salir una matrícula de la lista negra se
  actualiza la cámara en el momento (y si una cámara no responde, se dice, no se asume).
- **Un solo lugar para cargar:** la pestaña **"Lista de vigilancia"** en `/admin/users`, con la
  tabla completa (matrícula, categoría, motivo, persona vinculada, quién/cuándo, avisa, activa),
  alta por matrícula suelta o por persona (todas sus matrículas), y baja que **desactiva** (queda el
  historial) en vez de borrar. El diálogo del monitor LPR, los interruptores de la ficha del evento
  y el comando `lista negra` del bot siguen existiendo como atajos y escriben **la misma lista**, con
  el mismo criterio (desactivar, no borrar; no pisar una categoría distinta sin avisar).
- **Los avisos salen para cualquier lista negra**, no sólo para la derivada del rol: la regla
  `WATCHLIST` del motor de notificaciones y el socket del monitor se disparan igual venga de una fila
  manual, del usuario o de una lectura por RTSP.
- **Vocabulario unificado en pantalla:** el visor de cuadros del seguimiento y la ventana de
  tracking leen la categoría canónica (hoy leen la vieja y no pintan nada).

## Capabilities

### New Capabilities
- `lista-de-vigilancia`: la lista única de matrículas vigiladas (lista negra, VIP, en búsqueda):
  qué contiene, desde dónde se carga y se saca, cómo se vincula a una persona, y qué avisos genera.
- `decision-de-acceso-lpr`: cómo se decide PERMITIDO/DENEGADO ante una lectura de matrícula,
  incluyendo el peso de la lista negra sobre la credencial, el modo LPR y la lista de la cámara, y
  qué listas se cargan en la cámara.

### Modified Capabilities
- `whatsapp`: el comando `lista negra` del bot pasa a escribir y a leer la lista única con el mismo
  criterio que la pantalla (desactivar en vez de borrar; motivo; no pisar otra categoría).

## Impact

- **Datos:** migración Prisma: `PlateWatch` suma `userId?`, `motivo?`, `createdBy?`, `updatedAt`,
  `deactivatedAt?`; migración de datos de `negra|vip|busca` → canónico.
- **Decisión y cámaras:** `server.js` (rama ANPR), `src/lib/paso-por-acceso.ts`,
  `src/app/actions/history.ts` (`setEventPlate`), `src/lib/drivers/HikvisionDriver.ts`
  (`addPlateToCamera` con `listType`), `src/app/actions/lpr-sync.ts`, `src/app/actions/devices.ts`
  (`syncPlatesToDevice`, `syncPlatesToAllDevices`), `src/app/actions/credentials.ts`,
  `waha-handler.js` (`addPlateToHikvision`). Un helper único `src/lib/lista-negra.ts` (y su espejo
  CommonJS para `server.js`/`waha-handler.js`) que contesta "¿está en lista negra y por qué?".
- **UI:** `/admin/users` (pestaña nueva + acción "Lista negra" en el cajón de la persona + badge),
  `WatchlistDialog`, `EventDetailsDialog`, `VisorEventoAcceso`, `VisorCuadro`, `monitor-lpr`
  (`esNegra`/`tipoDeteccion` leen una sola fuente), `watch-categories.ts`.
- **Notificaciones:** `server.js` dispara `WATCHLIST` para toda lista negra; `paso-por-acceso.ts`
  también.
- **Procesos PM2 a reiniciar:** `omniaccess-web` (build), `omniaccess-webhooks` (server.js y
  waha-handler.js, sin build).
- **Páginas a verificar:** `/admin/users` (pestaña Lista de vigilancia; marcar y desmarcar una
  persona), `/admin/monitor-lpr` (diálogo, tarjeta roja, pila crítica tras recargar),
  `/admin/history` (ficha del evento), el bot (`lista negra ABC1234 motivo` / `quitar lista negra`),
  una lectura real de una matrícula en lista negra → DENY con `Lista negra:` en detalles, y la
  `blackList` de la cámara por ISAPI.

## Out of scope

- El módulo facial (`/admin/dashboard-face/*`, `face-sync`, `registerFace`, `toggleBlacklist`): sigue
  usando el rol `BLACKLISTED`; sólo se corrige que "sacar de lista negra" no promueva a `WHITELISTED`
  si se toca ese código, pero no se rediseña.
- La semántica de `MODE_LPR` (`LEARNING` hoy se comporta como `WHITELIST`) y el relé/apertura de
  barrera desde el servidor.
- El token de Telegram escrito en `server.js` y el código muerto (`handlers/*-handler.js`,
  `services/liveSync.ts`, `lib/sync-service.ts`, `FaceSecurityHub`): se anotan, no se tocan acá.
- Listas de la cámara para otras marcas (Dahua, Akuvox): sólo Hikvision, que es la flota.
