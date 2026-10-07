"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Check, AlertTriangle, Globe2, Camera } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { DIAS_CORTOS, DIAS_LETRA, HORARIO_SIEMPRE, horarioDiario, describirHorario, type Horario, type TipoRegla } from "@/lib/isapi-horarios";

/**
 * El horario de armado de las reglas de intrusión, para el operador.
 *
 * Cada cámara tiene dos reglas (línea y zona) y cada una su horario semanal EN LA CÁMARA.
 * Esto lo muestra en palabras ("L–D 22:00–06:00"), con "armada ahora / desarmada ahora", y
 * lo cambia con tres gestos: un preset (Siempre / Noche / Personalizado), los días, y la
 * franja. Un solo editor para dos alcances: esta cámara (línea, zona o ambas) o TODAS las
 * cámaras de intrusión — ese es el "criterio general", opcional, que se guarda para verse.
 */

export type EstadoRegla = { horario: Horario; texto: string; armadaAhora: boolean } | null;
export type HorariosCamara = { name: string; linea: EstadoRegla; zona: EstadoRegla };

const PRESETS: { clave: string; rotulo: string; dias: number[]; desde: string; hasta: string }[] = [
    { clave: "siempre", rotulo: "Siempre (24 h)", dias: [1, 2, 3, 4, 5, 6, 7], desde: "00:00", hasta: "24:00" },
    { clave: "noche", rotulo: "Noche 22:00–06:00", dias: [1, 2, 3, 4, 5, 6, 7], desde: "22:00", hasta: "06:00" },
    { clave: "fuera", rotulo: "Fuera de horario laboral", dias: [1, 2, 3, 4, 5, 6, 7], desde: "18:00", hasta: "08:00" },
];

export function ResumenArmado({ h, compacto }: { h: HorariosCamara | null | undefined; compacto?: boolean }) {
    if (!h) return <span className="text-[10px] text-white/60">armado: sin dato</span>;
    const Regla = ({ tipo, e }: { tipo: string; e: EstadoRegla }) => (
        <span className="inline-flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", e ? (e.armadaAhora ? "bg-emerald-400" : "bg-amber-400") : "bg-white/30")} />
            <span className="text-white/70">{tipo}</span>
            <span className="text-white/90 font-semibold">{e ? e.texto : "—"}</span>
        </span>
    );
    return (
        <span className={cn("inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5 tabular-nums", compacto ? "text-[9px]" : "text-[10px]")}>
            <Clock size={9} className="text-white/60" />
            <Regla tipo="línea" e={h.linea} />
            <Regla tipo="zona" e={h.zona} />
        </span>
    );
}

