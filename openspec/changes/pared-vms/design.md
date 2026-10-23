# Design

## Context

- **Búsqueda.** El buscador de parecidos ya existe: `/api/vision/buscar`.
  - GET busca por texto o por `parecido=<objetoId>`. POST con una imagen busca lo parecido a esa imagen. POST con `?objetos=1` devuelve las personas, vehículos, animales y objetos que hay en la imagen.
  - Lo usan el Historial (buscar con una foto) y OmniVision › Buscar.
  - Una pantalla lo tiene prohibido (`if (auth.pantalla) return forbiddenResponse(...)`).
- **Pantallas.**
  - El middleware deja a una pantalla sólo GET y las rutas de `ALCANCE_POR_VISTA`.
  - Hay una lista corta de POST de pantalla «que no guardan nada» (las siluetas de la grabación).
  - Las fotos de OmniVision se sirven desde `/api/vision/imagen/...`, que hoy no está en ningún alcance.
- **Pared de Cámaras.**
  - El cuadro de un canal ya se puede pedir: `fotoDe(c)` → `/api/snapshot/<equipo>` o `/api/monitor/camaras/foto?nvr=…&ch=…`.
  - Las vistas guardadas son `{ id, nombre, disposicion, canales: (string | null)[] }` en el ajuste `AJUSTE_VISTAS_CAMARAS`.
  - Cada clave de canal valida contra `CLAVE_CANAL` (`dev:<id>` o `nvr:<id>:<ch>`).
  - Se editan en `camaras/Editor.tsx` con `actions/monitores.ts`.
- **QR.** `qrcode` ya está en las dependencias, y `AlCelular` (Entrenador) lo usa. Pero el Entrenador pide sesión en el celular, y acá el celular no tiene usuario.
- **Rostro.**
  - El lab no tiene terminales faciales (`FACE_TERMINAL`: 0) ni eventos con `accessType = FACE` (0).
  - `server.js` ya emite `access_event` para los accesos de las terminales, igual que para LPR.
  - El Control LPR (`VistaLpr` + `/api/monitor/lpr`) es el modelo a seguir.

## Goals / Non-Goals

**Goals:**
- La búsqueda de parecidos reusa el mismo motor y la misma lógica que el Historial: una sola implementación.
- El celular sube la foto sin usuario, y lo único que lo autoriza es un token de un solo uso y de vida corta.
- Una fuente web no puede tocar la sesión de OmniAccess ni la pared que la contiene.

**Non-Goals:**
- Buscar por texto desde la pared: no hay teclado en un wall. Si hace falta, va aparte.
- Mostrar en la pared sitios que prohíben ser enmarcados (pasarlos por un proxy propio): se avisa y no se fuerza.
- Reconocimiento facial con las cámaras de video en el Monitor Face (decisión de Nico: sólo terminales).
- Cambiar el Monitor LPR.

## Decisions

### 1. La lógica de búsqueda sale de la ruta a una pieza compartida

`src/lib/vision/parecidos.ts`:
- `buscarPorImagen(buffer, { h, grupo, area })`
- `objetosEnImagen(buffer)`
- `resultadosConFotos(...)`

`/api/vision/buscar` pasa a llamarla, sin cambiar lo que devuelve. La pared usa una ruta propia, `/api/monitor/camaras/buscar`, que llama a la misma pieza.

**Por qué una ruta propia y no abrir `/api/vision/buscar` a las pantallas:** el alcance de una pantalla se define por prefijo, y meter `/api/vision/` entero en el alcance de Cámaras le abriría también reglas, entrenamiento y verificación. Con la ruta bajo `/api/monitor/camaras/`, el alcance actual de Cámaras y el de Rotación (`/api/monitor/`) ya la cubren, y LPR no.

**Alternativa descartada:** sumar sólo `/api/vision/buscar` al alcance. Con eso queda el problema de las fotos: los resultados apuntan a `/api/vision/imagen/...`.

### 2. Las fotos de los resultados pasan por `/api/monitor/camaras/imagen/[...clave]`

Es un reenvío de sólo lectura a la misma lectura de MinIO que hace `/api/vision/imagen`, limitado a los buckets de OmniVision (`objetos`, `intrusion`). La pieza `parecidos.ts` recibe el prefijo de URL con el que tiene que devolver cada foto.

### 3. El POST de la pared se suma a la lista de POST de pantalla

Se suma `/api/monitor/camaras/buscar` (que busca y devuelve objetos, no guarda nada) a la lista de POST «que no guardan nada» del middleware.

La subida del celular **no** pasa por ahí: `/api/subida/[token]` es pública y se valida sola, con el token.

