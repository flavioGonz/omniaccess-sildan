"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Check, Globe2, Camera, Radar, ShieldAlert, ShieldCheck, ShieldOff, Infinity as InfinityIco, Moon, Briefcase, SlidersHorizontal, CheckCircle2, XCircle, BellOff, BellRing, Eye } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { DIAS_CORTOS, DIAS_LETRA, HORARIO_SIEMPRE, horarioDiario, describirHorario, normalizarBloques, armadaAhora, type Horario, type TipoRegla } from "@/lib/isapi-horarios";

/**
 * El horario de armado de las reglas de intrusión, para el operador.
 *
 * Cada cámara tiene dos reglas (línea y zona) y cada una su horario semanal EN LA CÁMARA.
 * Esto lo muestra en palabras ("L–D 22:00–06:00") y en un mapa semanal, con "armada ahora /
 * desarmada ahora", y lo cambia con tres gestos: un preset (Siempre / Noche / Fuera de horario
 * / Personalizado), los días, y la franja. Un solo editor para dos alcances: esta cámara
 * (línea, zona o ambas) o TODAS las cámaras de intrusión — ese es el "criterio general",
 * opcional, que se guarda para verse.
 *
 * Rediseñado el 7/10: el cajón anterior era un formulario de píldoras chicas sin decir qué
 * significaba armar. Ahora cada elección es una tarjeta con su ícono y una línea que dice qué
 * va a pasar, hay un mapa de la semana que se pinta mientras se elige, y el botón de armar
 * respira y confirma: es la acción que decide si una cámara avisa o calla.
 */

export type EstadoRegla = { horario: Horario; texto: string; armadaAhora: boolean } | null;
export type HorariosCamara = { name: string; linea: EstadoRegla; zona: EstadoRegla };

const REGLAS: { tipo: TipoRegla; rotulo: string; Icono: any; que: string }[] = [
    { tipo: "linea", rotulo: "Cruce de línea", Icono: Radar, que: "Avisa cuando alguien cruza la línea dibujada en el cuadro, en el sentido configurado." },
    { tipo: "zona", rotulo: "Zona", Icono: ShieldAlert, que: "Avisa cuando alguien entra o se queda dentro del área dibujada en el cuadro." },
];

const PRESETS: { clave: string; rotulo: string; detalle: string; Icono: any; dias: number[]; desde: string; hasta: string }[] = [
    { clave: "siempre", rotulo: "Siempre", detalle: "Las 24 h, todos los días. La cámara nunca calla.", Icono: InfinityIco, dias: [1, 2, 3, 4, 5, 6, 7], desde: "00:00", hasta: "24:00" },
    { clave: "noche", rotulo: "Noche", detalle: "De 22:00 a 06:00, todos los días. De día ve, pero no avisa.", Icono: Moon, dias: [1, 2, 3, 4, 5, 6, 7], desde: "22:00", hasta: "06:00" },
    { clave: "fuera", rotulo: "Fuera de horario", detalle: "De 18:00 a 08:00, todos los días. Calla en horario laboral.", Icono: Briefcase, dias: [1, 2, 3, 4, 5, 6, 7], desde: "18:00", hasta: "08:00" },
    { clave: "personalizado", rotulo: "Personalizado", detalle: "Elegí los días y la franja.", Icono: SlidersHorizontal, dias: [], desde: "", hasta: "" },
];

const nombreRegla = (t: TipoRegla) => (t === "linea" ? "línea" : "zona");

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

/**
 * La semana pintada: siete filas, 24 horas cada una, verde donde la regla está armada.
 * Es lo que hace que "L–V 18:00–08:00" se entienda de un vistazo, incluido el cruce de
 * medianoche que en palabras siempre cuesta.
 */
