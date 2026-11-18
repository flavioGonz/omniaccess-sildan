"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
    AlertTriangle, CreditCard, DoorOpen, Fingerprint, KeyRound, Radio, ScanFace, Search, ShieldCheck, Wifi,
} from "lucide-react";
import { bitacoraEquipos, type BitacoraEquipos, type EquipoDeAcceso, type PasoEquipo } from "@/app/actions/bitacora-equipos";
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { getImagePath } from "@/lib/image-path";
import { hora, fecha } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Bitácora de equipos: quién pasó por cada portero y control de acceso.
 *
 * Pedido de Nico (18/11): una sección propia que concentre «las lecturas en vivo [y el] historial
 * de lectura de porteros y controles de acceso», con un enfoque distinto al de las demás
 * pantallas.
 *
 * Por qué no es otra tabla. En el Historial el sujeto es la matrícula y una tabla le queda bien:
 * se compara fila contra fila. Acá el sujeto es UNA PERSONA frente a UNA PUERTA, y lo que se
 * viene a mirar es su cara: ponerla en una celda de 48 px la vuelve un adorno de la fila. Así que
 * la pantalla es una TIRA DE PASADAS —la cara grande, la hora, la puerta— y, al lado, la pasada
 * elegida en grande con todo lo que se sabe de ella. La regla de la casa, «la captura es el
 * producto», acá es literal.
 *
 * Y se dice siempre QUIÉN contó cada pasada: el equipo (que sabe a quién reconoció y con qué
 * credencial) o nosotros (que sabemos qué cara vimos y cuánto se parecía). De dónde sale un dato
 * es parte del dato, sobre todo mientras las dos integraciones no estén completas.
 */

/** Cada cuánto se vuelve a pedir con la pantalla abierta: las pasadas entran solas. */
const REFRESCO_MS = 12_000;
const DIAS = [1, 7, 30];

const ICONO_TIPO: Record<string, typeof ScanFace> = { FACE: ScanFace, TAG: CreditCard, PIN: KeyRound, FINGERPRINT: Fingerprint };
const NOMBRE_TIPO: Record<string, string> = { FACE: "Rostro", TAG: "Tarjeta", PIN: "Clave", FINGERPRINT: "Huella" };
const ICONO_EQUIPO: Record<string, typeof DoorOpen> = { DOOR_INTERCOM: DoorOpen, ACCESS_CONTROL: KeyRound, FACE_TERMINAL: ScanFace };

const hace = (iso: string) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? "recién" : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};