### 4. QR: una fila `SubidaFoto` por código, y la pared consulta

Modelo nuevo, con migración aditiva:

```
SubidaFoto { id (cuid), token (único, 32 bytes al azar en base64url), creada, vence (creada + 10 min),
             foto Bytes?, tipo String?, llegó DateTime?, retirada DateTime? }
```

1. **La pared pide un código.** `POST /api/monitor/camaras/subida` devuelve `{ id, url }`, con `url = <origen>/subir/<token>`.
   - Esta ruta sí crea una fila, así que también va a la lista de POST de pantalla.
   - Es la excepción documentada: no cambia nada de la instalación.
   - Tiene un tope de 20 códigos vivos.
2. **La pared consulta.** Cada 2 s, `GET /api/monitor/camaras/subida/<id>`, mientras el QR esté a la vista.
   - Cuando llegó la foto, la devuelve una sola vez y marca `retirada`.
   - La pared trabaja desde ahí con la imagen en memoria, igual que con un cuadro.
3. **El celular.** `/subir/[token]` es una página pública mínima, sin el diseño del panel:
   - un botón «Sacar foto» (`<input type=file accept=image/* capture=environment>`) y otro «Elegir de la galería»;
   - antes de subir, achica la foto en el celular a 1600 px de lado y JPEG 85 %, porque una foto de celular de 4 a 8 MB por datos móviles es lenta;
   - la sube con `POST /api/subida/<token>`, que acepta sólo JPG, PNG o WebP de hasta 12 MB, y sólo si el token existe, no venció y no recibió otra foto.
4. **Limpieza.** Cada pedido de código borra las filas vencidas hace más de 10 minutos. No hace falta un proceso aparte.

**Por qué no un socket:** el aviso en vivo lo emite `server.js` (webhooks), y tocarlo pide el OK de Nico y reiniciar webhooks. Dos segundos de consulta, sólo mientras el QR está abierto, alcanzan.

**Por qué en la base y no en memoria:** Next puede atender la subida y la consulta en procesos distintos, o reiniciarse entre una y otra.

**Seguridad.** El token es lo único que autoriza la subida.
- Es de un solo uso, vence a los 10 minutos y no da acceso a nada más: no lee resultados ni la pared.
- La página no muestra nada de la instalación más que «Foto para la pared de OmniAccess».

### 5. Búsqueda en la pared: un cajón a pantalla completa, en tres pasos

`camaras/BuscarParecidos.tsx` es una pieza nueva que reemplaza a la pared mientras está abierta (Esc o «Volver a la pared»):

1. **Qué:** cuatro botones grandes (Objeto, Persona, Vehículo, Animal), para tocar en una pantalla táctil.
2. **De dónde:** «Cuadro de un canal» (la lista de canales de la vista, o directo el canal si se abrió desde su ficha) o «Foto del celular» (el QR grande, la dirección debajo y «Esperando la foto…»).
3. **Marcar:**
   - la imagen congelada con los recuadros de `objetosEnImagen` filtrados por la clase;
   - tocar uno, o «Dibujar recuadro» (con el mismo gesto que el calibrador);
   - el recorte lo hace el navegador en un canvas y se manda con POST.

Después, los resultados en una grilla, con período, área y «Otra búsqueda».

**Por qué el recorte en el navegador:** las huellas de OmniVision son de recortes, y un cuadro entero no se parece a ningún recorte (está escrito en la ruta actual). Es lo mismo que hace el Historial.

### 6. Canal web: clave `web:<id>` y catálogo en un ajuste

- **Clave.** `CLAVE_CANAL` acepta `web:[\w-]{1,40}`.
- **Catálogo.** El ajuste `MONITOR_FUENTES_WEB` guarda JSON `[{ id, nombre, url, recargaMin, zoom }]`, con un tope de 50, validado en `lib/monitor/fuentes-web.ts` (como `vistaValida`).
- **Edición.** Las acciones `guardarFuenteWeb` y `borrarFuenteWeb` piden `monitores.config` y viven en `actions/monitores.ts`, que ya tiene esa clasificación.
- **Datos.** `/api/monitor/camaras` devuelve las fuentes.
- **Editor.** Muestra en su lista una sección «Páginas web» junto a los canales.
- **En la pared.** La casilla `web:` dibuja `<iframe sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer" loading="lazy">`.
  - El zoom se hace con `transform: scale` sobre un contenedor más grande.
  - La recarga, cambiando un `key`.
  - `allow-same-origin` se da porque sin él la mayoría de los tableros no funciona (cookies, storage). Es seguro porque el origen es el del sitio externo, no el de OmniAccess: el sitio no puede leer la sesión ni la pared. No se da `allow-top-navigation` ni `allow-popups`.
