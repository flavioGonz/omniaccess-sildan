"use client";

import { useEffect, useState } from "react";
import type { Analisis } from "@/lib/vision-capa";

/**
 * Lo que OmniVision ve en una foto ya guardada, pedido al abrirla (12/11: la silueta del auto en
 * el visor de un estacionado, que no trae análisis guardado). El navegador ya tiene la foto: la
 * achica y se la manda a la misma ruta que usa la grabación (un cuadro, ~40 ms de GPU, una vez
 * por foto). Se guarda por dirección mientras dure la pestaña: volver a la misma foto no pide de nuevo.
 */
const LADO_MAX = 960;
const guardados = new Map<string, Analisis | null>();

export function useSiluetaDeFoto(url: string | null | undefined, activo: boolean): Analisis | null {
    const [a, setA] = useState<Analisis | null>(() => (url ? guardados.get(url) || null : null));
    useEffect(() => {
        if (!url || !activo) { setA(null); return; }
        if (guardados.has(url)) { setA(guardados.get(url) || null); return; }
        setA(null);
        let vivo = true;
        (async () => {
            try {
                const bmp = await createImageBitmap(await (await fetch(url)).blob());
                const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
                const c = document.createElement("canvas");
                c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
                c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
                const jpeg: Blob | null = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
                if (!jpeg) return;
                const r = await fetch("/api/monitor/camaras/siluetas", { method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg });
                // Sin respuesta (omni-vision apagado, demasiados pedidos) no se guarda: la próxima vez se vuelve a probar.
                if (!r.ok) return;
                const j = await r.json();
                const an: Analisis | null = j?.analisis?.objetos ? j.analisis : null;
                guardados.set(url, an);
                if (guardados.size > 60) guardados.delete(guardados.keys().next().value as string);
                if (vivo) setA(an);
            } catch { /* sin silueta: el visor sigue igual */ }
        })();
        return () => { vivo = false; };
    }, [url, activo]);
    return a;
}
