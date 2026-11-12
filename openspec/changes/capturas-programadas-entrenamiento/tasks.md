# Tasks

## 1. Medir antes de fijar el criterio de «repetida»

- [x] 1.1 Script de medición (fuera del repo) que toma en el lab pares de cuadros de al menos 4 cámaras —escena quieta de día, escena quieta de noche, y con un vehículo o persona que entra— y calcula la diferencia media de huella 32×18 y la máxima por celda 4×3. Verificación: tabla con las dos distribuciones por cámara, guardada en el doc del proyecto. **Hecho el 12/11 de noche, 8 cámaras; de día queda para la programación de prueba (cada cámara guarda sus últimas 24 comparaciones).**
- [x] 1.2 Elegir los dos umbrales entre las distribuciones y dejarlos escritos en `design.md` con la medición. Si se pisan, frenar y avisar a Nico antes de seguir. Verificación: `design.md` actualizado con los números. **Se pisan en escenas que se mueven solas (árboles al viento, tránsito al fondo): el filtro quedó conservador y la spec lo dice. Avisado a Nico en el resumen del despliegue.**

## 2. Base

- [x] 2.1 `prisma/schema.prisma`: modelo `CapturaProgramada` y `FotoEntrenamiento.programaId` con índice `(programaId, revisada)`; migración aditiva con comentarios `//` y `///`. Verificación: `prisma validate` y `prisma migrate deploy` limpio sobre una copia de la base.

## 3. Reglas (funciones puras)

- [x] 3.1 `src/lib/capturas-programadas.ts`: constantes de los frenos, validación de una programación (cámaras, intervalo, tope, fecha, franja) y `queHacer(programa, { ahora, sinDibujar })` con la próxima hora. Verificación: `tests/capturas-programadas.test.ts` cubre tomar, pausada, fuera de franja (incluida la que cruza medianoche), cola llena, tope y fecha.
- [x] 3.2 Huella y comparación: `huellaDe(jpeg)` y `esRepetida(huellaNueva, huellaGuardada)` con los umbrales de 1.2. Verificación: test con huellas armadas con los números medidos (misma escena con ruido, objeto en un rincón, cambio de luz, sin huella anterior). **Sin fotos reales en `tests/fixtures`: no se suben cuadros de cámaras de un cliente al repo.**

## 4. Tomar la foto: un solo camino

- [x] 4.1 Sacar la toma del cuadro de `api/vision/objetos/fotos/route.ts` a `cuadroDeCamara(id)` en `src/lib/detector-propio-servidor.ts` y hacer que la ruta la use. Verificación: «Sacar foto ahora» sigue respondiendo igual para un equipo y para un canal de grabador (pedido directo en el lab). **Verificado en el lab el 12/11 por la función compartida: equipo (0,3–0,7 s por cuadro) y canal de grabador (nvrch-nvr-2-1, 270 KB). Un canal sin video (NVR IES · CH 23) devuelve «go2rtc no entregó un cuadro».**
- [x] 4.2 `guardarFoto` acepta `programaId` opcional y `filaFoto` lo devuelve. Verificación: `tsc --noEmit` y la fila creada lleva el id.
- [x] 4.3 Ruta interna `POST /api/vision/objetos/capturas/vuelta` con `{ id }` (token interno, en la lista sin sesión del middleware): aplica `queHacer`, recorre las cámaras de a una, saltea repetidas, guarda, cuenta fallos por cámara con su motivo, actualiza contadores, `proximaAt`, `terminada` y la marca `enVueltaDesde`. Verificación: llamada con token en el lab sobre una programación de prueba guarda fotos y, repetida enseguida, las saltea; sin token responde 401/403. **Lab, 12/11: primera vuelta 3 guardadas en 1,5 s; la siguiente saltea las quietas (bloque 2,9–4,9) y guarda la que cambió (bloque 28–72); sin token 401.**

## 5. Programaciones: rutas y permisos

