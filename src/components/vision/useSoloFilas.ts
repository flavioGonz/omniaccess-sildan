"use client";

import { useEffect, useState } from "react";
import { getEnabledModules } from "@/app/actions/modules";
import { esSoloFilas } from "@/lib/vision-por-modo";

/**
 * ¿La instalación está en modo Filas solo? null mientras se averigua. Una sola consulta por carga
 * de la página: la barra de OmniVision y la pantalla de abajo la comparten.
 */
let pedido: Promise<boolean> | null = null;
export function useSoloFilas(): boolean | null {
    const [v, setV] = useState<boolean | null>(null);
    useEffect(() => {
        let vivo = true;
        pedido ||= getEnabledModules().then(esSoloFilas).catch(() => { pedido = null; return false; });
        pedido.then((x) => { if (vivo) setV(x); });
        return () => { vivo = false; };
    }, []);
    return v;
}