export function VistaBitacoraEquipos() {
    const [dias, setDias] = useState(7);
    const [equipo, setEquipo] = useState<string>("");
    const [q, setQ] = useState("");
    const [datos, setDatos] = useState<BitacoraEquipos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [elegido, setElegido] = useState<string | null>(null);
    /** Las pasadas que entraron desde la última vuelta: se marcan un momento al llegar. */
    const nuevas = useRef<Set<string>>(new Set());
    const vistos = useRef<Set<string>>(new Set());

    const cargar = useCallback(async () => {
        try {
            const d = await bitacoraEquipos({ dias, deviceId: equipo || null, q });
            nuevas.current = new Set(d.pasos.filter((p) => !vistos.current.has(p.id)).map((p) => p.id));
            if (vistos.current.size === 0) nuevas.current = new Set();   // la primera vez no «entra» nada
            for (const p of d.pasos) vistos.current.add(p.id);
            setDatos(d); setError(null);
        } catch (e: unknown) { setError(e instanceof Error ? e.message : "No se pudo traer la bitácora"); }
    }, [dias, equipo, q]);

    useEffect(() => {
        const t = setTimeout(cargar, q ? 250 : 0);
        const i = setInterval(cargar, REFRESCO_MS);
        return () => { clearTimeout(t); clearInterval(i); };
    }, [cargar, q]);

    const sel = useMemo(() => datos?.pasos.find((p) => p.id === elegido) || datos?.pasos[0] || null, [datos, elegido]);
    const porDia = useMemo(() => {
        const g = new Map<string, PasoEquipo[]>();
        for (const p of datos?.pasos || []) {
            const k = p.cuando.slice(0, 10);
            if (!g.has(k)) g.set(k, []);
            g.get(k)!.push(p);
        }
        return [...g.entries()];
    }, [datos]);

    if (error && !datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo las pasadas…" /></div>;

    return (
        <div className="relative h-full flex flex-col overflow-hidden bg-background">
            {/* Cabecera: qué es esto, y el estado de cada equipo de un vistazo. */}
            <header className="px-8 py-6 border-b border-border bg-card/40 backdrop-blur-md">
                <div className="flex items-start gap-3 flex-wrap">
                    <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><DoorOpen size={18} strokeWidth={2.3} /></span>
                    <div className="min-w-0 flex-1">
                        <h1 className="text-[17px] font-bold leading-tight">Bitácora de equipos</h1>
                        <p className="text-[12px] text-muted-foreground leading-snug">
                            Quién pasó por cada portero y control de acceso. Lo que contó el equipo y lo que vio OmniVision, en el mismo renglón de tiempo.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, tarjeta o legajo"
                                className="h-[34px] w-[220px] pl-8 pr-3 rounded-md border border-border bg-card text-[12.5px] outline-none focus:ring-2 focus:ring-[var(--accion)]/40" />
                        </label>
                        <div className="inline-flex items-center rounded-md border border-border overflow-hidden">
                            {DIAS.map((d) => (
                                <button key={d} type="button" onClick={() => setDias(d)}
                                    className={cn("h-[34px] px-3 text-[12.5px] font-semibold transition-colors", dias === d ? "bg-foreground text-background" : "hover:bg-accent")}>
                                    {d === 1 ? "Hoy" : `${d} d`}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-4 grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(248px,1fr))]">
                    {datos.equipos.map((e) => <TarjetaEquipo key={e.id} e={e} activo={equipo === e.id} alElegir={() => setEquipo(equipo === e.id ? "" : e.id)} />)}
                </div>
            </header>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
                {/* La tira de pasadas, agrupada por día. */}
                <div className="min-h-0 overflow-y-auto px-8 py-5">
                    {datos.pasos.length === 0 ? (
                        <Vacio icono={DoorOpen} titulo="Ninguna pasada en este período"
                            ayuda="Un portero cuenta sus pasadas cuando se lo escucha (hay que apuntarle los avisos a OmniAccess) y un control de acceso cuando se le trae la bitácora desde su ficha. OmniVision suma las suyas si le está mirando el video." />
                    ) : porDia.map(([dia, lista]) => (
                        <section key={dia} className="mb-6">
                            <h2 className="sticky top-0 z-10 -mx-2 px-2 py-1.5 bg-background/85 backdrop-blur-sm text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                {fecha(dia)} · <span className="tabular-nums">{lista.length}</span> {lista.length === 1 ? "pasada" : "pasadas"}
                            </h2>
                            <ul className="mt-1.5 space-y-1.5">
                                <AnimatePresence initial={false}>
                                    {lista.map((p) => (
                                        <motion.li key={p.id}
                                            initial={nuevas.current.has(p.id) ? { opacity: 0, y: -8 } : false}
                                            animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut" }}>
                                            <FilaPaso p={p} activo={sel?.id === p.id} nueva={nuevas.current.has(p.id)} alElegir={() => setElegido(p.id)} />
                                        </motion.li>
                                    ))}
                                </AnimatePresence>
                            </ul>
                        </section>
                    ))}
                </div>

                {/* La pasada elegida, en grande. */}
                <aside className="hidden lg:block min-h-0 overflow-y-auto border-l border-border bg-card/30">
                    {sel ? <Detalle p={sel} /> : <div className="p-8 text-[12.5px] text-muted-foreground">Elegí una pasada para verla.</div>}
                </aside>
            </div>
        </div>
    );
}

/** Un equipo: su estado y cuántas pasadas contó cada lado. Tocarlo filtra la tira. */
function TarjetaEquipo({ e, activo, alElegir }: { e: EquipoDeAcceso; activo: boolean; alElegir: () => void }) {
    const Ico = ICONO_EQUIPO[e.tipo] || DoorOpen;
    return (
        <button type="button" onClick={alElegir}
            className={cn("text-left rounded-[10px] border px-3 py-2.5 transition-colors", activo ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "border-border bg-card hover:bg-accent/50")}>
            <div className="flex items-center gap-2">
                <Ico size={15} className="shrink-0 text-muted-foreground" />
                <span className="font-bold text-[13px] truncate flex-1">{e.nombre}</span>
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{e.hoy} hoy</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <span className="font-mono">{e.ip}</span>
                {e.ultima && <span>· {hace(e.ultima)}</span>}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                <span className={cn("inline-flex items-center gap-1 h-[18px] px-1.5 rounded", e.delEquipo ? "chip-bien" : "chip-quieto")}>
                    <Radio size={10} /> {e.delEquipo ? `${e.delEquipo} del equipo` : "no lo cuenta"}
                </span>
                <span className={cn("inline-flex items-center gap-1 h-[18px] px-1.5 rounded", e.propias ? "chip-info" : "chip-quieto")}>
                    <ScanFace size={10} /> {e.propias ? `${e.propias} nuestras` : "sin mirar"}
                </span>
            </div>
        </button>
    );
}

/** Una pasada en la tira: la cara manda, al lado la hora, la puerta y quién la contó. */
function FilaPaso({ p, activo, nueva, alElegir }: { p: PasoEquipo; activo: boolean; nueva: boolean; alElegir: () => void }) {
    const Ico = (p.tipo && ICONO_TIPO[p.tipo]) || ScanFace;
    const foto = p.cara || p.foto || "";
    const negada = p.decision === "DENY";
    return (
        <button type="button" onClick={alElegir}
            className={cn("w-full text-left flex items-center gap-3 rounded-[10px] border px-2.5 py-2 transition-colors",
                activo ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "border-transparent hover:bg-accent/50",
                nueva && !activo && "border-[var(--bien)]/40")}>
            <span className="relative shrink-0">
                {foto
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={getImagePath(foto) || ""} alt="" className="h-14 w-14 rounded-[8px] object-cover bg-muted [box-shadow:var(--sombra-captura)]" />
                    : <span className="h-14 w-14 rounded-[8px] grid place-items-center bg-muted text-muted-foreground"><Ico size={18} /></span>}
                {negada && <span className="absolute -right-1 -top-1 h-[18px] w-[18px] rounded-full pleno-mal grid place-items-center"><AlertTriangle size={11} /></span>}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                    <span className={cn("text-[13.5px] font-bold truncate", !p.persona && "text-muted-foreground italic font-semibold")}>{p.persona || "Sin identificar"}</span>
                    {p.registrado && <ShieldCheck size={13} className="tono-bien shrink-0" />}
                </span>
                <span className="block text-[11.5px] text-muted-foreground truncate">
                    {p.equipo}{p.tipo ? ` · ${NOMBRE_TIPO[p.tipo] || p.tipo}` : ""}{p.credencial ? ` · ${p.credencial}` : ""}
                </span>
            </span>
            <span className="shrink-0 text-right">
                <span className="block text-[12.5px] font-semibold tabular-nums">{hora(p.cuando)}</span>
                <span className={cn("block text-[10px] font-bold uppercase tracking-wider", p.fuente === "equipo" ? "text-muted-foreground" : "text-[var(--accion)]")}>
                    {p.fuente === "equipo" ? "equipo" : "omnivision"}
                </span>
            </span>
        </button>
    );
}

/** La pasada elegida: la foto grande y todo lo que se sabe, diciendo de dónde sale cada cosa. */
function Detalle({ p }: { p: PasoEquipo }) {
    const foto = p.cara || p.foto || "";
    return (
        <div className="p-5 space-y-4">
            {foto && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={getImagePath(foto) || ""} alt="" className="w-full rounded-[10px] object-cover bg-black [box-shadow:var(--sombra-captura)]" />
            )}
            <div>
                <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{p.fuente === "equipo" ? "Lo contó el equipo" : "Lo vio OmniVision"}</div>
                <h2 className="mt-0.5 text-[20px] font-bold leading-tight">{p.persona || "Sin identificar"}</h2>
                <p className="text-[12.5px] text-muted-foreground">{fecha(p.cuando)} · {hora(p.cuando)}</p>
            </div>
            <dl className="rounded-[10px] border border-border divide-y divide-border">
                <Dato k="Equipo" v={p.equipo} />
                <Dato k="Con qué" v={p.tipo ? NOMBRE_TIPO[p.tipo] || p.tipo : null} />
                <Dato k="Credencial" v={p.credencial} />
                <Dato k="Decisión" v={p.decision === "GRANT" ? "Permitido" : p.decision === "DENY" ? "Negado" : p.decision} tono={p.decision === "DENY" ? "mal" : p.decision === "GRANT" ? "bien" : undefined} />
                <Dato k="Sentido" v={p.sentido === "ENTRY" ? "Entrada" : p.sentido === "EXIT" ? "Salida" : p.sentido} />
                <Dato k="Parecido" v={p.similitud != null ? `${p.similitud} %` : null} />
                <Dato k="En el padrón" v={p.registrado ? "Sí" : "No figura"} tono={p.registrado ? "bien" : undefined} />
            </dl>
            {p.detalle && (
                <details className="text-[11.5px] text-muted-foreground">
                    <summary className="cursor-pointer font-semibold">Lo que escribió el equipo</summary>
                    <p className="mt-1.5 break-words font-mono leading-snug">{p.detalle}</p>
                </details>
            )}
            <Link href={`/admin/history`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--accion)] hover:underline">
                <Wifi size={13} /> Ver en el historial
            </Link>
        </div>
    );
}

function Dato({ k, v, tono }: { k: string; v: string | null | undefined; tono?: "bien" | "mal" }) {
    return (
        <div className="flex items-baseline gap-3 px-3 py-1.5 text-[12.5px]">
            <dt className="w-[96px] shrink-0 text-muted-foreground">{k}</dt>
            <dd className={cn("min-w-0 font-semibold", !v && "text-muted-foreground/60 italic font-normal", tono === "bien" && "tono-bien", tono === "mal" && "tono-mal")}>{v || "—"}</dd>
        </div>
    );
}
