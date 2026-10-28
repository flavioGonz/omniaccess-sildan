"use client";
/**
 * «Cuentas de los equipos» en Dispositivos (openspec usuarios-de-equipos, «Controles en el área»).
 *
 * Un botón en la barra de Dispositivos y un cajón lateral. Antes era un panel arriba de la lista
 * de cada área y en «Todas» (28/10, Nico: «ocupa mucha importancia, debe ser algo más tipo
 * drawer»): la lista de equipos es lo que se vino a ver en Dispositivos; las cuentas se revisan
 * de vez en cuando. Cerrado, el botón sólo avisa con un número en su tono cuando hay algo que
 * mirar. Abierto, el cajón sigue la selección del árbol: «Todas» es todo el sitio, un área es su
 * rama, «Sin área» los equipos sueltos.
 *
 * En esta fase sólo lee: el resumen, las cuentas por equipo, quién está conectado y la auditoría.
 * Lo único que cambia es la marca de «conocida», que vive en OmniAccess y no toca el equipo.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    AlertTriangle, ChevronRight, Cpu, Globe, HardDrive, KeyRound, Loader2, Lock, ScanSearch, ScrollText, Server,
    ShieldCheck, ShieldQuestion, UserCheck, UserRound, Users, UserX, Wifi, type LucideIcon,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Chip, Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { Pestanias } from "@/components/ui/pestanias";
import { Seek } from "@/components/ui/search";
import { cn } from "@/lib/utils";
import { hace } from "@/lib/fechas";
import type { EstadoAreas } from "@/app/actions/areas";
import { gestoraDeArea } from "@/lib/usuarios-equipo/areas";
import { CLASES, PROCEDENCIAS, type Clase, type Procedencia } from "@/lib/usuarios-equipo/inventario";
import { ACCION_EQUIPOS } from "@/lib/usuarios-equipo/acciones";
import { useSessionRole } from "@/hooks/useSessionRole";
import { IconoTipo } from "@/components/devices/ArbolAreas";
import { useDatos, type TodasUsuarios, type CuentaVista, type SesionVista } from "@/components/devices/usuarios/datos";
import { MarcarConocida, type QueMarcar } from "@/components/devices/usuarios/MarcarConocida";

type Vista = "cuentas" | "conectados" | "auditoria";
/** «conocida» no es una clase: es una no gestionada que alguien explicó. Se filtra aparte para que el
    número de «No gestionada» sea el mismo que el de la tarjeta de arriba (las que falta revisar). */
type FiltroClase = "todas" | Clase | "conocida";
const pasa = (c: CuentaVista, k: FiltroClase) => k === "todas" || (k === "conocida" ? c.conocida : c.clase === k && !(k === "no-gestionada" && c.conocida));
type Tono = "bien" | "aviso" | "mal" | "info" | "quieto" | "neutro";
type Equipo = TodasUsuarios["equipos"][number];

/** El botón vuelve a mirar cada tanto: el cron lee cada 5 minutos, más seguido no cambia nada. */
const REFRESCO_MS = 5 * 60_000;
const ORDEN_CLASE: Record<Clase, number> = { "no-gestionada": 0, gestionada: 1, servicio: 2, fabrica: 3 };

/** Clases escritas enteras: Tailwind no ve una clase armada con `${tono}`. */
const FONDO_SUAVE: Record<Tono, string> = {
    bien: "bg-[var(--bien-suave)] tono-bien", aviso: "bg-[var(--aviso-suave)] tono-aviso", mal: "bg-[var(--mal-suave)] tono-mal",
    info: "bg-[var(--info-suave)] tono-info", quieto: "bg-[var(--quieto-suave)] tono-quieto", neutro: "bg-muted text-muted-foreground",
};

/** El círculo de color suave con su ícono: identifica de un vistazo sin agregar un color nuevo. */
function Medalla({ icono: I, tono, chica }: { icono: LucideIcon; tono: Tono; chica?: boolean }) {
    return (
        <span className={cn("grid place-items-center rounded-full shrink-0", chica ? "h-7 w-7" : "h-9 w-9",
            FONDO_SUAVE[tono])}>
            <I size={chica ? 13 : 16} />
        </span>
    );
}

