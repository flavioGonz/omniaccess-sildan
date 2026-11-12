"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Ban, CalendarClock, Clock, Loader2, NotebookPen, RotateCw, ScanSearch, Video } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { CajonSeccion } from "@/components/ui/cajon";
import { Estado, Matricula, Momento } from "@/components/ui/celdas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { estadoRevision, textoRevision, TONO_REVISION, REVISION_DIAS } from "@/lib/padron";
import type { FichaListaNegra } from "@/app/actions/padron";
import { anotarEnBitacora, bitacoraDe, renovarRevision, resumenSeguimiento, type AsientoBitacora } from "@/app/actions/lista-amarilla";
import type { ResumenSeguimiento } from "@/lib/seguimiento";

/**
 * El seguimiento de una ficha de la Lista Amarilla, dentro de su cajón (openspec
 * seguimiento-lista-amarilla): cuándo toca revisarla, cuánto y por dónde se la vio, y la
 * bitácora de lo que se fue sabiendo.
 *
 * Tres secciones, cada una con su carga y su error propios: si el resumen no llega, la bitácora
 * se puede usar igual. Van sólo en fichas amarillas y con la función prendida; eso lo decide
 * quien las monta (CajonListaNegra).
 */

/** El texto de los asientos que escribe el sistema, para distinguirlos de las notas. */
const ROTULO: Record<AsientoBitacora["tipo"], string | null> = {
    NOTA: null, ALTA: "Alta", RENOVACION: "Revisión", NIVEL: "Cambio de lista", BAJA: "Baja", REACTIVACION: "Reactivación",
};

const hora = (h: number) => `${String(h).padStart(2, "0")}:00`;
/** «2026-11-07» → «7/11/2026», sin pasar por la zona horaria (el día ya viene resuelto). */
const diaCorto = (d: string) => { const [a, m, dd] = d.split("-").map(Number); return `${dd}/${m}/${a}`; };

// ── Revisión ──────────────────────────────────────────────────────────────────────────────

export function RevisionFicha({ ficha, alRenovar, alPasarANegra, puedePasar, motivoNoPasa, ocupado }: {
    ficha: FichaListaNegra;
    /** La fecha nueva, para que el cajón y la tabla se pongan al día sin recargar todo. */
    alRenovar: (revisarEl: string) => void;
    alPasarANegra: () => void;
    puedePasar: boolean;
    /** Por qué no se puede pasar a lista negra ahora (cambios sin guardar, ficha de una persona). */
    motivoNoPasa?: string;
    ocupado?: boolean;
}) {
    const [renovando, setRenovando] = useState(false);
    const e = estadoRevision(ficha.revisarEl);

    const renovar = async () => {
        setRenovando(true);
        try {
            const r = await renovarRevision(ficha.clave);
            if (!r.ok) { toast.error({ title: "No se pudo renovar", description: r.error }); return; }
            toast.success({ title: "Revisada", description: `Se sigue ${REVISION_DIAS} días más. Quedó anotado en la bitácora.` });
            alRenovar(r.revisarEl);
        } finally { setRenovando(false); }
    };

    return (
        <CajonSeccion titulo="Revisión" icono={CalendarClock}
            pista={<>Cada ficha amarilla se vuelve a mirar cada {REVISION_DIAS} días: ¿sigue valiendo la pena seguirla? <b>Vencer no la apaga</b>: una ficha vencida sigue avisando en cada lectura. Es un recordatorio para vos, no un permiso para el vehículo.</>}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Estado tono={TONO_REVISION[e.estado]} icono={Clock}>{textoRevision(e)}</Estado>
                {ficha.revisarEl && <span className="text-[12px] text-muted-foreground">el <Momento t={ficha.revisarEl} soloFecha /></span>}
                <span className="ml-auto flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={renovar} disabled={renovando || ocupado}>
                        {renovando ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} Renovar {REVISION_DIAS} días
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={alPasarANegra} disabled={!puedePasar || ocupado} title={!puedePasar ? motivoNoPasa : "Pasa a alerta máxima: la barrera le deniega el paso. Conserva matrículas, motivo, foto y bitácora."}>
                        <Ban size={13} /> Pasar a lista negra
                    </Button>
                </span>
            </div>
            {!puedePasar && motivoNoPasa && <p className="mt-2 text-[11.5px] text-muted-foreground">{motivoNoPasa}</p>}
        </CajonSeccion>
    );
}

