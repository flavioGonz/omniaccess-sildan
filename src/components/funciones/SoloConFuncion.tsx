"use client";

import Link from "next/link";
import { ToggleLeft } from "lucide-react";
import { Vacio } from "@/components/ui/estados";
import { Button } from "@/components/ui/button";
import { useFuncion } from "@/lib/funciones-cliente";
import { funcionPorId, type FuncionId } from "@/lib/funciones";

/**
 * Una pantalla que sólo existe con una característica prendida (25/11, la primera: Face).
 *
 * Sacar la entrada del menú no alcanza: la dirección queda en el historial, en un favorito o en la
 * pantalla fijada de un puesto, y abrirla mostraría una pantalla de algo que la instalación dijo que
 * no usa. Apagada, se dice qué está apagado y dónde se prende. Mientras no se sabe (la primera
 * lectura), se muestra lo de adentro: las que se envuelven con esto vienen prendidas de fábrica.
 */
export function SoloConFuncion({ id, children }: { id: FuncionId; children: React.ReactNode }) {
    const on = useFuncion(id);
    if (on !== false) return <>{children}</>;
    const f = funcionPorId(id);
    return (
        <div className="p-6">
            <div className="mx-auto max-w-xl rounded-[14px] border border-dashed border-border">
                <Vacio icono={ToggleLeft} titulo={`${f?.nombre || "Esta característica"} está apagada`}
                    ayuda="Esta pantalla es parte de una característica que la instalación tiene apagada. Se prende en Ajustes › Características."
                    accion={<Button asChild size="sm" variant="outline"><Link href="/admin/settings?seccion=caracteristicas">Ir a Características</Link></Button>} />
            </div>
        </div>
    );
}