export function BotonCuentas({ estado, alcance, onAbrirEquipo, className }: {
    estado: EstadoAreas;
    /** Lo elegido en el árbol: null es «Todas»; el resto, un área con su rama o «Sin área». */
    alcance: { areaId: string | null; nombre: string | null; deviceIds: string[] | null };
    onAbrirEquipo?: (deviceId: string) => void;
    className?: string;
}) {
    const { datos, error, cargando, traer } = useDatos<TodasUsuarios>("/api/devices/usuarios");
    const [abierto, setAbierto] = useState(false);
    useEffect(() => { const t = setInterval(() => void traer(), REFRESCO_MS); return () => clearInterval(t); }, [traer]);

    const ids = useMemo(() => (alcance.deviceIds ? new Set(alcance.deviceIds) : null), [alcance.deviceIds]);
    const equipos = useMemo(() => (datos?.equipos || []).filter((e) => e.soporte && (!ids || ids.has(e.id))), [datos, ids]);
    const porId = useMemo(() => new Map(equipos.map((e) => [e.id, e])), [equipos]);
    const cuentas = useMemo(() => (datos?.cuentas || []).filter((c) => porId.has(c.deviceId) && !c.desaparecida), [datos, porId]);
    const n = {
        cuentas: cuentas.length,
        ajenas: cuentas.filter((c) => c.clase === "no-gestionada" && !c.conocida).length,
        accesos: equipos.reduce((a, e) => a + (e.sesiones.desconocida || 0), 0),
        sinLeer: equipos.filter((e) => e.lectura && (e.lectura.cuentasError || e.lectura.sesionesError)).length,
        leidos: equipos.filter((e) => e.lectura?.cuentasOk).length,
    };
    // El número del botón: los accesos desconocidos primero (rojo), si no las cuentas sin dueño (ámbar).
    const marca = n.accesos ? { n: n.accesos, tono: "mal" as const } : n.ajenas ? { n: n.ajenas, tono: "aviso" as const } : null;
    const resumen = [
        n.ajenas && `${n.ajenas} ${n.ajenas === 1 ? "cuenta no gestionada" : "cuentas no gestionadas"}`,
        n.accesos && `${n.accesos} ${n.accesos === 1 ? "acceso desconocido" : "accesos desconocidos"}`,
        n.sinLeer && `${n.sinLeer} sin leer`,
    ].filter(Boolean).join(" · ") || (n.leidos ? "Todo en orden" : "Sin lecturas todavía");

    return (
        <>
            <Pista titulo="Cuentas de los equipos" texto={`${alcance.nombre || "Todo el sitio"}: ${resumen}.`}>
                <button type="button" onClick={() => { setAbierto(true); void traer(); }} aria-label="Cuentas de los equipos"
                    className={cn("relative h-10 w-10 rounded-xl grid place-items-center border border-border/60 bg-background/70 hover:bg-accent hover:border-border transition-colors", className)}>
                    <KeyRound size={17} className="text-muted-foreground" />
                    {marca && (
                        <span className={cn("absolute -top-1.5 -right-1.5 h-[18px] min-w-[18px] px-1 rounded-full grid place-items-center text-[10px] font-bold tabular-nums ring-2 ring-background", `pleno-${marca.tono}`)}>
                            {marca.n > 99 ? "99+" : marca.n}
                        </span>
                    )}
                </button>
            </Pista>
            <Cajon open={abierto} onOpenChange={setAbierto}>
                {abierto && (
                    <CajonCuentas estado={estado} alcance={alcance} datos={datos} error={error} cargando={cargando} traer={traer}
                        equipos={equipos} cuentas={cuentas} n={n}
                        onAbrirEquipo={onAbrirEquipo ? (id) => { setAbierto(false); onAbrirEquipo(id); } : undefined} />
                )}
            </Cajon>
        </>
    );
}

