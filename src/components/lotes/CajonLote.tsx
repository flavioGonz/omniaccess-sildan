"use client";

import { useCallback, useEffect, useState } from "react";
import { CarFront, ClipboardList, History, MapPin, Users } from "lucide-react";
import { UbicacionLote } from "@/components/lotes/UbicacionLote";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Cargando, Chip, ErrorEstado } from "@/components/ui/estados";
import { fechaHora } from "@/lib/fechas";
import { detalleLote, elegirPrincipal, type DetalleLote } from "@/app/actions/administraciones";
import { sileo as toast } from "sileo";
import { EditorCodigo } from "@/components/lotes/EditorCodigo";
import { HistorialLote } from "@/components/lotes/HistorialLote";
import { AccionesDePersona, DatosDelLote, EditarPersona, MatriculasDePersona, SumarPersona } from "@/components/lotes/EdicionLote";

/**
 * Un lote, entero: quién vive, con qué código carga cada uno en el censo, con qué matrículas entran
 * y todo lo que cambió.
 *
 * Existe por dos pedidos de Nico del 21/11 que se contestan en el mismo lugar: editar a mano los
 * códigos del censo de cada lote, y la auditoría de cambios de cada lote («saber cuándo un
 * residente cambia sus matrículas»). Hasta acá un lote era un renglón en una tabla.
 *
 * Desde el 25/11 también se corrige acá, a mano (Nico: «desde el drawer del lote se debe poder
 * editar a mano, y quedar en el historial el cambio»): el titular y la situación, la gente (sumar,
 * corregir, sacar) y sus matrículas. Cada corrección queda firmada en el historial de abajo.
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
    /** Elegir a mano a quién le llega el código del lote (25/11: un código por lote, a su principal). */
    const [eligiendo, setEligiendo] = useState<string | null>(null);
    const hacerPrincipal = async (userId: string) => {
        if (!unitId) return;
        setEligiendo(userId);
        try {
            const r = await elegirPrincipal(unitId, userId);
            if (!r.ok) toast.error({ title: "No se cambió", description: r.error });
            else { toast.success({ title: "Listo", description: "El código del lote le va a llegar a esta persona." }); refrescar(); }
        } finally { setEligiendo(null); }
    };
    /** La persona que se está corrigiendo: su formulario va al pie de su renglón. */
    const [editandoPersona, setEditandoPersona] = useState<string | null>(null);
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
                                <CajonSeccion titulo="Datos" icono={ClipboardList} compacta>
                                    <DatosDelLote key={`${d.id}-${d.titular}-${d.situacion}`} unitId={d.id} titular={d.titular} situacion={d.situacion} puedeEditar={d.puedeEditar} alCambiar={refrescar} />
                                </CajonSeccion>
                                {/* Dónde queda, en el plano o en el satélite, y corregirlo desde acá (25/11). */}
                                <CajonSeccion titulo="Ubicación" icono={MapPin} compacta>
                                    <UbicacionLote key={d.id} unitId={d.id} plano={d.plano} coordenadas={d.coordenadas} censo={d.censoUbicacion} puedeEditar={d.puedeEditar} alGuardar={refrescar} />
                                </CajonSeccion>
                                <CajonSeccion titulo={`Personas · ${d.personas.length}`} icono={Users} compacta
                                    ayuda={d.principal
                                        ? `El código del censo es del lote y le llega a todos los que tienen correo. La principal${d.principal.aMano ? " (elegida a mano)" : ""} es la del código: a ella se le manda primero.${d.puedeEditar ? " Se cambia con «Hacerla principal»." : ""}`
                                        : "Este lote todavía no tiene código del censo: le llega a la persona principal, la primera con correo."}>
                                    {d.personas.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Nadie figura en este lote.</p> : (
                                        <ul className="divide-y divide-border rounded-[10px] border border-border">
                                            {d.personas.map((p) => (
                                                <li key={p.id} className="px-3 py-2.5">
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                        <span className="text-[13.5px] font-bold">{p.nombre}</span>
                                                        {p.vinculo && <span className="text-[11.5px] text-muted-foreground">{VINCULO[p.vinculo] || p.vinculo}</span>}
                                                        {p.invitacion && <Chip tono="info">Principal</Chip>}
                                                        <span className="ml-auto">
                                                            {!p.invitacion ? (d.puedeEditar && p.email
                                                                ? <button type="button" disabled={eligiendo === p.id} onClick={() => hacerPrincipal(p.id)} className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold hover:border-[var(--accion)] hover:text-[var(--accion)] disabled:opacity-50">{eligiendo === p.id ? "Cambiando…" : "Hacerla principal"}</button>
                                                                : <span className="text-[11.5px] text-muted-foreground">{p.email ? "Recibe el código del lote" : "Sin correo"}</span>)
                                                                : p.invitacion.estado === "cargo" ? <Chip tono="bien"><span title={`Cargó el ${fechaHora(p.invitacion.usadoAt)}`}>Cargó</span></Chip>
                                                                    : p.invitacion.estado === "enviado" ? <Chip tono="quieto"><span title={`Enviado el ${fechaHora(p.invitacion.enviadoAt)}`}>Enviado</span></Chip>
                                                                        : <Chip tono="aviso">Sin enviar</Chip>}
                                                        </span>
                                                        {d.puedeEditar && <AccionesDePersona unitId={d.id} persona={p} alEditar={() => setEditandoPersona((x) => (x === p.id ? null : p.id))} alCambiar={refrescar} />}
                                                    </div>
                                                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{[p.email, p.telefono].filter(Boolean).join(" · ") || "Sin correo ni teléfono"}</p>
                                                    {p.invitacion?.clave && (
                                                        <div className="mt-1.5 flex items-start gap-2">
                                                            <span className="mt-[5px] text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Código</span>
                                                            <EditorCodigo className="min-w-0 flex-1" invitacionId={p.invitacion.id} clave={p.invitacion.clave} yaEnviado={p.invitacion.estado !== "listo"} alCambiar={refrescar} />
                                                        </div>
                                                    )}
                                                    {d.puedeEditar && editandoPersona === p.id && (
                                                        <EditarPersona unitId={d.id} persona={p} alTerminar={(cambio) => { setEditandoPersona(null); if (cambio) refrescar(); }} />
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {d.puedeEditar && <SumarPersona unitId={d.id} alCambiar={refrescar} />}
                                </CajonSeccion>

                                <CajonSeccion titulo={`Matrículas · ${chapas}`} icono={CarFront} compacta ayuda="Con las que hoy entra la gente de este lote.">
                                    {/* Quien puede editar ve a toda la gente del lote, también la que no tiene chapa: es a quien se le suma una. */}
                                    {(d.puedeEditar ? d.personas.length === 0 : chapas === 0)
                                        ? <p className="text-[12.5px] text-muted-foreground">{d.personas.length ? "Nadie de este lote tiene matrículas cargadas." : "Sumá primero una persona al lote: las matrículas son de alguien."}</p>
                                        : (
                                            <ul className="space-y-1.5">
                                                {d.personas.filter((p) => d.puedeEditar || p.chapas.length).map((p) => (
                                                    <MatriculasDePersona key={p.id} unitId={d.id} persona={p} puedeEditar={d.puedeEditar} alCambiar={refrescar} />
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
