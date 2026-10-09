# Design

## Context

Ver `proposal.md` → Why. Lo que condiciona el cómo:

- Hay **dos procesos** que deciden accesos: `omniaccess-web` (Next: `paso-por-acceso.ts`,
  `setEventPlate`, acciones) y `omniaccess-webhooks` (`server.js`, CommonJS, y `waha-handler.js`).
  Comparten base y Prisma, no código TypeScript. Cualquier regla de decisión tiene que existir en los
  dos lados **con la misma lógica**, o vivir en SQL.
- `PlateWatch.plate` es `@unique`: una fila por matrícula, con `active`. La categoría está en dos
  vocabularios (`negra|vip|busca` del schema y `BLACKLISTED|WHITELISTED|SEARCH` de
  `lib/watch-categories.ts`).
- `Credential.value` no es único: `findFirst` devuelve "alguna" credencial para la matrícula.
- Las lectoras Hikvision (iDS-2CD7A46G0/P) exponen `licensePlateAuditData/record` con `listType`
  `whiteList|blackList` y `DelLicensePlateAuditData` que borra **todo**, sin distinguir lista. Hoy
  `HikvisionDriver.addPlateToCamera` tiene `whiteList` escrito fijo.
- El módulo facial (el primer barrio) usa el rol `BLACKLISTED` como lista negra de **personas** y
  `syncAllBlacklistAction` las manda a los terminales. No se toca.
- El monitor LPR rehidrata eventos desde la base sin campo `watch`; la pila crítica depende del
  socket en vivo o del rol.

## Goals / Non-Goals

**Goals:**
- Una función que conteste "¿esta matrícula está en lista negra, y por qué?" y que la usen las tres
  decisiones (ANPR, RTSP, carga manual) y las dos UIs (monitor, visor).
- Las listas de la cámara reflejan la lista de vigilancia; el servidor deniega aunque la cámara se
  equivoque.
- Un solo lugar de administración; los atajos no divergen.

**Non-Goals:**
- Reemplazar el rol `BLACKLISTED` del módulo facial o migrar usuarios de rol.
- Abrir/cerrar barrera desde el servidor (hoy la abre la cámara con su lista).
- Soporte de listas en cámaras no Hikvision.

## Decisions

### D1. La verdad es `PlateWatch`; el rol se lee como respaldo, no se escribe
Alternativas: (a) migrar el rol `BLACKLISTED` a un campo `User.listaNegra` y derivar siempre;
(b) mantener dos fuentes y reconciliar; (c) **`PlateWatch` como única verdad por matrícula, con
`userId` opcional para "esta entrada existe porque la persona está marcada", y el rol leído sólo
por compatibilidad.** Se elige (c): la lista negra en LPR es de **vehículos** (una matrícula sin
dueño conocido es el caso típico), y el módulo facial sigue funcionando sin tocarlo. (a) rompe
el primer barrio; (b) es lo que hay hoy y es lo que falla.

Schema: `PlateWatch` suma `userId String?`, `motivo String?`, `createdBy String?` (nombre o número
de quien cargó), `updatedAt DateTime @updatedAt`, `deactivatedAt DateTime?`. Migración de datos en
el mismo `migration.sql`: `UPDATE "PlateWatch" SET category = CASE lower(category) WHEN 'negra'
THEN 'BLACKLISTED' WHEN 'vip' THEN 'WHITELISTED' WHEN 'busca' THEN 'SEARCH' ELSE category END`.
`normalizeWatchCat` deja de mapear desconocido → `BLACKLISTED`; devuelve `null` y los escritores
rechazan.

### D2. Un helper por proceso, misma lógica, y la consulta en SQL para que no diverjan
`src/lib/lista-negra.ts` (Next) y `lib-lista-negra.js` (CommonJS, para `server.js` y
`waha-handler.js`) exponen `estaEnListaNegra(plate) → { negra: boolean; motivo: string|null;
origen: 'manual'|'persona'|'rol'; watch: Entrada|null }`. Los dos ejecutan **la misma consulta**:
la fila activa de `PlateWatch` para la matrícula normalizada (`[A-Z0-9]`), y si no hay fila negra,
la existencia de una credencial `PLATE` cuyo usuario tenga rol `BLACKLISTED`. Alternativa
descartada: duplicar la lógica "a ojo" en cada sitio, que es exactamente el estado actual.

