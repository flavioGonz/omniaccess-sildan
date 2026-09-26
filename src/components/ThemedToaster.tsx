"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Toaster } from "sileo";

/**
 * Toaster global de sileo, adaptado a light/dark:
 *  - El "pill" lo dibuja un <canvas> con el color `fill`. Resolvemos --card a RGB real
 *    (oscuro en dark, claro en light) para que el fondo respete el tema.
 *  - El texto y los íconos los maneja el <style> global de abajo, integrándose con las
 *    variables propias de sileo (--sileo-state-*) en vez de pelear con ellas.
 *  - Posición: ángulo inferior derecho.
 */
export default function ThemedToaster() {
    const { resolvedTheme } = useTheme();
    const [fill, setFill] = useState<string>("#0b0f1a");

    useEffect(() => {
        try {
            const probe = document.createElement("span");
            probe.style.cssText = "color:var(--card);position:absolute;left:-9999px";
            document.body.appendChild(probe);
            const rgb = getComputedStyle(probe).color; // el navegador convierte oklch → rgb
            document.body.removeChild(probe);
            if (rgb && rgb.startsWith("rgb")) setFill(rgb);
        } catch { }
    }, [resolvedTheme]);

    return (
        <>
            <style jsx global>{`
                /* Texto legible sobre el pill (card) tanto en light como en dark.
                   El título con estado conserva su color de estado (más específico). */
                [data-sileo-toast]{ color: var(--foreground); }
                [data-sileo-description]{ color: var(--muted-foreground) !important; }

                /* Paleta de estados un poco más viva; oklch funciona sobre cualquier fondo,
                   así que sirve igual en light y dark. Título e ícono la comparten. */
                [data-sileo-viewport]{
                    --sileo-state-success: oklch(0.70 0.19 152);
                    --sileo-state-error:   oklch(0.63 0.245 27);
                    --sileo-state-warning: oklch(0.80 0.16 80);
                    --sileo-state-info:    oklch(0.66 0.18 248);
                    --sileo-state-action:  oklch(0.62 0.22 280);
                }

                /* El ícono toma el color del estado (por defecto sileo lo deja en currentColor). */
                [data-sileo-toast][data-state="success"] [data-sileo-svg]{ color: var(--sileo-state-success); }
                [data-sileo-toast][data-state="error"]   [data-sileo-svg]{ color: var(--sileo-state-error); }
                [data-sileo-toast][data-state="warning"] [data-sileo-svg]{ color: var(--sileo-state-warning); }
                [data-sileo-toast][data-state="info"]    [data-sileo-svg]{ color: var(--sileo-state-info); }
                [data-sileo-toast][data-state="action"]  [data-sileo-svg]{ color: var(--sileo-state-action); }

                /* SVG animado: aparece con un "pop" con rebote. El spinner de loading conserva
                   su propia animación (no lo tocamos). */
                @keyframes sileoPop{
                    0%{ transform: scale(.4) rotate(-10deg); opacity: 0 }
                    55%{ transform: scale(1.18) rotate(4deg); opacity: 1 }
                    100%{ transform: scale(1) rotate(0); opacity: 1 }
                }
                [data-sileo-toast]:not([data-state="loading"]) [data-sileo-svg]{
                    animation: sileoPop .5s cubic-bezier(.2,1.5,.35,1) both;
                }

                /* Halo de color por estado que sigue la forma redondeada del pill
                   (drop-shadow respeta el alpha del canvas). */
                [data-sileo-toast][data-state="success"] [data-sileo-canvas]{ filter: drop-shadow(0 6px 18px color-mix(in oklch, var(--sileo-state-success) 55%, transparent)); }
                [data-sileo-toast][data-state="error"]   [data-sileo-canvas]{ filter: drop-shadow(0 6px 18px color-mix(in oklch, var(--sileo-state-error)   55%, transparent)); }
                [data-sileo-toast][data-state="warning"] [data-sileo-canvas]{ filter: drop-shadow(0 6px 18px color-mix(in oklch, var(--sileo-state-warning) 55%, transparent)); }
                [data-sileo-toast][data-state="info"]    [data-sileo-canvas]{ filter: drop-shadow(0 6px 18px color-mix(in oklch, var(--sileo-state-info)    55%, transparent)); }
                [data-sileo-toast][data-state="action"]  [data-sileo-canvas]{ filter: drop-shadow(0 6px 18px color-mix(in oklch, var(--sileo-state-action)  55%, transparent)); }
            `}</style>
            <Toaster position="bottom-right" offset={{ bottom: 20, right: 20 }} options={{ fill, roundness: 16 }} />
        </>
    );
}