- [ ] 5.1 `GET/POST /api/vision/objetos/capturas` y `PUT/DELETE /api/vision/objetos/capturas/[id]` (editar, pausar, reanudar, «tomar ahora»), con `puedeMirar` / `puedeCambiar` y auditoría de alta, cambio y baja. Verificación: pedidos en el lab con y sin permiso. **Hecho y desplegado; sin sesión responde 401. Con sesión (con y sin permiso) no se pudo pedir desde acá: queda para la recorrida 8.4.**
- [x] 5.2 `DELETE /api/vision/objetos/capturas/[id]/fotos`: descarta sólo las sin dibujar de esa programación (fila y objeto en el bucket) y devuelve cuántas. Verificación: una foto dibujada de la misma programación sigue después del descarte. **Lab, 12/11, por la función de la ruta: de 4 fotos con una dibujada, descarta 3 y la dibujada sigue; borrar la programación deja la foto.**
- [x] 5.3 Clasificar las rutas nuevas en `src/lib/permisos-api.ts`. Verificación: `tests/permisos-api.test.ts` pasa.

## 6. El reloj

- [x] 6.1 `vision-capturas.js` con `iniciar({ prisma, log })`: cada minuto escribe el latido, busca las programaciones a las que les toca y llama a la ruta interna de a una; errores al log sin tumbar el ciclo. Enchufarlo en `vision-worker.js`. Verificación: en el lab, el log del proceso muestra la vuelta y las fotos aparecen sin intervención. **Lab, 12/11: «capturas «Prueba (Claude)…»: 2 guardadas, 1 repetidas, 2 sin cuadro (1,5 s)» cada 5 min; un «Tomar ahora» pedido a las 20:50:29 salió a las 20:51:09.**

## 7. Pantalla

- [x] 7.1 Componente `CapturasProgramadas` (diálogo): lista con estado, próxima vuelta, guardadas, salteadas y cámaras sin imagen; formulario de alta y edición con el selector de cámaras agrupado por grabador; pausar, reanudar, tomar ahora, borrar y descartar pendientes con confirmación; cargando, vacío y error con reintento; aviso si el latido está viejo. Con las piezas de `ui/` y los tonos de estado. Verificación: `tsc --noEmit` y `npm run build`.
- [ ] 7.2 Botón «Programar capturas» en `SoltarFotos` y marca «Programada» en la foto de la grilla. Verificación: build, y recorrida en pantalla (8.4). **Hecho, compila y está desplegado. Falta verlo en pantalla (8.4): desde acá no hay sesión del panel.**

## 8. Verificación en el lab

- [x] 8.1 Suite completa: `node scripts/probar.js`. Verificación: todos los tests pasan. **146 pruebas, 0 fallas.**
- [ ] 8.2 Desplegar en el lab (migración, build, reinicio de web y visión) y dejar una programación de prueba de 3 cámaras cada 5 minutos durante una hora. Verificación: fotos guardadas y salteadas coherentes con lo que pasó en la escena; tiempo de una vuelta medido; `api/health` y el vigía en orden. **Desplegado el 12/11 20:44 (migración, build, web y visión reiniciados, health 200). La programación de prueba «Prueba (Claude) · se puede borrar» (3 cámaras + un canal sin video, cada 5 min, tope 30) quedó corriendo: falta mirar el resultado de la hora completa.**
- [x] 8.3 Probar los frenos con valores chicos: tope, fecha, cola llena y una cámara que no da imagen. Verificación: cada estado se muestra como dice la spec. **Lab, 12/11, con programaciones de prueba ya borradas: tope (2 de 2 y termina), fecha, pausa, franja (próxima a la hora de apertura), cámara inexistente y canal sin video (cuentan el fallo y las demás siguen), dos vueltas a la vez (la segunda no pisa). La cola llena sólo por test unitario: no se cargaron 500 fotos al lab.**
- [ ] 8.4 Recorrida de Nico en el lab: crear una programación, ver las fotos entrar a «Sin dibujar», pausar, tomar ahora, descartar pendientes. Verificación: su visto bueno.

## Workflow follow-up

- Subir a `lab` en git al terminar cada grupo que quede andando.
- San Nicolás sólo con el OK de Nico (lleva migración).
- Archivar el cambio cuando Nico lo apruebe.