function MapaSemanal({ horario, alto = 10 }: { horario: Horario; alto?: number }) {
    const bl = normalizarBloques(horario.bloques);
    const ahora = new Date();
    const diaHoy = ahora.getDay() === 0 ? 7 : ahora.getDay();
    const xHoy = (ahora.getHours() * 60 + ahora.getMinutes()) / 1440 * 100;
    const min = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
    return (
        <div className="space-y-1" aria-label={describirHorario(horario)}>
            <div className="flex items-center text-[9px] text-muted-foreground tabular-nums pl-7">
                {[0, 6, 12, 18, 24].map((h) => <span key={h} className="flex-1 first:flex-none first:w-0 last:flex-none last:w-0 relative"><span className="absolute -translate-x-1/2">{String(h).padStart(2, "0")}</span></span>)}
            </div>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <div key={d} className="flex items-center gap-1.5">
                    <span className={cn("w-[22px] text-[10px] font-bold tabular-nums text-right", d === diaHoy ? "text-foreground" : "text-muted-foreground")}>{DIAS_LETRA[d]}</span>
                    <div className="relative flex-1 rounded-sm bg-muted/60 overflow-hidden" style={{ height: alto }}>
                        {bl.filter((b) => b.dia === d).map((b, i) => (
                            <motion.span key={`${b.desde}-${b.hasta}-${i}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}
                                className="absolute inset-y-0 bg-[var(--bien)]"
                                style={{ left: `${min(b.desde) / 1440 * 100}%`, width: `${(min(b.hasta) - min(b.desde)) / 1440 * 100}%` }} />
                        ))}
                        {d === diaHoy && <span className="absolute inset-y-0 w-px bg-foreground/80" style={{ left: `${xHoy}%` }} title="ahora" />}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Armada o desarmada ahora, grande y sin ambigüedad. */
function EstadoAhora({ armada, texto }: { armada: boolean; texto: string }) {
    return (
        <div className={cn("flex items-center gap-3 rounded-[10px] border px-3.5 py-3", armada ? "border-[color-mix(in_oklab,var(--bien)_40%,transparent)] bg-[var(--bien-suave)]" : "border-[color-mix(in_oklab,var(--aviso)_40%,transparent)] bg-[var(--aviso-suave)]")}>
            <motion.span key={armada ? "on" : "off"} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }}
                className={cn("grid h-11 w-11 place-items-center rounded-full shrink-0", armada ? "pleno-bien" : "pleno-aviso")}>
                {armada ? <ShieldCheck size={24} /> : <ShieldOff size={24} />}
            </motion.span>
            <div className="min-w-0">
                <div className={cn("text-[13px] font-bold", armada ? "text-[var(--bien-texto)]" : "text-[var(--aviso-texto)]")}>{armada ? "Armada en este momento" : "Desarmada en este momento"}</div>
                <div className="text-[11.5px] text-muted-foreground">{texto}</div>
            </div>
        </div>
    );
}

export function HorarioArmadoDialog({ cam, todasLasCamaras, actual, general, camaras, onClose, onAplicado }: {
    /** La cámara a editar; con `todasLasCamaras` se ignora y se aplica a todas. */
    cam: { id: string; name: string } | null;
    todasLasCamaras?: boolean;
    actual?: HorariosCamara | null;
    general?: { texto: string; aplicado: string; tipos: TipoRegla[] } | null;
    /** El estado de todas las cámaras, para el resumen del criterio general. */
    camaras?: Record<string, HorariosCamara | null>;
    onClose: () => void;
    onAplicado: () => void;
}) {
    const [tipos, setTipos] = useState<TipoRegla[]>(["linea", "zona"]);
    const [preset, setPreset] = useState<string>("siempre");
    const [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
    const [desde, setDesde] = useState("22:00");
    const [hasta, setHasta] = useState("06:00");
    const [aplicando, setAplicando] = useState(false);
    const [hecho, setHecho] = useState(false);
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
        const p = PRESETS.find((x) => x.clave === preset && x.clave !== "personalizado");
        if (p) return p.clave === "siempre" ? HORARIO_SIEMPRE : horarioDiario(p.dias, p.desde, p.hasta);
        return horarioDiario(dias, desde, hasta);
    }, [preset, dias, desde, hasta]);
    const texto = describirHorario(horario);
    const armadaConEste = armadaAhora(horario);
    const listo = tipos.length > 0 && !(preset === "personalizado" && (dias.length === 0 || !desde || !hasta));

    const aplicar = async () => {
        if (!todasLasCamaras && !cam) return;
        setAplicando(true); setResultado(null); setHecho(false);
        try {
            const r = await fetch("/api/intrusion/horarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: cam?.id, todas: !!todasLasCamaras, tipos, horario }) }).then((x) => x.json());
            if (r?.error) throw new Error(r.error);
            setResultado(r.resultado || []);
            const fallos = (r.resultado || []).filter((x: any) => x.fallo?.length);
            if (fallos.length) toast.warning({ title: "Alguna cámara no aceptó el horario", description: fallos.map((x: any) => `${x.name}: ${x.fallo.map((f: any) => `${f.tipo} (${f.error})`).join(", ")}`).join(" · ") });
            else { setHecho(true); toast.success({ title: todasLasCamaras ? "Criterio general aplicado" : "Horario aplicado", description: `${texto} · ${tipos.map(nombreRegla).join(" y ")}` }); }
            onAplicado();
        } catch (e: any) {
            toast.error({ title: "No se pudo aplicar", description: e?.message });
        } finally { setAplicando(false); }
    };

    const alcance = todasLasCamaras ? "todas las cámaras de intrusión" : cam?.name || "";
    const listaCamaras = todasLasCamaras && camaras ? Object.entries(camaras).filter(([, h]) => h) as [string, HorariosCamara][] : [];

    return (
        <Cajon open onOpenChange={(o) => { if (!o) onClose(); }}>
            <CajonContenido ancho="intermedio" titulo={todasLasCamaras ? "Horario general de armado" : `Horario de armado · ${cam?.name}`}
                descripcion={todasLasCamaras ? "Un mismo horario para las reglas de todas las cámaras de intrusión. Después, cada cámara se puede ajustar por separado." : "Cuándo avisa esta cámara. Fuera del horario ve, pero calla."}
                pie={
                    <div className="flex items-center justify-between gap-3 w-full">
                        <div className="min-w-0">
                            <div className="text-[11px] text-muted-foreground">Se escribirá en {alcance}</div>
                            <div className="text-[12px] font-semibold tabular-nums truncate">{texto} · {tipos.length ? tipos.map(nombreRegla).join(" y ") : "ninguna regla"}</div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                            <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
                            {/* El botón de armar: respira mientras se puede apretar, gira mientras escribe en
                                las cámaras y confirma con el escudo. Es LA acción del cajón. */}
                            <motion.button type="button" onClick={aplicar} disabled={aplicando || !listo}
                                whileTap={{ scale: 0.96 }}
                                className={cn("relative inline-flex items-center gap-2 h-10 px-5 rounded-[10px] text-[13px] font-bold text-[var(--accion-texto)] bg-[var(--accion)] hover:bg-[var(--accion-sobre)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors",
                                    !aplicando && listo && !hecho && "boton-armar")}>
                                <AnimatePresence mode="wait" initial={false}>
                                    {aplicando ? (
                                        <motion.span key="a" initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0 }}><Loader2 size={16} className="animate-spin" /></motion.span>
                                    ) : hecho ? (
                                        <motion.span key="h" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}><ShieldCheck size={16} /></motion.span>
                                    ) : (
                                        <motion.span key="i" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><ShieldCheck size={16} /></motion.span>
                                    )}
                                </AnimatePresence>
                                {aplicando ? "Escribiendo en las cámaras…" : hecho ? "Armado" : todasLasCamaras ? "Armar todas con este horario" : "Armar con este horario"}
                            </motion.button>
                        </div>
                    </div>
                }>

                {/* Qué significa armar, antes de tocar nada */}
                <CajonSeccion titulo="Qué hace esto" icono={Eye} compacta>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="flex items-start gap-3 rounded-[10px] border border-border bg-card/40 p-3">
                            <span className="grid h-10 w-10 place-items-center rounded-full pleno-bien shrink-0"><BellRing size={20} /></span>
                            <div>
                                <div className="text-[12.5px] font-bold">Armada</div>
                                <div className="text-[11.5px] text-muted-foreground leading-snug">Dentro del horario la cámara manda el cruce o la zona al instante: suena acá, en el bot y en el historial, con foto.</div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3 rounded-[10px] border border-border bg-card/40 p-3">
                            <span className="grid h-10 w-10 place-items-center rounded-full pleno-aviso shrink-0"><BellOff size={20} /></span>
                            <div>
                                <div className="text-[12.5px] font-bold">Desarmada</div>
                                <div className="text-[11.5px] text-muted-foreground leading-snug">Fuera del horario la cámara sigue grabando en el NVR, pero no avisa nada: ni cruce, ni zona, ni foto.</div>
                            </div>
                        </div>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground">El horario vive <b className="text-foreground">en la cámara</b>, no en OmniAccess: se escribe por ISAPI y se relee para confirmar. Por eso cada regla puede tener el suyo.</p>
                </CajonSeccion>

                {!todasLasCamaras && (
                    <CajonSeccion titulo="Hoy en esta cámara" icono={Camera} compacta ayuda="Lo que la cámara tiene cargado ahora, regla por regla.">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {REGLAS.map(({ tipo, rotulo, Icono }) => {
                                const e = actual?.[tipo];
                                return (
                                    <div key={tipo} className="flex items-center gap-3 rounded-[10px] border border-border bg-card/40 p-3">
                                        <span className={cn("grid h-10 w-10 place-items-center rounded-full shrink-0", e ? (e.armadaAhora ? "pleno-bien" : "pleno-aviso") : "bg-muted text-muted-foreground")}><Icono size={20} /></span>
                                        <div className="min-w-0">
                                            <div className="text-[12.5px] font-bold">{rotulo}</div>
                                            <div className="text-[12px] tabular-nums">{e ? e.texto : "sin dato"}</div>
                                            <div className={cn("text-[11px]", e ? (e.armadaAhora ? "text-[var(--bien-texto)]" : "text-[var(--aviso-texto)]") : "text-muted-foreground")}>{e ? (e.armadaAhora ? "armada ahora" : "desarmada ahora") : "la cámara no contestó"}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CajonSeccion>
                )}

                {todasLasCamaras && (
                    <CajonSeccion titulo="Criterio general vigente" icono={Globe2} compacta>
                        {general ? (
                            <div className="flex items-center gap-3 rounded-[10px] border border-border bg-card/40 p-3">
                                <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--info-suave)] text-[var(--info-texto)] shrink-0"><Globe2 size={20} /></span>
                                <div className="min-w-0">
                                    <div className="text-[13px] font-bold tabular-nums">{general.texto}</div>
                                    <div className="text-[11.5px] text-muted-foreground">aplicado el {new Date(general.aplicado).toLocaleString("es-UY")} a {general.tipos.map(nombreRegla).join(" y ")}. Si después se tocó una cámara por separado, esa cámara manda.</div>
                                </div>
                            </div>
                        ) : (
                            <p className="text-[12px] text-muted-foreground">Todavía no se aplicó un criterio general: cada cámara tiene el horario que trajo de fábrica o el que se le puso a mano.</p>
                        )}
                        {listaCamaras.length > 0 && (
                            <div className="divide-y divide-border rounded-[10px] border border-border overflow-hidden">
                                {listaCamaras.map(([id, h]) => (
                                    <div key={id} className="flex items-center gap-3 px-3 py-2 text-[11.5px]">
                                        <span className="font-semibold w-[120px] truncate">{h.name}</span>
                                        {REGLAS.map(({ tipo, Icono }) => { const e = h[tipo]; return (
                                            <span key={tipo} className="inline-flex items-center gap-1.5 min-w-0">
                                                <Icono size={13} className={cn("shrink-0", e ? (e.armadaAhora ? "text-[var(--bien)]" : "text-[var(--aviso)]") : "text-muted-foreground/50")} />
                                                <span className="text-muted-foreground tabular-nums truncate">{e ? e.texto : "—"}</span>
                                            </span>
                                        ); })}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CajonSeccion>
                )}

                <CajonSeccion titulo="A qué reglas" icono={ShieldAlert} compacta ayuda="Las dos van juntas salvo que quieras que una calle y la otra no.">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {REGLAS.map(({ tipo, rotulo, Icono, que }) => {
                            const on = tipos.includes(tipo);
                            return (
                                <button key={tipo} type="button" aria-pressed={on}
                                    onClick={() => setTipos((p) => (p.includes(tipo) ? p.filter((x) => x !== tipo) : [...p, tipo]))}
                                    className={cn("relative flex items-start gap-3 rounded-[10px] border p-3 text-left transition-colors",
                                        on ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border bg-card/40 hover:bg-accent")}>
                                    <span className={cn("grid h-11 w-11 place-items-center rounded-full shrink-0 transition-colors", on ? "accion" : "bg-muted text-muted-foreground")}><Icono size={22} /></span>
                                    <span className="min-w-0">
                                        <span className="block text-[13px] font-bold">{rotulo}</span>
                                        <span className="block text-[11.5px] text-muted-foreground leading-snug">{que}</span>
                                    </span>
                                    <span className={cn("absolute top-2.5 right-2.5 grid h-5 w-5 place-items-center rounded-full border transition-colors", on ? "accion border-transparent" : "border-border text-transparent")}><Check size={12} /></span>
                                </button>
                            );
                        })}
                    </div>
                </CajonSeccion>

                <CajonSeccion titulo="Cuándo" icono={Clock} compacta>
                    <div className="grid grid-cols-2 gap-2">
                        {PRESETS.map((p) => {
                            const on = preset === p.clave;
                            return (
                                <button key={p.clave} type="button" aria-pressed={on} onClick={() => setPreset(p.clave)}
                                    className={cn("flex items-start gap-3 rounded-[10px] border p-3 text-left transition-colors",
                                        on ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border bg-card/40 hover:bg-accent")}>
                                    <span className={cn("grid h-10 w-10 place-items-center rounded-full shrink-0 transition-colors", on ? "accion" : "bg-muted text-muted-foreground")}><p.Icono size={20} /></span>
                                    <span className="min-w-0">
                                        <span className="block text-[12.5px] font-bold">{p.rotulo}</span>
                                        <span className="block text-[11px] text-muted-foreground leading-snug">{p.detalle}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <AnimatePresence initial={false}>
                        {preset === "personalizado" && (
                            <motion.div key="pers" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 pt-1">
                                    <CajonCampo etiqueta="Días" pista="Los días en que la regla está armada. Un rango que cruza medianoche (22:00–06:00) se guarda en la cámara como dos bloques; acá se ve como uno.">
                                        <div className="flex gap-1.5">
                                            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                                                const on = dias.includes(d);
                                                return (
                                                    <Pista key={d} texto={DIAS_CORTOS[d]} lado="abajo">
                                                        <button type="button" aria-pressed={on} onClick={() => setDias((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()))}
                                                            className={cn("h-10 w-10 rounded-full border text-[12px] font-bold transition-colors", on ? "accion border-transparent" : "bg-background text-muted-foreground border-border hover:bg-accent")}>{DIAS_LETRA[d]}</button>
                                                    </Pista>
                                                );
                                            })}
                                        </div>
                                    </CajonCampo>
                                    <CajonCampo etiqueta="Franja" ayuda="Puede cruzar medianoche.">
                                        <div className="flex items-center gap-2">
                                            <input type="time" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-10 rounded-[6px] border border-border bg-background px-2.5 text-[14px] font-semibold tabular-nums" />
                                            <span className="text-muted-foreground">a</span>
                                            <input type="time" value={hasta === "24:00" ? "23:59" : hasta} onChange={(e) => setHasta(e.target.value === "23:59" ? "24:00" : e.target.value)} className="h-10 rounded-[6px] border border-border bg-background px-2.5 text-[14px] font-semibold tabular-nums" />
                                        </div>
                                    </CajonCampo>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </CajonSeccion>

                <CajonSeccion titulo="Así quedaría" icono={ShieldCheck} compacta ayuda="La semana pintada: verde donde avisa. La raya es la hora de ahora.">
                    <div className="rounded-[10px] border border-border bg-card/40 p-3">
                        <MapaSemanal horario={horario} />
                    </div>
                    <EstadoAhora armada={armadaConEste} texto={`${texto} · con este horario, ${armadaConEste ? "ahora mismo estaría avisando" : "ahora mismo no avisaría"}`} />
                </CajonSeccion>

                {resultado && (
                    <CajonSeccion titulo="Resultado" icono={Check} compacta>
                        <ul className="space-y-1.5 text-[12px]">
                            {resultado.map((r: any) => (
                                <li key={r.id} className="flex items-start gap-2">
                                    {r.fallo?.length ? <XCircle size={15} className="text-[var(--mal)] shrink-0 mt-px" /> : <CheckCircle2 size={15} className="text-[var(--bien)] shrink-0 mt-px" />}
                                    <span><span className="font-semibold">{r.name}</span> <span className="text-muted-foreground">{r.ok.map(nombreRegla).join(" y ")}{r.ok.length ? ` → ${r.texto}` : ""}{r.fallo?.length ? ` · falló ${r.fallo.map((f: any) => `${f.tipo}: ${f.error}`).join(", ")}` : ""}</span></span>
                                </li>
                            ))}
                        </ul>
                    </CajonSeccion>
                )}
            </CajonContenido>
        </Cajon>
    );
}
