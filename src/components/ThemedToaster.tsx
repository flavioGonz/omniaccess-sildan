"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Toaster } from "sileo";

/**
 * El globo de avisos.
 *
 * Salía **oscuro con texto oscuro**: en modo claro sólo se veía el tilde verde.
 *
 * ## Qué pasaba
 *
 * El globo lo dibuja un canvas con el color `fill`, así que no hereda nada del tema: hay
 * que pasárselo. El texto, en cambio, **sí hereda** — en esta versión de la librería
 * `[data-sileo-description]` no fija color, o sea que toma la tinta de la página.
 *
 * Entonces alcanza con que el `fill` se equivoque para que los dos queden del mismo lado:
 * tinta oscura de la página sobre globo oscuro.
 *
 * ## Y el `fill` se equivocaba siempre, en silencio
 *
 * La versión anterior metía una sonda en el DOM con
 * `color: color-mix(in oklab, var(--card) …)`, leía su color calculado y lo aceptaba sólo
 * `if (rgb.startsWith("rgb"))`. Pero el navegador **no** devuelve `rgb(...)` para eso: un
 * `color-mix` en oklab se calcula como `oklab(...)` o `color(srgb …)`, y `--card` es
 * `oklch(1 0 0)`, que tampoco es `rgb`. La condición nunca se cumplía, `setFill` nunca
 * corría, y el globo se quedaba con el valor de arranque — `#0b0f1a`, oscuro, en los dos
 * temas.
 *
 * Un guard que descarta el resultado bueno y deja el valor de emergencia es la peor clase
 * de error: la pantalla anda, el color está mal, y no hay nada en la consola.
 *
 * ## El arreglo
 *
 * El color sale de un token **escrito como literal** (`--globo-aviso` en `globals.css`).
 * No es pereza: un literal no necesita que nadie lo convierta, y toda esta falla fue una
 * conversión imposible de hacer desde JavaScript. El token cambia con el tema como
 * cualquier otro, y queda al lado de `--card`, que es la superficie que imita.
 *
 * Con el globo bien, el texto se acomoda solo: hereda la tinta de la página, que ya es la
 * correcta para el tema.
 *
 * **Nota de versión:** esto es contra `sileo@0.1.3`. La 0.1.5 agrega una prop `theme` que
 * fija el color del texto — y ojo, está nombrada al revés de lo que uno espera
 * (`theme="dark"` pinta tinta oscura). Si algún día se actualiza, hay que pasarla cruzada
 * respecto del tema de la app, o el texto vuelve a pelearse con el fondo.
 */

/**
 * Sólo para el servidor, donde no hay DOM al que preguntarle. En el navegador NUNCA se usa:
 * el color sale siempre del token, leído del documento real.
 *
 * Esto importa más de lo que parece. La versión anterior arrancaba en blanco y dependía de
 * que un efecto llegara a corregirlo; si ese efecto no corría —o corría antes de que el
 * tema estuviera puesto— el globo se quedaba blanco en tema oscuro y nadie se enteraba.
 * Es la MISMA forma del error que esta pantalla ya tuvo una vez: un valor de emergencia que
 * se vuelve permanente porque el camino bueno falló en silencio.
 */
const GLOBO_SIN_DOM = "#ffffff";

/** El color del globo, leído del documento en este instante. */
function leerGlobo(): string {
    if (typeof document === "undefined") return GLOBO_SIN_DOM;
    try {
        const v = getComputedStyle(document.documentElement)
            .getPropertyValue("--globo-aviso").trim();
        return v || GLOBO_SIN_DOM;
    } catch {
        return GLOBO_SIN_DOM;
    }
}

export default function ThemedToaster() {
    /* `resolvedTheme` no se usa para leer el color: se usa sólo como una señal más de que
       algo del tema cambió. El color siempre sale del DOM. */
    const { resolvedTheme } = useTheme();

    /* Se lee en el inicializador, no en un efecto. Cuando este componente se monta, el
       script que next-themes inyecta ya puso la clase en <html>, así que el primer valor
       ya es el correcto y no hay un instante en blanco que corregir después. */
    const [fill, setFill] = useState(leerGlobo);

    useEffect(() => {
        const refrescar = () => setFill((antes) => {
            const ahora = leerGlobo();
            return ahora === antes ? antes : ahora;
        });
        refrescar();

        /*
         * Y además se mira el DOM directamente.
         *
         * El tema lo cambia una clase en <html>. Colgar la lectura sólo de `resolvedTheme`
         * es confiar en que la librería avise SIEMPRE y en el orden correcto, y este archivo
         * ya tiene un antecedente de confiar en un camino que fallaba callado.
         *
         * Con el observador da igual quién cambie la clase —next-themes, otra pantalla, o
         * alguien desde la consola—: el globo se entera igual. Es la diferencia entre
         * "me avisaron" y "lo vi".
         */
        const obs = new MutationObserver(refrescar);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
        return () => obs.disconnect();
    }, [resolvedTheme]);

    return <Toaster position="top-center" options={{ fill }} />;
}
