"use client";

import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { tonoFila, ROTULO_TONO } from "@/components/queue/CajonFila";
import { horaSeg, fechaCorta } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { DibujoPersonas, desdeGuardadas, type PersonaGuardada } from "@/components/queue/SiluetasBosch";

/**
 * Una captura de fila, abierta: la foto grande y sus datos. La usan el Flujo de filas (lecturas,
 * veces sobre el límite, la gráfica) y el Historial de capturas. Era un modal centrado de 3xl
 * que tapaba la tabla; en un cajón la tabla queda a la vista y se pasa de una a otra.
 */
export type Captura = { foto: string | null; t: string; fila: string; personas: number; limite: number; canal?: string; titulo: string; extra?: React.ReactNode; siluetas?: PersonaGuardada[] | null };

export function CajonCaptura({ detalle, alCerrar }: { detalle: Captura | null; alCerrar: () => void }) {
    const t = detalle ? tonoFila(detalle.personas, detalle.limite) : "quieto";
    return (
        <Cajon open={!!detalle} onOpenChange={(v) => !v && alCerrar()}>
            <CajonContenido ancho="intermedio" titulo={detalle?.titulo || "Detalle"} descripcion={detalle ? `${detalle.fila} · ${fechaCorta(detalle.t)} ${horaSeg(detalle.t)}` : undefined}>
                {detalle && (
                    <div className="p-5 space-y-4">
                        <div className="relative aspect-video rounded-[10px] overflow-hidden bg-black shadow-[var(--sombra-captura,none)]">
                            {detalle.foto
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <a href={detalle.foto} target="_blank" rel="noreferrer"><img src={detalle.foto} alt="" className="absolute inset-0 w-full h-full object-contain" />
                                    {/* Las personas que la cámara veía en ese momento, dibujadas por nosotros. */}
                                    {!!detalle.siluetas?.length && <DibujoPersonas personas={desdeGuardadas(detalle.siluetas)} />}</a>
                                : <div className="absolute inset-0 grid place-items-center text-white/60 text-[12.5px]">Esta lectura no tiene foto</div>}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <Dato rotulo="Personas"><span className={cn("text-[26px] font-bold tabular-nums", `tono-${t}`)}>{detalle.personas}</span><span className="text-muted-foreground"> / {detalle.limite}</span></Dato>
                            <Dato rotulo="Estado"><span className={cn("text-[12px] font-bold px-2 py-0.5 rounded-full border", `chip-${t}`)}>{ROTULO_TONO[t]}</span></Dato>
                            <Dato rotulo="Hora"><span className="tabular-nums font-semibold">{horaSeg(detalle.t)}</span> <span className="text-muted-foreground">{fechaCorta(detalle.t)}</span></Dato>
                            <Dato rotulo="Fila"><span className="font-semibold">{detalle.fila}</span>{detalle.canal && <span className="text-muted-foreground"> · {detalle.canal}</span>}</Dato>
                        </div>
                        {detalle.extra && <p className="text-[12.5px] text-muted-foreground">{detalle.extra}</p>}
                    </div>
                )}
            </CajonContenido>
        </Cajon>
    );
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
    return (
        <div className="rounded-[10px] border border-border px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground mb-0.5">{rotulo}</div>
            <div className="text-[13px]">{children}</div>
        </div>
    );
}
