"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Tooltip } from "react-tooltip";
import {
    Camera, Radar, HardDrive, Network, MapPin, Rocket, ScanSearch, Loader2, Check, X, AlertTriangle, Info,
    LogIn, LogOut, KeyRound, User, Cpu, Fingerprint, Clock, BellRing, ScanLine, Film, Video, ListChecks, Server,
    ChevronRight, ChevronLeft, Tag, Hash, Type, Plug, Car, Ban, Link2, Save, Crosshair, Download, Activity, ShieldCheck, Users, Sparkles,
    FolderTree, Plus,
} from "lucide-react";
import { leerAreas, crearArea, type Area } from "@/app/actions/areas";
import { guardarGrupo } from "@/app/actions/groups";
import { leerDestinoEventos, guardarDestinoEventos } from "@/app/actions/destino-eventos";
import { Cajon, CajonContenido, CajonCerrar } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarraDePasos, PasoAnimado } from "@/components/devices/Pasos";
import { createDevice, updateDevice, probeDeviceInfo, getDevices, detectarCapacidades, detectarCapacidadesCanales, getCredencialesDispositivo } from "@/app/actions/devices";
import { ChipsCapacidades } from "@/components/devices/Capacidades";
import type { Capacidades } from "@/lib/capacidades-camara";
import { consecuencias as consecuenciasTipo } from "@/lib/rol-camara";
import { provisionLprDevice } from "@/app/actions/provision";
import { getNvrList, getNvrChannels, getNvrChannelInfo, importarCanalesClasificados, type RolImport } from "@/app/actions/nvr";
import { dondeGraba, asignarGrabacion, calcularRetencion, retencionGuardada } from "@/app/actions/grabaciones";
import { CabeceraNvr } from "@/components/devices/CabeceraNvr";
import { ControlesLente, LecturasEnVivo } from "@/components/devices/LenteYLecturas";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { ElegirModoIntrusion, ElegirModoLpr, ModoEnFila, OPCIONES_INTRUSION_FILA, OPCIONES_LPR_FILA } from "@/components/devices/ModoCamara";
import { ponerModoCamara } from "@/app/actions/modo-camara";
import { rolesDeCamaras } from "@/app/actions/roles-camaras";
import { MODOS_INTRUSION, MODOS_LPR, modoIntrusionDe, modoLprDe, type ModoIntrusion, type ModoLpr } from "@/lib/modo-camara";

/**
 * Alta y edición de equipos en un único cajón, como en San Nicolás.
 *
 * Alta: lo primero es QUÉ se agrega (cámara LPR, cámara de intrusión o NVR), porque eso decide
 * los pasos que siguen. Cada tipo tiene su recorrido y termina en una puesta a punto que corre a
 * la vista (hora, servidor de alarmas, video, grabación, retención, importación de canales).
 *
 * Edición (reemplaza al viejo modal «Sincronizar Nodo»): una sola hoja con todo a la vista —
 * estado del equipo, identidad, conexión, sentido y grabación— y un único «Guardar cambios».
 */

type Tipo = "LPR_CAMERA" | "CAMERA" | "NVR";
type Marca = "HIKVISION" | "DAHUA";
type Estado = "espera" | "corriendo" | "ok" | "error" | "salteado";
type Tarea = { clave: string; titulo: string; ayuda: string; icono: any; estado: Estado; detalle?: string };
/** Una cámara del NVR mientras se importa: el avance de cada una a la vista (21/10). */
type FilaImport = { channel: number; name: string; rol: "lpr" | "intrusion" | "vincular"; estado: Estado; detalle?: string;
    /** El equipo creado o vinculado, y el error de su servidor de alarmas si falló (para reintentarlo). */
    id?: string; alarma?: string | null; base?: string };
type Ubic = { nvrId: string | null; nvrNombre: string | null; ch: number; canalNombre?: string | null };
type Canal = { channel: number; ip: string | null; name: string; model?: string | null; marca: string; protocolo?: string | null; sensorDe?: number | null; existente: { id: string; name: string; tipo: string } | null };

/** El tooltip de las piezas de la ficha (Etiqueta, Bloque, Opcion): quien las use dibuja un <Tooltip id={TT_FICHA}>. */
export const TT_FICHA = "tt-cajon-disp";
const TT = TT_FICHA;
const tip = (texto: string) => ({ "data-tooltip-id": TT, "data-tooltip-content": texto });
const ES_LPR = /\b(lpr|anpr)\b|matr[ií]cula|patente|entrada|salida|acceso|barrera/i;

const TIPOS: { valor: Tipo; rotulo: string; que: string; icono: any; color: string; ejemplo: string }[] = [
    { valor: "LPR_CAMERA", rotulo: "Cámara LPR", icono: Car, color: "text-amber-500 bg-amber-500/10 border-amber-500/30",
        que: "Lee matrículas en una garita, decide si se abre y prende el semáforo con su relé.",
        ejemplo: "Ej.: «P1 - Entrada (207)», una Hikvision iDS-TCM403 apuntando al carril de entrada." },
    { valor: "CAMERA", rotulo: "Cámara de intrusión", icono: Radar, color: "text-red-500 bg-red-500/10 border-red-500/30",
        que: "Vigila el perímetro con cruce de línea o zona. Sus alarmas van al monitor de intrusión.",
        ejemplo: "Ej.: «Perímetro Norte 12», una domo/bullet AcuSense grabada en un NVR. Lo normal es importarla desde su NVR." },
    { valor: "NVR", rotulo: "NVR / Grabador", icono: HardDrive, color: "text-sky-500 bg-sky-500/10 border-sky-500/30",
        que: "Guarda el video. Al agregarlo se leen sus canales y se importan las cámaras, clasificadas.",
        ejemplo: "Ej.: «NVR Sildan» en 172.16.2.59, Hikvision DS-9664NI de 64 canales." },
];

/**
 * Lo que se ofrece en el primer paso del alta. La cámara para omni-LPR es una cámara LPR con el
 * modo «Lectura OmniVision» ya elegido: antes había que saber que esa opción estaba escondida en
 * el paso «Modo» de «Cámara LPR» (Nico, 14/10: «¿cómo le digo que va a ser para omni-LPR?»).
 */
type OpcionAlta = { id: string; valor: Tipo; modo?: ModoLpr; rotulo: string; que: string; icono: any; color: string; ejemplo: string };
const OPCIONES_ALTA: OpcionAlta[] = [
    { ...TIPOS[0], id: "lpr", modo: "camara", que: "Lectora con ANPR propio: lee la matrícula y abre con su lista. Se le puede sumar la doble verificación de omni-lpr." },
    { id: "omnilpr", valor: "LPR_CAMERA", modo: "omnivision", rotulo: "Cámara para omni-LPR", icono: Sparkles, color: "text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)] border-[color-mix(in_oklab,var(--accion)_30%,transparent)]",
        que: "Una cámara común, sin ANPR, mirando el acceso: la matrícula la lee nuestro omni-lpr desde el video. Puede abrir la barrera.",
        ejemplo: "Ej.: una bullet de 4 MP apuntando al carril, como la de la entrada de San Nicolás (.86)." },
    { ...TIPOS[1], id: "intrusion" },
    { ...TIPOS[2], id: "nvr" },
];

const PASOS_POR_TIPO: Record<Tipo, { clave: string; rotulo: string }[]> = {
    // «Modo» (14/10): quién lee la matrícula o quién detecta la intrusión, elegido con nombre.
    LPR_CAMERA: [{ clave: "equipo", rotulo: "Equipo" }, { clave: "conexion", rotulo: "Conexión" }, { clave: "modo", rotulo: "Modo" }, { clave: "lugar", rotulo: "Ubicación" }, { clave: "grabacion", rotulo: "Grabación" }, { clave: "puesta", rotulo: "Puesta a punto" }],
    CAMERA: [{ clave: "equipo", rotulo: "Equipo" }, { clave: "conexion", rotulo: "Conexión" }, { clave: "modo", rotulo: "Modo" }, { clave: "grabacion", rotulo: "Grabación" }, { clave: "puesta", rotulo: "Puesta a punto" }],
    NVR: [{ clave: "equipo", rotulo: "Equipo" }, { clave: "conexion", rotulo: "Conexión" }, { clave: "canales", rotulo: "Canales" }, { clave: "puesta", rotulo: "Puesta a punto" }],
};

const TITULOS: Record<string, string> = {
    tipo: "¿Qué vas a agregar?", equipo: "¿Qué equipo es?", conexion: "¿Cómo se llega al equipo?", lugar: "¿Dónde está y por dónde pasan?",
    grabacion: "¿Dónde se graba?", canales: "Las cámaras del grabador", puesta: "Puesta a punto", modo: "¿Qué hace OmniAccess con esta cámara?",
};
const TITULO_MODO: Record<string, string> = { LPR_CAMERA: "¿Quién lee la matrícula?", CAMERA: "¿Quién detecta la intrusión?" };

/** Lo que elige cada canal al importar: el rol, su modo y (LPR) el sentido. */
type EleccionCanal = { rol: RolImport; direction: "ENTRY" | "EXIT"; modoLpr?: ModoLpr; modoIntr?: ModoIntrusion };

/* ── Piezas de formulario con ícono y tooltip ─────────────────────────────────── */

export function Etiqueta({ texto, ayuda }: { texto: string; ayuda?: string }) {
    return (
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/85 mb-1.5">
            {texto}
            {ayuda && <span {...tip(ayuda)} className="inline-grid place-items-center text-muted-foreground/60 hover:text-[var(--accion)] cursor-help"><Info size={12.5} /></span>}
        </span>
    );
}

export function Campo({ etiqueta, ayuda, icono: I, value, onChange, placeholder, tipo = "text", mono, autoFocus, className }: {
    etiqueta: string; ayuda?: string; icono: any; value: string; onChange: (v: string) => void; placeholder?: string;
    tipo?: string; mono?: boolean; autoFocus?: boolean; className?: string;
}) {
    const [ver, setVer] = useState(false);
    const esClave = tipo === "password";
    return (
        <label className={cn("block", className)}>
            <Etiqueta texto={etiqueta} ayuda={ayuda} />
            <span className="relative block">
                <I size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input type={esClave && !ver ? "password" : esClave ? "text" : tipo} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
                    className={cn("h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] outline-none transition-shadow placeholder:text-muted-foreground/60",
                        "focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]", mono && "font-mono", esClave && "pr-16")} />
                {esClave && <button type="button" onClick={() => setVer(!ver)} className="absolute right-2 top-1/2 -translate-y-1/2 h-7 px-2 rounded-md text-[11px] font-semibold text-muted-foreground hover:bg-accent">{ver ? "Ocultar" : "Ver"}</button>}
            </span>
        </label>
    );
}

export function Opcion({ activa, onClick, icono: I, titulo, detalle, color, ayuda }: { activa: boolean; onClick: () => void; icono: any; titulo: string; detalle?: string; color: string; ayuda?: string }) {
    return (
        <button type="button" onClick={onClick} {...(ayuda ? tip(ayuda) : {})}
            className={cn("rounded-xl border p-3.5 text-left flex items-center gap-3 transition-all", activa ? "border-[var(--accion)] ring-2 ring-[color-mix(in_oklab,var(--accion)_25%,transparent)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border hover:bg-accent/60")}>
            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", color)}><I size={19} /></span>
            <span className="min-w-0"><span className="block font-bold text-[13.5px]">{titulo}</span>{detalle && <span className="block text-[11.5px] text-muted-foreground leading-snug">{detalle}</span>}</span>
            {activa && <Check size={16} className="ml-auto text-[var(--accion)] shrink-0" />}
        </button>
    );
}

export function Bloque({ titulo, icono: I, ayuda, children, accion }: { titulo: string; icono: any; ayuda?: string; children: React.ReactNode; accion?: React.ReactNode }) {
    return (
        <section className="px-6 py-6 border-b border-border last:border-0">
            <div className="flex items-center gap-2 mb-4">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-muted/70 text-muted-foreground"><I size={14} /></span>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{titulo}</h3>
                {ayuda && <span {...tip(ayuda)} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help"><Info size={12.5} /></span>}
                {accion && <div className="ml-auto">{accion}</div>}
            </div>
            <div className="space-y-4">{children}</div>
        </section>
    );
}

function IconoEstado({ e }: { e: Estado }) {
    if (e === "corriendo") return <Loader2 size={16} className="animate-spin text-[var(--accion)]" />;
    if (e === "ok") return <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white"><Check size={12} /></span>;
    if (e === "error") return <span className="grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white"><X size={12} /></span>;
    if (e === "salteado") return <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-muted-foreground"><ChevronRight size={12} /></span>;
    return <span className="h-5 w-5 rounded-full border-2 border-dashed border-border" />;
}

/**
 * Elegir de una lista o crear uno nuevo ahí mismo (un área, un grupo de acceso), sin salir del
 * asistente. «Nuevo…» abre un renglón con el nombre ya sugerido; Enter lo crea y queda elegido.
 */
function ElegirOCrear({ etiqueta, ayuda, icono: I, valor, opciones, ninguna, nuevaRotulo, sugerencia, cargando, onElegir, onCrear }: {
    etiqueta: string; ayuda: string; icono: any; valor: string;
    opciones: { id: string; nombre: string; color?: string }[]; ninguna: string; nuevaRotulo: string; sugerencia: string; cargando?: boolean;
    onElegir: (id: string) => void; onCrear: (nombre: string) => Promise<string | null>;
}) {
    const [creando, setCreando] = useState(false);
    const [nombre, setNombre] = useState("");
    const [ocupado, setOcupado] = useState(false);
    const crear = async () => {
        const n = nombre.trim();
        if (!n || ocupado) return;
        setOcupado(true);
        try {
            const id = await onCrear(n);
            if (id) { onElegir(id); setCreando(false); toast.success({ title: `«${n}» creado`, description: "Quedó elegido." }); }
        } catch (e: any) { toast.error({ title: "No se pudo crear", description: e?.message }); }
        finally { setOcupado(false); }
    };
    return (
        <div className="block min-w-0">
            <Etiqueta texto={etiqueta} ayuda={ayuda} />
            {creando ? (
                <div className="flex items-center gap-1.5">
                    <span className="relative flex-1 min-w-0">
                        <Plus size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--accion)] pointer-events-none" />
                        <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); crear(); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setCreando(false); } }}
                            className="h-10 w-full rounded-lg border border-[var(--accion)] bg-background pl-9 pr-3 text-[13px] outline-none ring-2 ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]" />
                    </span>
                    <Button type="button" size="sm" onClick={crear} disabled={!nombre.trim() || ocupado} className="h-10 gap-1.5">{ocupado ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Crear</Button>
                    <button type="button" onClick={() => setCreando(false)} aria-label="Cancelar" title="Cancelar  ( Esc )" className="h-10 w-9 grid place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"><X size={15} /></button>
                </div>
            ) : (
                <Select value={valor} onValueChange={(v) => { if (v === "__nuevo") { setNombre(sugerencia); setCreando(true); } else onElegir(v); }}>
                    <SelectTrigger className="h-10"><I size={15} className="text-muted-foreground mr-1 shrink-0" />{cargando ? <span className="text-muted-foreground inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Cargando…</span> : <SelectValue />}</SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">{ninguna}</SelectItem>
                        {opciones.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                                <span className="inline-flex items-center gap-2">{o.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: o.color }} />}{o.nombre}</span>
                            </SelectItem>
                        ))}
                        <SelectItem value="__nuevo"><span className="inline-flex items-center gap-1.5 font-semibold text-[var(--accion)]"><Plus size={13} /> {nuevaRotulo}</span></SelectItem>
                    </SelectContent>
                </Select>
            )}
        </div>
    );
}

