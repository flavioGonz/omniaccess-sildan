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

/** Mientras el tema no resolvió. Claro, porque es el tema por defecto de la app. */
const GLOBO_POR_DEFECTO = "#ffffff";

export default function ThemedToaster() {
    const { resolvedTheme } = useTheme();
    const [fill, setFill] = useState(GLOBO_POR_DEFECTO);

    useEffect(() => {
        try {
            const v = getComputedStyle(document.documentElement)
                .getPropertyValue("--globo-aviso").trim();
            if (v) setFill(v);
        } catch { /* sin token queda el claro: poco contrastado en oscuro, nunca ilegible */ }
    }, [resolvedTheme]);

    return <Toaster position="top-center" options={{ fill }} />;
}