Orden de decisión resultante en los tres puntos (ANPR `server.js` ~1440, `paso-por-acceso.ts`,
`setEventPlate`): **1)** lista negra → `DENY` + `Lista negra: <motivo>` en `details` + `watch`;
**2)** si no, lo de hoy (credencial + `MODE_LPR` + decisión de cámara). La lista negra se evalúa
**antes** de persistir el evento, no después como hoy.

### D3. Cámaras: `addPlateToCamera(device, plate, listType)` y sincronización que respeta la lista
`HikvisionDriver.addPlateToCamera` toma `listType: "whiteList" | "blackList"` (default `whiteList`
para no romper llamadores). Las cuatro rutas de sincronización (`lpr-sync.ts` incremental y
completa, `devices.ts` `syncPlatesToDevice` y `syncPlatesToAllDevices`, `credentials.ts` alta) pasan
a construir el conjunto como `{ blancas: credenciales PLATE − negras, negras: PlateWatch BLACKLISTED
activas ∪ credenciales de usuarios con rol BLACKLISTED }`, desde **una** función
`listasParaCamara()` en `src/lib/lista-negra.ts`. `clearWhiteList` borra todo y se recarga en ese
orden. El alta/baja de una entrada negra llama `aplicarListaNegraEnCamaras(plate, negra:boolean)`
que recorre las `LPR_CAMERA` Hikvision: quita de una lista y pone en la otra (para quitar una sola
matrícula se usa `DelLicensePlateAuditData` con `id` de la matrícula; si el firmware no lo soporta
por id, se cae a "borrar todo + recargar" y se anota en el log), y devuelve `{ok: string[],
fallo: {id,name,error}[]}` que la UI muestra. Alternativa descartada: no tocar la cámara y confiar
en el servidor — pero la barrera la abre la cámara por su lista; si el server está caído, la lista
negra entraría.

Lo que hace `waha-handler.js` por su cuenta (`addPlateToHikvision`) pasa a respetar lo mismo: una
matrícula en lista negra no se agrega a la `whiteList` desde el bot.

### D4. Un solo lugar: pestaña en `/admin/users`, no una página nueva
Alternativas: página `/admin/lista-negra` propia, o pestaña en Usuarios. Se elige **pestaña
"Lista de vigilancia" en `/admin/users`** (junto a "Personas"): es donde el administrador ya va a
dar de alta gente, y el pedido es literalmente "un solo lugar para agregar usuarios, lista negra".
Componente `ListaVigilancia.tsx` sobre `ui/tabla.tsx` y `ui/celdas.tsx` (criterio de diseño:
no se dibuja una tabla a mano), con filtro por categoría/activas, buscador, alta (matrícula o
persona), edición de motivo/categoría/avisa, baja (desactivar), y las entradas "por rol" marcadas
como tales (sólo lectura: se sacan desde el módulo facial). El cajón de la persona
(`CajonUsuario.tsx`) suma el interruptor "Lista negra" con motivo, que llama
`marcarPersonaEnListaNegra(userId, motivo)` / `desmarcar...`. `TablaUsuarios` muestra el badge si
la persona tiene alguna matrícula activa en lista negra **o** el rol.

`WatchlistDialog` (monitor), `EventDetailsDialog` y `VisorEventoAcceso` conservan sus controles pero
llaman a las mismas acciones (`addWatch` con motivo y `createdBy`, `deactivateWatch` en vez de
`deleteWatch`), y `addWatch` devuelve `{ conflicto: 'WHITELISTED'|'SEARCH' }` cuando la matrícula ya
está activa en otra categoría, para que la UI confirme antes de pisar (`force: true`).

### D5. Avisos y monitor desde una sola fuente
`server.js`: el bloque de watchlist se mueve antes de persistir (D2) y `notificarPorReglas(
{modulo:'LPR', evento:'WATCHLIST'})` se dispara para toda lista negra, no sólo la derivada del rol.
`paso-por-acceso.ts` hace lo mismo y emite `watch` en el socket. `getAccessEvents` adjunta `watch`
a cada evento (join por matrícula contra `PlateWatch` activa + rol) para que el monitor, al recargar,
pinte y apile igual que en vivo; `esNegra`/`tipoDeteccion` leen sólo `event.watch` (y `watchMap`
como respaldo para eventos viejos). `VisorCuadro` y `tracking/recent` leen la categoría canónica.

### D6. Bot
`waha-handler.js` usa `lib-lista-negra.js`: alta con motivo y `createdBy = número`, baja =
desactivar; si la matrícula está activa en otra categoría contesta y pide `confirmar`; tras
alta/baja llama a la actualización de cámaras por HTTP interno (acción expuesta como ruta
`POST /api/vigilancia/camaras` con `x-tracking-token`, ya que el handler no puede importar código
de Next) y relata el resultado por cámara.

