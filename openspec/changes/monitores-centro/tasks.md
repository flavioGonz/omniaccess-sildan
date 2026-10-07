# Tasks

## 1. Pieza compartida: el canal en alarma

- [ ] 1.1 Extraer el overlay de canal en alarma de `admin/monitor-intrusion/page.tsx` a `components/intrusion/CanalEnAlarma.tsx` (`estado`, `tipo`, `hace`, `camara`, `eventos`, `accion?`) y usarlo en el panel sin cambio visual. Verificar: `/admin/monitor-intrusion` con una alarma pendiente (fila sintética en `Detection`, borrada después) y con la LPR Interior confirmada se ve igual que antes y "Ver evento" sigue abriendo la ficha.
- [ ] 1.2 Dar a `AlertaIntrusionGlobal` un modo `soloLectura` (sin botones real/falsa, se retira sola al resolverse) y una prop para no ocultarse por ruta. Verificar: montada en una página de prueba con `soloLectura`, no muestra botones y desaparece al resolver la alarma desde el panel.

## 2. Enlace de pantalla (credencial)

- [ ] 2.1 Migración Prisma `EnlacePantalla` (id, nombre, vista, tokenHash único, creadoPor, creadoEn, ultimoUsoEn, ultimoUsoIp, revocadoEn) y permiso `monitores` en `lib/permisos.ts` agregado a `rol-administrador` por migración de datos. Verificar: `npx prisma migrate deploy` en limpio y `select perms from "AppRole" where id='rol-administrador'` incluye `monitores`.
- [ ] 2.2 `lib/pantalla-auth.ts`: `credencialDePantalla(req)` (lee `?pantalla=` o la cookie `pantalla`, compara sha256 contra la tabla, descarta revocados, registra último uso con IP a lo sumo una vez por minuto) y `ALCANCE_POR_VISTA`. Verificar: prueba unitaria con un token válido, uno revocado y uno inventado.
- [ ] 2.3 Middleware: `/monitor/*` acepta sesión o token de su vista; con `?pantalla=` válido setea la cookie y redirige sin el parámetro; rechaza el token en `/admin/*` y en APIs fuera del alcance de su vista; token de otra vista → página "Este enlace no abre esta vista"; revocado → "Este enlace fue revocado". Verificar con `curl -I` cada caso (cookie puesta, 302 sin parámetro, 401/403 donde corresponde).
- [ ] 2.4 `verifyApiAuth` devuelve `pantalla: { vista }` con `role: "PANTALLA"`; auditar que todas las rutas `/api/*` que escriben rechacen `auth.pantalla` (grep de `verifyApiAuth` + método POST/PUT/DELETE) y agregar el rechazo donde falte. Verificar: un POST a `/api/intrusion/horarios` con cookie `pantalla` devuelve 403.
- [ ] 2.5 Server actions `crearEnlacePantalla`, `revocarEnlacePantalla`, `listarEnlacesPantalla` (exigen permiso `monitores` con `exigirAccesos`; el token en claro sólo en la respuesta de crear). Verificar: crear desde la UI muestra la URL una vez y la lista muestra nombre, vista, creador, último uso.

## 3. Marco de monitor y menú

- [ ] 3.1 `src/app/monitor/layout.tsx` + `components/monitor/MarcoMonitor.tsx`: tema oscuro forzado, encabezado (barrio, reloj del barrio 24 h, nombre de vista), botón y auto pantalla completa al primer gesto, cursor y botón ocultos a los 5 s, contexto de vitalidad (`latir()`, estados en vivo / reconectando / sin datos con franja ámbar) y refresco al recuperar foco. Verificar: `/monitor/prueba` con una vista vacía muestra todo; al cortar `omniaccess-webhooks` 90 s el encabezado pasa por los tres estados y vuelve.
- [ ] 3.2 `lib/monitor/vistas.ts`: catálogo de vistas (clave, nombre, para quién, qué muestra, previsualización) y página "Esta vista no existe" para claves desconocidas. Verificar: `/monitor/zzz` muestra la lista de vistas.
- [ ] 3.3 `/admin/monitores`: tarjetas por vista con Abrir, enlaces de pantalla (crear / copiar / revocar / último uso), ajustes de sonido por vista y de rotación, y la nota de cómo arrancar Chrome en kiosco. Entrada "Monitores" en el menú gateada por `ve("monitores")`. Verificar: con `rol-operador` no aparece ni abre; con administrador funciona todo el flujo de un enlace.
- [ ] 3.4 `lib/sonido-monitor.ts` (dos tonos sintetizados, aviso de audio bloqueado, silencio local). Verificar: en Chrome sin gesto aparece el aviso; tras un clic suena.
- [ ] 3.5 Redirigir `/dashboard-lpr`, `/dashboard-acceso`, `/dashboard-mixto` a `/admin/monitores` y borrar `UnifiedDashboard.tsx` si nadie más lo importa. Verificar: `curl -I /dashboard-lpr` → 302/307 y `grep -r UnifiedDashboard src` vacío.

## 4. Vista Intrusión

