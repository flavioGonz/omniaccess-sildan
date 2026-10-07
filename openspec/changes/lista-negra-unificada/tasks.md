# Tasks

## 1. Datos y vocabulario

- [ ] 1.1 Migración Prisma `PlateWatch`: `userId?`, `motivo?`, `createdBy?`, `updatedAt`,
      `deactivatedAt?` + `UPDATE` de categorías `negra|vip|busca` → canónicas en el mismo
      `migration.sql`. Verificar: `prisma migrate deploy` aplica sin error y
      `SELECT DISTINCT category FROM "PlateWatch"` sólo devuelve las tres canónicas.
- [ ] 1.2 `src/lib/watch-categories.ts`: `normalizeWatchCat` devuelve `null` para desconocido (ya no
      `BLACKLISTED`); los escritores (`addWatch`, `updateWatch`, bot) rechazan `null` con error.
      Verificar: `addWatch({category:"loquesea"})` responde `{ok:false}` y no crea fila.

## 2. El helper de lista negra (los dos procesos)

- [ ] 2.1 `src/lib/lista-negra.ts`: `estaEnListaNegra(plate)` (fila activa `BLACKLISTED` o credencial
      de usuario con rol `BLACKLISTED`; devuelve `{negra, motivo, origen, watch}`),
      `listasParaCamara()` (blancas = credenciales − negras; negras = manuales ∪ por rol) y
      `aplicarListaNegraEnCamaras(plate, negra)` con resultado por cámara. Verificar: script
      `npx tsx` contra la base con tres matrículas (negra manual, negra por rol, limpia).
- [ ] 2.2 `lib-lista-negra.js` (CommonJS) con **la misma consulta SQL** que 2.1, para `server.js` y
      `waha-handler.js`. Verificar: `node -e` con las tres matrículas devuelve lo mismo que 2.1.
- [ ] 2.3 Ruta interna `POST /api/vigilancia/camaras` (token `x-tracking-token`) que ejecuta
      `aplicarListaNegraEnCamaras` para que el bot/`server.js` actualicen cámaras sin importar
      código de Next. Verificar: `curl` con token → `{ok:[...], fallo:[...]}`; sin token → 401.

## 3. La decisión respeta la lista negra

- [ ] 3.1 `server.js` rama ANPR: evaluar `estaEnListaNegra` **antes** de decidir; si negra →
      `DENY`, `details` con `Lista negra: <motivo>`, `watchHit` con origen, Telegram y
      `notificarPorReglas({evento:"WATCHLIST"})` para toda negra (no sólo rol); el socket sale con
      `watch`. Verificar: push ANPR sintético de una matrícula con credencial y en lista negra →
      fila `DENY` con el motivo; sin lista negra → comportamiento de hoy. `pm2 restart
      omniaccess-webhooks`.
- [ ] 3.2 `src/lib/paso-por-acceso.ts`: misma regla; emite `watch` en el socket y dispara
      `WATCHLIST`. Verificar: `POST /api/tracking/sighting` de una matrícula negra en `lpr-interior`
      → `AccessEvent DENY` con motivo.
- [ ] 3.3 `src/app/actions/history.ts` `setEventPlate`: misma regla al recalcular la decisión.
      Verificar: corregir un evento "sin lectura" con una matrícula negra → `DENY` con motivo.

## 4. Cámaras

- [ ] 4.1 Probar por ISAPI en la lectora .8 (sin cambiar código): alta de una matrícula de prueba en
      `blackList`, lectura de `licensePlateAuditData`, borrado puntual por `id` con
      `DelLicensePlateAuditData`. Anotar en `design.md` → Open Questions qué soporta el firmware.
      Verificar: la matrícula de prueba aparece y desaparece en la lectura ISAPI.
- [ ] 4.2 `HikvisionDriver.addPlateToCamera(device, plate, listType = "whiteList")` y
      `removePlateFromCamera(device, plate)` según lo que dio 4.1. Verificar: tsc sin errores
      nuevos y una llamada manual contra .8.
- [ ] 4.3 Sincronizaciones (`lpr-sync.ts` incremental/completa, `devices.ts` `syncPlatesToDevice` y
      `syncPlatesToAllDevices`, `credentials.ts` alta, `waha-handler.js` `addPlateToHikvision`)
      construyen las listas con `listasParaCamara()`: negras a `blackList`, nunca a `whiteList`.
      Verificar: "sincronizar matrículas" en .8 y lectura ISAPI: ninguna negra en `whiteList`, todas
      en `blackList`.