- **Aviso al guardar.** La acción hace un GET a la dirección (5 s, sin seguir más de 3 redirecciones) y mira `X-Frame-Options` y `Content-Security-Policy: frame-ancestors`. Los avisos se guardan con la fuente y se muestran en Monitores y en el editor.
  - Que el servidor no llegue no prueba que el navegador de la pared no llegue (una herramienta de la LAN). Por eso es un aviso, no un rechazo.
- **Lo que la casilla web no hace.** No entra en `ordenados`, alertas, seguimiento ni búsqueda. En la vista automática no hay casillas web.

### 7. Monitor Face: vista `face`, hermana de LPR

- **Catálogo.** `vistas.ts` suma `face` («Monitor Face», ícono `ScanFace`, alcance `["/api/monitor/face"]`, sonido `MONITOR_FACE_SONIDO` con los modos off, denegado y desconocido).
- **Datos.** `/api/monitor/face` filtra con `accessType: "FACE"` y `device.deviceType: "FACE_TERMINAL"`. Devuelve:
  - `ultimas`: 11, con `user { name, photoPath, unidad }`, `snapshotPath`, `decision`, `details`, `direction` y `device.name`;
  - `hoy { permitidos, denegados, desconocidos }`;
  - `atencion`: los denegados de la última hora;
  - `terminales`: cuántas hay.
  - «Desconocido» = `decision: DENY` y sin `userId`.
- **Permisos.** La página `/monitor/face` pide `rostros` (sumarla a las `rutas` del permiso en `permisos.ts`, para que la prueba de cobertura pase).
- **`VistaFace.tsx`.** Sigue la estructura de `VistaLpr`: acceso grande, tira, contadores y atención.
  - Se actualiza con `useTiempoReal("access_event")` filtrando por `accessType === "FACE"`; si el evento no lo trae, recarga.
  - Fondo según `fondos.ts`:
    - `bien` si se permitió;
    - `mal` si fue un desconocido o el motivo es lista negra;
    - `aviso` en los demás denegados;
    - vuelve a `null` a los 8 s, como LPR.
- **`/admin/monitores`.** Ya dibuja las tarjetas desde `VISTAS`: con agregarla al catálogo aparece.

### 8. Criterio de color

Monitor Face y la búsqueda usan `lib/monitor/fondos.ts` (lab104). La búsqueda no tiñe la pared: es una herramienta, no un estado.

## Risks / Trade-offs

- [El token del QR se filtra (foto de la pantalla, alguien mirando)] → Sirve 10 minutos para una sola foto, y lo único que permite es mandarle una imagen a esa pared. No lee nada.
- [Una pantalla con enlace puede buscar en el historial de personas y vehículos (decisión de Nico)] → La búsqueda queda acotada a los enlaces de Cámaras y Rotación. Cada búsqueda se registra en el log del servidor con el enlace que la hizo, para poder auditar.
- [Muchos sitios no se dejan enmarcar (Google, la mayoría de los bancos y redes)] → Aviso al guardar. Las herramientas propias (Grafana, el NVR, tableros internos) normalmente sí se dejan.
- [Mixed content: una herramienta de la LAN por `http` no carga en el panel `https`] → Aviso al guardar. La salida es publicarla por el proxy con `https`, lo mismo que hoy con OmniAccess.
- [Una página pesada en una casilla carga la PC de la pared] → `loading=lazy`, una sola instancia por casilla y recarga configurable. No hay tope de cantidad: la pared la arma un usuario con `monitores.config`.
- [Monitor Face sin datos reales en el lab] → Se prueba con la vista previa y datos simulados. La consulta se verifica contra la base del lab (debe devolver ceros sin error). Las terminales reales se ven cuando Nico lo pase a una instalación con terminales.
- [Las fotos de las terminales pueden no tener `snapshotPath`] → La casilla muestra la foto del padrón sola, o el ícono de rostro si no hay ninguna.

## Migration Plan

1. Migración aditiva `SubidaFoto`. `desplegar.sh` ya corre `prisma migrate deploy`.
2. Desplegar en el lab y reiniciar `omniaccess-web`. Webhooks y `server.js` no se tocan.
3. Probar en el lab:
   - buscar desde el cuadro de una cámara;
   - buscar con una foto del celular escaneando el QR desde fuera de la red (por `omniaccess.ies.com.uy`);
   - una vista guardada con una fuente web;
   - Monitor Face vacío.
4. **Vuelta atrás:** revertir el commit. La tabla `SubidaFoto` puede quedar: es nueva y nada la lee.
5. San Nicolás, sólo cuando Nico lo diga.