export function HorarioArmadoDialog({ cam, todasLasCamaras, actual, general, onClose, onAplicado }: {
    /** La cámara a editar; con `todasLasCamaras` se ignora y se aplica a todas. */
    cam: { id: string; name: string } | null;
    todasLasCamaras?: boolean;
    actual?: HorariosCamara | null;
    general?: { texto: string; aplicado: string; tipos: TipoRegla[] } | null;
    onClose: () => void;
    onAplicado: () => void;
}) {
    const [tipos, setTipos] = useState<TipoRegla[]>(["linea", "zona"]);
    const [preset, setPreset] = useState<string>("siempre");
    const [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
    const [desde, setDesde] = useState("22:00");
    const [hasta, setHasta] = useState("06:00");
    const [aplicando, setAplicando] = useState(false);
    const [resultado, setResultado] = useState<any[] | null>(null);

    // Arranca con lo que la cámara tiene en la línea (si hay), para editar y no reescribir a ciegas.
    useEffect(() => {
        const base = actual?.linea?.horario || actual?.zona?.horario;
        if (!base) return;
        const bl = base.bloques;
        if (bl.length === 7 && bl.every((b) => b.desde === "00:00" && b.hasta === "24:00")) { setPreset("siempre"); return; }
        setPreset("personalizado");
        setDias([...new Set(bl.map((b) => b.dia))]);
        if (bl[0]) { setDesde(bl[0].desde); const fin = bl.find((b) => b.dia === bl[0].dia && b.desde === bl[0].desde); setHasta(fin?.hasta === "24:00" ? (bl.find((b) => b.desde === "00:00")?.hasta || "24:00") : (fin?.hasta || "24:00")); }
    }, [actual]);

    const horario: Horario = useMemo(() => {
        const p = PRESETS.find((x) => x.clave === preset);
        if (p) return p.clave === "siempre" ? HORARIO_SIEMPRE : horarioDiario(p.dias, p.desde, p.hasta);
        return horarioDiario(dias, desde, hasta);
    }, [preset, dias, desde, hasta]);
    const texto = describirHorario(horario);

    const aplicar = async () => {
        if (!todasLasCamaras && !cam) return;
        setAplicando(true); setResultado(null);
        try {
            const r = await fetch("/api/intrusion/horarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: cam?.id, todas: !!todasLasCamaras, tipos, horario }) }).then((x) => x.json());
            if (r?.error) throw new Error(r.error);
            setResultado(r.resultado || []);
            const fallos = (r.resultado || []).filter((x: any) => x.fallo?.length);
            if (fallos.length) toast.warning({ title: "Alguna cámara no aceptó el horario", description: fallos.map((x: any) => `${x.name}: ${x.fallo.map((f: any) => `${f.tipo} (${f.error})`).join(", ")}`).join(" · ") });
            else toast.success({ title: todasLasCamaras ? "Criterio general aplicado" : "Horario aplicado", description: `${texto} · ${tipos.map((t) => (t === "linea" ? "línea" : "zona")).join(" y ")}` });
            onAplicado();
        } catch (e: any) {
            toast.error({ title: "No se pudo aplicar", description: e?.message });
        } finally { setAplicando(false); }
    };

    const alcance = todasLasCamaras ? "todas las cámaras de intrusión" : cam?.name || "";
    return (
        <Cajon open onOpenChange={(o) => { if (!o) onClose(); }}>
            <CajonContenido ancho="intermedio" titulo={todasLasCamaras ? "Horario general de armado" : `Horario de armado · ${cam?.name}`}
                descripcion={todasLasCamaras ? "Un mismo horario para las reglas de todas las cámaras de intrusión. Opcional: después cada cámara se puede ajustar por separado." : "Cuándo avisa esta cámara. Fuera del horario, la cámara no manda el cruce ni la zona aunque ocurran."}
                pie={
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] text-muted-foreground tabular-nums">{texto} → {alcance}</span>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
                            <Button type="button" onClick={aplicar} disabled={aplicando || tipos.length === 0 || (preset === "personalizado" && dias.length === 0)}>
                                {aplicando ? <Loader2 size={14} className="animate-spin mr-1" /> : <Check size={14} className="mr-1" />}{todasLasCamaras ? "Aplicar a todas" : "Aplicar en la cámara"}
                            </Button>
                        </div>
                    </div>
                }>
                {!todasLasCamaras && (
                    <CajonSeccion titulo="Hoy" icono={Camera} ayuda="Lo que la cámara tiene cargado ahora, regla por regla. El punto verde es 'armada en este momento'.">
                        <div className="grid grid-cols-2 gap-3">
                            {(["linea", "zona"] as TipoRegla[]).map((t) => {
                                const e = actual?.[t];
                                return (
                                    <div key={t} className="rounded-[10px] border border-border bg-card/40 p-3">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t === "linea" ? "Cruce de línea" : "Zona"}</div>
                                        <div className="mt-1 text-[13px] font-semibold">{e ? e.texto : "sin dato"}</div>
                                        <div className={cn("mt-1 inline-flex items-center gap-1.5 text-[11px]", e ? (e.armadaAhora ? "text-[var(--bien)]" : "text-[var(--aviso)]") : "text-muted-foreground")}>
                                            <span className={cn("h-2 w-2 rounded-full", e ? (e.armadaAhora ? "bg-[var(--bien)]" : "bg-[var(--aviso)]") : "bg-muted-foreground")} />
                                            {e ? (e.armadaAhora ? "armada ahora" : "desarmada ahora") : "la cámara no contestó"}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CajonSeccion>
                )}
                {todasLasCamaras && general && (
                    <CajonSeccion titulo="Criterio general vigente" icono={Globe2}>
                        <p className="text-[13px]"><span className="font-semibold">{general.texto}</span> <span className="text-muted-foreground">· aplicado el {new Date(general.aplicado).toLocaleString("es-UY")} a {general.tipos.map((t) => (t === "linea" ? "línea" : "zona")).join(" y ")}</span></p>
                        <p className="text-[11px] text-muted-foreground mt-1">Es lo último que se aplicó a todas. Si después se tocó una cámara por separado, esa cámara manda: mirá su propio horario.</p>
                    </CajonSeccion>
                )}

                <CajonSeccion titulo="Nuevo horario" icono={Clock}>
                    <div className="space-y-4">
                        <CajonCampo etiqueta="A qué reglas">
                            <div className="flex gap-1.5">
                                {(["linea", "zona"] as TipoRegla[]).map((t) => (
                                    <button key={t} type="button" onClick={() => setTipos((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))}
                                        className={cn("h-9 px-4 rounded-full border text-[11px] font-bold uppercase tracking-wide", tipos.includes(t) ? "bg-accent text-foreground border-border" : "bg-background text-muted-foreground border-border")}>
                                        {t === "linea" ? "Cruce de línea" : "Zona"}
                                    </button>
                                ))}
                            </div>
                        </CajonCampo>
                        <CajonCampo etiqueta="Cuándo">
                            <div className="flex flex-wrap gap-1.5">
                                {PRESETS.map((p) => (
                                    <button key={p.clave} type="button" onClick={() => setPreset(p.clave)} className={cn("h-9 px-4 rounded-full border text-[11px] font-bold", preset === p.clave ? "bg-accent text-foreground border-border" : "bg-background text-muted-foreground border-border")}>{p.rotulo}</button>
                                ))}
                                <button type="button" onClick={() => setPreset("personalizado")} className={cn("h-9 px-4 rounded-full border text-[11px] font-bold", preset === "personalizado" ? "bg-accent text-foreground border-border" : "bg-background text-muted-foreground border-border")}>Personalizado</button>
                            </div>
                        </CajonCampo>
                        {preset === "personalizado" && (
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
                                <CajonCampo etiqueta="Días" pista="Los días en que la regla está armada. Un rango que cruza medianoche (22:00–06:00) se guarda en la cámara como dos bloques; acá se ve como uno.">
                                    <div className="flex gap-1">
                                        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                                            <button key={d} type="button" onClick={() => setDias((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()))} title={DIAS_CORTOS[d]}
                                                className={cn("h-9 w-9 rounded-full border text-[11px] font-bold", dias.includes(d) ? "bg-[var(--accion)] text-white border-[var(--accion)]" : "bg-background text-muted-foreground border-border")}>{DIAS_LETRA[d]}</button>
                                        ))}
                                    </div>
                                </CajonCampo>
                                <CajonCampo etiqueta="Franja">
                                    <div className="flex items-center gap-2">
                                        <input type="time" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-9 rounded-[6px] border border-border bg-background px-2 text-[13px] tabular-nums" />
                                        <span className="text-muted-foreground">a</span>
                                        <input type="time" value={hasta === "24:00" ? "23:59" : hasta} onChange={(e) => setHasta(e.target.value === "23:59" ? "24:00" : e.target.value)} className="h-9 rounded-[6px] border border-border bg-background px-2 text-[13px] tabular-nums" />
                                    </div>
                                </CajonCampo>
                            </div>
                        )}
                        <p className="text-[12px] text-muted-foreground inline-flex items-start gap-1.5">
                            <AlertTriangle size={13} className="text-[var(--aviso)] shrink-0 mt-0.5" />
                            <span>Quedaría: <b className="text-foreground">{texto}</b>. Fuera de ese horario la cámara <b>no avisa</b>: ni cruce, ni zona, ni foto. Se escribe en la cámara y se relee para confirmar.</span>
                        </p>
                    </div>
                </CajonSeccion>

                {resultado && (
                    <CajonSeccion titulo="Resultado" icono={Check}>
                        <ul className="space-y-1 text-[12px]">
                            {resultado.map((r: any) => (
                                <li key={r.id} className="flex items-center gap-2">
                                    <span className={cn("h-2 w-2 rounded-full", r.fallo?.length ? "bg-[var(--mal)]" : "bg-[var(--bien)]")} />
                                    <span className="font-semibold">{r.name}</span>
                                    <span className="text-muted-foreground">{r.ok.map((t: string) => (t === "linea" ? "línea" : "zona")).join(" y ")}{r.ok.length ? ` → ${r.texto}` : ""}{r.fallo?.length ? ` · falló ${r.fallo.map((f: any) => `${f.tipo}: ${f.error}`).join(", ")}` : ""}</span>
                                </li>
                            ))}
                        </ul>
                    </CajonSeccion>
                )}
            </CajonContenido>
        </Cajon>
    );
}