function CajonCuentas({ estado, alcance, datos, error, cargando, traer, equipos, cuentas, n, onAbrirEquipo }: {
    estado: EstadoAreas;
    alcance: { areaId: string | null; nombre: string | null; deviceIds: string[] | null };
    datos: TodasUsuarios | null; error: string | null; cargando: boolean; traer: (extra?: string) => Promise<void>;
    equipos: Equipo[]; cuentas: CuentaVista[];
    n: { cuentas: number; ajenas: number; accesos: number; sinLeer: number; leidos: number };
    onAbrirEquipo?: (deviceId: string) => void;
}) {
    const { tiene } = useSessionRole();
    const puede = tiene("dispositivos.usuarios");
    const [vista, setVista] = useState<Vista>("cuentas");
    const [clase, setClase] = useState<FiltroClase>("todas");
    const [q, setQ] = useState("");
    const [marcar, setMarcar] = useState<QueMarcar | null>(null);
    const [revisando, setRevisando] = useState(false);
    const porId = useMemo(() => new Map(equipos.map((e) => [e.id, e])), [equipos]);
    const nombreArea = (id: string) => estado.areas.find((a) => a.id === estado.equipos[id])?.nombre || "Sin área";
    const gestora = alcance.areaId ? gestoraDeArea(estado, alcance.areaId) : null;
    const ultima = equipos.map((e) => e.lectura?.cuentasAt).filter(Boolean).sort().pop();

    const revisar = async () => {
        setRevisando(true);
        try {
            const r = await fetch("/api/devices/usuarios/revisar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceIds: equipos.map((e) => e.id) }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.ok) throw new Error(j.error || `Error ${r.status}`);
            toast.success({ title: `Revisados ${j.equipos} ${j.equipos === 1 ? "equipo" : "equipos"}`, description: j.errores ? `${j.errores} no contestaron: se muestra lo último leído.` : undefined });
            await traer();
        } catch (e: any) {
            toast.error({ title: "No se pudo revisar", description: e?.message });
        } finally { setRevisando(false); }
    };

    const tiles: { clave: string; rotulo: string; valor: number; icono: LucideIcon; tono: Tono; ir?: () => void; ayuda: string }[] = [
        { clave: "cuentas", rotulo: "Cuentas", valor: n.cuentas, icono: Users, tono: "info", ir: () => { setVista("cuentas"); setClase("todas"); }, ayuda: `En ${equipos.length} ${equipos.length === 1 ? "equipo" : "equipos"} Hikvision.` },
        { clave: "ajenas", rotulo: "No gestionadas", valor: n.ajenas, icono: UserX, tono: n.ajenas ? "aviso" : "neutro", ir: () => { setVista("cuentas"); setClase("no-gestionada"); }, ayuda: "Creadas en el equipo, fuera de OmniAccess, y que nadie marcó como conocidas." },
        { clave: "accesos", rotulo: "Accesos desconocidos", valor: n.accesos, icono: Globe, tono: n.accesos ? "mal" : "neutro", ir: () => setVista("conectados"), ayuda: "Sesiones abiertas ahora desde una IP que no es OmniAccess, un grabador, otro equipo ni una IP conocida." },
        { clave: "sinLeer", rotulo: "Sin leer", valor: n.sinLeer, icono: AlertTriangle, tono: n.sinLeer ? "aviso" : "neutro", ayuda: "La última lectura falló. Se muestra lo último leído; el motivo está en la ficha de cada equipo." },
    ];

    const encabezado = (
        <div className="px-6 py-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {tiles.map((t) => (
                    <Pista key={t.clave} texto={t.ayuda}>
                        <button type="button" onClick={t.ir} disabled={!t.ir}
                            className={cn("w-full h-full flex rounded-[10px] border border-border bg-card px-3 py-2.5 text-left transition-colors",
                                t.ir && "hover:border-[color-mix(in_oklab,var(--accion)_45%,var(--border))]")}>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-start justify-between gap-2">
                                    <span className={cn("text-[22px] leading-none font-bold tabular-nums tracking-[-0.01em]", t.tono !== "neutro" && t.clave !== "cuentas" && `tono-${t.tono}`)}>{t.valor}</span>
                                    <Medalla icono={t.icono} tono={t.tono} chica />
                                </span>
                                <span className="block mt-1.5 text-[11.5px] text-muted-foreground leading-tight">{t.rotulo}</span>
                            </span>
                        </button>
                    </Pista>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Pestanias<Vista> valor={vista} alElegir={setVista} opciones={[
                    { valor: "cuentas", rotulo: "Cuentas", icono: Users, cuenta: n.cuentas },
                    { valor: "conectados", rotulo: "Conectados", icono: Wifi, ...(n.accesos ? { cuenta: n.accesos, tono: "mal" as const } : {}) },
                    { valor: "auditoria", rotulo: "Auditoría", icono: ScrollText },
                ]} />
                <div className="ml-auto flex items-center gap-2">
                    {alcance.areaId && (gestora?.gestionada
                        ? <Pista texto={gestora.heredada ? `Hereda la gestión de «${gestora.decide?.nombre}».` : "Esta área gestiona las cuentas de sus equipos."}><Chip tono="bien" icono={ShieldCheck}>Gestionada{gestora.heredada ? " · heredada" : ""}</Chip></Pista>
                        : <Pista texto="Las cuentas de esta área sólo se leen. La gestión por área llega con las altas y bajas."><Chip tono="neutro" icono={Lock}>Sólo lectura</Chip></Pista>)}
                    {puede && equipos.length > 0 && (
                        <Pista texto="Lee ya las cuentas y las sesiones de estos equipos. Sólo consulta: no cambia nada en ellos.">
                            <Button size="sm" onClick={revisar} disabled={revisando}>
                                {revisando ? <Loader2 className="animate-spin" /> : <ScanSearch />}Revisar
                            </Button>
                        </Pista>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <CajonContenido ancho="medio" titulo="Cuentas de los equipos"
            descripcion={`${alcance.nombre || "Todo el sitio"} · ${equipos.length} ${equipos.length === 1 ? "equipo compatible" : "equipos compatibles"}${ultima ? ` · leídas ${hace(ultima)}` : ""}`}
            encabezado={encabezado}>
            <div className="px-6 py-5">
                {cargando && !datos ? <Cargando texto="Leyendo las cuentas…" />
                    : error && !datos ? <ErrorEstado mensaje={error} alReintentar={() => traer()} />
                        : (
                            <AnimatePresence mode="wait" initial={false}>
                                <motion.div key={vista} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}>
                                    {vista === "cuentas" && <PorEquipo equipos={equipos} cuentas={cuentas} clase={clase} setClase={setClase} q={q} setQ={setQ}
                                        conArea={!alcance.areaId} nombreArea={nombreArea} puede={puede} onAbrirEquipo={onAbrirEquipo}
                                        alMarcar={(c) => setMarcar({ tipo: "cuenta", cuentaId: c.id, nombre: c.nombre, equipo: porId.get(c.deviceId)?.name || "el equipo" })} />}
                                    {vista === "conectados" && <Conectados deviceIds={equipos.map((e) => e.id)} nombreDe={(id) => porId.get(id)?.name || "Equipo dado de baja"} puede={puede} alMarcar={setMarcar} />}
                                    {vista === "auditoria" && <Auditoria deviceIds={alcance.deviceIds ? equipos.map((e) => e.id) : null} />}
                                </motion.div>
                            </AnimatePresence>
                        )}
            </div>
            <MarcarConocida que={marcar} onCerrar={() => setMarcar(null)} onHecho={() => traer()} />
        </CajonContenido>
    );
}

/* ── Cuentas: agrupadas por equipo, que es como se piensan («¿quién entra a este NVR?») ── */

function PorEquipo({ equipos, cuentas, clase, setClase, q, setQ, conArea, nombreArea, puede, onAbrirEquipo, alMarcar }: {
    equipos: Equipo[]; cuentas: CuentaVista[]; clase: FiltroClase; setClase: (c: FiltroClase) => void; q: string; setQ: (v: string) => void;
    conArea: boolean; nombreArea: (id: string) => string; puede: boolean; onAbrirEquipo?: (id: string) => void; alMarcar: (c: CuentaVista) => void;
}) {
    const cuentaPorClase = (k: FiltroClase) => cuentas.filter((c) => pasa(c, k)).length;
    const t = q.trim().toLowerCase();
    const grupos = equipos
        .map((e) => ({
            e,
            filas: cuentas.filter((c) => c.deviceId === e.id && pasa(c, clase)
                && (!t || `${c.nombre} ${e.name} ${e.ip}`.toLowerCase().includes(t)))
                .sort((a, b) => ORDEN_CLASE[a.clase] - ORDEN_CLASE[b.clase] || a.nombre.localeCompare(b.nombre)),
        }))
        .filter((g) => g.filas.length || (clase === "todas" && !t && !g.e.lectura?.cuentasOk))
        // Primero lo que pide atención: cuentas sin dueño, después lo que no se pudo leer.
        .sort((a, b) => peso(b) - peso(a) || a.e.name.localeCompare(b.e.name));

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                    {(["todas", "no-gestionada", "conocida", "gestionada", "servicio", "fabrica"] as FiltroClase[]).map((k) => {
                        const cant = cuentaPorClase(k);
                        // Un filtro que no deja nada es ruido: se muestra sólo si hay algo o si es el elegido.
                        if (!cant && k !== "todas" && k !== clase) return null;
                        return (
                            <button key={k} type="button" onClick={() => setClase(k)}
                                className={cn("h-7 pl-2.5 pr-2 rounded-full border text-[11.5px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                                    clase === k ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border text-muted-foreground hover:bg-muted")}>
                                {k === "todas" ? "Todas" : k === "conocida" ? "Conocida" : CLASES[k].rotulo}
                                <span className="tabular-nums opacity-70">{cant}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="ml-auto"><Seek value={q} onChange={setQ} placeholder="Cuenta, equipo o IP" startOpen width={200} alto={34} /></div>
            </div>

            {!grupos.length ? (
                <Vacio icono={ShieldQuestion} titulo={cuentas.length ? "Ninguna cuenta con ese filtro" : "Todavía no hay cuentas leídas"}
                    ayuda={cuentas.length ? undefined : "La lectura automática corre cada 5 minutos; las cuentas se leen una vez por hora. «Revisar» no espera."} />
            ) : (
                <div className="space-y-3">
                    {grupos.map(({ e, filas }) => (
                        <section key={e.id} className="rounded-[10px] border border-border bg-card overflow-hidden">
                            <button type="button" onClick={onAbrirEquipo ? () => onAbrirEquipo(e.id) : undefined} disabled={!onAbrirEquipo}
                                className="w-full flex items-center gap-3 px-3.5 py-2.5 bg-muted/40 border-b border-border text-left group">
                                <span className="h-8 w-8 rounded-[8px] bg-background border border-border grid place-items-center shrink-0">
                                    {e.deviceType ? <IconoTipo tipo={e.deviceType} size={15} /> : <Cpu size={15} />}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[13px] font-bold truncate">{e.name}</span>
                                    <span className="block text-[11px] text-muted-foreground tabular-nums truncate">{e.ip}{conArea ? ` · ${nombreArea(e.id)}` : ""}</span>
                                </span>
                                <EstadoLectura e={e} />
                                {e.soloLectura && <Pista texto="Este servidor sólo puede leer este equipo. Las cuentas se cambian desde el servidor de ese sitio."><Lock size={13} className="text-muted-foreground shrink-0" /></Pista>}
                                {onAbrirEquipo && <ChevronRight size={15} className="text-muted-foreground/60 group-hover:text-foreground transition-colors shrink-0" />}
                            </button>
                            {filas.length ? (
                                <ul className="divide-y divide-border">
                                    {filas.map((c) => <FilaCuenta key={c.id} c={c} puede={puede} alMarcar={() => alMarcar(c)} />)}
                                </ul>
                            ) : (
                                <p className="px-3.5 py-3 text-[12px] text-muted-foreground">Sin cuentas leídas todavía.</p>
                            )}
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}

const peso = (g: { e: Equipo; filas: CuentaVista[] }) =>
    g.filas.filter((c) => c.clase === "no-gestionada" && !c.conocida).length * 10 + (g.e.lectura?.cuentasError ? 5 : 0) + (g.e.sesiones.desconocida || 0) * 20;

function EstadoLectura({ e }: { e: Equipo }) {
    const l = e.lectura;
    if (l?.cuentasError) return <Pista titulo="No se pudo leer" texto={`${l.cuentasError} Se muestra lo último leído.`}><Chip tono="aviso" icono={AlertTriangle}>Sin leer</Chip></Pista>;
    if (!l?.cuentasAt) return <Chip tono="neutro">Nunca leído</Chip>;
    return <span className="text-[11px] text-muted-foreground whitespace-nowrap">{hace(l.cuentasAt)}</span>;
}

const ICONO_CLASE: Record<Clase, LucideIcon> = { servicio: Server, fabrica: KeyRound, gestionada: UserCheck, "no-gestionada": UserX };

function FilaCuenta({ c, puede, alMarcar }: { c: CuentaVista; puede: boolean; alMarcar: () => void }) {
    const k = CLASES[c.clase];
    const tono: Tono = c.clase === "no-gestionada" && c.conocida ? "bien" : k.tono;
    return (
        <li className="flex items-center gap-3 px-3.5 py-2.5 group/fila">
            <Medalla icono={c.clase === "no-gestionada" && c.conocida ? ShieldCheck : ICONO_CLASE[c.clase] || UserRound} tono={tono} chica />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-semibold truncate">{c.nombre}</span>
                    {c.idEquipo && <span className="text-[10.5px] text-muted-foreground tabular-nums">id {c.idEquipo}</span>}
                </span>
                <span className="block text-[11.5px] text-muted-foreground truncate">
                    {c.nivel || "Sin nivel"}
                    {c.conocida && c.conocidaMotivo ? ` · ${c.conocidaMotivo}` : ""}
                    {c.conocida && c.conocidaPor ? ` · marcó ${c.conocidaPor}` : ""}
                </span>
            </span>
            <Pista texto={k.ayuda}><Chip tono={c.conocida ? "bien" : k.tono}>{c.conocida ? "Conocida" : k.rotulo}</Chip></Pista>
            {c.clase === "no-gestionada" && !c.conocida && puede && (
                <Button variant="outline" size="sm" onClick={alMarcar}><ShieldCheck />Es conocida</Button>
            )}
        </li>
    );
}

/* ── Conectados: quién está adentro ahora y desde dónde ── */

const ICONO_PROC: Record<Procedencia, LucideIcon> = { servidor: Server, grabador: HardDrive, equipo: Cpu, conocida: ShieldCheck, desconocida: Globe };

function Conectados({ deviceIds, nombreDe, puede, alMarcar }: { deviceIds: string[]; nombreDe: (id: string) => string; puede: boolean; alMarcar: (q: QueMarcar) => void }) {
    const url = deviceIds.length ? `/api/devices/usuarios/sesiones?abiertas=1&deviceId=${deviceIds.join(",")}` : null;
    const { datos, error, cargando, traer } = useDatos<{ sesiones: SesionVista[] }>(url);
    if (cargando && !datos) return <Cargando texto="Mirando quién está conectado…" />;
    if (error && !datos) return <ErrorEstado mensaje={error} alReintentar={() => traer()} />;
    const filas = [...(datos?.sesiones || [])].sort((a, b) => Number(b.procedencia === "desconocida") - Number(a.procedencia === "desconocida") || b.vistaPrimera.localeCompare(a.vistaPrimera));
    if (!filas.length) return <Vacio icono={Wifi} titulo="Nadie conectado en la última lectura" ayuda="Las sesiones se miran cada 5 minutos: una entrada más corta puede no verse." />;
    return (
        <div className="space-y-2">
            <ul className="rounded-[10px] border border-border bg-card divide-y divide-border overflow-hidden">
                {filas.map((s) => {
                    const proc = (PROCEDENCIAS[s.procedencia as Procedencia] ? s.procedencia : "desconocida") as Procedencia;
                    const p = PROCEDENCIAS[proc];
                    return (
                        <li key={s.id} className={cn("flex items-center gap-3 px-3.5 py-2.5", proc === "desconocida" && "bg-[color-mix(in_oklab,var(--mal-suave)_45%,transparent)]")}>
                            <Medalla icono={ICONO_PROC[proc]} tono={p.tono} chica />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-1.5 min-w-0">
                                    <span className="text-[13px] font-semibold">{s.nombre}</span>
                                    <span className="text-[11.5px] text-muted-foreground">desde</span>
                                    <span className="text-[13px] font-semibold tabular-nums">{s.ip}</span>
                                </span>
                                <span className="block text-[11.5px] text-muted-foreground truncate">en {nombreDe(s.deviceId)} · {hace(s.vistaPrimera)}</span>
                            </span>
                            <Chip tono={p.tono}>{s.origenNombre && proc !== "servidor" ? s.origenNombre : p.rotulo}</Chip>
                            {proc === "desconocida" && puede && (
                                <Button variant="outline" size="sm" onClick={() => alMarcar({ tipo: "ip", ip: s.ip, cuenta: s.nombre, equipo: nombreDe(s.deviceId) })}><ShieldCheck />Es conocida</Button>
                            )}
                        </li>
                    );
                })}
            </ul>
            <p className="text-[11px] text-muted-foreground">Se mira cada 5 minutos: una entrada más corta puede no verse.</p>
        </div>
    );
}

/* ── Auditoría: una línea de tiempo, que es como se lee una historia ── */

type FilaAuditoria = { id: string; cuando: string; quien: string; accion: string; objetivo: string; detalle: string | null };

/** El tono de cada renglón sale de lo que cuenta, no de quién lo hizo. */
const TONO_ACCION: Record<string, Tono> = {
    [ACCION_EQUIPOS.CUENTA_NUEVA]: "aviso",
    [ACCION_EQUIPOS.CUENTA_YA_NO_ESTA]: "neutro",
    [ACCION_EQUIPOS.SESION_DESCONOCIDA]: "mal",
    [ACCION_EQUIPOS.CUENTA_CONOCIDA]: "bien",
    [ACCION_EQUIPOS.IP_CONOCIDA]: "bien",
    [ACCION_EQUIPOS.CUENTA_NO_CONOCIDA]: "neutro",
    [ACCION_EQUIPOS.IP_NO_CONOCIDA]: "neutro",
};
const tonoAccion = (accion: string): Tono => TONO_ACCION[accion] || "info";

function Auditoria({ deviceIds }: { deviceIds: string[] | null }) {
    const url = deviceIds && !deviceIds.length ? null : `/api/devices/usuarios/auditoria?dias=30${deviceIds ? `&deviceId=${deviceIds.join(",")}` : ""}`;
    const { datos, error, cargando, traer } = useDatos<{ filas: FilaAuditoria[] }>(url);
    if (cargando && !datos) return <Cargando texto="Leyendo la auditoría…" />;
    if (error && !datos) return <ErrorEstado mensaje={error} alReintentar={() => traer()} />;
    const filas = datos?.filas || [];
    if (!filas.length) return <Vacio icono={ScrollText} titulo="Nada en los últimos 30 días" ayuda="Acá quedan las cuentas nuevas o que se fueron, los accesos desde IP desconocidas y quién marcó qué como conocido." />;
    return (
        <ol className="relative pl-6">
            <span aria-hidden className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
            {filas.map((f) => {
                const tono = tonoAccion(f.accion);
                return (
                    <li key={f.id} className="relative pb-4 last:pb-0">
                        <span aria-hidden className={cn("absolute -left-6 top-1 h-[15px] w-[15px] rounded-full ring-4 ring-background",
                            tono === "neutro" ? "bg-muted-foreground/40" : `pleno-${tono}`)} />
                        <div className="flex items-baseline gap-2">
                            <span className="text-[13px] font-semibold">{f.accion}</span>
                            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{hace(f.cuando)}</span>
                        </div>
                        <p className="text-[12px] text-muted-foreground">
                            <span className="text-foreground/85">{f.objetivo}</span>{f.detalle ? ` · ${f.detalle}` : ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground/80">{f.quien}</p>
                    </li>
                );
            })}
        </ol>
    );
}
