"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Speech, Siren, ShieldAlert, Eye, Hand, ArrowRightLeft, Check, X, Power, History, Volume2, VolumeX, SlidersHorizontal, ChevronUp, ChevronDown, UserRound, Loader2, Radar, ScanEye, Repeat, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { hora } from "@/lib/fechas";
import { Switch } from "@/components/ui/switch";
import { useFuncion } from "@/lib/funciones-cliente";
import {
    useAvisos, avisoVigente, usePrefsAvisos, cambiarPrefs, pitidoAviso, useDestrabarAudio, leerAvisos,
    FONDO_TIPO, TIPOS_APAGABLES, type Aviso, type AccionAviso, type TipoAviso,
} from "@/lib/avisos-pantalla";

/**
 * La pila de avisos: abajo al centro, todos con la forma de la barra de intrusión (20/10, Nico:
 * «ése es el que vamos a usar, pero que aparezca desde el bottom; el color de fondo en función del
 * tipo de detección»). Ver lib/avisos-pantalla para quién publica y por qué hay dos niveles.
 *
 * Se ven hasta VISIBLES; el resto queda en «y N más», que despliega la lista entera. Lo crítico va
 * siempre arriba de la pila y no se puede apagar ni cerrar: se decide.
 */

const VISIBLES = 3;
/** Cada cuánto vuelve a sonar lo crítico mientras siga sin decidir (los que no traen sonido propio). */
const INTERVALO_CRITICO_MS = 6000;

const ICONO: Record<NonNullable<AccionAviso["icono"]>, typeof Eye> = { ver: Eye, tomar: Hand, pasar: ArrowRightLeft, real: Check, falsa: X, desactivar: Power, historial: History };
const ICONO_TIPO: Record<TipoAviso, typeof Eye> = { "lista-negra": ShieldAlert, "intrusion-real": ShieldAlert, intrusion: Radar, busqueda: Search, merodeo: Repeat, vision: ScanEye, patron: Repeat };

