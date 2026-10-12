"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Tooltip } from "react-tooltip";
import {
    Camera, Radar, HardDrive, Network, MapPin, Rocket, ScanSearch, Loader2, Check, X, AlertTriangle, Info,
    LogIn, LogOut, KeyRound, User, Cpu, Fingerprint, Clock, BellRing, ScanLine, Film, Video, ListChecks, Server,
    ChevronRight, ChevronLeft, Tag, Hash, Type, Plug, Car, Ban, Link2, Save, Crosshair, Download, Activity, ShieldCheck, Users,
} from "lucide-react";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarraDePasos, PasoAnimado } from "@/components/devices/Pasos";
import { createDevice, updateDevice, probeDeviceInfo, getDevices } from "@/app/actions/devices";
import { provisionLprDevice } from "@/app/actions/provision";
import { getNvrList, getNvrChannels, getNvrChannelInfo, importarCanalesClasificados, type RolImport } from "@/app/actions/nvr";
import { dondeGraba, asignarGrabacion, calcularRetencion } from "@/app/actions/grabaciones";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

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
type Ubic = { nvrId: string | null; nvrNombre: string | null; ch: number; canalNombre?: string | null };
type Canal = { channel: number; ip: string | null; name: string; model?: string | null; marca: string; protocolo?: string | null; sensorDe?: number | null; existente: { id: string; name: string; tipo: string } | null };

const TT = "tt-cajon-disp";
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

const PASOS_POR_TIPO: Record<Tipo, { clave: string; rotulo: string }[]> = {
    LPR_CAMERA: [{ clave: "equipo", rotulo: "Equipo" }, { clave: "conexion", rotulo: "Conexión" }, { clave: "lugar", rotulo: "Ubicación" }, { clave: "grabacion", rotulo: "Grabación" }, { clave: "puesta", rotulo: "Puesta a punto" }],
    CAMERA: [{ clave: "equipo", rotulo: "Equipo" }, { clave: "conexion", rotulo: "Conexión" }, { clave: "grabacion", rotulo: "Grabación" }, { clave: "puesta", rotulo: "Puesta a punto" }],
    NVR: [{ clave: "equipo", rotulo: "Equipo" }, { clave: "conexion", rotulo: "Conexión" }, { clave: "canales", rotulo: "Canales" }, { clave: "puesta", rotulo: "Puesta a punto" }],
};

const TITULOS: Record<string, string> = {
    tipo: "¿Qué vas a agregar?", equipo: "¿Qué equipo es?", conexion: "¿Cómo se llega al equipo?", lugar: "¿Dónde está y por dónde pasan?",
    grabacion: "¿Dónde se graba?", canales: "Las cámaras del grabador", puesta: "Puesta a punto",
};

/* ── Piezas de formulario con ícono y tooltip ─────────────────────────────────── */

function Etiqueta({ texto, ayuda }: { texto: string; ayuda?: string }) {
    return (
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/85 mb-1.5">
            {texto}
            {ayuda && <span {...tip(ayuda)} className="inline-grid place-items-center text-muted-foreground/60 hover:text-[var(--accion)] cursor-help"><Info size={12.5} /></span>}
        </span>
    );
}