- [ ] 4.4 Alta/baja de lista negra (acciones, bot, atajos) llaman `aplicarListaNegraEnCamaras` y
      la UI/bot muestran el resultado por cámara (hecho / no respondió). Verificar: apagar una
      lectora de prueba (o IP inexistente) y comprobar que la entrada queda y el fallo se informa.

## 5. Un solo lugar: `/admin/users`

- [ ] 5.1 Acciones: `addWatch` con `motivo`, `createdBy`, `userId` y detección de conflicto de
      categoría (`{conflicto}` salvo `force`); `deactivateWatch` reemplaza a `deleteWatch`;
      `marcarPersonaEnListaNegra(userId, motivo)` / `desmarcarPersonaEnListaNegra(userId)` sobre
      todas las matrículas de la persona; alta de credencial PLATE a persona marcada crea la
      entrada. Verificar: los escenarios de la spec `lista-de-vigilancia` con un usuario de prueba
      con dos matrículas.
- [ ] 5.2 Pestaña "Lista de vigilancia" en `/admin/users` (`ListaVigilancia.tsx` con `ui/tabla.tsx`
      y `ui/celdas.tsx`): tabla, filtro categoría/activas/inactivas, buscador (`ui/search.tsx`),
      alta por matrícula o persona, edición, baja, entradas "por rol" en sólo lectura; estados
      cargando / vacío / error con reintento. Verificar: lo cargado desde el monitor aparece acá y
      viceversa.
- [ ] 5.3 `CajonUsuario.tsx`: interruptor "Lista negra" con motivo; `TablaUsuarios.tsx`: badge si
      tiene matrícula negra activa o rol. Verificar: marcar/desmarcar una persona y ver sus
      matrículas en la pestaña.
- [ ] 5.4 Atajos: `WatchlistDialog` (motivo, confirmación de conflicto, desactivar), `EventDetailsDialog`
      y `VisorEventoAcceso` (desactivar en vez de borrar; confirmación de conflicto). Verificar:
      marcar/desmarcar desde los tres y comprobar la fila en la pestaña.

## 6. Monitor, visor y avisos desde una sola fuente

- [ ] 6.1 `getAccessEvents` adjunta `watch` (join por matrícula contra activas + rol);
      `monitor-lpr` `esNegra`/`tipoDeteccion` leen `event.watch` (respaldo `watchMap`). Verificar:
      recargar el monitor con una lectura negra reciente → tarjeta roja y pila crítica.
- [ ] 6.2 `VisorCuadro.tsx` y `api/tracking/recent` usan la categoría canónica. Verificar: una
      matrícula negra vista por una interior se pinta en el visor del seguimiento.
- [ ] 6.3 Regla `WATCHLIST`: confirmar que `regla-lpr-wa` o una regla nueva la incluye y que llega el
      WhatsApp con foto para una negra manual. Verificar: `DispatchJob SENT` tras 3.1.

## 7. Bot

- [ ] 7.1 `waha-handler.js`: `lista negra <m> [motivo]` → alta con `createdBy=número`;
      `confirmar` si está activa en otra categoría; `quitar lista negra` → desactivar; llama a 2.3 y
      relata el resultado por cámara; `addPlateToHikvision` no agrega negras a `whiteList`.
      Verificar: los tres escenarios de la spec `whatsapp` con webhook sintético y `WahaRequestLog`.

## 8. Despliegue y verificación

- [ ] 8.1 Bundle → LXC: `prisma migrate deploy`, `prisma generate`, build en background
      (`BUILD_EXIT=0`), `pm2 restart omniaccess-web omniaccess-webhooks --update-env`, `/login` 200,
      `/admin/users` 200, `/admin/monitor-lpr` 200; `git push origin san-nicolas`.
- [ ] 8.2 Sincronizar matrículas en .7 y .8 y verificar por ISAPI las dos listas; pasar una
      matrícula de prueba en lista negra (push ANPR sintético o auto real) → `DENY` con `Lista
      negra:` en `/admin/history` y en el monitor; luego sacarla y repetir → decisión normal.
- [ ] 8.3 Actualizar `claude/pendientes-san-nicolas.md` (sacar el ítem "matrículas BLACKLISTED a la
      lista blanca de la cámara") y anotar en la entrega que desde este despliegue la lista negra
      **no entra**.