const hace = (ts: string) => { const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000)); return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`; };

export function PilaAvisos({ soloCriticos = false }: {
    /** La pared (/monitor): sólo lo crítico, y sin preferencias (no hay a quién preguntarle). */
    soloCriticos?: boolean;
}) {
    const todos = useAvisos();
    const prefs = usePrefsAvisos();
    useDestrabarAudio();
    const [abierta, setAbierta] = useState(false);
    const [ajustes, setAjustes] = useState(false);
    const [montado, setMontado] = useState(false);
    useEffect(() => setMontado(true), []);
    // El reloj de «hace 2 min».
    const [, setTic] = useState(0);
    useEffect(() => { const iv = setInterval(() => setTic((n) => n + 1), 15000); return () => clearInterval(iv); }, []);

    const avisos = useMemo(() => todos.filter((a) => a.nivel === "critico" || (!soloCriticos && !prefs.apagados.includes(a.tipo))), [todos, prefs.apagados, soloCriticos]);
    const hayCritico = avisos.some((a) => a.nivel === "critico");

    // Suena al llegar un aviso nuevo (alerta: una vez; crítico: también cada tanto mientras siga).
    const vistos = useRef<Set<string>>(new Set());
    useEffect(() => {
        const nuevos = avisos.filter((a) => !vistos.current.has(`${a.id}:${a.veces || 1}`));
        for (const a of avisos) vistos.current.add(`${a.id}:${a.veces || 1}`);
        if (!nuevos.length || prefs.silencio) return;
        const conPitido = nuevos.filter((a) => !a.sonidoPropio);
        if (conPitido.length) pitidoAviso(conPitido.some((a) => a.nivel === "critico"));
        // La voz, después del pitido; lo crítico primero (ya vienen ordenados así).
        if (prefs.voz) setTimeout(() => leerAvisos(nuevos), conPitido.length ? 700 : 0);
    }, [avisos, prefs.silencio, prefs.voz]);
    const criticosSinSonido = avisos.some((a) => a.nivel === "critico" && !a.sonidoPropio);
    useEffect(() => {
        if (!criticosSinSonido || prefs.silencio) return;
        const iv = setInterval(() => pitidoAviso(false), INTERVALO_CRITICO_MS);
        return () => clearInterval(iv);
    }, [criticosSinSonido, prefs.silencio]);
    useEffect(() => { if (avisos.length <= VISIBLES) setAbierta(false); }, [avisos.length]);

    if (!montado || !avisos.length) return null;
    const vista = abierta ? avisos : avisos.slice(0, VISIBLES);
    const resto = avisos.length - vista.length;

    return createPortal(
        <>
            {/* Lo crítico respira en los bordes de toda la pantalla. No bloquea clics. */}
            {hayCritico && <div aria-hidden className="fixed inset-0 z-[2370] pointer-events-none oa-respirar-critico" />}
            <div role="region" aria-label="Avisos" aria-live="assertive"
                className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[2380] w-[min(980px,calc(100vw-24px))] flex flex-col gap-1.5 pointer-events-none">
                <div className={cn("flex flex-col gap-1.5 pointer-events-auto", abierta && "max-h-[70vh] overflow-y-auto pr-1")}>
                    {vista.map((a) => <BarraAviso key={a.id} a={a} />)}
                </div>
                <div className="pointer-events-auto self-center flex items-center gap-1.5">
                    {(resto > 0 || abierta) && (
                        <button type="button" onClick={() => setAbierta((v) => !v)}
                            className="h-8 px-3 rounded-full bg-card text-foreground border border-border text-[12px] font-bold inline-flex items-center gap-1.5 shadow-lg">
                            {abierta ? <><ChevronDown size={14} /> Mostrar menos</> : <><ChevronUp size={14} /> y {resto} {resto === 1 ? "aviso" : "avisos"} más</>}
                        </button>
                    )}
                    <button type="button" onClick={() => cambiarPrefs({ silencio: !prefs.silencio })} aria-label={prefs.silencio ? "Activar el sonido" : "Silenciar"}
                        title={prefs.silencio ? "Activar el sonido de los avisos" : "Silenciar los avisos (siguen apareciendo)"}
                        className="h-8 w-8 rounded-full bg-card text-foreground border border-border grid place-items-center shadow-lg">
                        {prefs.silencio ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                    {!soloCriticos && (
                        <div className="relative">
                            <button type="button" onClick={() => setAjustes((v) => !v)} aria-expanded={ajustes} aria-label="Qué avisos saltan en esta pantalla"
                                title="Qué avisos saltan en esta pantalla" className="h-8 w-8 rounded-full bg-card text-foreground border border-border grid place-items-center shadow-lg">
                                <SlidersHorizontal size={14} />
                            </button>
                            {ajustes && <AjustesAvisos alCerrar={() => setAjustes(false)} />}
                        </div>
                    )}
                </div>
            </div>
            <style jsx global>{`
                @keyframes oa-respirar-critico {
                    0%, 100% { box-shadow: inset 0 0 0 0 color-mix(in oklab, var(--mal) 0%, transparent); }
                    50% { box-shadow: inset 0 0 0 4px color-mix(in oklab, var(--mal) 85%, transparent), inset 0 0 90px 20px color-mix(in oklab, var(--mal) 25%, transparent); }
                }
                .oa-respirar-critico { animation: oa-respirar-critico 2.2s ease-in-out infinite; }
                @keyframes oa-barra-critica { 0%, 100% { box-shadow: 0 0 0 0 transparent, 0 18px 40px rgba(0,0,0,.35); } 50% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--mal) 35%, transparent), 0 18px 40px rgba(0,0,0,.35); } }
                .oa-barra-critica { animation: oa-barra-critica 1.6s ease-in-out infinite; }
                @keyframes oa-barra-entra { from { transform: translateY(18px); opacity: 0; } to { transform: none; opacity: 1; } }
                .oa-barra-entra { animation: oa-barra-entra .22s ease-out; }
                @keyframes oa-activa-brillo { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
                @keyframes oa-activa-punto { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.7); } }
                .oa-barra-activa { position: relative; overflow: hidden; outline: 2px solid rgba(255,255,255,.55); outline-offset: -2px; }
                .oa-barra-activa::before { content: ""; position: absolute; inset: 0; width: 40%; pointer-events: none;
                    background: linear-gradient(100deg, transparent, rgba(255,255,255,.16), transparent); animation: oa-activa-brillo 2.4s ease-in-out infinite; }
                .oa-activa-punto { animation: oa-activa-punto 1s ease-in-out infinite; }
                @media (prefers-reduced-motion: reduce) { .oa-respirar-critico, .oa-barra-critica, .oa-barra-entra, .oa-barra-activa::before, .oa-activa-punto { animation: none; } }
            `}</style>
        </>,
        document.body,
    );
}

/** Una barra: foto, qué es, de quién, y las decisiones. Translúcidos sobre el color del tipo (sirve con texto claro u oscuro). */
function BarraAviso({ a }: { a: Aviso }) {
    const t = FONDO_TIPO[a.tipo];
    const I = ICONO_TIPO[a.tipo];
    const [confirmando, setConfirmando] = useState<string | null>(null);
    const [corriendo, setCorriendo] = useState<string | null>(null);
    const [foto, setFoto] = useState(true);
    useEffect(() => { if (!confirmando) return; const x = setTimeout(() => setConfirmando(null), 5000); return () => clearTimeout(x); }, [confirmando]);
    useEffect(() => setFoto(true), [a.foto]);

    const correr = async (acc: AccionAviso) => {
        if (acc.confirmar && confirmando !== acc.clave) { setConfirmando(acc.clave); return; }
        setConfirmando(null);
        // Lo último que publicó la fuente, no lo que había cuando se dibujó la barra.
        const vigente = avisoVigente(a.id)?.acciones.find((x) => x.clave === acc.clave) || acc;
        setCorriendo(acc.clave);
        try { await vigente.correr(); } finally { setCorriendo(null); }
    };
    const translucido = "bg-[color-mix(in_oklab,currentColor_16%,transparent)] hover:bg-[color-mix(in_oklab,currentColor_26%,transparent)]";

    return (
        <div className={cn("oa-barra-entra flex items-center gap-3 rounded-[14px] pl-1.5 pr-2 py-1.5 shadow-2xl", a.nivel === "critico" && "oa-barra-critica", a.activa && "oa-barra-activa")}
            style={{ background: a.activa ? "var(--mal)" : t.fondo, color: a.activa ? "#fff" : t.texto }}>
            {/* Una alarma activa muestra la foto del evento más grande, con el punto de «en curso». */}
            <span className={cn("relative shrink-0", a.activa ? "w-[128px]" : "w-[88px]")}>
                {a.foto && foto
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.foto} alt="" onError={() => setFoto(false)} className="w-full aspect-video rounded-[9px] object-cover bg-black" />
                    : <span className={cn("w-full aspect-video rounded-[9px] grid place-items-center", translucido)}><I size={22} /></span>}
                {a.activa && (
                    <span className="absolute left-1.5 top-1.5 h-5 px-1.5 rounded-full bg-black/65 text-white text-[9.5px] font-extrabold uppercase tracking-[0.12em] inline-flex items-center gap-1">
                        <span className="oa-activa-punto w-1.5 h-1.5 rounded-full bg-[#ff4d4d]" /> Activa
                    </span>
                )}
            </span>
            <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-80 inline-flex items-center gap-1.5">
                    <I size={11} /> {a.rotulo}{a.veces && a.veces > 1 ? <span className="tabular-nums normal-case tracking-normal font-extrabold opacity-100"> · ×{a.veces}</span> : null}
                </div>
                <div className="text-[15px] font-extrabold leading-tight truncate">
                    {a.titulo}<span className="font-semibold opacity-85">{a.detalle ? ` · ${a.detalle}` : ""} · {hace(a.ts)}</span>
                </div>
                {a.activa ? (
                    <div className="text-[11.5px] font-semibold opacity-95 inline-flex items-center gap-1 truncate max-w-full">
                        <ShieldAlert size={12} /> Confirmada real por <b className="font-extrabold">{a.activa.por || "la guardia"}</b> · {hora(a.activa.desde)} ({hace(a.activa.desde)})
                    </div>
                ) : a.operador !== undefined && (
                    <div className="text-[11px] font-semibold opacity-85 inline-flex items-center gap-1 truncate max-w-full"><UserRound size={11} /> {a.operador || "Nadie la tomó"}</div>
                )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                {a.acciones.map((acc) => {
                    const Ic = acc.icono ? ICONO[acc.icono] : null;
                    const conf = confirmando === acc.clave;
                    return (
                        <button key={acc.clave} type="button" onClick={() => void correr(acc)} disabled={!!corriendo} title={acc.ayuda}
                            className={cn("h-9 px-3 rounded-[9px] text-[12.5px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors",
                                conf ? "bg-black text-white ring-2 ring-white" : acc.principal ? "bg-white hover:bg-white/90 font-extrabold" : translucido)}
                            style={acc.principal && !conf ? { color: a.activa ? "var(--mal)" : a.tipo === "busqueda" || a.tipo === "merodeo" ? "#16120a" : t.fondo } : undefined}>
                            {corriendo === acc.clave ? <Loader2 size={14} className="animate-spin" /> : Ic ? <Ic size={14} /> : null}
                            {conf ? acc.confirmar : acc.etiqueta}
                        </button>
                    );
                })}
                {a.cerrar && (
                    <button type="button" onClick={a.cerrar} aria-label="Quitar de la pantalla" title="Quitar de la pantalla (no decide nada: sigue en Gestión de alarmas)"
                        className={cn("h-9 w-9 rounded-[9px] grid place-items-center", translucido)}><X size={15} /></button>
                )}
            </div>
        </div>
    );
}

/**
 * El mismo ajuste fuera de la pila (Gestión de alarmas): la pila sólo existe mientras hay avisos,
 * y sin esto no había cómo volver a prender un tipo apagado hasta que saltara otro aviso.
 */
export function BotonAjustesAvisos() {
    const [abierto, setAbierto] = useState(false);
    const prefs = usePrefsAvisos();
    return (
        <div className="relative">
            <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} title="Qué avisos saltan en esta pantalla y si suenan"
                className="h-[34px] px-3 rounded-lg bg-muted/60 text-[12px] font-semibold inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                {prefs.silencio ? <VolumeX size={14} /> : <SlidersHorizontal size={14} />} Avisos en pantalla
            </button>
            {abierto && <AjustesAvisos abajo alCerrar={() => setAbierto(false)} />}
        </div>
    );
}

/**
 * Los íconos de la barra del Monitor LPR (20/10, Nico: «estos íconos deben poder activar o no
 * estas notificaciones, además de tener sonido y la lectura con voz»): la sirena abre qué avisos
 * saltan en esta pantalla; el parlante con voz prende la lectura en voz alta. El silencio es el
 * botón de parlante de siempre (el mismo de la pila).
 */
export function IconosAvisosMonitor() {
    const prefs = usePrefsAvisos();
    const [abierto, setAbierto] = useState(false);
    const apagados = prefs.apagados.length;
    const base = "h-[30px] w-[30px] rounded-md grid place-items-center transition-colors";
    return (
        <>
            <div className="relative">
                <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} aria-label="Avisos en esta pantalla"
                    title={apagados ? `Avisos en esta pantalla: ${apagados} tipo${apagados === 1 ? "" : "s"} apagado${apagados === 1 ? "" : "s"}` : "Avisos en esta pantalla: todos prendidos"}
                    className={cn(base, "relative", apagados ? "text-muted-foreground hover:text-foreground hover:bg-background" : "bg-background tono-mal")}>
                    <Siren size={15} />
                    {apagados > 0 && <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-muted-foreground text-background text-[9px] font-bold grid place-items-center tabular-nums">{apagados}</span>}
                </button>
                {abierto && <AjustesAvisos abajo alCerrar={() => setAbierto(false)} />}
            </div>
            <button type="button" onClick={() => cambiarPrefs({ voz: !prefs.voz })} aria-pressed={prefs.voz} aria-label="Leer los avisos en voz alta"
                title={prefs.voz ? "Lectura en voz alta: prendida (dice el tipo, la matrícula y la cámara)" : "Lectura en voz alta: apagada"}
                className={cn(base, prefs.voz ? "bg-background tono-info" : "text-muted-foreground hover:text-foreground hover:bg-background")}>
                <Speech size={15} />
            </button>
        </>
    );
}

/** Qué salta en esta pantalla. Lo crítico no se ofrece: lista negra e intrusión saltan siempre. */
function AjustesAvisos({ alCerrar, abajo }: { alCerrar: () => void; abajo?: boolean }) {
    const prefs = usePrefsAvisos();
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const fuera = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) alCerrar(); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") alCerrar(); };
        setTimeout(() => window.addEventListener("pointerdown", fuera), 0); window.addEventListener("keydown", esc);
        return () => { window.removeEventListener("pointerdown", fuera); window.removeEventListener("keydown", esc); };
    }, [alCerrar]);
    const alternar = (t: TipoAviso) => cambiarPrefs({ apagados: prefs.apagados.includes(t) ? prefs.apagados.filter((x) => x !== t) : [...prefs.apagados, t] });
    // «En búsqueda» es una función de LPR que se apaga (Ajustes → Modos): apagada, no hay nada que silenciar.
    const busqueda = useFuncion("LPR_BUSQUEDA");
    const tipos = TIPOS_APAGABLES.filter((t) => t !== "busqueda" || busqueda === true);
    return (
        <div ref={ref} className={cn("absolute right-0 z-[2390] w-[280px]", abajo ? "top-10" : "bottom-10", " rounded-[14px] bg-popover text-popover-foreground border border-border shadow-2xl p-3")}>
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5 px-2">Saltan en esta pantalla</div>
            <div>
                {tipos.map((t) => (
                    <FilaInterruptor key={t} prendido={!prefs.apagados.includes(t)} onCambio={() => alternar(t)}
                        icono={<span className="w-2.5 h-2.5 rounded-full" style={{ background: FONDO_TIPO[t].fondo }} />} texto={FONDO_TIPO[t].nombre} />
                ))}
            </div>
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mt-3 mb-1.5 px-2 pt-2.5 border-t border-border">Cómo avisan</div>
            <FilaInterruptor prendido={prefs.voz} onCambio={() => cambiarPrefs({ voz: !prefs.voz })} icono={<Speech size={14} />} texto="Leer en voz alta" />
            <FilaInterruptor prendido={!prefs.silencio} onCambio={() => cambiarPrefs({ silencio: !prefs.silencio })} icono={prefs.silencio ? <VolumeX size={14} /> : <Volume2 size={14} />} texto="Sonido" />
            <p className="mt-2 px-2 text-[11px] text-muted-foreground leading-snug">Lista negra e intrusión saltan siempre. Lo apagado acá sigue en Gestión de alarmas. Vale para este navegador.</p>
        </div>
    );
}

/**
 * Un renglón con interruptor (20/10, Nico: «deben ser toggle buttons»): antes era un texto «Sí / No»
 * que no se leía como algo que se toca. Todo el renglón es el blanco; el interruptor dice el estado.
 */
function FilaInterruptor({ prendido, onCambio, icono, texto }: { prendido: boolean; onCambio: () => void; icono: ReactNode; texto: string }) {
    return (
        <label className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[6px] hover:bg-muted cursor-pointer select-none">
            <span className="w-4 grid place-items-center shrink-0 text-muted-foreground">{icono}</span>
            <span className={cn("flex-1 text-[13px]", !prendido && "text-muted-foreground")}>{texto}</span>
            <Switch checked={prendido} onCheckedChange={onCambio} aria-label={texto} className="data-[state=checked]:bg-[var(--accion)]" />
        </label>
    );
}
