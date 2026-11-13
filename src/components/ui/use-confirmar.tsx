"use client";

import { useCallback, useRef, useState } from "react";
import { ConfirmarEnCajon } from "@/components/ui/cajon-confirmar";

/**
 * El reemplazo directo de `confirm()` del navegador (punto 6, 21/10): quedaban once, cada uno un
 * cartel gris con dos botones iguales que no se parecía a nada del panel. Donde había
 *
 *     if (!confirm("¿Eliminar este modelo?")) return;
 *
 * ahora va
 *
 *     const { confirmar, elemento } = useConfirmar();
 *     if (!(await confirmar({ titulo: "Eliminar el modelo «X»", accion: "Eliminar" }))) return;
 *     …y {elemento} en cualquier lugar del JSX (el cajón se dibuja en un portal).
 *
 * Por dentro es el cajón de confirmar de siempre (ConfirmarEnCajon): misma pieza, mismo aspecto.
 */
type Opciones = {
    titulo: string; descripcion?: string; accion?: string;
    /** `accion`: confirmar algo que no borra nada (abrir una puerta). Ver ConfirmarEnCajon. */
    variante?: "borrar" | "accion";
    icono?: React.ComponentType<{ size?: number }>;
};
type Pedido = Opciones & { resolver: (ok: boolean) => void };

export function useConfirmar() {
    const [pedido, setPedido] = useState<Pedido | null>(null);
    const confirmado = useRef(false);
    const confirmar = useCallback((o: Opciones) =>
        new Promise<boolean>((resolver) => { confirmado.current = false; setPedido({ ...o, resolver }); }), []);
    const elemento = pedido ? (
        <ConfirmarEnCajon id="confirmar" open title={pedido.titulo} description={pedido.descripcion} etiquetaAccion={pedido.accion || "Confirmar"} variante={pedido.variante} icono={pedido.icono}
            // El cajón cierra (onOpenChange false) antes de avisar el éxito: la respuesta sale de acá.
            onOpenChange={(v) => { if (!v) { pedido.resolver(confirmado.current); setPedido(null); } }}
            onDelete={async () => { confirmado.current = true; return { success: true }; }}
            onSuccess={() => { }} />
    ) : null;
    return { confirmar, elemento };
}
