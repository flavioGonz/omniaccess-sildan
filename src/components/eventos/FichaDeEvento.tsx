"use client";

import { useEffect, useRef, useState } from "react";
import { sileo as toast } from "sileo";
import { getAccessEvent } from "@/app/actions/history";
import { VisorEventoAcceso } from "@/components/eventos/VisorEventoAcceso";

/**
 * La ficha de un evento LPR a partir de su id: se trae el evento y se abre el MISMO visor del
 * Monitor LPR y del Historial (foto, video, comportamiento, lista negra, clip, compartir).
 *
 * Para las pantallas que sólo tienen el id de la lectura —las lecturas de una ficha de lista negra,
 * por ejemplo— y abrían la foto en un cuadro propio, sin nada de lo que la ficha sabe hacer (20/10,
 * Nico: «trae un modal feo; debe usar el modal de eventos LPR»). Se monta para abrir y avisa al
 * cerrar.
 */
export function FichaDeEvento({ id, alCerrar }: { id: string; alCerrar: () => void }) {
    const [ev, setEv] = useState<any>(null);
    const cerrar = useRef(alCerrar); cerrar.current = alCerrar;
    useEffect(() => {
        let vivo = true;
        getAccessEvent(id)
            .then((e) => { if (!vivo) return; if (e) setEv(e); else { toast.error({ title: "No se encontró el evento" }); cerrar.current(); } })
            .catch((e) => { if (vivo) { toast.error({ title: "No se pudo abrir el evento", description: String(e?.message || e) }); cerrar.current(); } });
        return () => { vivo = false; };
    }, [id]);
    if (!ev) return null;
    return <VisorEventoAcceso event={ev} timeStatus={null} abrirAlMontar alCerrar={() => cerrar.current()}>{null}</VisorEventoAcceso>;
}
