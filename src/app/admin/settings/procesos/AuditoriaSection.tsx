"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ScrollText, XCircle } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Momento } from "@/components/ui/celdas";
import { auditoriaProcesos, type AccionFila } from "@/app/actions/procesos";

/**
 * Ajustes → Sistema → Auditoría: lo que se hizo desde Procesos y tareas (reinicios, tareas
 * corridas a mano, pausas), con quién y cómo salió — también lo que falló.
 *
 * Era un bloque al pie de Procesos: para ver quién reinició algo había que pasar por toda la
 * pantalla de servicios. Es otra pregunta («quién tocó qué»), así que tiene su lugar.
 */

/** Cada cuánto se vuelve a leer. Cambia sólo cuando alguien toca algo: no hace falta más. */
const REFRESCO_MS = 15_000;

export default function AuditoriaSection() {
    const [filas, setFilas] = useState<AccionFila[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const traer = useCallback(async () => {
        try { setFilas(await auditoriaProcesos(1000)); setError(null); } catch (e: any) { setError(e?.message || "No se pudo leer la auditoría."); }
    }, []);
    useEffect(() => {
        traer();
        const i = setInterval(() => { if (document.visibilityState === "visible") traer(); }, REFRESCO_MS);
        return () => clearInterval(i);
    }, [traer]);

    const fallidas = filas?.filter((a) => !a.ok).length || 0;
    const cols = useMemo<ColumnaTabla<AccionFila>[]>(() => [
        { clave: "cuando", titulo: "Cuándo", ancho: 130, ordenable: true, valor: (a) => a.cuando, celda: (a) => <Momento t={a.cuando} /> },
        { clave: "quien", titulo: "Quién", ancho: 160, ordenable: true, valor: (a) => a.quien, celda: (a) => <span className="text-[12.5px] font-semibold">{a.quien}</span> },
        { clave: "accion", titulo: "Qué hizo", ancho: 240, ordenable: true, valor: (a) => a.accion, celda: (a) => <span className="text-[12.5px]">{a.accion} <span className="text-muted-foreground">· {a.objetivo}</span></span> },
        { clave: "ok", titulo: "Resultado", ancho: 110, ordenable: true, valor: (a) => (a.ok ? "1" : "0"), celda: (a) => <Estado tono={a.ok ? "bien" : "mal"} icono={a.ok ? CheckCircle2 : XCircle}>{a.ok ? "Bien" : "Falló"}</Estado> },
        { clave: "detalle", titulo: "Detalle", ancho: 420, celda: (a) => <span className="text-[12px] text-muted-foreground line-clamp-1 break-all">{a.detalle || "—"}</span> },
    ], []);

    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-[17px] font-bold">Auditoría</h2>
                    <p className="text-[12.5px] text-muted-foreground max-w-2xl">Lo que se hizo desde Procesos y tareas: reinicios, tareas corridas a mano y pausas. Con quién y cómo salió, también lo que falló.</p>
                </div>
                {filas && (
                    <span className="flex items-center gap-2">
                        <Estado tono="neutro">{filas.length} acciones</Estado>
                        {fallidas > 0 && <Estado tono="mal">{fallidas} fallaron</Estado>}
                    </span>
                )}
            </div>
            <Tabla<AccionFila> id="auditoria-procesos" nombreArchivo="auditoria-procesos" filas={filas || []} clave={(a) => a.id} columnas={cols}
                cargando={!filas && !error} error={!filas ? error : null} alReintentar={traer}
                vacio={{ icono: ScrollText, titulo: "Nadie tocó nada todavía", ayuda: "Cada reinicio, pausa o corrida a mano queda anotado acá." }} filasFantasma={6} alto="calc(100vh - 260px)" />
        </div>
    );
}
