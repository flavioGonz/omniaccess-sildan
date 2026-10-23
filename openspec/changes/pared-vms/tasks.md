# Tasks

## 1. Búsqueda compartida

- [x] 1.1 Sacar de `/api/vision/buscar` la lógica de imagen a `src/lib/vision/parecidos.ts` (`buscarPorImagen`, `objetosEnImagen`, `resultadosConFotos` con el prefijo de URL de las fotos). La ruta la usa sin cambiar su respuesta.
  - Verificación: `tsc` limpio. En el lab, el Historial con una foto devuelve lo mismo que antes, comparando cantidad y los primeros diez ids para la misma foto antes y después.
- [x] 1.2 `/api/monitor/camaras/buscar` (POST con imagen; `?objetos=1` devuelve los objetos, `h`, `grupo` y `area` acotan) y `/api/monitor/camaras/imagen/[...clave]` (sólo lectura, buckets de OmniVision). En el middleware, la búsqueda va a la lista de POST de pantalla. Una línea de log por búsqueda con el enlace o el usuario.
  - Prueba: `tests/` sobre `alcanceCubre`: Cámaras y Rotación cubren las dos rutas y LPR no.
  - Verificación en el lab: con una cookie de enlace de Cámaras, POST → 200; con una de LPR → 403.

## 2. Foto desde el celular

- [x] 2.1 Modelo `SubidaFoto` y migración aditiva (`prisma migrate deploy`; sólo `//` en el schema).
  - Verificación: la migración corre en el lab y `prisma.subidaFoto.count()` da 0.
- [x] 2.2 `POST /api/monitor/camaras/subida` (crea el código, tope de 20 vivos, limpia los vencidos) y `GET /api/monitor/camaras/subida/[id]` (entrega la foto una sola vez). Las dos van al alcance de Cámaras; el POST, a la lista de POST de pantalla.
  - Prueba unitaria de la lógica de vencimiento y uso único (`lib/monitor/subida.ts`).
- [x] 2.3 `POST /api/subida/[token]` (pública: valida el token, que no haya vencido, que no se haya usado, el tipo y los 12 MB) y la página `/subir/[token]`:
  - sacar o elegir la foto;
  - achicarla a 1600 px y JPEG 85 % en el celular;
  - estados de enviando, listo, vencido y error.

  Las dos van a la lista pública del middleware.
  - Prueba: token inexistente, vencido, usado y archivo no imagen → rechazo con su mensaje.
  - Verificación en el lab desde un celular por `omniaccess.ies.com.uy`, fuera de la red.

## 3. Buscar parecidos en la pared

- [x] 3.1 `camaras/BuscarParecidos.tsx`, en pantalla completa sobre la pared:
  - **qué**: cuatro botones;
  - **de dónde**: un canal (su cuadro con `fotoDe`) o el QR con la espera;
  - **marcar**: los recuadros de la clase, tocar uno o dibujar; el recorte en canvas;
  - **resultados**: grilla, período, área, foto grande y «Ver el momento» si hay grabación;
  - estados: cargando, sin nada reconocido, sin parecidos (ofrece ampliar el período), error con reintento y canal sin imagen.

  Usa `ui/` y tokens; nada a mano.
  - Verificación: vista previa con datos simulados, en oscuro y a 1920 px y a 1366 px.
- [x] 3.2 Entradas:
  - el botón «Buscar parecidos» en la barra de la pared (`BarraDelMarco` y la barra de abajo en el celular);
  - «Buscar parecidos de este canal» en `FichaCanal`, que salta el paso «de dónde».

  Esc y «Volver a la pared» cierran. Mientras la búsqueda está abierta, la página automática no avanza.
  - Verificación: en el lab, con un enlace de pantalla de Cámaras, buscar desde el cuadro de una cámara y desde una foto del celular.

## 4. Canal web

- [ ] 4.1 `lib/monitor/fuentes-web.ts`:
  - `fuenteValida` (http/https, sin credenciales en la dirección, nombre, recarga de 0 a 1440 min, zoom de 50 a 200);
  - `leerFuentes`;
  - `CLAVE_CANAL` acepta `web:<id>`.

  Las acciones `guardarFuenteWeb` y `borrarFuenteWeb` piden `monitores.config` y revisan los encabezados del sitio (X-Frame-Options, frame-ancestors, http dentro de https, sin respuesta) para guardar los avisos.
  - Pruebas: validación, y que la clasificación de acciones las tenga con `monitores.config`.
- [ ] 4.2 `/admin/monitores`: la sección «Páginas web» (lista con sus avisos, alta, edición y borrado en un cajón). `/api/monitor/camaras` devuelve las fuentes.
  - Verificación: en el lab, cargar una fuente que se deja enmarcar y una que no (se ve el aviso).
- [ ] 4.3 `camaras/Editor.tsx`: sección «Páginas web» para poner una fuente en una casilla. En `VistaCamaras`:
  - la casilla `web:` dibuja el iframe aislado (`sandbox` sin `allow-top-navigation` ni `allow-popups`, `referrerpolicy=no-referrer`), con el rótulo, el zoom y la recarga;
  - «Fuente web que ya no existe» si se borró;
  - fuera de `ordenados`, alertas, seguimiento y búsqueda.
  - Verificación: una vista guardada en el lab con una fuente en la casilla grande y video en las demás; una alerta de una cámara no mueve la fuente.

## 5. Monitor Face

- [ ] 5.1 `vistas.ts`: vista `face` (nombre, para quién, qué muestra, `ScanFace`, alcance, sonido `MONITOR_FACE_SONIDO`). `permisos.ts`: la ruta `/monitor/face` en el permiso `rostros`. `/monitor/[vista]` la registra.
  - Verificación: `node scripts/probar.js` (cobertura de páginas y alcances) en verde; la tarjeta aparece en `/admin/monitores`.
- [ ] 5.2 `/api/monitor/face`: `accessType FACE` y `FACE_TERMINAL`; últimas 11 con persona, foto del padrón, unidad, foto tomada, decisión, motivo, sentido y terminal; contadores del día; atención de la última hora; cantidad de terminales.
  - Verificación: en el lab devuelve ceros y listas vacías sin error, con sesión y con un enlace de Face; un enlace de LPR → 403.
- [ ] 5.3 `vistas/VistaFace.tsx`:
  - acceso grande (foto tomada y foto del padrón, nombre o «Desconocido», unidad, terminal, sentido, hora, permitido o denegado y motivo);
  - tira de diez, contadores y atención;
  - en vivo con `access_event`;
  - fondo con `fondos.ts` (bien, mal o aviso; vuelve a calma a los 8 s);
  - sonido con sus tres modos;
  - estado «no hay terminales faciales» y error con reintento.
  - Verificación: vista previa con datos simulados (permitido, desconocido, denegado por horario, sin terminales), en oscuro, a 1920 px y a 1366 px.

## 6. Cierre

- [ ] 6.1 `tsc --noEmit`, `node scripts/probar.js` y `node scripts/probar-dc09.js` en verde. Desplegar en el lab y recorrer las tres cosas con un enlace de pantalla de Cámaras, uno de Face y una sesión de operador.
- [ ] 6.2 Documentar en el proyecto (`claude/pared-vms.md`) la búsqueda desde la pared (incluido el QR y su seguridad), las fuentes web y sus límites (sitios que no se dejan enmarcar, http dentro de https) y el Monitor Face.

## Workflow follow-up

- San Nicolás sólo cuando Nico lo diga: allí no hay terminales faciales conocidas; confirmar antes si hace falta la vista.
- Monitor Face con datos reales cuando haya una instalación con terminales.
