# Sitio de OmniAccess

Página única, en español. La historia se cuenta con cinco videos (generados con IA por Nico, 30/10):
el barrio desde un dron, un auto en el portón, alguien trepando el cerco, una visita con QR y la
central de monitoreo. Sin animaciones: sólo corren los videos, y sólo mientras se ven.
OmniAccess, una solución de **Infratec**.

## Verlo

- **Sin instalar nada:** abrí `dist/omniaccess-un-archivo.html` con doble clic. Está todo en ese archivo,
  videos incluidos (sólo la tipografía viene de Google Fonts).
- **Para subir a un hosting:** la carpeta `dist/` (`index.html`, `estilos.css`, `sitio.js`, `videos/` y `descargas/`).
- `dist/artifact.html` es la misma página para publicarla en claude.ai.

## Cambiarlo

Todo el texto está en `src/contenido.js`: las 35 detecciones, las escenas de la historia, los
módulos, las descargas y **los datos de contacto de Infratec** (`CONTACTO`, hoy vacíos: el sitio no
muestra botones de contacto hasta que se completen).

```
npm install
npm run build   # arma dist/
npm run dev     # recompila al guardar y sirve dist/ en http://localhost:8080
```

| Archivo | Qué tiene |
|---|---|
| `src/contenido.js` | Todos los textos y la lista de detecciones (con su ícono de Lucide) |
| `src/videos/` | Los videos (MP4 H.264 y WebM VP9, 720p, sin audio) y su foto de portada |
| `src/sitio.js` | Videos sólo a la vista, filtros de detecciones, descargas |
| `src/estilos.css` | Colores, tipografía y diseño (tokens arriba de todo) |
| `src/index.html` | La estructura; las partes repetidas las completa `scripts/construir.mjs` |

Los PDF de descargas no van en git (pesan ~70 MB): se ponen en `descargas/` y se copian al compilar.

## Decisiones

- **Sin animaciones** (pedido de Nico): ni 3D, ni scroll suave, ni entradas. Lo único que se mueve
  son los videos, que se pausan fuera de pantalla y quedan quietos con «menos movimiento».
- **Dos registros:** la noche (videos a sangre, con el rótulo de la cámara y lo que OmniAccess
  registró, como sobre una grabación) y el día (las detecciones y cómo verifica, en claro).
- **El azul de fondo** es el de las franjas de los propios videos, para que se fundan con la página.
- **En el teléfono** el video va entero arriba y el texto abajo: no se tapan.
- **Contenido:** sólo lo que el producto hace hoy. El pie aclara que las escenas son ilustrativas.
- **Íconos:** lucide-static 1.65.0 (ISC), embebidos al compilar.