function Campo({ etiqueta, ayuda, icono: I, value, onChange, placeholder, tipo = "text", mono, autoFocus, className }: {
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

function Opcion({ activa, onClick, icono: I, titulo, detalle, color, ayuda }: { activa: boolean; onClick: () => void; icono: any; titulo: string; detalle?: string; color: string; ayuda?: string }) {
    return (
        <button type="button" onClick={onClick} {...(ayuda ? tip(ayuda) : {})}
            className={cn("rounded-xl border p-3.5 text-left flex items-center gap-3 transition-all", activa ? "border-[var(--accion)] ring-2 ring-[color-mix(in_oklab,var(--accion)_25%,transparent)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border hover:bg-accent/60")}>
            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", color)}><I size={19} /></span>
            <span className="min-w-0"><span className="block font-bold text-[13.5px]">{titulo}</span>{detalle && <span className="block text-[11.5px] text-muted-foreground leading-snug">{detalle}</span>}</span>
            {activa && <Check size={16} className="ml-auto text-[var(--accion)] shrink-0" />}
        </button>
    );
}

function Bloque({ titulo, icono: I, ayuda, children, accion }: { titulo: string; icono: any; ayuda?: string; children: React.ReactNode; accion?: React.ReactNode }) {
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

const ipOk = (ip: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim());

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
    const [eleccion, setEleccion] = useState<Record<number, { rol: RolImport; direction: "ENTRY" | "EXIT" }>>({});
    // Puesta a punto
    const [cargarMatriculas, setCargarMatriculas] = useState(true);
    const [tareas, setTareas] = useState<Tarea[]>([]);
    const [corriendo, setCorriendo] = useState(false);
    const [terminado, setTerminado] = useState(false);
    const [creadoId, setCreadoId] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    useEffect(() => {
        if (!open) return;
        setF(blanco()); setPaso(0); setHacia(1); setInfo(null); setDonde(null); setManual({ nvrId: "", ch: "" });
        setSinGrabar(false); setActual(null); setRetencion(null); setCanales(null); setErrorCanales(""); setEleccion({});
        setTareas([]); setCorriendo(false); setTerminado(false); setCreadoId(null); setCargarMatriculas(true); setGuardando(false);
        getNvrList().then(setNvrs).catch(() => setNvrs([]));
        if (device?.id && device.deviceType !== "NVR") getNvrChannelInfo(device.id).then(setActual).catch(() => setActual(null));
    }, [open, blanco, device]);

    const tipo = f.deviceType as Tipo | "";
    const meta = TIPOS.find((t) => t.valor === tipo);
    const pasos = useMemo(() => esEdicion ? [{ clave: "ficha", rotulo: "Ficha" }] : [{ clave: "tipo", rotulo: "Tipo" }, ...(tipo ? PASOS_POR_TIPO[tipo] : [])], [esEdicion, tipo]);
    const clave = pasos[Math.min(paso, pasos.length - 1)]?.clave || "tipo";
    const ultimo = paso >= pasos.length - 1;
    const ir = (i: number) => { setHacia(i > paso ? 1 : -1); setPaso(i); };
    const ipValida = ipOk(f.ip);

    /* ── Acciones ── */
    const detectar = async () => {
        if (!ipValida) return;
        setDetectando(true); setInfo(null);
        try {
            const r: any = await probeDeviceInfo({ ip: f.ip.trim(), username: f.username, password: f.password, authType: f.authType, brand: f.brand });
            setInfo(r);
            if (r?.ok) setF((p) => ({ ...p, mac: r.macAddress || p.mac, deviceModel: r.model || p.deviceModel, authType: r.authType || p.authType, name: p.name || r.deviceName || "" }));
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
            const [r, devs]: any = await Promise.all([getNvrChannels({ ip: f.ip.trim(), username: f.username, password: f.password, authType: f.authType }), getDevices()]);
            if (!r?.ok) { setErrorCanales(r?.error || "El NVR no devolvió canales"); return; }
            const porIp = new Map((devs || []).map((d: any) => [d.ip, d]));
            const lista: Canal[] = (r.channels || []).map((c: any) => {
                const e: any = c.ip ? porIp.get(c.ip) : null;
                return { channel: Number(c.channel), ip: c.ip || null, name: (c.name && String(c.name).trim()) || `Canal ${c.channel}`, model: c.model || null, marca: c.brand || f.brand, protocolo: c.protocolo || null, sensorDe: c.sensorDe ?? null, existente: e ? { id: e.id, name: e.name, tipo: String(e.deviceType) } : null };
            });
            setCanales(lista);
            setEleccion(Object.fromEntries(lista.map((c) => [c.channel, { rol: (c.existente || !c.ip || c.sensorDe ? "omitir" : ES_LPR.test(`${c.name} ${c.model || ""}`) ? "lpr" : "intrusion") as RolImport, direction: (/salida|exit/i.test(c.name) ? "EXIT" : "ENTRY") as "ENTRY" | "EXIT" }])));
        } catch (e: any) { setErrorCanales(e?.message || "No se pudo leer el NVR"); }
        finally { setLeyendo(false); }
    }, [f.ip, f.username, f.password, f.authType, f.brand]);
    useEffect(() => { if (open && clave === "canales" && !canales && !leyendo && !errorCanales) leerCanales(); }, [open, clave, canales, leyendo, errorCanales, leerCanales]);

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

    const puestaAPunto = async () => {
        if (!tipo) return;
        const hik = f.brand === "HIKVISION";
        const T = (clave: string, titulo: string, ayuda: string, icono: any): Tarea => ({ clave, titulo, ayuda, icono, estado: "espera" });
        const lista: Tarea[] = tipo === "LPR_CAMERA" ? [
            T("crear", "Dar de alta la cámara", "Se guarda con su IP, credenciales, sentido y grupo de acceso.", Camera),
            T("hora", "Poner la hora", "Hora del servidor (Montevideo). Con la hora corrida el clip de la lectura no coincide.", Clock),
            T("eventos", "Servidor de alarmas → OmniAccess", "Se configura el envío de cada lectura a OmniAccess (HTTP host). Sin esto la cámara lee pero nadie se entera.", BellRing),
            T("anpr", "Modo ANPR", "Se activa la lectura de matrículas.", ScanLine),
            T("h264", "Video H.264", "Para que el vivo se vea en el navegador sin transcodificar.", Film),
            T("vivo", "Video en vivo", "Se registra el stream en go2rtc para el monitor.", Video),
            T("matriculas", "Cargar matrículas", "Las habilitadas van a la lista de la cámara: son las que prenden el semáforo verde con el relé.", ListChecks),
            T("grabacion", "Vincular la grabación", "En qué NVR y canal se graba, para clips y playback.", HardDrive),
            T("retencion", "Calcular retención", "La grabación más vieja de ese canal: de ese día a hoy es lo que guarda.", Server),
        ] : tipo === "CAMERA" ? [
            T("crear", "Dar de alta la cámara", "Se guarda como cámara de intrusión con su IP y credenciales.", Camera),
            T("hora", "Poner la hora", "Hora del servidor. Las alarmas quedan con la hora correcta y el clip coincide.", Clock),
            T("eventos", "Servidor de alarmas → OmniAccess", "La cámara manda los cruces de línea y entradas a zona a OmniAccess. Sin esto no llegan al monitor de intrusión.", BellRing),
            T("vivo", "Video en vivo", "Se registra el stream en go2rtc para el monitor de intrusión.", Video),
            T("grabacion", "Vincular la grabación", "En qué NVR y canal se graba, para clips y playback de las alarmas.", HardDrive),
            T("retencion", "Calcular retención", "Cuántos días guarda el NVR de esta cámara.", Server),
        ] : [
            T("crear", "Dar de alta el NVR", "Se guarda con su IP, puerto RTSP y credenciales.", HardDrive),
            T("hora", "Poner la hora", "Hora del servidor: el playback busca por hora, si está corrida no encuentra nada.", Clock),
            T("importar", "Importar cámaras clasificadas", "Se crean las cámaras elegidas (LPR o intrusión) y se vinculan las que ya existían a su canal de grabación.", Download),
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

            if (tipo === "LPR_CAMERA") {
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
                actualizar("eventos", { estado: "corriendo" });
                const a = await fetch(`/api/devices/alarm-host?deviceId=${id}`, { method: "POST" }).then((x) => x.json()).catch(() => null);
                actualizar("eventos", { estado: a?.ok ? "ok" : "error", detalle: a?.info || a?.error || (a?.ok ? "configurado" : "sin respuesta — se reintenta desde el calibrador") });
                actualizar("vivo", { estado: "ok", detalle: "registrado al crear" });
                await vincularGrabacion(id);
            } else {
                await ponerHora(id);
                const pedidos = (canales || []).filter((c) => c.existente || (eleccion[c.channel]?.rol && eleccion[c.channel].rol !== "omitir"))
                    .map((c) => ({ channel: c.channel, rol: (c.existente ? "intrusion" : eleccion[c.channel].rol) as RolImport, direction: eleccion[c.channel]?.direction, groupId: f.groupId }));
                if (!pedidos.length) actualizar("importar", { estado: "salteado", detalle: "no se eligió ninguna cámara (se puede hacer después desde el menú del NVR)" });
                else {
                    actualizar("importar", { estado: "corriendo", detalle: `${pedidos.length} canales…` });
                    const ri = await importarCanalesClasificados(id, pedidos);
                    actualizar("importar", ri.ok ? { estado: "ok", detalle: `${ri.creadas} nuevas · ${ri.mapeadas} ya existían y quedaron vinculadas` } : { estado: "error", detalle: ri.error });
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
            if (grabacionElegida?.nvrId && (!actual || actual.ch !== grabacionElegida.ch || actual.nvr !== grabacionElegida.nvrId)) await asignarGrabacion(f.ip.trim(), grabacionElegida.nvrId, grabacionElegida.ch);
            toast.success({ title: "Cambios guardados", description: f.name });
            onSuccess(); onOpenChange(false);
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };
    const calcRet = async () => {
        if (!device?.id) return;
        setCalculando(true);
        try {
            const rt = await calcularRetencion(device.id);
            setRetencion(rt.ok && rt.retencion && !rt.retencion.error ? `${rt.retencion.dias} días guardados (desde ${rt.retencion.desde.slice(0, 10)})${rt.retencion.grabando === false ? " · NO está grabando ahora" : ""}` : `No se pudo calcular: ${rt.error || rt.retencion?.error || "sin respuesta"}`);
        } finally { setCalculando(false); }
    };

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
                <Campo etiqueta="Dirección IP" icono={Network} value={f.ip} onChange={(v) => { set("ip", v); setInfo(null); setDonde(null); setCanales(null); setErrorCanales(""); }} placeholder="172.16.2.210" mono
                    ayuda="La IP fija del equipo en la red del barrio. Ejemplos: 172.16.2.210 (cámara LPR), 172.16.2.59 (NVR). Con esta IP también se busca en qué NVR graba." />
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
            <CajonContenido ancho="medio"
                titulo={esEdicion ? (device?.name || "Equipo") : TITULOS[clave] || "Nuevo equipo"}
                descripcion={esEdicion ? `${meta?.rotulo || "Equipo"} · ${f.brand === "HIKVISION" ? "Hikvision" : "Dahua"}${f.deviceModel ? ` · ${f.deviceModel}` : ""}` : clave === "tipo" ? "Lo primero, porque de esto dependen los pasos que siguen." : `${meta?.rotulo} · alta guiada`}
                encabezado={esEdicion ? undefined : clave === "tipo"
                    ? <div className="h-0.5 bg-border/60"><div className="h-full w-[6%] bg-[var(--accion)]" /></div>
                    : <BarraDePasos pasos={pasos.slice(1)} actual={paso - 1} alIr={(i) => !corriendo && !terminado && i + 1 < paso && ir(i + 1)} />}
                pie={pie}>

                {esEdicion ? (
                    /* ───────── FICHA (edición) ───────── */
                    <div>
                        <CabeceraVideo device={device} tipo={tipo} meta={meta} f={f} actual={actual} nvrNombre={nvrActual?.name || null}
                            detectando={detectando} puedeDetectar={ipValida} onComprobar={detectar} info={info} />
                        <Bloque titulo="Identidad" icono={Tag} ayuda="Cómo se llama el equipo y dónde está. Es lo que se ve en el monitor, el historial y los avisos.">
                            <Campo etiqueta="Nombre" icono={Type} value={f.name} onChange={(v) => set("name", v)}
                                placeholder={tipo === "NVR" ? "NVR Sildan" : tipo === "CAMERA" ? "Perímetro Norte 12" : "P1 - Entrada (207)"}
                                ayuda={tipo === "LPR_CAMERA" ? "Conviene incluir la garita y el sentido. Ej.: «P1 - Entrada (207)». Si incluye P1, P2… el monitor agrupa el semáforo en esa garita." : "El nombre del lugar dice más que el modelo. Ej.: «Perímetro Norte 12»."} />
                            <div className="grid grid-cols-2 gap-4">
                                <Campo etiqueta="Modelo" icono={Cpu} value={f.deviceModel} onChange={(v) => set("deviceModel", v)} placeholder="iDS-TCM403-GIR"
                                    ayuda="Lo completa «Comprobar». Ej.: iDS-TCM403-GIR, DS-2CD2T47G2, DS-9664NI-I8." />
                                {tipo !== "NVR" && <Campo etiqueta="Ubicación / garita" icono={MapPin} value={f.location} onChange={(v) => set("location", v)} placeholder="Garita P1"
                                    ayuda="Texto libre. Ej.: «Garita P1», «Lote 120 fondo». En LPR, «P1»/«P2» agrupan el semáforo en el monitor." />}
                            </div>
                            {tipo === "LPR_CAMERA" && <div><Etiqueta texto="Sentido" ayuda="Decide la columna del monitor, si suma a «adentro ahora» y si cierra visitas. Ej.: el carril de ingreso de P1 es Entrada." />{bloqueSentido}</div>}
                            <div><Etiqueta texto="Fabricante" ayuda="No se cambia en un equipo dado de alta." />{bloqueMarca}</div>
                        </Bloque>
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
                                {TIPOS.map((t) => (
                                    <button key={t.valor} type="button" onClick={() => { set("deviceType", t.valor); setHacia(1); setPaso(1); setCanales(null); setDonde(null); }}
                                        className={cn("group text-left rounded-2xl border p-4 flex gap-4 transition-all hover:-translate-y-px hover:shadow-md",
                                            tipo === t.valor ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border bg-card/40 hover:bg-accent/50")}>
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
                            <Bloque titulo="Qué es cada cámara" icono={Camera} ayuda="La sugerencia sale del nombre del canal (LPR si habla de entrada, salida, acceso, matrícula). Siempre se puede cambiar. Las que ya existen sólo se vinculan."
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
                                                            </div>
                                                        </div>
                                                        {c.existente ? (
                                                            <span {...tip(`Ya existe como «${c.existente.name}». Sólo se le vincula este canal como su grabación.`)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><Link2 size={12} /> Se vincula</span>
                                                        ) : !c.ip || c.sensorDe ? <span className="text-[11px] text-muted-foreground">{c.sensorDe ? `con D${c.sensorDe}` : "No importable"}</span> : (
                                                            <div className="flex items-center gap-1.5">
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
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {resumenCanales.lpr > 0 && (
                                            <label className="block">
                                                <Etiqueta texto="Grupo de acceso para las LPR nuevas" ayuda="Quiénes pasan por las cámaras LPR que se creen. Ej.: «Residentes + Proveedores»." />
                                                <Select value={f.groupId} onValueChange={(v) => set("groupId", v)}>
                                                    <SelectTrigger className="h-10"><Users size={15} className="text-muted-foreground mr-1" /><SelectValue /></SelectTrigger>
                                                    <SelectContent><SelectItem value="none">Sin grupo</SelectItem>{groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                                                </Select>
                                            </label>
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
                                                <span>Tipo: <b className="text-foreground">{meta?.rotulo}</b></span><span>Fabricante: <b className="text-foreground">{f.brand === "HIKVISION" ? "Hikvision" : "Dahua"}</b></span>
                                                <span>Nombre: <b className="text-foreground">{f.name}</b></span><span>IP: <b className="text-foreground font-mono">{f.ip}{tipo === "NVR" && f.port ? `:${f.port}` : ""}</b></span>
                                                {tipo === "LPR_CAMERA" && <><span>Sentido: <b className="text-foreground">{f.direction === "ENTRY" ? "Entrada" : "Salida"}</b></span><span>Grupo: <b className="text-foreground">{groups.find((g: any) => g.id === f.groupId)?.name || "sin grupo"}</b></span></>}
                                                {tipo !== "NVR" && <span className="col-span-2">Grabación: <b className={cn(grabacionElegida ? "text-foreground" : "text-amber-600")}>{grabacionElegida ? `${grabacionElegida.nvrNombre} · canal ${grabacionElegida.ch}` : "sin grabaciones"}</b></span>}
                                                {tipo === "NVR" && <span className="col-span-2">Cámaras: <b className="text-foreground">{resumenCanales.lpr} LPR · {resumenCanales.intr} intrusión · {resumenCanales.ya} se vinculan</b></span>}
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
function CabeceraVideo({ device, tipo, meta, f, actual, nvrNombre, detectando, puedeDetectar, onComprobar, info }: any) {
    const [listo, setListo] = useState(false);
    const [falla, setFalla] = useState(false);
    const esVideo = tipo !== "NVR";
    const chip = "inline-flex items-center gap-1 h-6 px-2 rounded-md bg-black/45 backdrop-blur-md text-white text-[10.5px] font-bold ring-1 ring-white/10";
    // Queda fijo arriba al hacer scroll en la ficha (sticky dentro del área que scrollea del cajón).
    return (
        <div className="sticky top-0 z-20 px-4 pt-4 pb-3 bg-background/95 backdrop-blur-sm">
        <div className={cn("relative w-full overflow-hidden rounded-2xl bg-black shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-black/10", esVideo ? "aspect-video" : "h-28 bg-gradient-to-br from-sky-950 via-neutral-900 to-black")}>
            {esVideo && (<>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/snapshot/${device.id}?w=960`} alt="" className={cn("absolute inset-0 w-full h-full object-cover transition-all duration-500", listo ? "opacity-0" : "opacity-100 blur-[2px] scale-105")} onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                {!falla && <video key={device.id} src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(`lpr_${device.id}`)}&video=h264`} autoPlay muted playsInline
                    onPlaying={() => setListo(true)} onError={() => setFalla(true)} className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-500", listo ? "opacity-100" : "opacity-0")} />}
                {!listo && !falla && <span className="absolute inset-0 grid place-items-center"><span className="flex items-center gap-2 text-white/80 text-[12px] font-semibold"><Loader2 size={15} className="animate-spin" /> Conectando el vivo…</span></span>}
            </>)}
            {!esVideo && <span className="absolute right-6 top-1/2 -translate-y-1/2 text-sky-400/25"><HardDrive size={72} /></span>}
            {/* degradados para leer los datos */}
            <span className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
            <span className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
            {/* arriba: tipo, sentido, en vivo */}
            <div className="absolute left-4 top-3 right-4 flex items-center gap-1.5">
                {meta && <span className={chip}><meta.icono size={12} /> {meta.rotulo}</span>}
                {tipo === "LPR_CAMERA" && <span className={cn(chip, f.direction === "EXIT" ? "!bg-orange-500/80" : "!bg-emerald-600/80")}>{f.direction === "EXIT" ? "Salida" : "Entrada"}</span>}
                {esVideo && listo && <span className={cn(chip, "ml-auto !bg-red-600/85")}><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> EN VIVO</span>}
            </div>
            {/* abajo: IP, MAC, grabación + comprobar */}
            <div className="absolute left-4 right-4 bottom-3 flex items-end gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn(chip, "font-mono")}><Network size={11} /> {f.ip}</span>
                        {f.mac && <span className={cn(chip, "font-mono font-semibold")}>{f.mac}</span>}
                        {tipo !== "NVR" && <span className={chip}><HardDrive size={11} /> {actual ? `${nvrNombre || "NVR"} · CH ${actual.ch}` : "Sin grabación"}</span>}
                    </div>
                    {info && <div className={cn(chip, "max-w-full truncate", info.ok ? "!bg-emerald-600/80" : "!bg-red-600/80")}>{info.ok ? <Check size={11} /> : <AlertTriangle size={11} />} {info.ok ? `${info.model || "Responde"}${info.firmwareVersion ? ` · ${info.firmwareVersion}` : ""}` : (info.error || "No respondió")}</div>}
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
