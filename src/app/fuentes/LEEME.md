# Outfit, servida desde acá y no desde Google

## Por qué

El 24 de setiembre de 2026 el sitio se cayó en un despliegue. El build falló así:

```
Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
  Server Component: ./src/app/guard/layout.tsx
```

`next/font/google` **descarga la fuente durante el build**. Un hipo de red en ese minuto
deja el CSS generado roto, el build termina en error, y `omniaccess-web` queda en
`errored`: el sitio abajo. No fue un problema del código ni de la fuente — fue que el
despliegue necesitaba internet para algo que no tiene por qué necesitarlo.

Eso es inaceptable en un barrio: los despliegues tienen que poder salir con la red del
barrio a media máquina, que es justamente cuando más se necesita desplegar.

## Qué son estos archivos

Outfit **variable** (pesos 100 a 900 en un solo archivo), bajada de Google Fonts, en los
dos cortes que la aplicación usa:

- `outfit-latin.woff2` — el latín básico.
- `outfit-latin-ext.woff2` — el latín extendido.

Se cargan con `next/font/local`, que no toca la red. Misma fuente, mismos pesos, misma
variable CSS (`--font-outfit`): nada de la aplicación se entera del cambio.

## Licencia

Outfit está publicada bajo la **SIL Open Font License 1.1**, que permite redistribuirla
embebida en un producto. Autor: Smartsheet Inc. https://fonts.google.com/specimen/Outfit

## Si hay que actualizarla

Pedir `https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap` con un
User-Agent de navegador moderno, sacar las dos URL de `.woff2` del CSS que devuelve, y
reemplazar estos archivos. No hace falta tocar el código.
