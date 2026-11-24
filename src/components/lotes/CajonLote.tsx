"use client";

import { useCallback, useEffect, useState } from "react";
import { CarFront, History, MapPin, Users } from "lucide-react";
import { EnElMapa } from "@/components/administraciones/PlanoLotes";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Cargando, Chip, ErrorEstado } from "@/components/ui/estados";
import { Matricula } from "@/components/ui/celdas";
import { fechaHora } from "@/lib/fechas";
import { detalleLote, type DetalleLote } from "@/app/actions/administraciones";
import { EditorCodigo } from "@/components/lotes/EditorCodigo";
import { HistorialLote } from "@/components/lotes/HistorialLote";

/**
 * Un lote, entero: quién vive, con qué código carga cada uno en el censo, con qué matrículas entran
 * y todo lo que cambió.
 *
 * Existe por dos pedidos de Nico del 21/11 que se contestan en el mismo lugar: editar a mano los
 * códigos del censo de cada lote, y la auditoría de cambios de cada lote («saber cuándo un
 * residente cambia sus matrículas»). Hasta acá un lote era un renglón en una tabla.
 */

const VINCULO: Record<string, string> = { PROPIETARIO: "Propietario", INQUILINO: "Inquilino", OCUPANTE: "Ocupante", FAMILIA: "Familia" };

export function CajonLote({ unitId, alCerrar }: { unitId: string | null; alCerrar: () => void }) {
    /* La respuesta guarda de qué lote es: al pasar de un lote a otro, lo que se ve del anterior
       deja de corresponder sin tener que borrarlo a mano dentro de un efecto. */
    const [traido, setTraido] = useState<{ de: string; d: DetalleLote | null; error: string | null } | null>(null);
    const [vuelta, setVuelta] = useState(0);
    const refrescar = useCallback(() => setVuelta((n) => n + 1), []);
    useEffect(() => {
        if (!unitId) return;
        let vivo = true;
        detalleLote(unitId)
            .then((d) => { if (vivo) setTraido({ de: unitId, d, error: d ? null : "Ese lote ya no está." }); })
            .catch((e) => { if (vivo) setTraido({ de: unitId, d: null, error: e instanceof Error ? e.message : "No se pudo traer el lote." }); });
        return () => { vivo = false; };
    }, [unitId, vuelta]);
    const suyo = traido && traido.de === unitId ? traido : null;
    const d = suyo?.d || null;
    const chapas = d ? d.personas.reduce((n, p) => n + p.chapas.length, 0) : 0;

    return (
        <Cajon open={!!unitId} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={d ? `Lote ${d.nombre}` : "Lote"}
                descripcion={d ? [d.administracion, d.edificio, d.titular ? `Titular según la administración: ${d.titular}` : ""].filter(Boolean).join(" · ") || undefined : undefined}>
                {suyo?.error ? <div className="p-6"><ErrorEstado mensaje={suyo.error} alReintentar={refrescar} /></div>
                    : !d ? <div className="p-6"><Cargando texto="Trayendo el lote…" /></div>
                        : (
                            <>
                                {/* Dónde está (25/11): con el croquis cargado, cada lote sabe su punto en la Tierra. */}
                                {d.coordenadas && (
                                    <div className="flex items-center gap-2 border-b border-border px-6 py-3 text-[12.5px]">
                                        <MapPin size={13} className="text-muted-foreground" />
                                        <span className="tabular-nums text-muted-foreground">{d.coordenadas}</span>
                                        <EnElMapa coordenadas={d.coordenadas} className="ml-auto text-[12.5px] font-semibold" />
                                    </div>
                                )}
                                <CajonSeccion titulo={`Personas · ${d.personas.length}`} icono={Users} compacta
                                    ayuda={d.puedeEditar ? "Cada persona carga en el censo con su propio código. Se puede cambiar a mano con el lápiz." : undefined}>
                                    {d.personas.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Nadie figura en este lote.</p> : (
                                        <ul className="divide-y divide-border rounded-[10px] border border-border">
                                            {d.personas.map((p) => (
                                                <li key={p.id} className="px-3 py-2.5">
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                        <span className="text-[13.5px] font-bold">{p.nombre}</span>
                                                        {p.vinculo && <span className="text-[11.5px] text-muted-foreground">{VINCULO[p.vinculo] || p.vinculo}</span>}
                                                        <span className="ml-auto">
                                                            {!p.invitacion ? <Chip tono="neutro">Sin código</Chip>
                                                                : p.invitacion.estado === "cargo" ? <Chip tono="bien"><span title={`Cargó el ${fechaHora(p.invitacion.usadoAt)}`}>Cargó</span></Chip>
                                                                    : p.invitacion.estado === "enviado" ? <Chip tono="quieto"><span title={`Enviado el ${fechaHora(p.invitacion.enviadoAt)}`}>Enviado</span></Chip>
                                                                        : <Chip tono="aviso">Sin enviar</Chip>}
                                                        </span>
                                                    </div>
                                                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{[p.email, p.telefono].filter(Boolean).join(" · ") || "Sin correo ni teléfono"}</p>
                                                    {p.invitacion?.clave && (
                                                        <div className="mt-1.5 flex items-start gap-2">
                                                            <span className="mt-[5px] text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Código</span>
                                                            <EditorCodigo className="min-w-0 flex-1" invitacionId={p.invitacion.id} clave={p.invitacion.clave} yaEnviado={p.invitacion.estado !== "listo"} alCambiar={refrescar} />
                                                        </div>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </CajonSeccion>

                                <CajonSeccion titulo={`Matrículas · ${chapas}`} icono={CarFront} compacta ayuda="Con las que hoy entra la gente de este lote.">
                                    {chapas === 0 ? <p className="text-[12.5px] text-muted-foreground">Nadie de este lote tiene matrículas cargadas.</p> : (
                                        <ul className="space-y-1.5">
                                            {d.personas.filter((p) => p.chapas.length).map((p) => (
                                                <li key={p.id} className="flex flex-wrap items-center gap-1.5">
                                                    {p.chapas.map((c) => <Matricula key={c} p={c} />)}
                                                    <span className="text-[12px] text-muted-foreground">de {p.nombre}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </CajonSeccion>

                                <CajonSeccion titulo="Historial" icono={History} compacta>
                                    <HistorialLote cambios={d.cambios} auditadoDesde={d.auditadoDesde} />
                                </CajonSeccion>
                            </>
                        )}
            </CajonContenido>
        </Cajon>
    );
}