/**
 * Las cámaras que quedaron creadas pero sin avisar a OmniAccess. Si faltaba el destino de los
 * eventos (a qué IP le mandan las cámaras), se dice acá mismo y se reintenta; si fue otra cosa
 * (la cámara no contestó), se reintenta igual.
 */
function ArreglarAlarmas({ cuantas, faltaDestino, ocupado, onReintentar }: { cuantas: number; faltaDestino: boolean; ocupado: boolean; onReintentar: () => void }) {
    const [ip, setIp] = useState("");
    const [puerto, setPuerto] = useState("10000");
    const [sugeridas, setSugeridas] = useState<string[]>([]);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => {
        if (!faltaDestino) return;
        leerDestinoEventos().then((d) => { setSugeridas(d.sugeridas); setPuerto(d.puerto); setIp((v) => v || d.ip || d.sugeridas[0] || ""); }).catch(() => { });
    }, [faltaDestino]);
    const guardarYReintentar = async () => {
        setGuardando(true);
        try {
            const r = await guardarDestinoEventos(ip, puerto);
            if (!r.ok) { toast.error({ title: "No se pudo guardar", description: r.error }); return; }
            onReintentar();
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };
    return (
        <div className="rounded-xl border border-[color-mix(in_oklab,var(--aviso)_40%,transparent)] bg-[color-mix(in_oklab,var(--aviso)_7%,transparent)] p-4 space-y-3">
            <div className="flex items-start gap-2.5">
                <BellRing size={16} className="tono-aviso shrink-0 mt-0.5" />
                <div className="min-w-0">
                    <div className="text-[13px] font-semibold">{cuantas} {cuantas === 1 ? "cámara quedó creada pero no avisa" : "cámaras quedaron creadas pero no avisan"} a OmniAccess</div>
                    <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        {faltaDestino ? "Falta decir a qué IP le mandan sus eventos (cruces de línea, entradas a zona). Es la IP con la que las cámaras llegan a este servidor; se guarda una vez para todas." : "No se les pudo escribir el servidor de alarmas. El motivo está en cada renglón."}
                    </p>
                </div>
            </div>
            {faltaDestino ? (
                <div className="flex flex-wrap items-end gap-2">
                    <label className="block flex-1 min-w-[180px]">
                        <Etiqueta texto="IP de OmniAccess para las cámaras" ayuda="La dirección de este servidor vista desde la red de las cámaras. Si están en otra red (VPN, otro barrio), la que enruta hasta acá." />
                        <input value={ip} onChange={(e) => setIp(e.target.value)} list="ips-servidor" placeholder="172.26.20.200"
                            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] font-mono outline-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]" />
                        <datalist id="ips-servidor">{sugeridas.map((x) => <option key={x} value={x} />)}</datalist>
                    </label>
                    <label className="block w-[96px]">
                        <Etiqueta texto="Puerto" ayuda="El del receptor de eventos. Por defecto 10000." />
                        <input value={puerto} onChange={(e) => setPuerto(e.target.value.replace(/\D/g, "").slice(0, 5))}
                            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] font-mono outline-none focus:border-[var(--accion)]" />
                    </label>
                    <Button onClick={guardarYReintentar} disabled={!ip.trim() || guardando || ocupado} className="h-10 gap-1.5">
                        {guardando || ocupado ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar y reintentar
                    </Button>
                </div>
            ) : (
                <Button variant="outline" size="sm" onClick={onReintentar} disabled={ocupado} className="gap-1.5">
                    {ocupado ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />} Reintentar el servidor de alarmas ({cuantas})
                </Button>
            )}
        </div>
    );
}