## Risks / Trade-offs

- [`DelLicensePlateAuditData` por id puede no estar soportado en este firmware] → probar primero
  por ISAPI en una lectora real (tarea explícita); si no, "borrar todo + recargar" por cámara, que
  ya es lo que hace la sincronización completa hoy.
- [Una matrícula con credencial de dos usuarios distintos (`Credential.value` no único)] → la
  decisión usa la matrícula, no el usuario: si cualquiera de las fuentes la marca negra, es negra.
  Se documenta; no se intenta deduplicar credenciales acá.
- [Pisar sin querer una VIP con una negra desde el bot o un atajo] → confirmación explícita (D4/D6).
- [Doble implementación TS/CJS del helper] → la consulta vive en una sola sentencia SQL compartida
  como string en los dos archivos, con un test manual en tasks que compara el resultado de ambos
  para tres matrículas (negra manual, negra por rol, limpia).
- [Rendimiento: una consulta extra por lectura ANPR] → una sola `SELECT` indexada por `plate`
  (`@unique`) y por `Credential.value`; despreciable frente a la subida de la foto a MinIO.
- [Dejar de pushear matrículas negras a la `whiteList` cambia qué abre la barrera hoy] → es el
  objetivo; se avisa en la entrega que, desde el despliegue, un vehículo en lista negra **no entra**
  aunque antes entrara.

## Migration Plan

1. Migración Prisma (columnas nuevas + `UPDATE` de categorías) con `prisma migrate deploy` en el
   LXC; `prisma generate`.
2. Deploy del código (build de `omniaccess-web`; `pm2 restart omniaccess-web omniaccess-webhooks`).
3. Ejecutar una vez "sincronizar matrículas" en las lectoras (.7 y .8) para que la `whiteList`
   quede sin las negras y la `blackList` con ellas; verificar por ISAPI (`licensePlateAuditData`).
4. Rollback: revertir el commit y restaurar el build anterior; las columnas nuevas son nullable y la
   migración de categorías es idempotente, así que el código viejo sigue leyendo (normaliza igual).

## Open Questions

- ~~Si la cámara soporta borrar una matrícula puntual de su lista~~ **Resuelto el 7/10 contra la
  iDS-2CD7A46G0/P de salida (.8):** `licensePlateAuditData/record` con `listType: blackList`
  funciona; mandar la misma chapa con otro `listType` **reemplaza** el registro (mismo `id`), así
  que mover de blanca a negra es un PUT; `DelLicensePlateAuditData` borra por el **`id` interno
  del registro, como string** (`{"id":["2"]}`): con número contesta OK y no borra, con la matrícula
  contesta "Invalid JSON Content" — que es lo que mandaba el código viejo, o sea que borrar una
  chapa de la cámara nunca había funcionado. El id se obtiene con `searchLPListAudit` filtrando
  por `LicensePlate`.

## Addendum 9/10 — fichas, pestañas y comportamiento

**Fichas, no filas.** La lista sigue siendo PlateWatch, una fila por matrícula, porque es lo que
leen la barrera (`estaEnListaNegra` y su espejo de server.js), las lectoras y el bot. Lo nuevo es
`ficha`: las filas con el mismo id son una persona o un vehículo. Una fila suelta (monitor, bot)
se muestra como ficha de una matrícula «Sin identificar»; una persona marcada desde su cajón,
agrupada por `userId`; el rol «Lista negra» del módulo facial, en sólo lectura. Las fichas no son
usuarios ni credenciales: una credencial PLATE es lo que abre la barrera.

**Dos niveles.** Alerta máxima = `BLACKLISTED` (deniega, lectoras, alarma). En búsqueda =
`SEARCH` (pasa, avisa con el motivo, que es obligatorio). VIP sale de la lista: `User.vip`.

**Baja y reactivación.** La baja desactiva todas las filas con la misma hora; reactivar trae las
de la última baja (las que se habían quitado antes de la ficha no vuelven).

**Comportamiento.** Fijo (barrera, lectoras, alarma de alerta máxima) se dice, no se dibuja como
control. Interruptores sólo donde algo cambia de verdad en el monitor LPR. Los avisos fuera de la
pantalla siguen en las reglas de Notificaciones (WATCHLIST): se muestra cuántas hay.
