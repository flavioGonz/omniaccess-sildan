"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Toaster } from "sileo";

// El "pill" del toast lo dibuja un canvas con el color `fill`; por eso no respetaba
// el tema. Aquí resolvemos --card a un color RGB real y lo pasamos como fill, para
// que la notificación sea oscura en dark y clara en light. Sin caja externa.
export default function ThemedToaster() {
    const { resolvedTheme } = useTheme();
    const [fill, setFill] = useState<string>("#0b0f1a");

    useEffect(() => {
        try {
            const probe = document.createElement("span");
            probe.style.cssText = "color:color-mix(in oklab, var(--card) 86%, var(--foreground) 14%);position:absolute;left:-9999px";
            document.body.appendChild(probe);
            const rgb = getComputedStyle(probe).color; // el navegador convierte oklch → rgb
            document.body.removeChild(probe);
            if (rgb && rgb.startsWith("rgb")) setFill(rgb);
        } catch { }
    }, [resolvedTheme]);

    return <Toaster position="top-center" options={{ fill }} />;
}
