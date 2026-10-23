"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useTiempoReal } from "@/lib/tiempo-real";
import { Cronometro, useTranscurrido, leerDuracion } from "@/components/tracking/Cronometro";

/**
 * Lo que disparó un aviso de OmniVision, dibujado SOBRE la foto en la pantalla (21/10, Nico, con
 * «Se quedó en la zona»: «no dibuja el contador de tiempo de estacionado en vivo»). La foto del
 * aviso traía el rótulo quemado («Auto · 15 min»): quieto, y viejo en cuanto pasaba un minuto. Acá
 * va el cuadro crudo y encima, en vivo:
 *   · la zona de la regla, con el borde caminando;
 *   · la caja de quien la disparó, que se dibuja al entrar;
 *   · para la permanencia, el reloj CORRIENDO desde que llegó, y la caja se mueve a donde OmniVision
 *     lo ve ahora (socket `vision_estadia`, cada 2 s desde vision-reglas). Si lo pierde, lo dice;
 *     cuando se va, el reloj se queda quieto en el total.
 *
 * Va adentro de la caja de la foto (misma proporción), así los porcentajes caen justo.
 */
export type MarcasComportamiento = {
    zona?: [number, number][] | null;
    linea?: { a: [number, number]; b: [number, number] } | null;
    caja?: number[] | null;
    tono?: "aviso" | "mal" | "info";
    /** El rótulo de la caja («Auto», «Persona en la zona»). */
    rotulo?: string | null;
    /** Permanencia: el reloj, y la caja en vivo por el aviso. */
    estadia?: { avisoId: string | null; desde: string; hasta: string | null } | null;
};

const TONO: Record<string, string> = { aviso: "var(--aviso)", mal: "var(--mal)", info: "var(--accion-en-oscuro)" };

export function CapaComportamiento({ m, className }: { m: MarcasComportamiento; className?: string }) {
    const [vivo, setVivo] = useState<{ caja: number[] | null; perdida: boolean; visto: string | null }>({ caja: null, perdida: false, visto: null });
    const avisoId = m.estadia && !m.estadia.hasta ? m.estadia.avisoId : null;
    useTiempoReal("vision_estadia", (x: any) => {
        if (!avisoId || x?.avisoId !== avisoId) return;
        setVivo((v) => ({ caja: Array.isArray(x.caja) && x.caja.length === 4 ? x.caja : v.caja, perdida: !!x.perdida, visto: x.visto || v.visto }));
    });
    const caja = vivo.caja || m.caja || null;
    const color = TONO[m.tono || "aviso"];
    const zona = m.zona && m.zona.length >= 3 ? m.zona : null;
    const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
    return (
        <div className={cn("absolute inset-0 pointer-events-none", className)}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
                {zona && (<>
                    <polygon points={zona.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")} fill="var(--accion-en-oscuro)" fillOpacity={0.1}
                        stroke="rgba(0,0,0,0.55)" strokeWidth={4} vectorEffect="non-scaling-stroke" />
                    <polygon points={zona.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")} fill="none" stroke="var(--accion-en-oscuro)" strokeWidth={2}
                        strokeDasharray="10 6" vectorEffect="non-scaling-stroke" className="oa-zona-camina" />
                </>)}
                {m.linea && (<>
                    <line x1={m.linea.a[0] * 100} y1={m.linea.a[1] * 100} x2={m.linea.b[0] * 100} y2={m.linea.b[1] * 100} stroke="rgba(0,0,0,0.55)" strokeWidth={5} vectorEffect="non-scaling-stroke" />
                    <line x1={m.linea.a[0] * 100} y1={m.linea.a[1] * 100} x2={m.linea.b[0] * 100} y2={m.linea.b[1] * 100} stroke="var(--accion-en-oscuro)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                </>)}
            </svg>
            {caja && (
                // La caja en HTML (no en el SVG estirado): las esquinas quedan en ángulo recto y se animan al moverse.
                <div className="absolute transition-[left,top,width,height] duration-700 ease-out"
                    style={{ left: pct(caja[0] - 0.006), top: pct(caja[1] - 0.006), width: pct(caja[2] - caja[0] + 0.012), height: pct(caja[3] - caja[1] + 0.012) }}>
                    <span className={cn("absolute inset-0 rounded-[4px] oa-caja-entra", vivo.perdida && "opacity-50")}
                        style={{ boxShadow: `0 0 0 1.5px ${color}, 0 0 0 3.5px rgba(0,0,0,0.5)` }} />
                    {m.estadia && !m.estadia.hasta && !vivo.perdida && <span className="absolute inset-0 rounded-[4px] oa-caja-late" style={{ boxShadow: `0 0 0 2px ${color}` }} />}
                    <span className={cn("absolute left-0 flex items-center gap-1.5 whitespace-nowrap", caja[1] > 0.12 ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]")}>
                        {m.rotulo && (
                            <span className="h-6 pl-1.5 pr-2 rounded-[6px] bg-black/75 text-white text-[11px] font-semibold inline-flex items-center gap-1.5">
                                <span className="w-1.5 h-3 rounded-[2px]" style={{ background: color }} />{m.rotulo}
                            </span>
                        )}
                        {m.estadia && <Cronometro desde={m.estadia.desde} hasta={m.estadia.hasta} tamano="chico" className="bg-black/70" />}
                        {vivo.perdida && !m.estadia?.hasta && <PerdidoHace visto={vivo.visto} />}
                    </span>
                </div>
            )}
        </div>
    );
}

function PerdidoHace({ visto }: { visto: string | null }) {
    const ms = useTranscurrido(visto);
    return (
        <span className="h-6 px-2 rounded-[6px] bg-black/75 text-white/75 text-[10.5px] font-semibold inline-flex items-center" title="OmniVision dejó de verlo. Si en 10 min vuelve a verlo en el mismo lugar, es el mismo y el reloj sigue; si no, se da por ido.">
            no se ve{ms != null ? ` hace ${leerDuracion(ms)}` : ""}
        </span>
    );
}
