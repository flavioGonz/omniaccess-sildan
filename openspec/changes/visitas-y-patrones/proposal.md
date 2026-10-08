# Proposal

## Why

San Nicolás es un barrio **abierto**: no hay barrera y la guardia no puede frenar a nadie; algunos paran en la garita y otros pasan de largo. El sistema, en cambio, razona como un barrio cerrado: cada lectura sale "Permitido / Denegado", el monitor muestra **1.670 "denegados" y 0 entradas** en un día normal (cuenta sólo las permitidas), y el merodeo marca como sospechoso a cualquier auto que pase cuatro veces. Al mismo tiempo los datos ya permiten saber mucho más de lo que se muestra: en 9 días de lecturas hay 97 matrículas que vienen 8 a 14 días, rutinas de lunes a viernes con ±2–9 minutos de variación, una permanencia mediana de 2 h 19 min y 557 visitas de menos de 20 minutos (tipo delivery). La guardia no ve nada de eso, y un delivery que paró en la garita no queda registrado en ningún lado con su lote y su tiempo.

## What Changes

- **Modo de acceso por barrio** (`ABIERTO` / `CERRADO`, en `Setting`, por defecto `CERRADO` para no cambiar a los clientes con barrera). En abierto el vocabulario pasa a **Registrado / No registrado**, los contadores cuentan todas las lecturas (no sólo las permitidas) y no hay alertas de "denegado". San Nicolás se configura en abierto.
- **Visitas registradas**: la guardia registra desde su consola, en pocos toques, a quien para (tipo, lote del mapa, matrícula si se ve, nombre/empresa opcional). Cada tipo tiene su tiempo configurable (**Delivery 15 min**, Servicio, Obra, Visita…). Una matrícula con invitación vigente que entra abre su visita sola con el lote de la invitación. La visita **se cierra sola cuando la cámara de Salida lee su matrícula**; si no, la cierra el guardia con un toque, o al fin del día queda "sin salida registrada". La guardia puede extenderla.
- **Perfil de cada matrícula**, recalculado periódicamente: días vistos y frecuencia, permanencia habitual (mediana y p90 de sus propias visitas), **rutina** por día de semana y hora (con su variación), lote probable, y clase (**Residente · Habitual con rutina · Frecuente · Ocasional · Primera vez**). Separa "pasa por la calle" (vista sólo en Salida) de "entró al barrio".
- **Avisos a la guardia, sólo a la guardia** (monitor y consola del guardia; nunca WhatsApp): visita excedida, fuera de rutina, permanencia mayor a la habitual, primera vez de noche, da vueltas, y —en abierto— entró sin registrarse; cada aviso dice por qué se disparó y se puede marcar como atendido. El merodeo actual se redefine en abierto para no marcar a los habituales.
- **Monitor LPR**: columna **"En el barrio ahora"** con cada visita y su cuenta atrás (ámbar cerca del tope, rojo excedida) y las no registradas con su tiempo **estimado**; ficha de la matrícula con frecuencia, permanencia típica y la **rutina dibujada** (días × horas); los avisos entran en la fila de atención con su motivo.
- **Panel**: Ajustes → "Visitas y patrones" (modo de acceso, tipos y tiempos, umbrales de los avisos) y una pantalla `/admin/visitas` con las visitas y los avisos del día.

## Capabilities

### New Capabilities
- `modo-de-acceso`: cómo se comporta el sistema en un barrio abierto o cerrado — vocabulario de la decisión, qué cuenta cada contador, qué alertas aplican.
- `visitas`: el registro de una visita (guardia o invitación), sus tipos y tiempos, cómo se cierra (salida leída, guardia, fin del día), la extensión y el aviso de excedida, y cómo se ven en el monitor y la consola.
- `perfiles-de-matricula`: la frecuencia, la permanencia habitual, la rutina y la clase de cada matrícula, cómo se calculan y dónde se muestran.
- `avisos-a-la-guardia`: qué patrones generan un aviso, con qué umbrales, a quién llega (sólo guardia), cómo se ve y cómo se atiende.

### Modified Capabilities
- (ninguna en `openspec/specs/`. La vista LPR está especificada en el cambio `monitores-centro`, todavía sin archivar; los requisitos nuevos del monitor quedan en `visitas` y `modo-de-acceso` y no contradicen los de esa vista)

## Impact

- **Datos (migración Prisma):** tablas nuevas `Visita`, `PerfilMatricula`, `AvisoGuardia`. Ajustes nuevos en `Setting`: `MODO_ACCESO`, `VISITA_TIPOS`, `AVISOS_GUARDIA`. Ninguna columna existente cambia.
- **Código:** motor de visitas y patrones en `src/lib/visitas/*` enganchado donde ya llega cada lectura LPR (`/api/notifications/event` desde `server.js` y `paso-por-acceso.ts` para la .86) — **sin tocar `server.js`**; ruta interna `/api/visitas/tick` (vencimientos, cierres de fin de día, recálculo de perfiles) llamada por cron; acciones de servidor para registrar/cerrar/extender visitas y atender avisos; `GuardConsole.tsx` (botón "Registrar visita" y avisos); `VistaLpr.tsx` y `/api/monitor/lpr` (columna en el barrio, ficha con perfil, contadores y vocabulario según modo); Ajustes; `/admin/visitas`; `permisos.ts` (la pantalla nueva bajo el permiso `guardia`).
- **Procesos PM2:** `omniaccess-web` (build + restart). **No** se reinicia `omniaccess-webhooks` ni `dispatch-worker`.
- **Infra del CT:** una línea de cron (`* * * * *`) que llama `/api/visitas/tick` con el token interno (como el muestreo de salud; va en la lista de "qué poner en un CT nuevo").
- **Páginas a verificar:** `/monitor/lpr` (abierto: Registrado/No registrado, contadores, En el barrio ahora, ficha con rutina), `/guard` (registrar, cerrar, extender, ver avisos), `/admin/settings?seccion=visitas`, `/admin/visitas`, `/admin/monitor-lpr` (el historial sigue igual).
- **Límites conocidos (medidos):** sólo el 45 % de las entradas se ve salir y 2.948 matrículas aparecen sólo en Salida (tránsito de calle): la permanencia de un no registrado es **estimada** y no dispara avisos por sí sola. La cámara de Salida cuenta "Motorbike 0": las motos sólo existen si paran en la garita.

## Out of scope

- Aviso al residente por WhatsApp (decisión: sólo a la guardia) y el pre-registro del residente por el bot ("viene un Rappi").
- QR para que el repartidor se registre solo y comparta su ubicación en vivo; seguimiento del camino dentro del barrio (la cámara interior lee 56 veces por semana).
- Cambiar la decisión de la barrera en barrios cerrados (el modo sólo cambia vocabulario, contadores y avisos).
- Reconocimiento de motos o cambios de cámaras/encuadres.
- Avisos por regla de notificación (WhatsApp/Telegram) a partir de los patrones.
