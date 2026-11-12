# Proposal

## Why

La Lista Amarilla nació para «vehículos sospechosos a los que darles seguimiento» (Nico, 9/11), pero hoy es una lista con un aviso en ámbar: cuando la cámara lee la matrícula, el guardia ve el motivo y nada más. No sabe si es la primera vez que pasa o la quinta de la semana, la ficha no dice cuándo ni por dónde anda, nadie anota qué se averiguó, y una ficha cargada hace seis meses sigue avisando igual que una de ayer. Seguir a alguien es acumular lo que se va sabiendo y decidir cada tanto si sigue valiendo la pena; eso es lo que falta.

Buena parte de la materia prima ya existe y no se usa acá: el cajón «Investigar» del Monitor LPR muestra actividad por día, hora pico y recorrido de una matrícula, pero sólo se llega a él desde una lectura del monitor, no desde la ficha.

## What Changes

- **El aviso dice cuánto se la vio.** Al leer una matrícula de la Lista Amarilla, el aviso (monitor LPR, Control LPR, Telegram a la guardia y reglas de Notificaciones) agrega una línea de contexto: cuántas lecturas y en cuántos días distintos de la última semana, y cuándo y dónde fue la anterior. La primera vez lo dice: «primera vez que se la ve».
- **La ficha muestra el seguimiento.** La ficha de una entrada amarilla suma un resumen (lecturas en 7 y 30 días, días activos, última vez, franja horaria habitual, cámaras por las que pasa) y un botón **Investigar** que abre, sin salir de Usuarios, el mismo cajón del Monitor LPR con la actividad y el recorrido de esa matrícula.
- **Fecha de revisión.** Toda ficha amarilla nace con una fecha de revisión a 30 días. La tabla muestra cuánto falta, hay un filtro «Para revisar», y la ficha ofrece **Renovar**, **Pasar a lista negra** o **Dar de baja**. Una ficha vencida **sigue avisando**: vencer es un recordatorio para quien administra, nunca un apagado silencioso.
- **Bitácora.** Cada ficha lleva un registro fechado y firmado: las notas que escribe el operador («se habló con el vecino del lote 14») y lo que el sistema anota solo (alta, renovación, cambio de nivel, baja, reactivación).
- **Pasar a lista negra en un paso.** Desde la ficha, con la confirmación que ya existe para alerta máxima (a quién se le cierra la barrera), conservando matrículas, motivo, foto y bitácora.
- La tabla de la pestaña Lista Amarilla suma las columnas **Vista** (última vez y lecturas en 7 días) y **Revisión**.
- Todo queda atado a la función `LPR_BUSQUEDA`, como la pestaña.

No hay cambios **BREAKING**: la lista negra no cambia de comportamiento, y lo que decide la barrera tampoco.

## Capabilities

### New Capabilities

- `lista-amarilla`: el seguimiento de vehículos en la Lista Amarilla — qué dice el aviso cuando se la lee, qué muestra la ficha, la fecha de revisión, la bitácora y el paso a lista negra.

### Modified Capabilities

Ninguna. `openspec/specs/` está vacío: los cambios anteriores siguen sin archivar y ninguno define la lista negra ni la amarilla.

## Impact

- **Base:** migración aditiva — `PlateWatch.revisarEl` (fecha, opcional) y la tabla nueva `NotaVigilancia`. Sin borrar ni renombrar nada. Las fichas amarillas activas que ya existen reciben una revisión a 30 días desde la migración, para que no aparezcan todas vencidas el primer día.
- **Servidor de eventos (`server.js`):** una consulta más por cada lectura de una matrícula amarilla (no por cada lectura), sobre el índice `(plateDetected, timestamp)` que ya existe.
- **Acciones:** `actions/padron.ts` (guardar, baja y reactivar anotan en la bitácora y mantienen la revisión), `actions/watchlist.ts` (la carga rápida del monitor y la del bot nacen con revisión), acciones nuevas para el resumen, la bitácora y renovar.
- **Pantallas:** `CajonListaNegra`, `TablaListaNegra`, `admin/users/page.tsx`, `WatchlistDialog`, `avisos/AvisosLpr` y `PilaAvisos` (línea de contexto), monitor LPR y Control LPR donde hoy se muestra el motivo. `FichaMatriculaDrawer` se reutiliza tal cual.
- **Notificaciones:** el texto de Telegram y el `extra` de las reglas `WATCHLIST` suman el contexto. Las plantillas existentes siguen valiendo.
- **Instancias:** se desarrolla y valida en el lab. San Nicolás tiene la función prendida: pasa cuando Nico lo diga.
