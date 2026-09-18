"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { actividadPorDia } from "@/app/actions/alertas";
import { Pista } from "@/components/ui/pista";

/**
 * El pulso del registro: cuántas lecturas hubo cada día, en una tira.
 *
 * Reemplaza al mapa de actividad estilo GitHub, que ocupaba un rectángulo grande para
 * decir muy poco: seis meses de celdas, casi todas vacías, con el rótulo "0
 * contributions" en inglés. Acá el mismo dato entra en una línea, en el idioma del
 * producto, y —lo más importante— **desaparece cuando no hay nada que mostrar**, en vez
 * de dejar un hueco negro que parece un error de carga.
 *
 * Días y no semanas: en un barrio el tráfico se mira por jornada. La altura de cada barra
 * es relativa al día más movido del período, que es la comparación que interesa (¿hoy fue
 * un día cargado?) y no un número absoluto que no le dice nada a nadie.
 */
export function PulsoActividad({ dias = 60 }: { dias?: number }) {
    const [filas, setFilas] = useState<{ date: string; count: number }[] | null>(null);

    useEffect(() => {
        let vivo = true;
        actividadPorDia(dias)
            .then((f) => { if (vivo) setFilas(f || []); })
            .catch(() => { if (vivo) setFilas([]); });
        return () => { vivo = false; };
    }, [dias]);

    const { barras, total, pico } = useMemo(() => {
        if (!filas) return { barras: [], total: 0, pico: 0 };
        const porDia = new Map(filas.map((f) => [f.date, f.count]));
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const out: { date: string; count: number }[] = [];
        for (let i = dias - 1; i >= 0; i--) {
            const d = new Date(hoy); d.setDate(d.getDate() - i);
            const clave = d.toISOString().slice(0, 10);
            out.push({ date: clave, count: porDia.get(clave) || 0 });
        }
        return {
            barras: out,
            total: out.reduce((a, b) => a + b.count, 0),
            pico: Math.max(1, ...out.map((b) => b.count)),
        };
    }, [filas, dias]);

    // Sin datos no se dibuja nada. Un gráfico vacío no informa: estorba.
    if (!filas || total === 0) return null;

    return (
        <Pista
            titulo="Pulso del registro"
            texto={`Lecturas por día de los últimos ${dias} días, contando accesos y avistamientos. La altura de cada barra es relativa al día más movido del período.`}
        >
            <div className="flex items-center gap-2.5">
                <div className="flex items-end gap-px h-[18px]">
                    {barras.map((b, i) => (
                        <motion.span
                            key={b.date}
                            initial={{ scaleY: 0 }}
                            animate={{ scaleY: 1 }}
                            transition={{ duration: 0.3, delay: Math.min(i, 40) * 0.006, ease: [0.22, 1, 0.36, 1] }}
                            title={`${new Date(b.date + "T12:00:00").toLocaleDateString("es-UY", { day: "2-digit", month: "short" })} · ${b.count}`}
                            className={b.count ? "bg-sky-400/75 rounded-[1px]" : "bg-white/[0.07] rounded-[1px]"}
                            style={{
                                width: 2,
                                height: `${Math.max(12, Math.round((b.count / pico) * 100))}%`,
                                transformOrigin: "bottom",
                            }}
                        />
                    ))}
                </div>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
                    <span className="font-bold text-foreground">{total.toLocaleString("es-UY")}</span> en {dias} días
                </span>
            </div>
        </Pista>
    );
}
