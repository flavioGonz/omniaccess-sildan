# De dónde sale esta skill

No es nuestra. Es `apple-design` de **Emil Kowalski** (el de Sonner y Vaul), que destila las
charlas de diseño de Apple —sobre todo *Designing Fluid Interfaces*, WWDC 2018— y las traduce a
la web. Nico pidió usarla el 18/11 para el formulario del censo, que casi todos van a abrir desde
el celular.

Se instaló tal cual, sin tocarle una línea, con el instalador del autor:

```
npx skills@latest add emilkowalski/skills --skill apple-design
```

Para actualizarla, correr lo mismo. El catálogo completo está en
`github.com/emilkowalski/skills`.

**Dónde se aplicó hasta ahora:** `src/app/registro/Formulario.tsx` y el bloque «Censo del barrio»
de `src/app/globals.css` (resortes en vez de duraciones, respuesta en el pointer-down, caminos
simétricos, barra translúcida con el contenido por debajo, movimiento y transparencia reducidos).

**Dónde NO se aplica:** la consola. `claude/DESIGN.md` manda ahí, y manda por una razón escrita:
la densidad alta es para alguien que barre cien lecturas. Esta skill es para las pantallas que
mira una persona una vez, desde un teléfono.
