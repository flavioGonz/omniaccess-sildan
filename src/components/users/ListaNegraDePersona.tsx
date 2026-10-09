"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Loader2 } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pista } from "@/components/ui/pista";
import { estadoListaNegraDePersona, marcarPersonaEnListaNegra, desmarcarPersonaEnListaNegra } from "@/app/actions/watchlist";
import { WATCH_EFECTOS } from "@/lib/watch-categories";
import { resumirCamaras } from "@/lib/lista-negra";

/**
 * El interruptor "Lista negra" de la ficha de una persona.
 *
 * Marca a la persona = todas sus matrículas (y las que se le carguen después) en la lista de
 * vigilancia como lista negra, con el motivo. No le cambia el rol. Se aplica en el momento,
 * no al guardar la ficha: es una acción con efecto en la barrera y en las cámaras, y queda
 * dicho qué pasó con cada lectora. Si la persona está en lista negra por rol (módulo facial)
 * se avisa que eso se saca desde allí.
 */
export function ListaNegraDePersona({ userId, chapas, onCambio }: { userId: string; chapas: string[]; onCambio?: () => void }) {
    const [estado, setEstado] = useState<Awaited<ReturnType<typeof estadoListaNegraDePersona>> | null>(null);
    const [motivo, setMotivo] = useState("");
    const [ocupado, setOcupado] = useState(false);
    const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
    const [conflicto, setConflicto] = useState<string | null>(null);

    const cargar = () => estadoListaNegraDePersona(userId).then(setEstado).catch(() => setEstado(null));
    useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

    const e = WATCH_EFECTOS.BLACKLISTED;

    async function marcar(force = false) {
        setOcupado(true); setConflicto(null);
        try {
            const r: any = await marcarPersonaEnListaNegra(userId, motivo.trim(), force);
            if (r.conflicto && !force) { setConflicto(r.error); return; }
            if (!r.ok) { toast.error({ title: "No se pudo marcar", description: r.error }); return; }
            toast.success({ title: "En lista negra", description: `${r.plates.join(", ")}: toda lectura se registra DENEGADA.` });
            if (r.camaras) { const t = resumirCamaras(r.camaras); if (r.camaras.fallo.length) toast.warning({ title: "Lectoras: alguna no respondió", description: t }); else toast.success({ title: "Lectoras actualizadas", description: t }); }
            setPidiendoMotivo(false); setMotivo(""); cargar(); onCambio?.();
        } finally { setOcupado(false); }
    }
    async function desmarcar() {
        setOcupado(true);
        try {
            const r: any = await desmarcarPersonaEnListaNegra(userId);
            toast.success({ title: "Salió de la lista negra", description: r.plates?.length ? `${r.plates.join(", ")}: vuelve a decidir la credencial y el modo LPR.` : "No tenía entradas vinculadas." });
            if (r.camaras) { const t = resumirCamaras(r.camaras); if (r.camaras.fallo.length) toast.warning({ title: "Lectoras: alguna no respondió", description: t }); }
            cargar(); onCambio?.();
        } finally { setOcupado(false); }
    }

    const marcada = !!estado?.marcada;
    return (
        <div className={cn("rounded-[10px] border p-3 space-y-2", marcada ? "border-[var(--mal)] bg-[var(--mal-suave)]" : "border-border bg-card/40")}>
            <div className="flex items-start gap-3">
                <ShieldAlert size={18} className={marcada ? "text-[var(--mal)] mt-0.5" : "text-muted-foreground mt-0.5"} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-bold">Lista negra</span>
                        {estado === null ? <Loader2 size={12} className="animate-spin text-muted-foreground" /> : marcada
                            ? <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md chip-mal">marcada</span>
                            : <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md chip-neutro">no</span>}
                        {estado?.porRol && (
                            <Pista titulo="Por rol" texto="La persona tiene el rol 'Lista negra' del módulo facial: sus matrículas se deniegan por eso aunque no haya entrada acá. Ese rol se cambia desde el módulo facial.">
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md chip-aviso">también por rol</span>
                            </Pista>
                        )}
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                        {marcada
                            ? <>Desde {estado?.desde ? new Date(estado.desde).toLocaleString("es-UY") : "—"}{estado?.por ? ` · cargó ${estado.por}` : ""}{estado?.motivo ? ` · ${estado.motivo}` : ""}</>
                            : <>Pone <b>todas sus matrículas</b> ({chapas.length ? chapas.join(", ") : "ninguna cargada todavía"}) en la pestaña Lista negra (alerta máxima), y las que se le carguen después.</>}
                    </p>
                    {/* Qué va a pasar, antes de apretar */}
                    <Pista titulo="Qué hace exactamente" ancho={360} texto={
                        <div className="space-y-1 text-[11px] leading-snug">
                            <p><b>Barrera:</b> {e.barrera}</p>
                            <p><b>Cámaras:</b> {e.camaras}</p>
                            <p><b>Monitor:</b> {e.monitor}</p>
                            <p><b>Monitores:</b> {e.monitores}</p>
                            <p><b>Avisos:</b> {e.avisos}</p>
                        </div>
                    }>
                        <span className="inline-block mt-1 text-[11px] text-[var(--accion)] underline decoration-dotted cursor-help">¿Qué hace exactamente?</span>
                    </Pista>
                </div>
                <div className="shrink-0">
                    {marcada
                        ? <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={desmarcar}>{ocupado ? <Loader2 size={13} className="animate-spin" /> : "Sacar de lista negra"}</Button>
                        : <Button type="button" size="sm" variant="outline" disabled={ocupado || chapas.length === 0} onClick={() => setPidiendoMotivo(true)} title={chapas.length === 0 ? "Cargá y guardá una matrícula primero" : undefined}>Marcar</Button>}
                </div>
            </div>
            {pidiendoMotivo && !marcada && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Motivo (queda en el registro)" className="flex-1 min-w-[200px] h-9" autoFocus onKeyDown={(ev) => { if (ev.key === "Enter") marcar(); }} />
                    <Button type="button" size="sm" disabled={ocupado} onClick={() => marcar()}>{ocupado ? <Loader2 size={13} className="animate-spin" /> : "Confirmar: denegar sus matrículas"}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setPidiendoMotivo(false); setConflicto(null); }}>Cancelar</Button>
                </div>
            )}
            {conflicto && (
                <div className="rounded-[6px] border border-[var(--aviso)] bg-[var(--aviso-suave)] p-2 text-[12px] flex flex-wrap items-center gap-2">
                    <span className="flex-1">{conflicto}</span>
                    <Button type="button" size="sm" onClick={() => marcar(true)} disabled={ocupado}>Sí, pisarlas</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setConflicto(null)}>No</Button>
                </div>
            )}
        </div>
    );
}
