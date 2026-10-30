# Sitio de OmniAccess

Página única, en español, con el barrio de noche en 3D (three.js) atado al scroll (GSAP + Lenis).
OmniAccess, una solución de **Infratec**.

## Verlo

- **Sin instalar nada:** abrí `dist/omniaccess-un-archivo.html` con doble clic. Está todo en ese archivo
  (sólo la tipografía viene de Google Fonts).
- **Para subir a un hosting:** la carpeta `dist/` (`index.html`, `estilos.css`, `sitio.js` y `descargas/`).
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
| `src/escena.js` | La escena 3D: el barrio, el auto, el cerco, la visita, las marcas |
| `src/sitio.js` | Scroll, filtros de detecciones, descargas |
| `src/estilos.css` | Colores, tipografía y diseño (tokens arriba de todo) |
| `src/index.html` | La estructura; las partes repetidas las completa `scripts/construir.mjs` |

Los PDF de descargas no van en git (pesan ~70 MB): se ponen en `descargas/` y se copian al compilar.

## Decisiones

- **Concepto «el barrio de noche»:** la hora en la que la seguridad importa. Azul noche, la luz de
  sodio de los faroles para lo detectado y el violeta del logo como marca. El recuadro de esquinas
  del logo marca lo detectado, igual que en las capturas del producto.
- **Rendimiento:** en equipos modestos y teléfonos, la escena va sin brillo y con menos casas. Se deja de
  dibujar al pasar la historia y con la pestaña oculta.
- **«Menos movimiento»:** si el sistema lo pide, la cámara salta de escena en escena sin volar ni
  balancearse, y no hay scroll suave.
- **Accesibilidad:** el contenido es HTML, no está dibujado en el lienzo.
- **Contenido:** sólo lo que el producto hace hoy.
- **Versiones fijas:** three 0.186.1, gsap 3.15.0, lenis 1.3.26, íconos lucide-static 1.65.0 (ISC).