- [ ] 4.1 `/api/monitor/intrusion` (cámaras de intrusión con geometría, armado, última detección, alarmas pendientes y confirmadas, últimas 12 detecciones), alcance en `ALCANCE_POR_VISTA`. Verificar: `curl` con sesión y con token de Intrusión devuelve JSON; con token de Mapa → 403.
- [ ] 4.2 `/monitor/intrusion`: mosaico que llena la pantalla, línea/zona dibujadas, armado por regla, última detección; con alarma el canal usa `CanalEnAlarma` sin acción y crece a `area: grande` con transición; franja lateral en vivo; snapshots cada 8 s sin alarma / 4 s con alarma, sólo visibles. Verificar: con la alarma sintética de 1.1 el canal crece antes de 1 s y vuelve al resolverla; franja refleja "Falsa" al reclasificar.
- [ ] 4.3 Sonido según `MONITOR_INTRUSION_SONIDO` (off / una / repetir hasta aceptar) y silencio desde la pantalla. Verificar: cada modo con la alarma sintética.

## 5. Vista Control LPR

- [ ] 5.1 `/api/monitor/lpr` (última lectura con recorte y cuadro, últimas 10, contadores del día del barrio, fila de atención de 24 h: lista negra / en búsqueda / merodeo). Verificar: los contadores coinciden con `/admin/history` filtrado a hoy.
- [ ] 5.2 `/monitor/lpr`: protagonista grande (matrícula ≥ 72 px), resultado con motivo (LISTA NEGRA destacado), tira de últimas lecturas con transición, contadores con hora de actualización y reinicio a medianoche del barrio, fila de atención con "Sin novedades". Verificar: con un `access_event` sintético por socket la protagonista cambia en menos de 400 ms; a las 00:00 (reloj del navegador adelantado) los contadores vuelven a cero.
- [ ] 5.3 Sonido según `MONITOR_LPR_SONIDO` (off / denegado / sólo lista). Verificar: un DENY común y uno de lista negra con cada modo.

## 6. Vista Mapa

- [ ] 6.1 Modo `pantalla` en `BarrioMap` (sin edición, sin buscador, sin paneles, zoom oculto con el cursor, tope de 200 marcadores, encuadre del barrio desde `Setting`). Verificar: el panel `/admin/mapa` sigue igual; en modo pantalla no hay ningún control de edición.
- [ ] 6.2 `/monitor/mapa` con vehículos en seguimiento, estacionados con cronómetro, cámara en alarma titilando con halo y tarjeta al pie del último evento ("Sin movimiento desde HH:MM" si no hay). Verificar: con la alarma sintética la cámara titila y la tarjeta la muestra; con dos alarmas aparece "+1 más".

## 7. Vista Resumen del barrio

- [ ] 7.1 `/api/monitor/resumen` (adentro ahora, entradas/salidas/denegados del día, visitas activas, cámaras en línea/caídas con nombres, alarmas pendientes y confirmadas, lecturas por hora, últimos 8 eventos), cada número con su `actualizadoEn` y `fuente`. Verificar: cada cifra se cruza con la pantalla del panel de la que sale.
- [ ] 7.2 `/monitor/resumen`: tarjetas KPI grandes con hora y fuente, tira de barras del día con la hora actual marcada ("Sin lecturas hoy" si vacío), lista de últimos eventos en vivo, tarjeta Cámaras en ámbar cuando hay caídas. Verificar: apagar una cámara de prueba y ver la tarjeta cambiar en menos de 2 min.

## 8. Vista Salud del sistema

- [ ] 8.1 `/api/monitor/salud`: agrega salud de dispositivos (última muestra por equipo), NVR, bot WhatsApp (último `WahaRequestLog` / sesión), MinIO, base, socket y workers (PM2 vía `pm2 jlist` o el `/api/system-status` existente), con estado, hace cuánto y desde cuándo falla. `/api/system-status` pasa a exigir sesión o token de Salud. Verificar: `curl /api/system-status` sin credenciales → 401; con sesión → JSON.
- [ ] 8.2 `/monitor/salud`: resumen arriba ("Todo en línea" / "N con problemas" con los que fallan primero), tarjeta por componente con los cuatro colores. Verificar: detener `tracking-worker` 2 min y ver su tarjeta en rojo con "desde HH:MM"; volver a arrancarlo y verla en verde.

## 9. Rotación y alerta global

- [ ] 9.1 `/monitor/rotacion`: vistas y segundos desde `Setting` (mínimo 10), fundido entre vistas, indicador de la siguiente, token de rotación con la unión de alcances. Verificar: Mapa → LPR → Resumen cada 30 s en bucle con un enlace de rotación.
- [ ] 9.2 `AlertaIntrusionGlobal` en modo sólo lectura montada en el layout de monitor, y la rotación fija en Intrusión mientras haya confirmada. Verificar: con la pared en `/monitor/mapa`, confirmar una alarma en el panel cubre la pantalla; resolverla la libera y la rotación sigue.

## 10. Cierre

- [ ] 10.1 Despliegue en San Nicolás: migración, build, restart de `omniaccess-web`, recorrido completo de verificación del design (Migration Plan §3) con sesión y con enlaces de pantalla, y medición de carga del CT con dos monitores abiertos 10 min (CPU y RAM de `omniaccess-web` antes/después).
- [ ] 10.2 Documentar en `claude/monitores.md` (proyecto): qué vista es para qué, cómo emitir y revocar enlaces, cómo configurar Chrome en kiosco, y qué queda para la etapa 2 (mosaico 2×2, invitados de hoy, quién está de guardia, video en vivo en Intrusión). Actualizar `claude/pendientes-san-nicolas.md`.