// ── Resumen de actividad ──────────────────────────────────────────────────────────────────

export function SeguimientoFicha({ clave, alInvestigar }: { clave: string; alInvestigar: (plate: string) => void }) {
    const [r, setR] = useState<ResumenSeguimiento | null>(null);
    const [error, setError] = useState<string | null>(null);

    const cargar = useCallback(() => {
        setR(null); setError(null);
        resumenSeguimiento(clave)
            .then((x) => { if (x.ok) setR(x.resumen); else setError(x.error); })
            .catch((e) => setError(e?.message || "No se pudo leer el seguimiento."));
    }, [clave]);
    useEffect(cargar, [cargar]);

    const cifras: [string, React.ReactNode][] = r ? [
        ["Lecturas · 7 días", r.lecturas7],
        ["Lecturas · 30 días", r.lecturas30],
        ["Días con actividad · 30", r.diasActivos30],
        ["Última vez", r.ultima ? <Momento t={r.ultima} /> : "—"],
    ] : [];

    return (
        <CajonSeccion titulo="Seguimiento" icono={Activity}
            ayuda={r && !r.sinLecturas && r.primera ? <>Se la ve desde el {diaCorto(r.primera)}. Cuenta lecturas de las lectoras, no pasadas: dos cámaras que la leen en un minuto son dos.</> : undefined}>
            {error ? (
                <div className="text-[12px] text-muted-foreground">No se pudo leer el seguimiento: {error} <button type="button" onClick={cargar} className="tono-accion font-semibold ml-1">Reintentar</button></div>
            ) : !r ? (
                <div className="text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Sumando las lecturas…</div>
            ) : r.sinLecturas ? (
                // Sin lecturas no se muestran cifras en cero: cuatro ceros parecen un dato, y no lo son.
                <div className="text-[12.5px] text-muted-foreground">Ninguna cámara la vio todavía. Cuando una lectora lea alguna de sus matrículas, acá aparece cuánto y por dónde anda.</div>
            ) : (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {cifras.map(([rotulo, valor]) => (
                            <div key={rotulo} className="rounded-[10px] border border-border bg-card px-3 py-2">
                                <div className="text-[18px] font-bold tabular-nums leading-tight">{valor}</div>
                                <div className="text-[10.5px] text-muted-foreground mt-0.5">{rotulo}</div>
                            </div>
                        ))}
                    </div>
                    {r.horaPico != null && (
                        <p className="text-[12.5px]">Aparece sobre todo de <b className="font-semibold">{r.franja}</b>, cerca de las <span className="tabular-nums font-semibold">{hora(r.horaPico)}</span>.</p>
                    )}
                    {r.camaras.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11.5px] text-muted-foreground inline-flex items-center gap-1 mr-0.5"><Video size={12} /> Por dónde pasa</span>
                            {r.camaras.slice(0, 8).map((c) => (
                                <span key={c.nombre} className="h-6 px-2 rounded-full border border-border bg-card text-[11.5px] inline-flex items-center gap-1.5">
                                    {c.nombre}<span className="tabular-nums text-muted-foreground">{c.n}</span>
                                </span>
                            ))}
                        </div>
                    )}
                    {/* Por matrícula, con la puerta a Investigar: el calendario, la hora pico y el
                        recorrido completo ya existen en el Monitor LPR; acá se abren sin salir. */}
                    <ul className="divide-y divide-border rounded-[10px] border border-border bg-card">
                        {r.porMatricula.map((m) => (
                            <li key={m.plate} className="flex items-center gap-3 px-3 py-2">
                                <Matricula p={m.plate} />
                                <span className="text-[12px] text-muted-foreground min-w-0 flex-1 truncate">
                                    {m.lecturas30 ? <><span className="tabular-nums">{m.lecturas30}</span> lectura{m.lecturas30 === 1 ? "" : "s"} en 30 días{m.ultima ? <> · última <Momento t={m.ultima} /></> : null}</> : "sin lecturas en 30 días"}
                                </span>
                                <Button type="button" size="sm" variant="outline" onClick={() => alInvestigar(m.plate)}><ScanSearch size={13} /> Investigar</Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </CajonSeccion>
    );
}

// ── Bitácora ──────────────────────────────────────────────────────────────────────────────

export function BitacoraFicha({ clave, pulso = 0 }: { clave: string;
    /** Cambia cuando el cajón hizo algo que el sistema anotó (renovar): se vuelve a leer. */
    pulso?: number }) {
    const [asientos, setAsientos] = useState<AsientoBitacora[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nota, setNota] = useState("");
    const [guardando, setGuardando] = useState(false);

    const cargar = useCallback(() => {
        setError(null);
        bitacoraDe(clave)
            .then((x) => { if (x.ok) setAsientos(x.asientos); else { setAsientos(null); setError(x.error); } })
            .catch((e) => { setAsientos(null); setError(e?.message || "No se pudo leer la bitácora."); });
    }, [clave]);
    useEffect(() => { setAsientos(null); cargar(); }, [cargar, pulso]);

    const anotar = async () => {
        if (!nota.trim() || guardando) return;
        setGuardando(true);
        try {
            const r = await anotarEnBitacora(clave, nota);
            if (!r.ok) { toast.error({ title: "No se guardó la nota", description: r.error }); return; }
            setAsientos((a) => [r.asiento, ...(a || [])]);
            setNota("");
        } catch (e: any) { toast.error({ title: "No se guardó la nota", description: e?.message || "Revisá la conexión y probá de nuevo." }); }
        finally { setGuardando(false); }
    };

    return (
        <CajonSeccion titulo="Bitácora" icono={NotebookPen}
            ayuda="Lo que se va sabiendo, con fecha y firma. No se edita ni se borra: para corregir, se agrega otra nota.">
            <div className="space-y-2">
                <Textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={1000} disabled={guardando}
                    placeholder="Ej. «Se habló con el vecino del lote 14: es el jardinero nuevo»"
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); anotar(); } }} />
                <div className="flex justify-end">
                    <Button type="button" size="sm" onClick={anotar} disabled={!nota.trim() || guardando}>
                        {guardando ? <Loader2 size={13} className="animate-spin" /> : <NotebookPen size={13} />} Anotar
                    </Button>
                </div>
            </div>
            <div className="mt-3">
                {error ? (
                    <div className="text-[12px] text-muted-foreground">No se pudo leer la bitácora: {error} <button type="button" onClick={cargar} className="tono-accion font-semibold ml-1">Reintentar</button></div>
                ) : !asientos ? (
                    <div className="text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Leyendo la bitácora…</div>
                ) : asientos.length === 0 ? (
                    <div className="text-[12.5px] text-muted-foreground">Todavía no hay nada anotado.</div>
                ) : (
                    <ol className="space-y-2.5">
                        {asientos.map((a) => (
                            <li key={a.id} className="text-[12.5px] leading-snug">
                                <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-1.5">
                                    <Momento t={a.cuando} />
                                    <span>·</span><span>{a.autor || "sin firma"}</span>
                                    {ROTULO[a.tipo] && <Estado tono="quieto">{ROTULO[a.tipo]}</Estado>}
                                </div>
                                {/* Lo que anotó el sistema va más apagado que lo que escribió una persona. */}
                                <p className={cn("mt-0.5 whitespace-pre-wrap break-words", a.tipo !== "NOTA" && "text-muted-foreground")}>{a.texto}</p>
                            </li>
                        ))}
                    </ol>
                )}
            </div>
        </CajonSeccion>
    );
}