/** El avance de la importación de un NVR: una barra y un renglón por cámara, con su estado. */
function AvanceImportacion({ filas }: { filas: FilaImport[] }) {
    const hechas = filas.filter((x) => x.estado !== "espera" && x.estado !== "corriendo").length;
    const errores = filas.filter((x) => x.estado === "error").length;
    const ROL = { lpr: { rotulo: "LPR", icono: Car, clase: "bg-amber-500/10 text-amber-600 dark:text-amber-400" }, intrusion: { rotulo: "Intrusión", icono: Radar, clase: "bg-red-500/10 text-red-500" }, vincular: { rotulo: "Se vincula", icono: Link2, clase: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" } } as const;
    return (
        <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3.5 pt-3 pb-2.5 space-y-2 bg-card/40">
                <div className="flex items-center gap-2 text-[12.5px]">
                    <Download size={14} className="text-muted-foreground" />
                    <span className="font-semibold">Cámaras del NVR</span>
                    <span className="ml-auto tabular-nums text-muted-foreground"><b className="text-foreground">{hechas}</b> de {filas.length}{errores ? <span className="text-red-500"> · {errores} con error</span> : null}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <motion.div className={cn("h-full rounded-full", errores ? "bg-amber-500" : "bg-[var(--accion)]")} initial={false} animate={{ width: `${(hechas / Math.max(1, filas.length)) * 100}%` }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} />
                </div>
            </div>
            <div className="max-h-[38vh] overflow-y-auto divide-y divide-border/60">
                {filas.map((x) => {
                    const r = ROL[x.rol];
                    return (
                        <div key={x.channel} className={cn("flex items-center gap-3 px-3.5 py-2 transition-colors", x.estado === "corriendo" && "bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]")}>
                            <span className="shrink-0"><IconoEstado e={x.estado} /></span>
                            <span className="w-8 shrink-0 font-mono text-[11px] text-muted-foreground">D{x.channel}</span>
                            <div className="min-w-0 flex-1">
                                <div className={cn("text-[12.5px] font-semibold truncate", x.estado === "espera" && "text-muted-foreground")}>{x.name}</div>
                                {x.detalle && <div className={cn("text-[11px] line-clamp-2 break-words", x.estado === "error" ? "text-red-500" : "text-muted-foreground")} title={x.detalle}>{x.detalle}</div>}
                            </div>
                            <span className={cn("shrink-0 inline-flex items-center gap-1 px-2 h-6 rounded-full text-[10.5px] font-bold", r.clase)}><r.icono size={11} /> {r.rotulo}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const ipOk = (ip: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim());

/**
 * El tipo de una cámara en su ficha, con lo que la cámara dice que sabe hacer (16/10, Nico: «si es
 * sólo ANPR no tengo esa opción, sólo indica cruces de línea; y cuando le cambio el modo sigue
 * diciendo que es de intrusión»). Antes el tipo no se podía cambiar desde acá: la ficha ofrecía
 * los modos del tipo guardado, así que una LPR importada como intrusión sólo podía elegir entre
 * modos de intrusión. Ahora se elige el tipo —con la sugerencia de la cámara— y los modos que se
 * ofrecen son los de ese tipo. Se aplica al guardar, con lo que cambia dicho antes.
 */
function TipoDeCamara({ tipo, original, caps, leyendo, modoLpr, modoIntr, onCambiar }: {
    tipo: "LPR_CAMERA" | "CAMERA"; original: "LPR_CAMERA" | "CAMERA"; caps: Capacidades | null; leyendo: boolean;
    modoLpr: ModoLpr; modoIntr: ModoIntrusion; onCambiar: (t: "LPR_CAMERA" | "CAMERA") => void;
}) {
    const sug = caps && caps.fuente !== "nada" ? caps.sugerido : null;
    const ROT = { LPR_CAMERA: "Cámara LPR", CAMERA: "Cámara de intrusión" } as const;
    const sinAnalitica = caps?.fuente === "camara" && caps.cruceLinea === false && caps.zona === false;
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap text-[12px] text-muted-foreground min-h-[24px]">
                {leyendo ? <><Loader2 size={13} className="animate-spin" /> Preguntándole a la cámara qué sabe hacer…</>
                    : caps ? <>La cámara dice que sabe: <ChipsCapacidades c={caps} /></>
                        : <>No se le pudo preguntar a la cámara qué sabe hacer.</>}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {(["LPR_CAMERA", "CAMERA"] as const).map((t) => (
                    <Opcion key={t} activa={tipo === t} onClick={() => tipo !== t && onCambiar(t)} icono={t === "LPR_CAMERA" ? Car : Radar}
                        color={t === "LPR_CAMERA" ? "text-amber-500 bg-amber-500/10" : "text-red-500 bg-red-500/10"}
                        titulo={`${ROT[t]}${sug?.tipo === t ? " · sugerida" : ""}`}
                        detalle={t === "LPR_CAMERA" ? "Lee matrículas en un acceso (con su ANPR o con omni-lpr)." : "Perímetro: cruce de línea, zona, o sólo video para OmniVision."} />
                ))}
            </div>
            {/* Una cámara sin ANPR cargada como LPR con «Lectura OmniVision» está bien (la .86): no se sugiere intrusión. */}
            {sug && sug.tipo !== tipo && caps?.fuente === "camara" && !(tipo === "LPR_CAMERA" && modoLpr === "omnivision") && (
                <div className="rounded-lg chip-aviso px-3 py-2.5 text-[12.5px] flex items-center gap-2">
                    <AlertTriangle size={15} className="shrink-0" />
                    <span className="flex-1">La cámara {sug.por}: conviene <b>{ROT[sug.tipo]}</b>.</span>
                    <Button size="sm" onClick={() => onCambiar(sug.tipo)}>Cambiar a {ROT[sug.tipo]}</Button>
                </div>
            )}
            {tipo === "CAMERA" && sinAnalitica && (modoIntr === "camara" || modoIntr === "doble") && (
                <div className="rounded-lg chip-aviso px-3 py-2.5 text-[12.5px] flex items-center gap-2"><AlertTriangle size={15} className="shrink-0" />
                    Esta cámara no tiene cruce de línea ni zona: no va a avisar nada. Elegí «Analítica OmniVision» o «Sólo video».</div>
            )}
            {tipo === "LPR_CAMERA" && caps?.fuente === "camara" && caps.anpr === false && modoLpr !== "omnivision" && (
                <div className="rounded-lg chip-aviso px-3 py-2.5 text-[12.5px] flex items-center gap-2"><AlertTriangle size={15} className="shrink-0" />
                    Esta cámara no tiene ANPR: no va a leer matrículas sola. Elegí «Lectura OmniVision».</div>
            )}
            {tipo !== original && (
                <ul className="text-[12px] text-muted-foreground list-disc pl-5 space-y-0.5">
                    {consecuenciasTipo(original, tipo).map((c) => <li key={c}>{c}</li>)}
                    {tipo === "LPR_CAMERA" && <li>Revisá el <b>sentido</b> (entrada o salida) en Identidad.</li>}
                    <li>Se aplica al tocar «Guardar cambios».</li>
                </ul>
            )}
        </div>
    );
}

/* ── El cajón ─────────────────────────────────────────────────────────────────── */

export function CajonDispositivo({ device, groups = [], onSuccess, open, onOpenChange, alCalibrar, alImportar }: {
    /** Con equipo: ficha de edición. Sin equipo: alta por pasos. */
    device?: any | null;
    groups?: any[];
    onSuccess: () => void;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    /** Abrir el calibrador de intrusión de una cámara recién creada (o de la ficha). */
    alCalibrar?: (d: { id: string; name: string; ip: string; brand: string; deviceType: string }) => void;
    /** Abrir la importación de cámaras de un NVR desde su ficha. */
    alImportar?: (d: any) => void;
}) {
    const esEdicion = !!device;
    const [paso, setPaso] = useState(0);
    const [hacia, setHacia] = useState(1);

    const blanco = useCallback(() => ({
        deviceType: (device?.deviceType || "") as Tipo | "",
        brand: (device?.brand === "DAHUA" ? "DAHUA" : "HIKVISION") as Marca,
        name: device?.name || "", ip: device?.ip || "", port: device?.port ? String(device.port) : "",
        httpPort: device?.httpPort ? String(device.httpPort) : "",
        username: device?.username || "admin", password: device?.password || "", authType: device?.authType || "DIGEST",
        mac: device?.mac || "", deviceModel: device?.deviceModel || "", location: device?.location || "",
        direction: device?.direction || "ENTRY", groupId: "none",
    }), [device]);
    const [f, setF] = useState(blanco());
    const set = (k: keyof ReturnType<typeof blanco>, v: string) => setF((p) => ({ ...p, [k]: v }));

    const [detectando, setDetectando] = useState(false);
    const [info, setInfo] = useState<any>(null);
    // Grabación
    const [buscando, setBuscando] = useState(false);
    const [donde, setDonde] = useState<{ ubicacion: Ubic | null; nvrs: { nombre: string; ok: boolean; error?: string; canales: number }[]; hayNvr: boolean; error?: string } | null>(null);
    const [manual, setManual] = useState<{ nvrId: string; ch: string }>({ nvrId: "", ch: "" });
    const [nvrs, setNvrs] = useState<{ id: string; name: string; ip: string }[]>([]);
    const [sinGrabar, setSinGrabar] = useState(false);
    const [actual, setActual] = useState<{ ch: number; nvr: string | null } | null>(null);
    const [retencion, setRetencion] = useState<string | null>(null);
    const [calculando, setCalculando] = useState(false);
    // Canales del NVR
    const [leyendo, setLeyendo] = useState(false);
    const [canales, setCanales] = useState<Canal[] | null>(null);
    const [errorCanales, setErrorCanales] = useState("");
    const [eleccion, setEleccion] = useState<Record<number, EleccionCanal>>({});
    // Modo (lib/modo-camara.ts). En la ficha, `modoAntes` es el guardado: si no cambió no se toca.
    const [modoLpr, setModoLpr] = useState<ModoLpr>("camara");
    const [abre, setAbre] = useState(false);
    const [modoIntr, setModoIntr] = useState<ModoIntrusion>("doble");
    const [modoAntes, setModoAntes] = useState<{ lpr: ModoLpr | null; abre: boolean; intr: ModoIntrusion | null }>({ lpr: null, abre: false, intr: null });
    // Puesta a punto
    const [cargarMatriculas, setCargarMatriculas] = useState(true);
    const [tareas, setTareas] = useState<Tarea[]>([]);
    const [corriendo, setCorriendo] = useState(false);
    const [terminado, setTerminado] = useState(false);
    /*
     * Dónde quedan las cámaras importadas de un NVR (21/10, Nico: «debe poder crear un grupo o área
     * para alojar esas cámaras rápidamente, ahí mismo en el drawer»). El área vale para todas; el
     * grupo de acceso, sólo para las LPR (decide quién pasa). Los dos se pueden crear acá mismo.
     */
    const [areas, setAreas] = useState<Area[] | null>(null);
    const [areaId, setAreaId] = useState("none");
    const [gruposNuevos, setGruposNuevos] = useState<{ id: string; name: string }[]>([]);
    const [importados, setImportados] = useState<FilaImport[]>([]);
    /** El servidor de alarmas falló porque no se sabe a qué IP mandan los eventos las cámaras. */
    const [faltaDestino, setFaltaDestino] = useState(false);
    /** Reintentar el servidor de alarmas de las que fallaron (después de decir el destino, o si fue un corte). */
    const reintentarAlarmas = async () => {
        const pend = importados.filter((x) => x.alarma && x.id);
        if (!pend.length) return;
        setCorriendo(true); setFaltaDestino(false);
        let fallan = 0;
        for (const x of pend) {
            setImportados((fs) => fs.map((y) => (y.channel === x.channel ? { ...y, estado: "corriendo", detalle: `${y.base} · configurando el servidor de alarmas…` } : y)));
            const a = await fetch(`/api/devices/alarm-host?deviceId=${x.id}`, { method: "POST" }).then((r) => r.json()).catch(() => null);
            if (a?.sinDestino) setFaltaDestino(true);
            if (!a?.ok) fallan++;
            setImportados((fs) => fs.map((y) => (y.channel === x.channel ? (a?.ok
                ? { ...y, estado: "ok", alarma: null, detalle: `${y.base} · avisa a OmniAccess` }
                : { ...y, estado: "error", alarma: a?.error || "sin respuesta", detalle: `${y.base} · no quedó avisando: ${a?.error || "sin respuesta"}` }) : y)));
        }
        setCorriendo(false);
        if (fallan) toast.error({ title: `${fallan} siguen sin avisar`, description: "El motivo está en cada renglón." });
        else toast.success({ title: "Todas avisan a OmniAccess" });
    };
    // Mientras corre la puesta a punto, salir de la página la corta a la mitad: se avisa.
    useEffect(() => {
        if (!corriendo) return;
        const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
        window.addEventListener("beforeunload", avisar);
        return () => window.removeEventListener("beforeunload", avisar);
    }, [corriendo]);
    const [creadoId, setCreadoId] = useState<string | null>(null);
    const [opcionAlta, setOpcionAlta] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    // Lo que la cámara sabe hacer (lib/capacidades-camara): decide qué tipo y modo se sugieren.
    const [caps, setCaps] = useState<Capacidades | null>(null);
    const [leyendoCaps, setLeyendoCaps] = useState(false);
    const [capsCanal, setCapsCanal] = useState<Record<string, Capacidades>>({});

    useEffect(() => {
        if (!open) return;
        setF(blanco()); setPaso(0); setHacia(1); setInfo(null); setDonde(null); setManual({ nvrId: "", ch: "" });
        setSinGrabar(false); setActual(null); setRetencion(null); setCanales(null); setErrorCanales(""); setEleccion({});
        setTareas([]); setImportados([]); setFaltaDestino(false); setAreaId("none"); setCorriendo(false); setTerminado(false); setCreadoId(null); setCargarMatriculas(true); setGuardando(false); setOpcionAlta(null);
        setCaps(null); setCapsCanal({});
        // Las credenciales ya no vienen en la lista de equipos (lib/equipo-publico): se piden acá,
        // con el permiso Dispositivos. Si no llegan, guardar no borra la clave (updateDevice).
        if (device?.id) getCredencialesDispositivo(device.id).then((c) => { if (c) setF((p) => ({ ...p, username: c.username || p.username, password: c.password || "" })); }).catch(() => { });
        // En la ficha de una cámara se le pregunta qué sabe hacer apenas se abre (sólo lectura).
        if (device?.id && device.deviceType !== "NVR") {
            setLeyendoCaps(true);
            detectarCapacidades({ deviceId: device.id }).then((r) => setCaps(r.ok ? r.capacidades : null)).catch(() => setCaps(null)).finally(() => setLeyendoCaps(false));
        }
        {
            const ml = device ? modoLprDe(device) : null;
            const mi = device ? modoIntrusionDe(device, null) : null;
            setModoLpr(ml || "camara"); setAbre(!!device?.lprAbre); setModoIntr(mi || "doble");
            setModoAntes({ lpr: ml, abre: !!device?.lprAbre, intr: mi });
            // Una cámara de antes sin modo elegido: si no le avisa a OmniAccess, es «sólo video».
            if (device?.deviceType === "CAMERA" && !device.intrusionModo) rolesDeCamaras().then((r) => {
                const m = modoIntrusionDe(device, r.avisan.includes(device.ip));
                setModoIntr(m || "doble"); setModoAntes((a) => ({ ...a, intr: m }));
            }).catch(() => { });
        }
        getNvrList().then(setNvrs).catch(() => setNvrs([]));
        if (device?.id && device.deviceType !== "NVR") {
            getNvrChannelInfo(device.id).then((a) => {
                setActual(a);
                // La retención guardada se muestra al abrir; si graba en un NVR y nunca se
                // calculó, se calcula sola (antes había que apretar el botón cámara por cámara).
                retencionGuardada(device.id).then((r) => {
                    if (r) setRetencion(textoRetencion(r));
                    else if (a) calcRet();
                }).catch(() => { });
            }).catch(() => setActual(null));
        }
    }, [open, blanco, device]);

    // La lectura de OmniVision se guarda como LPR_INTERIOR que mira un acceso (lib/modo-camara.ts):
    // en pantalla es una cámara LPR más, con su sentido y su grupo.
    const esLprOmni = String(f.deviceType) === "LPR_INTERIOR" && !!device?.trackAcceso;
    const tipo = (esLprOmni ? "LPR_CAMERA" : f.deviceType) as Tipo | "";
    const meta = TIPOS.find((t) => t.valor === tipo);
    /** El tipo con el que está guardada (la lectura de OmniVision cuenta como LPR). */
    const tipoOriginal: "LPR_CAMERA" | "CAMERA" = device?.deviceType === "LPR_CAMERA" || (device?.deviceType === "LPR_INTERIOR" && device?.trackAcceso) ? "LPR_CAMERA" : "CAMERA";
    /** Cambiar el tipo de cámara: los modos que se ofrecen pasan a ser los del tipo nuevo, en el que conviene según la cámara. */
    const cambiarTipo = (t: "LPR_CAMERA" | "CAMERA") => {
        set("deviceType", t);
        if (t === "LPR_CAMERA") { setModoLpr(caps?.fuente === "camara" && caps.anpr === false ? "omnivision" : "camara"); setAbre(false); }
        else setModoIntr(caps?.fuente === "camara" ? caps.sugerido.modoIntr : "doble");
        if (!esEdicion) setOpcionAlta(t === "CAMERA" ? "intrusion" : caps?.anpr === false ? "omnilpr" : "lpr");
    };
    const pasos = useMemo(() => esEdicion ? [{ clave: "ficha", rotulo: "Ficha" }] : [{ clave: "tipo", rotulo: "Tipo" }, ...(tipo ? PASOS_POR_TIPO[tipo] : [])], [esEdicion, tipo]);
    const clave = pasos[Math.min(paso, pasos.length - 1)]?.clave || "tipo";
    const ultimo = paso >= pasos.length - 1;
    const ir = (i: number) => { setHacia(i > paso ? 1 : -1); setPaso(i); };
    const ipValida = ipOk(f.ip);
    /**
     * A qué se le habla por HTTP mientras el equipo no está guardado: la IP con su puerto web si no
     * es el 80 (lib/host-http lo respeta tal cual). Una vez guardado, el puerto sale de la base.
     */
    const ipHttp = f.httpPort && f.httpPort !== "80" ? `${f.ip.trim()}:${f.httpPort}` : f.ip.trim();

    /* ── Acciones ── */
    const detectar = async () => {
        if (!ipValida) return;
        setDetectando(true); setInfo(null);
        try {
            const r: any = await probeDeviceInfo({ ip: ipHttp, username: f.username, password: f.password, authType: f.authType, brand: f.brand });
            setInfo(r);
            if (r?.ok) setF((p) => ({ ...p, mac: r.macAddress || p.mac, deviceModel: r.model || p.deviceModel, authType: r.authType || p.authType, name: p.name || r.deviceName || "",
                ...(r.credenciales ? { username: r.credenciales.username, password: r.credenciales.password } : {}) }));
            if (r?.nota) (r.credenciales ? toast.success : toast.info)({ title: r.credenciales ? "Credenciales tomadas del NVR" : "Datos según el NVR", description: r.nota });
            // Respondió: se le pregunta qué sabe hacer, para sugerir el tipo y el modo antes de seguir.
            if (r?.ok && tipo !== "NVR") {
                setLeyendoCaps(true);
                const cr = await detectarCapacidades(esEdicion && device?.id ? { deviceId: device.id } : { ip: ipHttp, username: r.credenciales?.username || f.username, password: r.credenciales?.password || f.password, authType: r.authType || f.authType, brand: f.brand, deviceModel: r.model || f.deviceModel }).catch(() => null);
                const c = cr && cr.ok ? cr.capacidades : null;
                setCaps(c); setLeyendoCaps(false);
                // En el alta, el modo arranca en el que conviene (si el tipo coincide); el tipo no se cambia solo.
                if (c && !esEdicion && c.fuente === "camara") { if (tipo === "LPR_CAMERA" && opcionAlta !== "omnilpr") setModoLpr(c.anpr === false ? "omnivision" : "camara"); if (tipo === "CAMERA") setModoIntr(c.sugerido.modoIntr); }
            }
        } catch (e: any) { setInfo({ ok: false, error: e?.message }); }
        finally { setDetectando(false); }
    };

    const buscarGrabacion = useCallback(async () => {
        if (!ipOk(f.ip)) return;
        setBuscando(true); setDonde(null);
        try { setDonde(await dondeGraba(f.ip.trim()) as any); }
        catch (e: any) { setDonde({ ubicacion: null, nvrs: [], hayNvr: true, error: e?.message || "No se pudo consultar los NVR" }); }
        finally { setBuscando(false); }
    }, [f.ip]);
    useEffect(() => { if (open && !esEdicion && clave === "grabacion" && !donde && !buscando) buscarGrabacion(); }, [open, esEdicion, clave, donde, buscando, buscarGrabacion]);

    const leerCanales = useCallback(async () => {
        if (!ipOk(f.ip)) return;
        setLeyendo(true); setErrorCanales(""); setCanales(null);
        try {
            const [r, devs]: any = await Promise.all([getNvrChannels({ ip: ipHttp, username: f.username, password: f.password, authType: f.authType }), getDevices()]);
            if (!r?.ok) { setErrorCanales(r?.error || "El NVR no devolvió canales"); return; }
            const porIp = new Map((devs || []).map((d: any) => [d.ip, d]));
            const lista: Canal[] = (r.channels || []).map((c: any) => {
                const e: any = c.ip ? porIp.get(c.ip) : null;
                return { channel: Number(c.channel), ip: c.ip || null, name: (c.name && String(c.name).trim()) || `Canal ${c.channel}`, model: c.model || null, marca: c.brand || f.brand, protocolo: c.protocolo || null, sensorDe: c.sensorDe ?? null, existente: e ? { id: e.id, name: e.name, tipo: String(e.deviceType) } : null };
            });
            setCanales(lista);
            setEleccion(Object.fromEntries(lista.map((c) => [c.channel, { rol: (c.existente || !c.ip || c.sensorDe ? "omitir" : ES_LPR.test(`${c.name} ${c.model || ""}`) ? "lpr" : "intrusion") as RolImport, direction: (/salida|exit/i.test(c.name) ? "EXIT" : "ENTRY") as "ENTRY" | "EXIT", modoLpr: "camara" as ModoLpr, modoIntr: "doble" as ModoIntrusion }])));
            // Después, a cada cámara nueva se le pregunta qué sabe hacer (con las credenciales del NVR,
            // que son con las que se crea): lo que dice manda sobre lo que sugiere el nombre del canal.
            const aPreguntar = lista.filter((c) => c.ip && !c.existente && !c.sensorDe).map((c) => ({ ip: c.ip!, model: c.model || null, brand: c.marca !== "OTRA" ? c.marca : f.brand }));
            if (aPreguntar.length) detectarCapacidadesCanales({ canales: aPreguntar, username: f.username, password: f.password, authType: f.authType }).then((m: Record<string, Capacidades>) => {
                setCapsCanal(m || {});
                setEleccion((p) => Object.fromEntries(Object.entries(p).map(([k, e]) => {
                    const c = lista.find((x) => x.channel === Number(k)); const cap = c?.ip ? m?.[c.ip] : null;
                    if (!c || !cap || cap.fuente !== "camara" || c.existente || c.sensorDe) return [k, e];
                    const porNombre = ES_LPR.test(`${c.name} ${c.model || ""}`);
                    const omni = cap.anpr === false && porNombre;
                    const rol: RolImport = cap.sugerido.tipo === "LPR_CAMERA" || omni ? "lpr" : "intrusion";
                    return [k, { ...e, rol, modoLpr: omni ? "omnivision" : cap.sugerido.modoLpr, modoIntr: cap.sugerido.modoIntr }];
                })));
            }).catch(() => { });
        } catch (e: any) { setErrorCanales(e?.message || "No se pudo leer el NVR"); }
        finally { setLeyendo(false); }
    }, [f.ip, ipHttp, f.username, f.password, f.authType, f.brand]);
    useEffect(() => { if (open && clave === "canales" && !canales && !leyendo && !errorCanales) leerCanales(); }, [open, clave, canales, leyendo, errorCanales, leerCanales]);
    useEffect(() => { if (open && clave === "canales" && areas === null) leerAreas().then((e) => setAreas(e.areas)).catch(() => setAreas([])); }, [open, clave, areas]);
    const todosLosGrupos = useMemo(() => [...groups.map((g: any) => ({ id: String(g.id), name: String(g.name) })), ...gruposNuevos.filter((n) => !groups.some((g: any) => g.id === n.id))], [groups, gruposNuevos]);
    /** El nombre de un área con su camino («Perímetro › Norte»): hay sub-áreas con el mismo nombre. */
    const caminoArea = useCallback((idA: string) => {
        const lista = areas || [];
        const partes: string[] = [];
        let cur = lista.find((a) => a.id === idA);
        for (let i = 0; cur && i < 10; i++) { partes.unshift(cur.nombre); cur = cur.padre ? lista.find((a) => a.id === cur!.padre) : undefined; }
        return partes.join(" › ");
    }, [areas]);

    const grabacionElegida: Ubic | null = donde?.ubicacion || (manual.nvrId && Number(manual.ch) > 0 ? { nvrId: manual.nvrId, nvrNombre: nvrs.find((n) => n.id === manual.nvrId)?.name || null, ch: Number(manual.ch) } : null);

    const bloqueo = useMemo(() => {
        if (clave === "tipo" && !tipo) return "Elegí qué equipo vas a agregar.";
        if (clave === "equipo" && !f.name.trim()) return "Poné un nombre: es como va a figurar en el monitor y el historial.";
        if (clave === "conexion" && !ipValida) return "Falta una IP válida (ej. 172.16.2.210).";
        if (clave === "grabacion" && !grabacionElegida && !sinGrabar) return "Elegí dónde graba o confirmá que va sin grabaciones.";
        return null;
    }, [clave, tipo, f.name, ipValida, grabacionElegida, sinGrabar]);

    const actualizar = (k: string, cambios: Partial<Tarea>) => setTareas((ts) => ts.map((t) => (t.clave === k ? { ...t, ...cambios } : t)));
    const ponerHora = async (id: string) => {
        actualizar("hora", { estado: "corriendo" });
        const h = await fetch("/api/devices/sync-time", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: id, mode: "now" }) }).then((x) => x.json()).catch(() => null);
        actualizar("hora", { estado: h?.ok ? "ok" : "error", detalle: h?.ok ? "hora del servidor (Montevideo)" : h?.results?.[0]?.error || h?.error || "sin respuesta" });
    };
    const vincularGrabacion = async (id: string) => {
        if (grabacionElegida?.nvrId) {
            actualizar("grabacion", { estado: "corriendo" });
            await asignarGrabacion(f.ip.trim(), grabacionElegida.nvrId, grabacionElegida.ch);
            actualizar("grabacion", { estado: "ok", detalle: `${grabacionElegida.nvrNombre || "NVR"} · canal ${grabacionElegida.ch}` });
            actualizar("retencion", { estado: "corriendo" });
            const rt = await calcularRetencion(id);
            actualizar("retencion", rt.ok && rt.retencion && !rt.retencion.error
                ? { estado: "ok", detalle: `${rt.retencion.dias} días (desde ${rt.retencion.desde.slice(0, 10)})${rt.retencion.grabando === false ? " · NO está grabando ahora" : ""}` }
                : { estado: "error", detalle: rt.error || rt.retencion?.error || "no se pudo calcular" });
        } else {
            actualizar("grabacion", { estado: "salteado", detalle: "sin NVR: no habrá clips ni playback" });
            actualizar("retencion", { estado: "salteado" });
        }
    };

    /** El modo elegido, recién creada la cámara. Lo que le falte para andar va en el detalle. */
    const aplicarModo = async (id: string) => {
        actualizar("modo", { estado: "corriendo" });
        const r = await ponerModoCamara(id, tipo === "LPR_CAMERA" ? { lpr: { modo: modoLpr, abre } } : { intrusion: modoIntr }).catch((e) => ({ ok: false, error: e?.message, pendientes: [] as string[] }));
        actualizar("modo", r.ok ? { estado: "ok", detalle: r.pendientes.length ? `Falta: ${r.pendientes.join(" · ")}` : "aplicado" } : { estado: "error", detalle: r.error || "no se pudo aplicar" });
        if (r.ok && r.pendientes.length) toast.info({ title: "El modo quedó elegido; le falta:", description: r.pendientes.join(" · ") });
    };

    const puestaAPunto = async () => {
        if (!tipo) return;
        const hik = f.brand === "HIKVISION";
        const T = (clave: string, titulo: string, ayuda: string, icono: any): Tarea => ({ clave, titulo, ayuda, icono, estado: "espera" });
        const tModo = tipo === "LPR_CAMERA"
            ? T("modo", `Modo: ${MODOS_LPR[modoLpr].rotulo}`, MODOS_LPR[modoLpr].que, ScanLine)
            : T("modo", `Modo: ${MODOS_INTRUSION[modoIntr].rotulo}`, MODOS_INTRUSION[modoIntr].que, Radar);
        const lista: Tarea[] = tipo === "LPR_CAMERA" && modoLpr === "omnivision" ? [
            // Lectura OmniVision: la cámara no lee; no se le configura ANPR, envío de lecturas ni lista.
            T("crear", "Dar de alta la cámara", "Se guarda con su IP, credenciales, sentido y grupo de acceso.", Camera), tModo,
            T("hora", "Poner la hora", "Hora del servidor (Montevideo). Con la hora corrida el clip de la lectura no coincide.", Clock),
            T("vivo", "Video para omni-lpr", "Se registra el stream que lee omni-lpr y que se ve en el monitor.", Video),
            T("grabacion", "Vincular la grabación", "En qué NVR y canal se graba, para clips y playback.", HardDrive),
            T("retencion", "Calcular retención", "La grabación más vieja de ese canal: de ese día a hoy es lo que guarda.", Server),
        ] : tipo === "LPR_CAMERA" ? [
            T("crear", "Dar de alta la cámara", "Se guarda con su IP, credenciales, sentido y grupo de acceso.", Camera), tModo,
            T("hora", "Poner la hora", "Hora del servidor (Montevideo). Con la hora corrida el clip de la lectura no coincide.", Clock),
            T("eventos", "Servidor de alarmas → OmniAccess", "Se configura el envío de cada lectura a OmniAccess (HTTP host). Sin esto la cámara lee pero nadie se entera.", BellRing),
            T("anpr", "Modo ANPR", "Se activa la lectura de matrículas.", ScanLine),
            T("h264", "Video H.264", "Para que el vivo se vea en el navegador sin transcodificar.", Film),
            T("vivo", "Video en vivo", "Se registra el stream en go2rtc para el monitor.", Video),
            T("matriculas", "Cargar matrículas", "Las habilitadas van a la lista de la cámara: son las que prenden el semáforo verde con el relé.", ListChecks),
            T("grabacion", "Vincular la grabación", "En qué NVR y canal se graba, para clips y playback.", HardDrive),
            T("retencion", "Calcular retención", "La grabación más vieja de ese canal: de ese día a hoy es lo que guarda.", Server),
        ] : tipo === "CAMERA" ? [
            T("crear", "Dar de alta la cámara", "Se guarda como cámara de intrusión con su IP y credenciales.", Camera), tModo,
            T("hora", "Poner la hora", "Hora del servidor. Las alarmas quedan con la hora correcta y el clip coincide.", Clock),
            T("eventos", "Servidor de alarmas → OmniAccess", "La cámara manda los cruces de línea y entradas a zona a OmniAccess. Sin esto no llegan al monitor de intrusión.", BellRing),
            T("vivo", "Video en vivo", "Se registra el stream en go2rtc para el monitor de intrusión.", Video),
            T("grabacion", "Vincular la grabación", "En qué NVR y canal se graba, para clips y playback de las alarmas.", HardDrive),
            T("retencion", "Calcular retención", "Cuántos días guarda el NVR de esta cámara.", Server),
        ] : [
            T("crear", "Dar de alta el NVR", "Se guarda con su IP, puerto RTSP y credenciales.", HardDrive),
            T("hora", "Poner la hora", "Hora del servidor: el playback busca por hora, si está corrida no encuentra nada.", Clock),
            T("importar", "Importar cámaras clasificadas", "Se crean las cámaras elegidas (LPR o intrusión), se les configura el servidor de alarmas para que avisen a OmniAccess, y se vinculan las que ya existían a su canal de grabación.", Download),
            ...(areaId !== "none" ? [T("ubicar", `Ubicarlas en «${caminoArea(areaId)}»`, "Todas las importadas, nuevas o vinculadas, quedan en esa área del panel.", FolderTree)] : []),
        ];
        setTareas(lista); setCorriendo(true);
        let id: string | null = null;
        try {
            actualizar("crear", { estado: "corriendo" });
            const fd = new FormData();
            Object.entries({ ...f, puestaManual: "1", direction: tipo === "LPR_CAMERA" ? f.direction : "ENTRY" }).forEach(([k, v]) => fd.append(k, String(v)));
            const r: any = await createDevice(fd);
            id = r?.id || null;
            if (!id) throw new Error("No se pudo crear el equipo");
            setCreadoId(id);
            actualizar("crear", { estado: "ok", detalle: `${f.name} · ${f.ip}` });
            onSuccess();

            if (tipo !== "NVR") await aplicarModo(id);
            if (tipo === "LPR_CAMERA" && modoLpr === "omnivision") {
                await ponerHora(id);
                actualizar("vivo", { estado: "ok", detalle: "registrado al poner el modo" });
                await vincularGrabacion(id);
            } else if (tipo === "LPR_CAMERA") {
                if (hik) {
                    ["hora", "eventos", "anpr", "h264", "vivo", "matriculas"].forEach((k) => actualizar(k, { estado: k === "matriculas" && !cargarMatriculas ? "salteado" : "corriendo" }));
                    const p: any = await provisionLprDevice(id, cargarMatriculas);
                    const por = (n: string) => (p?.steps || []).find((s: any) => s.name === n);
                    const marca = (k: string, n: string) => { const s = por(n); actualizar(k, s ? { estado: s.ok ? "ok" : "error", detalle: String(s.detail || "") } : { estado: "salteado", detalle: "no corrió" }); };
                    marca("hora", "Hora"); marca("eventos", "Envío de eventos (HTTP host)"); marca("anpr", "Modo ANPR"); marca("h264", "Códec H.264"); marca("vivo", "Video en vivo (go2rtc)");
                    if (cargarMatriculas) marca("matriculas", "Matrículas"); else actualizar("matriculas", { estado: "salteado", detalle: "se cargan después con «Poner a punto»" });
                } else {
                    await ponerHora(id);
                    actualizar("eventos", { estado: "corriendo" });
                    const a = await fetch(`/api/devices/alarm-host?deviceId=${id}`, { method: "POST" }).then((x) => x.json()).catch(() => null);
                    actualizar("eventos", { estado: a?.ok ? "ok" : "error", detalle: a?.info || a?.error || (a?.ok ? "configurado" : "sin respuesta") });
                    ["anpr", "h264", "vivo", "matriculas"].forEach((k) => actualizar(k, { estado: "salteado", detalle: "se configura desde la web de la Dahua" }));
                }
                await vincularGrabacion(id);
            } else if (tipo === "CAMERA") {
                await ponerHora(id);
                if (MODOS_INTRUSION[modoIntr].avisos) {
                    actualizar("eventos", { estado: "corriendo" });
                    const a = await fetch(`/api/devices/alarm-host?deviceId=${id}`, { method: "POST" }).then((x) => x.json()).catch(() => null);
                    actualizar("eventos", { estado: a?.ok ? "ok" : "error", detalle: a?.info || a?.error || (a?.ok ? "configurado" : "sin respuesta — se reintenta desde el calibrador") });
                } else actualizar("eventos", { estado: "salteado", detalle: "en este modo la cámara no avisa: la mira OmniVision" });
                actualizar("vivo", { estado: "ok", detalle: "registrado al crear" });
                await vincularGrabacion(id);
            } else {
                await ponerHora(id);
                const pedidos = (canales || []).filter((c) => c.existente || (eleccion[c.channel]?.rol && eleccion[c.channel].rol !== "omitir"))
                    .map((c) => {
                        const e = eleccion[c.channel];
                        const rol = (c.existente ? "intrusion" : e.rol) as RolImport;
                        // A una que ya existe no se le cambia el modo: sólo se vincula su grabación.
                        const modo = c.existente ? undefined : rol === "lpr" ? e?.modoLpr : rol === "intrusion" ? e?.modoIntr : undefined;
                        return { channel: c.channel, rol, direction: e?.direction, groupId: f.groupId, modo };
                    });
                if (!pedidos.length) {
                    actualizar("importar", { estado: "salteado", detalle: "no se eligió ninguna cámara (se puede hacer después desde el menú del NVR)" });
                    actualizar("ubicar", { estado: "salteado", detalle: "no hay cámaras para ubicar" });
                } else {
                    /*
                     * De a una (21/10, Nico: «debe ser estilizado el proceso»): antes era una sola llamada
                     * con un «19 canales…» girando un par de minutos y el resultado todo junto al final.
                     * Ahora cada cámara tiene su renglón con su estado; el servidor guarda lo leído del
                     * NVR un par de minutos, así que no se le vuelve a preguntar por cada una.
                     */
                    const area = areaId !== "none" ? areaId : null;
                    setImportados(pedidos.map((p) => {
                        const c = (canales || []).find((x) => x.channel === p.channel);
                        return { channel: p.channel, name: c?.existente?.name || c?.name || `Canal ${p.channel}`, rol: c?.existente ? "vincular" : (p.rol as "lpr" | "intrusion"), estado: "espera" as Estado };
                    }));
                    actualizar("importar", { estado: "corriendo", detalle: `0 de ${pedidos.length}` });
                    let creadas = 0, mapeadas = 0, fallidas = 0;
                    for (let i = 0; i < pedidos.length; i++) {
                        const p = pedidos[i];
                        setImportados((fs) => fs.map((x) => (x.channel === p.channel ? { ...x, estado: "corriendo" } : x)));
                        const ri = await importarCanalesClasificados(id, [p], { areaId: area })
                            .catch((e: any) => ({ ok: false, error: e?.message || "sin respuesta", creadas: 0, mapeadas: 0, detalle: [] as any[] }));
                        const d = ri.detalle?.[0];
                        creadas += ri.creadas || 0; mapeadas += ri.mapeadas || 0;
                        if (!ri.ok) fallidas++;
                        let estado: Estado = !ri.ok ? "error" : !d || d.accion === "omitida" ? "salteado" : "ok";
                        let detalle = !ri.ok ? ri.error : d ? [d.accion === "mapeada" ? "ya existía: se vinculó su grabación" : d.accion, d.accion !== "mapeada" ? d.motivo : null].filter(Boolean).join(" · ") : "sin cambios";
                        /*
                         * El servidor de alarmas de cada cámara nueva, como en el alta de una cámara suelta
                         * (21/10, Nico preguntó si se configuraba al importar: no se hacía). Sin esto la cámara
                         * se crea pero sus cruces de línea y entradas a zona no llegan al monitor. Intrusión:
                         * si el modo avisa (en «OmniVision» la mira el detector y la cámara no manda nada).
                         * LPR Hikvision ya lo trae de su puesta a punto (provisionLprDevice); LPR de otra marca,
                         * acá. Dahua no escribe nada en la cámara: OmniAccess se suscribe al NVR.
                         */
                        const canalP = (canales || []).find((x) => x.channel === p.channel);
                        const avisa = p.rol === "intrusion" ? !!MODOS_INTRUSION[(p.modo as ModoIntrusion) || "doble"]?.avisos
                            : p.rol === "lpr" ? p.modo !== "omnivision" && (canalP?.marca || f.brand) !== "HIKVISION" : false;
                        let alarma: string | null = null;
                        const base = detalle;
                        if (ri.ok && d?.id && String(d.accion).startsWith("creada") && avisa) {
                            setImportados((fs) => fs.map((x) => (x.channel === p.channel ? { ...x, detalle: `${detalle} · configurando el servidor de alarmas…` } : x)));
                            const a = await fetch(`/api/devices/alarm-host?deviceId=${d.id}`, { method: "POST" }).then((x) => x.json()).catch(() => null);
                            if (a?.ok) detalle = `${detalle} · avisa a OmniAccess`;
                            else {
                                // La cámara quedó creada: lo que falló es sólo que avise. Se puede reintentar al final.
                                estado = "error"; fallidas++; alarma = a?.error || "sin respuesta";
                                if (a?.sinDestino) setFaltaDestino(true);
                                detalle = `${detalle} · no quedó avisando: ${alarma}`;
                            }
                        }
                        setImportados((fs) => fs.map((x) => (x.channel === p.channel ? { ...x, estado, detalle, id: d?.id, alarma, base } : x)));
                        actualizar("importar", { estado: "corriendo", detalle: `${i + 1} de ${pedidos.length}` });
                    }
                    actualizar("importar", fallidas
                        ? { estado: "error", detalle: `${creadas} nuevas · ${mapeadas} vinculadas · ${fallidas} con error (abajo, cuáles)` }
                        : { estado: "ok", detalle: `${creadas} nuevas · ${mapeadas} ya existían y quedaron vinculadas` });
                    if (area) actualizar("ubicar", { estado: creadas + mapeadas ? "ok" : "salteado", detalle: creadas + mapeadas ? `${creadas + mapeadas} cámaras en el área` : "no quedó ninguna para ubicar" });
                }
            }
            setTerminado(true);
            onSuccess();
        } catch (e: any) {
            setTareas((ts) => ts.map((t) => (t.estado === "corriendo" || (t.clave === "crear" && !id) ? { ...t, estado: "error", detalle: e?.message || "error" } : t)));
            toast.error({ title: "No se pudo completar el alta", description: e?.message });
        } finally { setCorriendo(false); }
    };

    /* ── Edición ── */
    const guardarCambios = async () => {
        if (!device?.id) return;
        if (!f.name.trim()) { toast.error({ title: "Falta el nombre" }); return; }
        if (!ipValida) { toast.error({ title: "La IP no es válida", description: "Ejemplo: 172.16.2.210" }); return; }
        setGuardando(true);
        try {
            const fd = new FormData();
            Object.entries(f).forEach(([k, v]) => fd.append(k, String(v)));
            await updateDevice(device.id, fd);
            // El modo va después: puede cambiar el tipo guardado (la lectura de OmniVision es una
            // LPR_INTERIOR), y updateDevice escribe el tipo que traía el formulario.
            const cambioLpr = tipo === "LPR_CAMERA" && (modoLpr !== modoAntes.lpr || abre !== modoAntes.abre);
            const cambioIntr = tipo === "CAMERA" && modoIntr !== modoAntes.intr;
            if (cambioLpr || cambioIntr) {
                const r = await ponerModoCamara(device.id, cambioLpr ? { lpr: { modo: modoLpr, abre } } : { intrusion: modoIntr });
                if (!r.ok) throw new Error(r.error || "No se pudo cambiar el modo");
                if (r.pendientes.length) toast.info({ title: "Modo cambiado; le falta:", description: r.pendientes.join(" · ") });
            }
            if (grabacionElegida?.nvrId && (!actual || actual.ch !== grabacionElegida.ch || actual.nvr !== grabacionElegida.nvrId)) await asignarGrabacion(f.ip.trim(), grabacionElegida.nvrId, grabacionElegida.ch);
            toast.success({ title: "Cambios guardados", description: f.name });
            onSuccess(); onOpenChange(false);
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };
    async function calcRet() {
        if (!device?.id) return;
        setCalculando(true);
        try {
            const rt = await calcularRetencion(device.id);
            setRetencion(rt.ok && rt.retencion && !rt.retencion.error ? textoRetencion(rt.retencion) : `No se pudo calcular: ${rt.error || rt.retencion?.error || "sin respuesta"}`);
        } finally { setCalculando(false); }
    }

    const fallas = tareas.filter((t) => t.estado === "error");
    const nvrActual = actual ? nvrs.find((n) => n.id === actual.nvr) : null;
    const resumenCanales = useMemo(() => {
        const v = (canales || []).filter((c) => !c.existente && c.ip && !c.sensorDe);
        return { lpr: v.filter((c) => eleccion[c.channel]?.rol === "lpr").length, intr: v.filter((c) => eleccion[c.channel]?.rol === "intrusion").length, ya: (canales || []).filter((c) => c.existente).length };
    }, [canales, eleccion]);

    /* ── Bloques reutilizados por alta y ficha ── */
    const bloqueMarca = (
        <div className="grid grid-cols-2 gap-3">
            {(["HIKVISION", "DAHUA"] as Marca[]).map((m) => (
                <Opcion key={m} activa={f.brand === m} onClick={() => !esEdicion && set("brand", m)} icono={Cpu} color={m === "HIKVISION" ? "bg-red-500/10 text-red-500" : "bg-sky-500/10 text-sky-500"}
                    titulo={m === "HIKVISION" ? "Hikvision" : "Dahua"}
                    detalle={m === "HIKVISION" ? "Configuración automática por ISAPI" : "Hora y alarmas automáticas; el resto desde su web"}
                    ayuda={esEdicion ? "El fabricante no se cambia en un equipo ya dado de alta." : m === "HIKVISION" ? "Por ISAPI se configura sola: hora, envío de eventos, ANPR, H.264 y matrículas." : "Por CGI se configura la hora y el servidor de alarmas; ANPR y video se ajustan desde la web del equipo."} />
            ))}
        </div>
    );

    const bloqueConexion = (
        <>
            <div className="grid grid-cols-2 gap-4">
                {/* La IP y, al lado, el puerto web (21/10, Nico: un NVR con la web en otro puerto daba
                    «ECONNREFUSED …:80» al leer los canales). Si se tipea «ip:puerto» en la IP, se separa solo. */}
                <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
                    <Campo etiqueta="Dirección IP" icono={Network} value={f.ip}
                        onChange={(v) => {
                            const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})\s*$/.exec(v);
                            setF((p) => ({ ...p, ip: m ? m[1] : v, ...(m ? { httpPort: m[2] } : {}) }));
                            setInfo(null); setDonde(null); setCanales(null); setErrorCanales("");
                        }} placeholder="172.16.2.210" mono
                        ayuda="La IP fija del equipo en la red del barrio. Ejemplos: 172.16.2.210 (cámara LPR), 172.16.2.59 (NVR). Con esta IP también se busca en qué NVR graba. Si escribís «IP:puerto», el puerto pasa al campo de al lado." />
                    <Campo etiqueta="Puerto web" icono={Plug} value={f.httpPort}
                        onChange={(v) => { set("httpPort", v.replace(/\D/g, "").slice(0, 5)); setInfo(null); setCanales(null); setErrorCanales(""); }} placeholder="80" mono
                        ayuda="El puerto HTTP de la web del equipo, por donde se lo configura y se leen sus canales (ISAPI). Vacío = 80. Cambialo si el equipo tiene la web en otro puerto, ej. 8080, o si está publicado con NAT." />
                </div>
                {tipo === "NVR" ? (
                    <Campo etiqueta="Puerto RTSP" icono={Plug} value={f.port} onChange={(v) => set("port", v.replace(/\D/g, ""))} placeholder="554" mono
                        ayuda="Puerto RTSP del NVR para reproducir grabaciones y clips. Por defecto 554; si está publicado con NAT puede ser otro, ej. 10554." />
                ) : (
                    <label className="block">
                        <Etiqueta texto="Autenticación" ayuda="Hikvision usa Digest (recomendado). Dahua acepta Digest o Basic. Si la detección falla con Digest se prueba Basic sola." />
                        <Select value={f.authType} onValueChange={(v) => set("authType", v)}>
                            <SelectTrigger className="h-10"><ShieldCheck size={15} className="text-muted-foreground mr-1" /><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="DIGEST">Digest</SelectItem><SelectItem value="BASIC">Basic</SelectItem></SelectContent>
                        </Select>
                    </label>
                )}
                <Campo etiqueta="Usuario" icono={User} value={f.username} onChange={(v) => set("username", v)} placeholder="admin"
                    ayuda="Un usuario con permisos de administrador del equipo. Ej.: admin. Se usa para configurarlo y para el video." />
                <Campo etiqueta="Contraseña" icono={KeyRound} tipo="password" value={f.password} onChange={(v) => set("password", v)} placeholder="••••••••"
                    ayuda="La clave de ese usuario. Queda guardada en el servidor y no se muestra en las listas." />
                {tipo === "NVR" && (
                    <label className="block">
                        <Etiqueta texto="Autenticación" ayuda="Hikvision: Digest. Dahua: Digest o Basic." />
                        <Select value={f.authType} onValueChange={(v) => set("authType", v)}>
                            <SelectTrigger className="h-10"><ShieldCheck size={15} className="text-muted-foreground mr-1" /><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="DIGEST">Digest</SelectItem><SelectItem value="BASIC">Basic</SelectItem></SelectContent>
                        </Select>
                    </label>
                )}
                <Campo etiqueta="MAC" icono={Fingerprint} value={f.mac} onChange={(v) => set("mac", v)} placeholder="Se completa al detectar" mono
                    ayuda="Identifica al equipo aunque le cambien la IP. Ej.: 24:0f:9b:aa:12:34. La completa «Detectar equipo»." />
            </div>
            <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                <div className="flex items-center gap-3">
                    <Button type="button" variant="outline" onClick={detectar} disabled={!ipValida || detectando} className="gap-1.5 shrink-0">
                        {detectando ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={15} />} Detectar equipo
                    </Button>
                    <span className="text-[12px] text-muted-foreground">Lee modelo, MAC y firmware: si responde, la IP y la clave son correctas y el servidor lo alcanza.</span>
                </div>
                <AnimatePresence>
                    {info && (
                        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className={cn("rounded-lg p-3 text-[12.5px] flex items-start gap-2.5", info.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-300")}>
                            {info.ok ? <Check size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
                            {info.ok
                                ? <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 flex-1"><span>Modelo: <b>{info.model || "—"}</b></span><span>MAC: <b className="font-mono">{info.macAddress || "—"}</b></span><span>Firmware: <b>{info.firmwareVersion || "—"}</b></span><span>Auth: <b>{info.authType || f.authType}</b></span></div>
                                : <span>No respondió: {info.error || "revisá IP, usuario y contraseña"}</span>}
                        </motion.div>
                    )}
                </AnimatePresence>
                {/* En el alta: lo que la cámara sabe hacer, y si conviene otro tipo que el elegido. */}
                {!esEdicion && tipo !== "NVR" && (leyendoCaps || caps) && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap text-[12px] text-muted-foreground">
                            {leyendoCaps ? <><Loader2 size={13} className="animate-spin" /> Preguntándole qué sabe hacer…</> : caps ? <>La cámara sabe: <ChipsCapacidades c={caps} /></> : null}
                        </div>
                        {caps && caps.fuente === "camara" && (tipo === "LPR_CAMERA" || tipo === "CAMERA") && caps.sugerido.tipo !== tipo && !(tipo === "LPR_CAMERA" && (opcionAlta === "omnilpr" || modoLpr === "omnivision")) && (
                            <div className="rounded-lg chip-aviso px-3 py-2.5 text-[12.5px] flex items-center gap-2">
                                <AlertTriangle size={15} className="shrink-0" />
                                <span className="flex-1">La cámara {caps.sugerido.por}: conviene darla de alta como <b>{caps.sugerido.tipo === "LPR_CAMERA" ? "Cámara LPR" : "Cámara de intrusión"}</b>.</span>
                                <Button size="sm" onClick={() => cambiarTipo(caps.sugerido.tipo)}>Cambiar</Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );

    const bloqueSentido = (
        <div className="grid grid-cols-2 gap-3">
            <Opcion activa={f.direction === "ENTRY"} onClick={() => set("direction", "ENTRY")} icono={LogIn} titulo="Entrada" detalle="Lee a los que entran al barrio" color="bg-emerald-500/15 text-emerald-500"
                ayuda="Aparece en la columna de entradas del monitor y suma a «adentro ahora». Ej.: carril de ingreso de la garita P1." />
            <Opcion activa={f.direction === "EXIT"} onClick={() => set("direction", "EXIT")} icono={LogOut} titulo="Salida" detalle="Lee a los que salen; cierra visitas" color="bg-orange-500/15 text-orange-500"
                ayuda="Aparece en la columna de salidas y cierra las visitas abiertas de esa matrícula. Ej.: carril de egreso de la garita P1." />
        </div>
    );

    const bloqueBusquedaGrabacion = (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500"><ScanSearch size={19} /></span>
                <div className="flex-1 text-[12px] text-muted-foreground">Se busca la IP <b className="font-mono text-foreground">{f.ip || "—"}</b> en los canales de todos los NVR dados de alta.</div>
                <Button variant="outline" size="sm" onClick={buscarGrabacion} disabled={buscando || !ipValida} className="gap-1.5">{buscando ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />} {donde ? "Buscar de nuevo" : "Buscar"}</Button>
            </div>
            {buscando && <div className="rounded-xl border border-dashed border-border p-6 grid place-items-center text-muted-foreground text-[13px] gap-2"><Loader2 size={22} className="animate-spin" /> Consultando los NVR…</div>}
            {donde && !buscando && (
                <>
                    {donde.nvrs.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {donde.nvrs.map((n) => (
                                <span key={n.nombre} {...tip(n.ok ? `${n.canales} canales leídos` : `No respondió: ${n.error || "sin respuesta"}`)}
                                    className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px]", n.ok ? "border-border text-muted-foreground" : "border-red-500/30 text-red-500")}>
                                    <HardDrive size={12} /> {n.nombre} {n.ok ? <Check size={12} className="text-emerald-500" /> : <X size={12} />}
                                </span>
                            ))}
                        </div>
                    )}
                    {donde.error ? (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-[13px] text-red-600 dark:text-red-300 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> No se pudo consultar los NVR: {donde.error}. Probá «Buscar de nuevo» o elegilo a mano abajo.</div>
                    ) : donde.ubicacion ? (
                        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
                            <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500 text-white"><Check size={18} /></span>
                            <div>
                                <div className="font-bold">Graba en {donde.ubicacion.nvrNombre} · canal {donde.ubicacion.ch}</div>
                                <div className="text-[12px] text-muted-foreground">{donde.ubicacion.canalNombre ? `El NVR la tiene como «${donde.ubicacion.canalNombre}». ` : ""}Clips y playback salen de ahí.</div>
                            </div>
                        </motion.div>
                    ) : !donde.hayNvr ? (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
                            <div className="font-bold text-red-600 dark:text-red-300 inline-flex items-center gap-2"><AlertTriangle size={16} /> No hay ningún NVR dado de alta</div>
                            <p className="text-[13px] text-muted-foreground">Sin NVR esta cámara <b>no va a tener grabaciones</b>. Sugerido: agregá primero el NVR (Agregar → NVR) y volvé a buscar.</p>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-1">
                            <div className="font-bold text-amber-700 dark:text-amber-300 inline-flex items-center gap-2"><AlertTriangle size={16} /> Ningún NVR tiene esta IP en sus canales</div>
                            <p className="text-[12.5px] text-muted-foreground">Puede grabarla un NVR que todavía no está dado de alta (sugerido: agregarlo), o tenerla con otra IP. Si sabés dónde graba, elegilo a mano.</p>
                        </div>
                    )}
                </>
            )}
            {(!donde?.ubicacion || esEdicion) && (
                <div className="grid grid-cols-[1fr_120px] gap-3">
                    <label className="block">
                        <Etiqueta texto="NVR (a mano)" ayuda="Si la búsqueda no la encuentra pero sabés dónde graba. Ej.: NVR Sildan." />
                        <Select value={manual.nvrId} onValueChange={(v) => setManual((m) => ({ ...m, nvrId: v }))}>
                            <SelectTrigger className="h-10"><HardDrive size={15} className="text-muted-foreground mr-1" /><SelectValue placeholder="Elegí el NVR" /></SelectTrigger>
                            <SelectContent>{nvrs.map((n) => <SelectItem key={n.id} value={n.id}>{n.name} · {n.ip}</SelectItem>)}</SelectContent>
                        </Select>
                    </label>
                    <Campo etiqueta="Canal" icono={Hash} value={manual.ch} onChange={(v) => setManual((m) => ({ ...m, ch: v.replace(/\D/g, "") }))} placeholder="12" mono
                        ayuda="Número de canal en el NVR (como figura en su lista de cámaras). Ej.: 12 para D12." />
                </div>
            )}
        </div>
    );

    /* ── Pie ── */
    const pie = esEdicion ? (
        <div className="flex items-center gap-2 w-full">
            <span className="flex-1 text-[12px] text-muted-foreground truncate">{meta?.rotulo} · {device?.ip}</span>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
            <Button onClick={guardarCambios} disabled={guardando} className="gap-1.5">{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar cambios</Button>
        </div>
    ) : (
        <div className="flex items-center gap-2 w-full">
            {paso > 0 && !corriendo && !terminado && <Button variant="outline" onClick={() => ir(paso - 1)} className="gap-1"><ChevronLeft size={15} /> Atrás</Button>}
            <span className="flex-1 text-[12px] text-muted-foreground truncate">{bloqueo || ""}</span>
            {!ultimo && clave !== "tipo" && <Button onClick={() => ir(paso + 1)} disabled={!!bloqueo} className="gap-1">Siguiente <ChevronRight size={15} /></Button>}
            {ultimo && clave !== "tipo" && !terminado && <Button onClick={puestaAPunto} disabled={corriendo || tareas.length > 0} className="gap-1.5 bg-[var(--accion)] text-white">{corriendo ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} Crear y poner a punto</Button>}
            {terminado && tipo === "CAMERA" && creadoId && alCalibrar && (
                <Button variant="outline" onClick={() => { onOpenChange(false); alCalibrar({ id: creadoId, name: f.name, ip: f.ip, brand: f.brand, deviceType: "CAMERA" }); }} className="gap-1.5 text-red-500 border-red-500/30"><Crosshair size={15} /> Calibrar ahora</Button>
            )}
            {terminado && <Button onClick={() => onOpenChange(false)} className="gap-1.5"><Check size={15} /> Listo</Button>}
        </div>
    );

    return (
        <Cajon open={open} onOpenChange={(v) => { if (!corriendo) onOpenChange(v); }}>
            <CajonContenido ancho={esEdicion ? "intermedio" : "medio"} tituloOculto={esEdicion} sinCabecera={esEdicion} sinCerrar={corriendo}
                onInteractOutside={(e) => { if (corriendo) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (corriendo) e.preventDefault(); }}
                titulo={esEdicion ? (device?.name || "Equipo") : (clave === "modo" ? TITULO_MODO[tipo] : TITULOS[clave]) || "Nuevo equipo"}
                descripcion={esEdicion ? `${meta?.rotulo || "Equipo"} · ${f.brand === "HIKVISION" ? "Hikvision" : "Dahua"}${f.deviceModel ? ` · ${f.deviceModel}` : ""}` : clave === "tipo" ? "Lo primero, porque de esto dependen los pasos que siguen." : `${OPCIONES_ALTA.find((o) => o.id === opcionAlta)?.rotulo || meta?.rotulo} · alta guiada`}
                encabezado={esEdicion ? undefined : clave === "tipo"
                    ? <div className="h-0.5 bg-border/60"><div className="h-full w-[6%] bg-[var(--accion)]" /></div>
                    : <BarraDePasos pasos={pasos.slice(1)} actual={paso - 1} alIr={(i) => !corriendo && !terminado && i + 1 < paso && ir(i + 1)} />}
                pie={pie}>

                {esEdicion ? (
                    /* ───────── FICHA (edición) ───────── */
                    <div>
                        {tipo === "NVR" ? (
                            <CabeceraNvr device={device} titulo={f.name || device?.name || "NVR"} subtitulo={`NVR / Grabador · ${f.brand === "HIKVISION" ? "Hikvision" : "Dahua"}${f.deviceModel ? ` · ${f.deviceModel}` : ""}`}
                                ip={f.ip} mac={f.mac} detectando={detectando} puedeDetectar={ipValida} onComprobar={detectar} info={info} />
                        ) : (
                            <CabeceraVideo device={device} titulo={f.name || device?.name || "Equipo"} subtitulo={`${meta?.rotulo || "Equipo"} · ${f.brand === "HIKVISION" ? "Hikvision" : "Dahua"}${f.deviceModel ? ` · ${f.deviceModel}` : ""}`} tipo={tipo} meta={meta} f={f} actual={actual} nvrNombre={nvrActual?.name || null}
                                detectando={detectando} puedeDetectar={ipValida} onComprobar={detectar} info={info} />
                        )}
                        <Bloque titulo="Identidad" icono={Tag} ayuda="Cómo se llama el equipo y dónde está. Es lo que se ve en el monitor, el historial y los avisos.">
                            <Campo etiqueta="Nombre" icono={Type} value={f.name} onChange={(v) => set("name", v)}
                                placeholder={tipo === "NVR" ? "NVR Sildan" : tipo === "CAMERA" ? "Perímetro Norte 12" : "P1 - Entrada (207)"}
                                ayuda={tipo === "LPR_CAMERA" ? "Conviene incluir la garita y el sentido. Ej.: «P1 - Entrada (207)». Si incluye P1, P2… el monitor agrupa el semáforo en esa garita." : "El nombre del lugar dice más que el modelo. Ej.: «Perímetro Norte 12»."} />
                            <div className="grid grid-cols-2 gap-4">
                                <Dato etiqueta="Modelo" icono={Cpu} valor={f.deviceModel} faltante="Sin leer: «Comprobar» lo trae del equipo"
                                    ayuda="Lo lee el equipo mismo al comprobar (no se escribe a mano): un modelo tipeado mal hacía elegir mal el driver y la foto." />
                                {tipo !== "NVR" && <Campo etiqueta="Ubicación / garita" icono={MapPin} value={f.location} onChange={(v) => set("location", v)} placeholder="Garita P1"
                                    ayuda="Texto libre. Ej.: «Garita P1», «Lote 120 fondo». En LPR, «P1»/«P2» agrupan el semáforo en el monitor." />}
                            </div>
                            {tipo === "LPR_CAMERA" && <div><Etiqueta texto="Sentido" ayuda="Decide la columna del monitor, si suma a «adentro ahora» y si cierra visitas. Ej.: el carril de ingreso de P1 es Entrada." />{bloqueSentido}</div>}
                        </Bloque>
                        {(tipo === "LPR_CAMERA" || tipo === "CAMERA") && (
                            <Bloque titulo="Qué hace OmniAccess con esta cámara" icono={tipo === "LPR_CAMERA" ? ScanLine : Radar}
                                ayuda={tipo === "LPR_CAMERA" ? "Quién lee la matrícula: la cámara, la cámara verificada por omni-lpr, u omni-lpr solo. Se aplica al guardar." : "Quién detecta la intrusión: la cámara, la cámara verificada por OmniVision, OmniVision solo, o nadie (sólo video). Se aplica al guardar."}>
                                <TipoDeCamara tipo={tipo as "LPR_CAMERA" | "CAMERA"} original={tipoOriginal} caps={caps} leyendo={leyendoCaps} modoLpr={modoLpr} modoIntr={modoIntr} onCambiar={cambiarTipo} />
                                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground pt-1">{tipo === "LPR_CAMERA" ? "¿Quién lee la matrícula?" : "¿Quién detecta la intrusión?"}</div>
                                {tipo === "LPR_CAMERA"
                                    ? <ElegirModoLpr valor={modoLpr} abre={abre} onCambiar={(m, a) => { setModoLpr(m); setAbre(a); }} antes={modoAntes.lpr} />
                                    : <ElegirModoIntrusion valor={modoIntr} onCambiar={setModoIntr} antes={modoAntes.intr} />}
                            </Bloque>
                        )}
                        <Bloque titulo="Conexión" icono={Network} ayuda="Cómo llega el servidor al equipo. Si cambiás IP o clave, «Comprobar» confirma que sigue respondiendo.">{bloqueConexion}</Bloque>
                        {tipo !== "NVR" && (
                            <Bloque titulo="Grabación" icono={HardDrive} ayuda="En qué NVR y canal se graba: de ahí salen los clips y el playback."
                                accion={<Button variant="outline" size="sm" onClick={calcRet} disabled={calculando || !actual} className="gap-1.5" {...tip("Busca en el NVR la grabación más vieja de este canal y calcula cuántos días guarda.")}>{calculando ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />} Calcular retención</Button>}>
                                <div className={cn("rounded-xl border p-3.5 flex items-center gap-3 text-[13px]", actual ? "border-emerald-500/25 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
                                    {actual ? <Link2 size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-amber-500" />}
                                    <span className="flex-1">{actual ? <>Vinculada a <b>{nvrActual?.name || "NVR"}</b> · canal <b>{actual.ch}</b></> : "Sin grabación vinculada: no hay clips ni playback."}</span>
                                </div>
                                {retencion && <div className="text-[12.5px] text-muted-foreground inline-flex items-center gap-1.5"><Clock size={13} /> {retencion}</div>}
                                {bloqueBusquedaGrabacion}
                            </Bloque>
                        )}
                        {tipo === "CAMERA" && alCalibrar && (
                            <Bloque titulo="Analítica de intrusión" icono={Crosshair} ayuda="Línea de cruce, zona, sentido, sensibilidad, objetivo y aviso a OmniAccess, sobre el video en vivo.">
                                <Button variant="outline" onClick={() => { onOpenChange(false); alCalibrar(device); }} className="gap-1.5 text-red-500 border-red-500/30"><Crosshair size={15} /> Abrir el calibrador</Button>
                            </Bloque>
                        )}
                        {tipo === "NVR" && alImportar && (
                            <Bloque titulo="Cámaras del NVR" icono={Download} ayuda="Lee los canales y deja elegir qué es cada cámara (LPR o intrusión) antes de crearla. Las que ya existen sólo se vinculan a su grabación.">
                                <Button variant="outline" onClick={() => { onOpenChange(false); alImportar(device); }} className="gap-1.5"><Download size={15} /> Importar y clasificar cámaras</Button>
                            </Bloque>
                        )}
                    </div>
                ) : (
                    /* ───────── ALTA POR PASOS ───────── */
                    <PasoAnimado clave={clave} hacia={hacia}>
                        {clave === "tipo" && (
                            <div className="px-6 py-6 grid gap-3">
                                {OPCIONES_ALTA.map((t) => (
                                    <button key={t.id} type="button" onClick={() => { set("deviceType", t.valor); if (t.modo) { setModoLpr(t.modo); setAbre(false); } setOpcionAlta(t.id); setHacia(1); setPaso(1); setCanales(null); setDonde(null); }}
                                        className={cn("group text-left rounded-2xl border p-4 flex gap-4 transition-colors",
                                            opcionAlta === t.id ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border bg-card/40 hover:bg-accent/50")}>
                                        <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-xl border", t.color)}><t.icono size={22} /></span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-2 text-[14.5px] font-bold text-foreground">{t.rotulo}<span {...tip(t.ejemplo)} className="text-muted-foreground/60 hover:text-[var(--accion)]"><Info size={13} /></span></span>
                                            <span className="block text-[12.5px] text-muted-foreground leading-snug mt-0.5">{t.que}</span>
                                            <span className="mt-2 flex flex-wrap gap-1.5">
                                                {PASOS_POR_TIPO[t.valor].map((p, i) => <span key={p.clave} className="px-2 py-0.5 rounded-full bg-muted/70 text-[10.5px] font-semibold text-muted-foreground">{i + 1}. {p.rotulo}</span>)}
                                            </span>
                                        </span>
                                        <ChevronRight size={18} className="self-center text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </button>
                                ))}
                            </div>
                        )}

                        {clave === "equipo" && (
                            <>
                                <Bloque titulo="Fabricante" icono={Cpu} ayuda="Decide con qué protocolo se lo configura (ISAPI para Hikvision, CGI para Dahua).">{bloqueMarca}</Bloque>
                                <Bloque titulo="Identidad" icono={Tag}>
                                    <Campo etiqueta="Nombre" icono={Type} value={f.name} onChange={(v) => set("name", v)} autoFocus
                                        placeholder={tipo === "NVR" ? "NVR Sildan" : tipo === "CAMERA" ? "Perímetro Norte 12" : "P1 - Entrada (207)"}
                                        ayuda={tipo === "LPR_CAMERA" ? "Como va a aparecer en el monitor, el historial y los semáforos. Ej.: «P1 - Entrada (207)» o «P2 - Salida (221)»." : tipo === "NVR" ? "Ej.: «NVR Sildan», «NVR Perímetro Sur». Es el nombre que se ve en la columna Grabaciones." : "Ej.: «Perímetro Norte 12», «Portón de servicio». Es como aparece en el monitor de intrusión."} />
                                    {tipo !== "NVR" && (
                                        <Campo etiqueta="Ubicación" icono={MapPin} value={f.location} onChange={(v) => set("location", v)} placeholder={tipo === "LPR_CAMERA" ? "Garita P1" : "Cerco norte, lote 120"}
                                            ayuda={tipo === "LPR_CAMERA" ? "Texto libre. Si incluye «P1», «P2»… el monitor agrupa el semáforo en esa garita." : "Dónde está, para encontrarla rápido en el monitor. Ej.: «Cerco norte, lote 120»."} />
                                    )}
                                </Bloque>
                            </>
                        )}

                        {clave === "conexion" && <Bloque titulo="Acceso al equipo" icono={Network} ayuda="IP y credenciales juntas: la detección necesita las tres cosas.">{bloqueConexion}</Bloque>}

                        {clave === "modo" && (
                            <div className="px-6 py-6">
                                {tipo === "LPR_CAMERA"
                                    ? <ElegirModoLpr valor={modoLpr} abre={abre} onCambiar={(m, a) => { setModoLpr(m); setAbre(a); }} />
                                    : <ElegirModoIntrusion valor={modoIntr} onCambiar={setModoIntr} />}
                            </div>
                        )}

                        {clave === "lugar" && (
                            <>
                                <Bloque titulo="Sentido" icono={MapPin} ayuda="Decide la columna del monitor, si suma a «adentro ahora» y si cierra visitas.">{bloqueSentido}</Bloque>
                                <Bloque titulo="Grupo de acceso" icono={Users} ayuda="Quiénes pasan por esta cámara. Ej.: «Residentes + Proveedores». Sin grupo queda cargada pero no habilita a nadie.">
                                    <Select value={f.groupId} onValueChange={(v) => set("groupId", v)}>
                                        <SelectTrigger className="h-10"><Users size={15} className="text-muted-foreground mr-1" /><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Sin grupo</SelectItem>
                                            {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    {f.groupId === "none" && <p className="text-[12px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1.5"><AlertTriangle size={13} /> Sin grupo de acceso la cámara no deja pasar a nadie por servidor.</p>}
                                </Bloque>
                            </>
                        )}

                        {clave === "grabacion" && (
                            <Bloque titulo="Grabación en NVR" icono={HardDrive} ayuda="Se busca sola al entrar. Sin NVR no hay clips de las lecturas ni playback.">
                                {bloqueBusquedaGrabacion}
                                {!donde?.ubicacion && !buscando && (
                                    <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none">
                                        <input type="checkbox" checked={sinGrabar} onChange={(e) => setSinGrabar(e.target.checked)} className="h-4 w-4 accent-[var(--accion)]" />
                                        Seguir sin grabaciones (funciona, pero sus eventos no van a tener video)
                                    </label>
                                )}
                            </Bloque>
                        )}

                        {clave === "canales" && (
                            <Bloque titulo="Qué es cada cámara" icono={Camera} ayuda="A cada cámara se le pregunta qué sabe hacer (ANPR, cruce de línea, zona) y eso decide la sugerencia; si no contesta, sale del nombre del canal. Siempre se puede cambiar. Las que ya existen sólo se vinculan."
                                accion={<Button variant="outline" size="sm" onClick={leerCanales} disabled={leyendo} className="gap-1.5">{leyendo ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />} Leer de nuevo</Button>}>
                                {leyendo && <div className="rounded-xl border border-dashed border-border p-8 grid place-items-center text-muted-foreground text-[13px] gap-2"><Loader2 size={22} className="animate-spin" /> Leyendo los canales del NVR…</div>}
                                {errorCanales && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-[13px] text-red-600 dark:text-red-300 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {errorCanales}. Revisá IP y credenciales en el paso anterior; también podés seguir y importar después desde el menú del NVR.</div>}
                                {canales && !leyendo && (
                                    <>
                                        <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                                            <span className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold inline-flex items-center gap-1"><Car size={12} /> {resumenCanales.lpr} LPR</span>
                                            <span className="px-2.5 py-1 rounded-full bg-red-500/10 text-red-500 font-semibold inline-flex items-center gap-1"><Radar size={12} /> {resumenCanales.intr} intrusión</span>
                                            <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold inline-flex items-center gap-1"><Link2 size={12} /> {resumenCanales.ya} ya existen</span>
                                            <div className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                                                Marcar todas:
                                                {([["lpr", "LPR"], ["intrusion", "Intrusión"], ["omitir", "Ninguna"]] as const).map(([v, t]) => (
                                                    <button key={v} type="button" onClick={() => setEleccion((p) => Object.fromEntries(Object.entries(p).map(([k, e]) => [k, (canales.find((c) => c.channel === Number(k))?.existente || !canales.find((c) => c.channel === Number(k))?.ip || canales.find((c) => c.channel === Number(k))?.sensorDe) ? e : { ...e, rol: v }])))}
                                                        className="px-2 h-6 rounded-md border border-border font-semibold hover:bg-accent">{t}</button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="border border-border rounded-xl overflow-hidden max-h-[46vh] overflow-y-auto">
                                            {canales.map((c) => {
                                                const e = eleccion[c.channel];
                                                return (
                                                    <div key={c.channel} className="flex items-center gap-3 px-3 py-2 border-b border-border/50 last:border-0">
                                                        <span className="w-9 text-center font-mono text-[11px] text-muted-foreground">D{c.channel}</span>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-[12.5px] font-semibold truncate">{c.name}</div>
                                                            <div className="text-[10.5px] text-muted-foreground font-mono flex items-center gap-1.5 flex-wrap">{c.ip || "sin IP"}{c.model ? ` · ${c.model}` : ""}
                                                                <span {...tip(`Fabricante de la cámara según el NVR${c.protocolo ? ` (protocolo ${c.protocolo})` : ""}. Un NVR puede grabar cámaras de otras marcas: esto decide cómo se le habla directo; las grabaciones siempre salen del NVR.`)}
                                                                    className={cn("font-sans px-1.5 rounded text-[9px] font-bold uppercase border", c.marca === "HIKVISION" ? "bg-red-500/10 text-red-500 border-red-500/25" : c.marca === "DAHUA" ? "bg-sky-500/10 text-sky-500 border-sky-500/25" : "bg-muted text-muted-foreground border-border")}>{c.marca === "OTRA" ? "Otra marca" : c.marca}</span>
                                                                {c.sensorDe && <span {...tip(`Misma IP que D${c.sensorDe}: otro sensor de la misma cámara (térmico + visible). Se graba igual; no se crea aparte.`)} className="font-sans px-1.5 rounded text-[9px] font-bold uppercase bg-violet-500/10 text-violet-500 border border-violet-500/25">2.º sensor</span>}
                                                                {c.ip && <ChipsCapacidades c={capsCanal[c.ip]} chico className="font-sans" />}
                                                            </div>
                                                        </div>
                                                        {c.existente ? (
                                                            <span {...tip(`Ya existe como «${c.existente.name}». Sólo se le vincula este canal como su grabación.`)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><Link2 size={12} /> Se vincula</span>
                                                        ) : !c.ip || c.sensorDe ? <span className="text-[11px] text-muted-foreground">{c.sensorDe ? `con D${c.sensorDe}` : "No importable"}</span> : (
                                                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                                                                <div className="inline-flex rounded-lg bg-muted/60 p-0.5">
                                                                    {([["lpr", "LPR", Car], ["intrusion", "Intrusión", Radar], ["omitir", "No", Ban]] as const).map(([v, t, I]) => (
                                                                        <button key={v} type="button" onClick={() => setEleccion((p) => ({ ...p, [c.channel]: { ...p[c.channel], rol: v } }))}
                                                                            className={cn("h-7 px-2 rounded-md text-[11px] font-bold inline-flex items-center gap-1", e?.rol === v ? (v === "lpr" ? "bg-amber-500 text-black" : v === "intrusion" ? "bg-red-500 text-white" : "bg-neutral-600 text-white") : "text-muted-foreground hover:text-foreground")}>
                                                                            <I size={12} /> {t}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                                {e?.rol === "lpr" && (
                                                                    <div className="inline-flex rounded-lg bg-muted/60 p-0.5">
                                                                        {([["ENTRY", LogIn, "Entrada"], ["EXIT", LogOut, "Salida"]] as const).map(([v, I, t]) => (
                                                                            <button key={v} type="button" {...tip(t)} onClick={() => setEleccion((p) => ({ ...p, [c.channel]: { ...p[c.channel], direction: v } }))}
                                                                                className={cn("h-7 w-7 rounded-md grid place-items-center", e.direction === v ? (v === "ENTRY" ? "bg-emerald-500 text-white" : "bg-orange-500 text-white") : "text-muted-foreground hover:text-foreground")}><I size={13} /></button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                {e?.rol === "lpr" && <ModoEnFila opciones={OPCIONES_LPR_FILA} valor={e.modoLpr || "camara"} onCambiar={(m) => setEleccion((p) => ({ ...p, [c.channel]: { ...p[c.channel], modoLpr: m } }))} />}
                                                                {e?.rol === "intrusion" && <ModoEnFila opciones={OPCIONES_INTRUSION_FILA} valor={e.modoIntr || "doble"} onCambiar={(m) => setEleccion((p) => ({ ...p, [c.channel]: { ...p[c.channel], modoIntr: m } }))} />}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {(resumenCanales.lpr + resumenCanales.intr + resumenCanales.ya) > 0 && (
                                            <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                                                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><FolderTree size={14} /> Dónde quedan</div>
                                                <div className={cn("grid gap-3", resumenCanales.lpr > 0 ? "grid-cols-2" : "grid-cols-1")}>
                                                    <ElegirOCrear etiqueta="Área" icono={FolderTree} valor={areaId} onElegir={setAreaId} ninguna="Sin área"
                                                        ayuda="Dónde aparecen en el panel (Dispositivos, mapa). Vale para todas las que se importan, también las que ya existían."
                                                        opciones={(areas || []).map((a) => ({ id: a.id, nombre: caminoArea(a.id), color: a.color }))} cargando={areas === null}
                                                        nuevaRotulo="Nueva área…" sugerencia={f.name.trim() || "Cámaras del NVR"}
                                                        onCrear={async (nombre) => {
                                                            const e = await crearArea(nombre, null);
                                                            setAreas(e.areas);
                                                            const nueva = [...e.areas].reverse().find((a) => a.nombre === nombre);
                                                            return nueva?.id || null;
                                                        }} />
                                                    {resumenCanales.lpr > 0 && (
                                                        <ElegirOCrear etiqueta="Grupo de acceso de las LPR" icono={Users} valor={f.groupId} onElegir={(v) => set("groupId", v)} ninguna="Sin grupo"
                                                            ayuda="Quiénes pasan por las cámaras LPR que se creen. Ej.: «Residentes + Proveedores». Un grupo nuevo nace vacío: las personas se suman desde Grupos de acceso."
                                                            opciones={todosLosGrupos.map((g) => ({ id: g.id, nombre: g.name }))}
                                                            nuevaRotulo="Nuevo grupo…" sugerencia={f.name.trim() ? `Accesos ${f.name.trim()}` : "Accesos"}
                                                            onCrear={async (nombre) => {
                                                                const r = await guardarGrupo({ name: nombre, equipos: [], personas: [] });
                                                                if (!r.ok) throw new Error(r.error);
                                                                setGruposNuevos((g) => [...g, { id: r.id, name: nombre }]);
                                                                return r.id;
                                                            }} />
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </Bloque>
                        )}

                        {clave === "puesta" && (
                            <div className="px-6 py-6 space-y-4">
                                {tareas.length === 0 ? (
                                    <>
                                        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><ListChecks size={14} /> Resumen</div>
                                            <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-[12.5px] text-muted-foreground">
                                                <span>Tipo: <b className="text-foreground">{OPCIONES_ALTA.find((o) => o.id === opcionAlta)?.rotulo || meta?.rotulo}</b></span><span>Fabricante: <b className="text-foreground">{f.brand === "HIKVISION" ? "Hikvision" : "Dahua"}</b></span>
                                                {tipo !== "NVR" && <span className="col-span-2">Modo: <b className="text-foreground">{tipo === "LPR_CAMERA" ? `${MODOS_LPR[modoLpr].rotulo}${modoLpr === "omnivision" ? (abre ? " · abre la barrera" : " · sólo registra") : ""}` : MODOS_INTRUSION[modoIntr].rotulo}</b></span>}
                                                <span>Nombre: <b className="text-foreground">{f.name}</b></span><span>IP: <b className="text-foreground font-mono">{f.ip}{f.httpPort && f.httpPort !== "80" ? `:${f.httpPort}` : ""}</b>{tipo === "NVR" && f.port ? <> · RTSP <b className="text-foreground font-mono">{f.port}</b></> : null}</span>
                                                {tipo === "LPR_CAMERA" && <><span>Sentido: <b className="text-foreground">{f.direction === "ENTRY" ? "Entrada" : "Salida"}</b></span><span>Grupo: <b className="text-foreground">{groups.find((g: any) => g.id === f.groupId)?.name || "sin grupo"}</b></span></>}
                                                {tipo !== "NVR" && <span className="col-span-2">Grabación: <b className={cn(grabacionElegida ? "text-foreground" : "text-amber-600")}>{grabacionElegida ? `${grabacionElegida.nvrNombre} · canal ${grabacionElegida.ch}` : "sin grabaciones"}</b></span>}
                                                {tipo === "NVR" && <span className="col-span-2">Cámaras: <b className="text-foreground">{resumenCanales.lpr} LPR · {resumenCanales.intr} intrusión · {resumenCanales.ya} se vinculan</b></span>}
                                                {tipo === "NVR" && <span>Área: <b className="text-foreground">{areaId !== "none" ? caminoArea(areaId) : "sin área"}</b></span>}
                                                {tipo === "NVR" && resumenCanales.lpr > 0 && <span>Grupo de las LPR: <b className="text-foreground">{todosLosGrupos.find((g) => g.id === f.groupId)?.name || "sin grupo"}</b></span>}
                                            </div>
                                        </div>
                                        {tipo === "LPR_CAMERA" && f.brand === "HIKVISION" && (
                                            <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none" {...tip("Carga las matrículas habilitadas en la lista de la cámara (las que prenden el semáforo verde). Con muchas matrículas puede tardar un par de minutos.")}>
                                                <input type="checkbox" checked={cargarMatriculas} onChange={(e) => setCargarMatriculas(e.target.checked)} className="h-4 w-4 accent-[var(--accion)]" />
                                                Cargar ya las matrículas en la cámara
                                            </label>
                                        )}
                                        <p className="text-[12px] text-muted-foreground">Al apretar «Crear y poner a punto» se da de alta y se configura todo acá abajo, paso por paso.</p>
                                    </>
                                ) : (
                                    <div className="space-y-2">
                                        {tareas.map((t) => (
                                            <motion.div key={t.clave} layout className={cn("flex items-start gap-3 rounded-xl border px-3 py-2.5",
                                                t.estado === "error" ? "border-red-500/30 bg-red-500/5" : t.estado === "ok" ? "border-emerald-500/20" : "border-border")}>
                                                <span className="mt-0.5"><IconoEstado e={t.estado} /></span>
                                                <t.icono size={16} className="mt-0.5 text-muted-foreground shrink-0" />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[13px] font-semibold flex items-center gap-1.5">{t.titulo} <span {...tip(t.ayuda)} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help"><Info size={12.5} /></span></div>
                                                    {t.detalle && <div className={cn("text-[12px] truncate", t.estado === "error" ? "text-red-500" : "text-muted-foreground")}>{t.detalle}</div>}
                                                </div>
                                            </motion.div>
                                        ))}
                                        {importados.length > 0 && <AvanceImportacion filas={importados} />}
                                        {terminado && importados.some((x) => x.alarma && x.id) && (
                                            <ArreglarAlarmas cuantas={importados.filter((x) => x.alarma && x.id).length} faltaDestino={faltaDestino} ocupado={corriendo} onReintentar={reintentarAlarmas} />
                                        )}
                                        {terminado && (
                                            <div className={cn("rounded-xl p-3 text-[13px] flex items-center gap-2", fallas.length ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
                                                {fallas.length ? <AlertTriangle size={16} /> : <Check size={16} />}
                                                {fallas.length ? `Quedó dado de alta, con ${fallas.length} paso${fallas.length !== 1 ? "s" : ""} para revisar.` : tipo === "CAMERA" ? "Lista. Falta dibujarle la línea o la zona: «Calibrar ahora»." : "Listo: dado de alta y configurado."}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </PasoAnimado>
                )}
                <Tooltip id={TT} place="top" className="!max-w-[300px] !text-[12px] !leading-snug !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}


/**
 * Cabecera de la ficha: el video en vivo de la cámara de borde a borde, sin marco, con los
 * datos encima (tipo, sentido, IP, grabación, estado) y «Comprobar» como botón flotante.
 * Para un NVR (sin video propio) una banda con su ícono y los mismos datos.
 */
function CabeceraVideo({ device, titulo, subtitulo, tipo, meta, f, actual, nvrNombre, detectando, puedeDetectar, onComprobar, info }: any) {
    const [listo, setListo] = useState(false);
    const [falla, setFalla] = useState(false);
    const esVideo = tipo !== "NVR";
    const chip = "inline-flex items-center gap-1 h-6 px-2 rounded-md bg-black/45 backdrop-blur-md text-white text-[10.5px] font-bold ring-1 ring-white/10";
    // Queda fijo arriba al hacer scroll en la ficha (sticky dentro del área que scrollea del cajón).
    // A sangre (14/10): sin el margen, el redondeo ni la sombra, que la hacían ver como una
    // tarjeta flotando dentro del cajón en vez de la cabecera del cajón.
    return (
        <div className="sticky top-0 z-20">
        <div className={cn("relative w-full overflow-hidden bg-black", esVideo ? "aspect-video" : "h-40 bg-gradient-to-br from-sky-950 via-neutral-900 to-black")}>
            {esVideo && (<>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/snapshot/${device.id}?w=960`} alt="" className={cn("absolute inset-0 w-full h-full object-cover transition-all duration-500", listo ? "opacity-0" : "opacity-100 blur-[2px] scale-105")} onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                {!falla && <video key={device.id} src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(`lpr_${device.id}`)}&video=h264`} autoPlay muted playsInline
                    onPlaying={() => setListo(true)} onError={() => setFalla(true)} className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-500", listo ? "opacity-100" : "opacity-0")} />}
                {!listo && !falla && <span className="absolute inset-0 grid place-items-center"><span className="flex items-center gap-2 text-white/80 text-[12px] font-semibold"><Loader2 size={15} className="animate-spin" /> Conectando el vivo…</span></span>}
            </>)}
            {!esVideo && <span className="absolute right-6 top-1/2 -translate-y-1/2 text-sky-400/25"><HardDrive size={72} /></span>}
            {/* Lecturas en vivo y lente motorizado (17/10): se ajusta mirando si la chapa se sigue leyendo. */}
            {esVideo && device?.id && <LecturasEnVivo deviceId={device.id} tt={TT} />}
            {esVideo && device?.id && <ControlesLente deviceId={device.id} tt={TT} />}
            {/* degradados para leer los datos */}
            <span className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none" />
            <span className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
            {/* arriba: tipo, sentido, en vivo */}
            {/* arriba: título del cajón dentro del video + cerrar */}
            <div className="absolute left-5 top-4 right-4 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <h2 className="text-[19px] font-bold text-white leading-tight truncate drop-shadow">{titulo}</h2>
                    <p className="text-[12px] text-white/75 truncate drop-shadow">{subtitulo}</p>
                    <div className="flex items-center gap-1.5 mt-2">
                        {meta && <span className={chip}><meta.icono size={12} /> {meta.rotulo}</span>}
                        {tipo === "LPR_CAMERA" && <span className={cn(chip, f.direction === "EXIT" ? "!bg-orange-500/80" : "!bg-emerald-600/80")}>{f.direction === "EXIT" ? "Salida" : "Entrada"}</span>}
                        {esVideo && listo && <span className={cn(chip, "!bg-red-600/85")}><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> EN VIVO</span>}
                    </div>
                </div>
                <CajonCerrar className="shrink-0 h-9 w-9 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md text-white grid place-items-center ring-1 ring-white/15 transition-colors" aria-label="Cerrar"><X size={17} /></CajonCerrar>
            </div>
            {/* abajo: IP, MAC, grabación + comprobar */}
            <div className="absolute left-4 right-4 bottom-3 flex items-end gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn(chip, "font-mono")}><Network size={11} /> {f.ip}</span>
                        {f.mac && <span className={cn(chip, "font-mono font-semibold")}>{f.mac}</span>}
                        {tipo !== "NVR" && <span className={chip}><HardDrive size={11} /> {actual ? `${nvrNombre || "NVR"} · CH ${actual.ch}` : "Sin grabación"}</span>}
                    </div>
                    {info && <div title={info.nota || undefined} className={cn(chip, "max-w-full truncate", info.viaNvr ? "!bg-amber-500/85 !text-black" : info.ok ? "!bg-emerald-600/80" : "!bg-red-600/80")}>{info.ok ? <Check size={11} /> : <AlertTriangle size={11} />} {info.ok ? `${info.viaNvr ? "Según el NVR: " : ""}${info.model || "Responde"}${info.firmwareVersion ? ` · ${info.firmwareVersion}` : ""}` : (info.error || "No respondió")}</div>}
                </div>
                <button type="button" onClick={onComprobar} disabled={detectando || !puedeDetectar}
                    data-tooltip-id={TT} data-tooltip-content="Comprobar: consulta el equipo ahora (modelo, MAC, firmware) para confirmar que responde con estas credenciales."
                    className="shrink-0 h-9 px-3 rounded-full bg-white/90 hover:bg-white text-black text-[12px] font-bold inline-flex items-center gap-1.5 shadow-lg disabled:opacity-60">
                    {detectando ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />} Comprobar
                </button>
            </div>
        </div>
        </div>
    );
}


/** La retención en una frase: días, desde cuándo y si está grabando. */
function textoRetencion(r: { dias: number; desde: string; grabando: boolean | null; error?: string }): string {
    if (r.error) return `No se pudo calcular: ${r.error}`;
    return `${r.dias} días guardados (desde ${r.desde.slice(0, 10)})${r.grabando === false ? " · NO está grabando ahora" : ""}`;
}

/**
 * Un dato que lee el equipo y no se escribe: el modelo. Antes era un campo de texto, y lo que se
 * tipeaba ahí se usaba para elegir foto y driver; un «DS-2CD» mal escrito no fallaba, elegía mal.
 */
function Dato({ etiqueta, icono: I, valor, faltante, ayuda }: { etiqueta: string; icono: any; valor?: string | null; faltante: string; ayuda?: string }) {
    return (
        <div>
            <Etiqueta texto={etiqueta} ayuda={ayuda} />
            <div className="h-10 rounded-lg bg-muted/50 px-3 flex items-center gap-2 text-[13px]">
                <I size={15} className="text-muted-foreground shrink-0" />
                {valor ? <span className="font-semibold truncate">{valor}</span> : <span className="text-muted-foreground text-[12px] truncate">{faltante}</span>}
            </div>
        </div>
    );
}
