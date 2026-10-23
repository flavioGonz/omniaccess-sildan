# Proposal

## Why

La pared de Cámaras (`/monitor/camaras`) ya es un mosaico de video con vistas guardadas, disposiciones y alertas, pero sigue siendo sólo para mirar. El 23/10 Nico pidió tres cosas para que vaya siendo el VMS del centro de monitoreo: que el operario de la pared pueda **buscar parecidos** sin ir al panel (desde lo que ve en un canal o desde una foto que le pasan al celular), que un canal pueda **mostrar una página web** para vestir la pared con herramientas externas, y que exista un **Monitor Face** entre las vistas de `/admin/monitores`, que hoy no tiene.

## What Changes

- **Buscar parecidos en la pared de Cámaras**:
  - un botón «Buscar parecidos» en la barra de la pared y en la ficha de un canal;
  - primero se pregunta **qué** se busca: Objeto, Persona, Vehículo o Animal;
  - la imagen sale de una de dos fuentes:
    - **el cuadro del canal**: se congela la escena, OmniVision marca lo que reconoce del tipo elegido y el operario toca uno (o dibuja el recuadro él mismo);
    - **una foto del celular**: la pared muestra un **QR**; el celular lo escanea, abre una página sin usuario, saca o elige la foto y la sube; la pared la recibe sola;
  - los resultados (los parecidos del registro de OmniVision, con cámara, hora y foto) se ven en la pared, con el período y el área para acotar;
  - por decisión de Nico, **cualquier pantalla puede buscar**, incluida una abierta con un enlace de pantalla sin usuario. Hoy `/api/vision/buscar` lo prohíbe.
- **Canal web en la pared**:
  - en Monitores se cargan **fuentes web** (nombre, dirección, cada cuánto recargar, zoom);
  - en una vista guardada de Cámaras, una casilla puede tener una fuente web en lugar de un canal de video;
  - al guardar la fuente se avisa si el sitio no se deja mostrar dentro de otra página, o si es `http` dentro de un panel `https`.
- **Monitor Face**, una vista nueva de pantalla (`/monitor/face`) que se ofrece en `/admin/monitores`:
  - es la versión facial del Control LPR, alimentada **sólo por las terminales faciales** (`FACE_TERMINAL`);
  - muestra el último acceso en grande (la foto tomada y la foto de la persona), permitido o denegado con el motivo, la persona y su unidad, la tira de los últimos diez, los contadores del día y una fila de atención (denegados y desconocidos);
  - sigue el criterio de fondo de las paredes (`lib/monitor/fondos`).

## Capabilities

### New Capabilities

- `monitor-busqueda-parecidos`: buscar en el registro de OmniVision desde una pared de video, a partir de un recorte del cuadro de un canal o de una foto subida desde un celular por QR, eligiendo antes la clase de lo buscado.
- `monitor-canal-web`: fuentes web cargadas en Monitores y su uso como casilla de una vista guardada de la pared de Cámaras.
- `monitor-face`: la vista de pantalla de los accesos por reconocimiento facial de las terminales.

### Modified Capabilities

Ninguna: `openspec/specs/` todavía no tiene especificaciones archivadas.

## Impact

- **API**:
  - `/api/monitor/camaras/buscar` (nueva): POST con imagen, que busca parecidos o devuelve los objetos del cuadro; la lógica sale de `/api/vision/buscar` a `src/lib/vision/parecidos.ts` y las dos rutas la comparten;
  - `/api/monitor/camaras/subida` (nueva): abrir un QR y consultar si ya llegó la foto;
  - `/api/subida/[token]` (nueva, pública con token de un solo uso);
  - `/api/monitor/face` (nueva);
  - `/api/monitor/camaras` suma las fuentes web.
- **Middleware y alcances**:
  - el POST de una pantalla se admite en la búsqueda (no guarda nada);
  - `ALCANCE_POR_VISTA` suma la búsqueda y las imágenes de OmniVision a Cámaras;
  - la página `/subir/[token]` y su API van a la lista pública.
- **Base**, con una migración aditiva:
  - `SubidaFoto`: el token, cuándo vence, la foto (bytes, hasta 12 MB) y cuándo se tomó;
  - se borra a los 10 minutos.
- **Ajustes**: `MONITOR_FUENTES_WEB` (el catálogo, en JSON).
- **Código**:
  - `VistaCamaras.tsx`, `camaras/Ficha.tsx` y `camaras/Editor.tsx`;
  - `lib/monitor/disposiciones.ts` (clave `web:<id>`);
  - `lib/monitor/vistas.ts` (vista `face`);
  - `vistas/VistaFace.tsx` (nueva);
  - `admin/monitores/page.tsx` (fuentes web);
  - `app/subir/[token]/page.tsx` (nueva).
- **Permisos**:
  - cargar fuentes web pide `monitores.config`;
  - el Monitor Face pide `rostros` con sesión, y su enlace de pantalla sólo abre esa vista.
- **PM2**: sólo `omniaccess-web`. `server.js` no se toca.
- **Sin datos en el lab**: el lab no tiene terminales faciales ni eventos de rostro; el Monitor Face se prueba con datos simulados en la vista previa.
- Todo en el lab hasta que Nico diga San Nicolás.
