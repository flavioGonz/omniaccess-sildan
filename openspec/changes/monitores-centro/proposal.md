# Proposal

## Why

El centro de monitoreo del barrio tiene pantallas en la pared y OmniAccess sólo sabe mostrarse como panel de operador: con menú, barra lateral, sesión de usuario y densidad para leerse a 50 cm. Hoy, para "poner el mapa en el monitor grande", alguien abre el panel con su usuario, agranda el navegador y reza para que no venza la sesión ni se corte el socket; y las páginas `/dashboard-lpr`, `/dashboard-acceso` y `/dashboard-mixto` que nacieron para eso quedaron sin mantener y fuera del diseño actual. Hace falta un conjunto de vistas pensadas para verse de pie, a tres o cuatro metros, que arranquen solas en una PC sin teclado y que digan con claridad cuándo están vivas y cuándo no.

## What Changes

- Nueva sección **Monitores** en el menú del panel (grupo Operación, permiso nuevo `monitores`), con una tarjeta por vista: vista previa, descripción de qué muestra y para quién, botón "Abrir", y la administración de los enlaces de pantalla.
- Nuevas rutas `/monitor/<vista>` fuera del layout de admin: sin menú ni barra lateral, tema oscuro fijo, tipografía y densidad para distancia, reloj y nombre del barrio en el encabezado, botón de pantalla completa (y pantalla completa automática al primer clic/tecla), socket con reconexión sola y un **indicador de vitalidad** siempre visible ("en vivo" / "sin datos hace 2 min"), para que una pantalla congelada nunca parezca un barrio tranquilo.
- **Enlace de pantalla**: un token por monitor (nombre, vista, creado por, último uso, revocable) que abre esa vista sin usuario ni contraseña, con permiso de sólo lectura y ámbito limitado a las APIs que esa vista consume. Se crea y revoca desde Monitores. Es la única forma nueva de entrar sin sesión; nada de lo que un token abre permite actuar.
- Siete vistas:
  - **Intrusión**: mosaico de las cámaras de intrusión con línea y zona dibujadas; cuando hay alarma pendiente o confirmada el canal toma el overlay rojo del monitor y crece hasta ocupar media pantalla; franja lateral con las últimas detecciones y su foto; sonido opcional.
  - **Control LPR**: última lectura grande (recorte de la chapa + cuadro completo), permitido/denegado con el motivo, tira de las últimas lecturas, contadores del día (entradas, salidas, denegados, adentro ahora) y fila de atención (lista negra, en búsqueda, merodeo); sonido opcional en denegado y lista negra.
  - **Mapa**: el mapa del barrio a pantalla completa con cámaras, vehículos en seguimiento moviéndose, estacionados, alarma de intrusión titilando sobre su cámara y una tarjeta al pie con el último evento.
  - **Resumen del barrio**: KPI del día en una pantalla (adentro ahora, visitas activas, cámaras en línea / caídas, alarmas pendientes, últimos eventos).
  - **Salud del sistema**: cámaras, NVR, lectoras, bot de WhatsApp, MinIO, base y workers en verde/rojo con "hace cuánto respondió", a partir de la salud de dispositivos y de `/api/system-status`.
  - **Rotación**: una URL que alterna un conjunto de vistas cada N segundos, para quien tiene un solo monitor.
  - **Alerta sobre cualquier vista**: una intrusión confirmada se impone sobre la vista que esté en pantalla (el mismo overlay global del panel), hasta que alguien la resuelva desde el panel; en los monitores no se resuelve (sólo lectura).
- Se **retiran** `/dashboard-lpr`, `/dashboard-acceso` y `/dashboard-mixto` (sin usuarios, sin diseño, con datos de otra época) y se redirigen a `/admin/monitores`. **BREAKING** sólo para quien tuviera esas URLs guardadas.
- `/api/system-status` deja de ser pública: pasa a exigir sesión o token de pantalla con la vista Salud (hoy devuelve host, versión y tamaño de la base a quien pregunte).

## Capabilities

### New Capabilities
- `monitores/vistas-de-pantalla`: las rutas `/monitor/*`, su marco común (pantalla completa, tema, vitalidad, reconexión, reloj), el menú Monitores y la rotación.
- `monitores/enlace-de-pantalla`: el token de pantalla: emisión, revocación, alcance de sólo lectura, qué rutas abre y auditoría de uso.
- `monitores/vista-intrusion`: qué muestra la vista Intrusión y cómo reacciona a una alarma (crecer, sonar, apagarse).
- `monitores/vista-lpr`: qué muestra la vista Control LPR, sus contadores y la fila de atención.
- `monitores/vista-mapa`: qué muestra la vista Mapa y cómo marca alarmas y vehículos.
- `monitores/vista-resumen`: los KPI de Resumen del barrio y de dónde sale cada número.
- `monitores/vista-salud`: qué componentes vigila Salud del sistema, con qué fuente y qué significa cada color.

### Modified Capabilities
- `monitor-intrusion`: la alerta de intrusión confirmada se impone también sobre las vistas de monitor; el overlay de canal en alarma se comparte con la vista Intrusión (misma pieza, mismos estados).

## Impact

- **Código**: `src/app/monitor/*` (rutas nuevas, layout propio), `src/app/admin/monitores/page.tsx`, `src/lib/permisos.ts` (permiso `monitores`), `src/middleware.ts` (rutas `/monitor/*` y APIs con token de pantalla), `src/lib/api-auth.ts` (aceptar token de pantalla con alcance), `prisma/schema.prisma` (modelo `EnlacePantalla`), componentes compartidos extraídos de `monitor-intrusion/page.tsx` (overlay de canal en alarma), de `BarrioMap` y de `monitor-lpr`; `AlertaIntrusionGlobal` montado también en `/monitor`.
- **APIs**: nuevas de sólo lectura para los KPI de Resumen y para Salud (agregan lo que ya existe: `getActiveAlarms`, salud de dispositivos, `/api/system-status`, `/api/history/unified`); emisión/revocación de enlaces en `src/app/actions/monitores.ts`.
- **Datos**: tabla `EnlacePantalla` (token hasheado, vista, nombre, creadoPor, creadoEn, ultimoUso, revocadoEn) y ajustes por vista en `Setting` (`MONITOR_<vista>_SONIDO`, `MONITOR_ROTACION_SEG`, `MONITOR_ROTACION_VISTAS`).
- **Procesos PM2**: `omniaccess-web` (build + restart). No toca `omniaccess-webhooks` ni `server.js`: las vistas consumen el socket que ya emite.
- **Páginas a verificar tras desplegar**: `/admin/monitores`, `/monitor/intrusion`, `/monitor/lpr`, `/monitor/mapa`, `/monitor/resumen`, `/monitor/salud`, `/monitor/rotacion`, cada una con sesión y con un enlace de pantalla; `/admin/monitor-intrusion` (que no se rompa al extraer el overlay); `/dashboard-lpr` → redirección.

## Out of scope

- Actuar desde un monitor (aceptar alarmas, abrir barrera, escribir bitácora): los monitores son de sólo lectura; se actúa desde el panel o la consola de guardia.
- Mosaico 2×2 configurable, "quién está de guardia" en pantalla y vista Invitados de hoy: quedan para una segunda etapa, sobre el mismo marco.
- Audio en navegadores que exigen gesto del usuario: se documenta que el primer clic habilita el sonido; no se intenta eludir.
- Cambios en `server.js` / webhooks: no hacen falta y requieren OK aparte.
- Multi-barrio en una misma pantalla.
