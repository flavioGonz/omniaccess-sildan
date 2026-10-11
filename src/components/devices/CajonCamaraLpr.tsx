"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Tooltip } from "react-tooltip";
import {
    Camera, Network, MapPin, HardDrive, Rocket, ScanSearch, Loader2, Check, X, AlertTriangle, Info,
    LogIn, LogOut, KeyRound, Cpu, Fingerprint, Clock, BellRing, ScanLine, Film, Video, ListChecks, Server, ChevronRight, ChevronLeft,
} from "lucide-react";
import { Cajon, CajonDisparador, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarraDePasos, PasoAnimado } from "@/components/devices/Pasos";
import { createDevice, probeDeviceInfo } from "@/app/actions/devices";
import { provisionLprDevice } from "@/app/actions/provision";
import { getNvrList } from "@/app/actions/nvr";
import { dondeGraba, asignarGrabacion, calcularRetencion } from "@/app/actions/grabaciones";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/**
 * Alta de una camara LPR, por pasos.
 *
 * Reemplaza al modal de alta para las lectoras de matriculas. Lo que antes quedaba a cargo de
 * quien instalaba —y casi siempre quedaba sin hacer— ahora lo hace el asistente y lo muestra:
 *
 *  1. Equipo: fabricante y nombre.
 *  2. Conexion: IP y credenciales, con deteccion (modelo, MAC, firmware) en el mismo lugar.
 *  3. Ubicacion: entrada o salida, la garita y el grupo de acceso.
 *  4. Grabacion: busca SOLO en que NVR y canal se graba (por la IP en los canales de cada NVR).
 *     Si no aparece en ninguno se dice con todas las letras: sin NVR no hay clips ni playback.
 *  5. Puesta a punto: crea el equipo y corre, uno por uno y a la vista, la hora, el envio de
 *     eventos a OmniAccess (servidor de alarmas / HTTP host), el modo ANPR, el H.264, el video
 *     en vivo y la grabacion; al final calcula cuantos dias guarda el NVR.
 */

type Marca = "HIKVISION" | "DAHUA";
type Estado = "espera" | "corriendo" | "ok" | "error" | "salteado";
type Tarea = { clave: string; titulo: string; ayuda: string; icono: any; estado: Estado; detalle?: string };
type Ubic = { nvrId: string | null; nvrNombre: string | null; ch: number; canalNombre?: string | null };

const PASOS = [
    { clave: "equipo", rotulo: "Equipo" },
    { clave: "conexion", rotulo: "Conexión" },
    { clave: "lugar", rotulo: "Ubicación" },
    { clave: "grabacion", rotulo: "Grabación" },
    { clave: "puesta", rotulo: "Puesta a punto" },
];

const TT = "tt-alta-lpr";
const tip = (texto: string) => ({ "data-tooltip-id": TT, "data-tooltip-content": texto });

function Ayuda({ texto }: { texto: string }) {
    return <span {...tip(texto)} className="inline-grid h-4 w-4 place-items-center rounded-full text-muted-foreground hover:text-foreground cursor-help align-middle"><Info size={13} /></span>;
}

function IconoEstado({ e }: { e: Estado }) {
    if (e === "corriendo") return <Loader2 size={16} className="animate-spin text-[var(--accion)]" />;
    if (e === "ok") return <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white"><Check size={12} /></span>;
    if (e === "error") return <span className="grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white"><X size={12} /></span>;
    if (e === "salteado") return <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-muted-foreground"><ChevronRight size={12} /></span>;
    return <span className="h-5 w-5 rounded-full border-2 border-dashed border-border" />;
}

export function CajonCamaraLpr({ groups = [], onSuccess, children }: { groups?: any[]; onSuccess: () => void; children: React.ReactNode }) {
    const [abierto, setAbierto] = useState(false);
    const [paso, setPaso] = useState(0);
    const [hacia, setHacia] = useState(1);
    const ir = (i: number) => { setHacia(i > paso ? 1 : -1); setPaso(i); };

    const blanco = useCallback(() => ({
        brand: "HIKVISION" as Marca, name: "", ip: "", username: "admin", password: "", authType: "DIGEST",
        mac: "", deviceModel: "", location: "", direction: "ENTRY", groupId: "none",
    }), []);
    const [f, setF] = useState(blanco());
    const set = (k: keyof ReturnType<typeof blanco>, v: string) => setF((p) => ({ ...p, [k]: v }));

    // Deteccion del equipo
    const [detectando, setDetectando] = useState(false);
    const [info, setInfo] = useState<any>(null);
    // Grabacion
    const [buscando, setBuscando] = useState(false);
    const [donde, setDonde] = useState<{ ubicacion: Ubic | null; nvrs: { nombre: string; ok: boolean; error?: string; canales: number }[]; hayNvr: boolean } | null>(null);
    const [manual, setManual] = useState<{ nvrId: string; ch: string }>({ nvrId: "", ch: "" });
    const [nvrs, setNvrs] = useState<{ id: string; name: string; ip: string }[]>([]);
    const [sinGrabar, setSinGrabar] = useState(false);
    const [cargarMatriculas, setCargarMatriculas] = useState(true);
    // Puesta a punto
    const [tareas, setTareas] = useState<Tarea[]>([]);
    const [corriendo, setCorriendo] = useState(false);
    const [terminado, setTerminado] = useState(false);

    useEffect(() => {
        if (!abierto) return;
        setF(blanco()); setPaso(0); setHacia(1); setInfo(null); setDonde(null); setManual({ nvrId: "", ch: "" });
        setSinGrabar(false); setTareas([]); setCorriendo(false); setTerminado(false); setCargarMatriculas(true);
        getNvrList().then(setNvrs).catch(() => setNvrs([]));
    }, [abierto, blanco]);

    const ipValida = /^\d{1,3}(\.\d{1,3}){3}$/.test(f.ip.trim());

    const detectar = async () => {
        if (!ipValida) return;
        setDetectando(true); setInfo(null);
        try {
            const r: any = await probeDeviceInfo({ ip: f.ip.trim(), username: f.username, password: f.password, authType: f.authType, brand: f.brand });
            setInfo(r);
            if (r?.ok) {
                setF((p) => ({ ...p, mac: r.macAddress || p.mac, deviceModel: r.model || p.deviceModel, authType: r.authType || p.authType, name: p.name || r.deviceName || "" }));
            }
        } catch (e: any) { setInfo({ ok: false, error: e?.message }); }
        finally { setDetectando(false); }
    };

    const buscarGrabacion = useCallback(async () => {
        if (!ipValida) return;
        setBuscando(true); setDonde(null);
        try { setDonde(await dondeGraba(f.ip.trim()) as any); }
        catch (e: any) { setDonde({ ubicacion: null, nvrs: [], hayNvr: false }); toast.error({ title: "No se pudo consultar los NVR", description: e?.message }); }
        finally { setBuscando(false); }
    }, [f.ip, ipValida]);
    // Al entrar al paso de grabacion se busca solo.
    useEffect(() => { if (PASOS[paso]?.clave === "grabacion" && !donde && !buscando) buscarGrabacion(); }, [paso, donde, buscando, buscarGrabacion]);

    const grabacionElegida: Ubic | null = donde?.ubicacion || (manual.nvrId && Number(manual.ch) > 0 ? { nvrId: manual.nvrId, nvrNombre: nvrs.find((n) => n.id === manual.nvrId)?.name || null, ch: Number(manual.ch) } : null);

    /** Que falta para pasar de cada hoja. */
    const bloqueo = useMemo(() => {
        const c = PASOS[paso]?.clave;
        if (c === "equipo" && !f.name.trim()) return "Poné un nombre: es como va a figurar en el monitor y el historial.";
        if (c === "conexion" && !ipValida) return "Falta una IP válida.";
        if (c === "grabacion" && !grabacionElegida && !sinGrabar) return "Elegí dónde graba o confirmá que va sin grabaciones.";
        return null;
    }, [paso, f.name, ipValida, grabacionElegida, sinGrabar]);

    const actualizar = (clave: string, cambios: Partial<Tarea>) => setTareas((ts) => ts.map((t) => (t.clave === clave ? { ...t, ...cambios } : t)));

    const puestaAPunto = async () => {
        const hik = f.brand === "HIKVISION";
        const lista: Tarea[] = [
            { clave: "crear", titulo: "Dar de alta el equipo", ayuda: "Se guarda la cámara en OmniAccess con su IP, credenciales, sentido y grupo de acceso.", icono: Camera, estado: "espera" },
            { clave: "hora", titulo: "Poner la hora", ayuda: "Se le pone la hora del servidor (Montevideo). Con la hora corrida los eventos quedan en otro momento y el clip de la lectura no coincide.", icono: Clock, estado: "espera" },
            { clave: "eventos", titulo: "Servidor de alarmas → OmniAccess", ayuda: "Se configura en la cámara el envío de cada lectura a OmniAccess (HTTP host / servidor de alarmas). Sin esto la cámara lee pero nadie se entera.", icono: BellRing, estado: "espera" },
            { clave: "anpr", titulo: "Modo ANPR", ayuda: "Se activa la lectura de matrículas en la cámara.", icono: ScanLine, estado: "espera" },
            { clave: "h264", titulo: "Video H.264", ayuda: "Se pasa el video a H.264 para que el vivo se vea en el navegador sin transcodificar.", icono: Film, estado: "espera" },
            { clave: "vivo", titulo: "Video en vivo", ayuda: "Se registra el stream en go2rtc para el vivo del monitor.", icono: Video, estado: "espera" },
            { clave: "matriculas", titulo: "Cargar matrículas", ayuda: "Se cargan en la lista de la cámara las matrículas habilitadas: son las que prenden el semáforo verde con el relé.", icono: ListChecks, estado: "espera" },
            { clave: "grabacion", titulo: "Vincular la grabación", ayuda: "Se guarda en qué NVR y canal se graba, para los clips y el playback de cada lectura.", icono: HardDrive, estado: "espera" },
            { clave: "retencion", titulo: "Calcular retención", ayuda: "Se busca en el NVR la grabación más vieja de ese canal: de ese día a hoy es lo que se guarda.", icono: Server, estado: "espera" },
        ];
        setTareas(lista); setCorriendo(true);
        let id: string | null = null;
        try {
            // 1. Alta (sin la puesta a punto silenciosa: se corre aca, a la vista)
            actualizar("crear", { estado: "corriendo" });
            const fd = new FormData();
            Object.entries({ ...f, deviceType: "LPR_CAMERA", puestaManual: "1" }).forEach(([k, v]) => fd.append(k, String(v)));
            const r: any = await createDevice(fd);
            id = r?.id || null;
            if (!id) throw new Error("No se pudo crear el equipo");
            actualizar("crear", { estado: "ok", detalle: `${f.name} · ${f.ip}` });
            onSuccess();

            // 2-7. Puesta a punto en la camara
            if (hik) {
                ["hora", "eventos", "anpr", "h264", "vivo", "matriculas"].forEach((k) => actualizar(k, { estado: k === "matriculas" && !cargarMatriculas ? "salteado" : "corriendo" }));
                const p: any = await provisionLprDevice(id, cargarMatriculas);
                const por = (nombre: string) => (p?.steps || []).find((s: any) => s.name === nombre);
                const marca = (clave: string, nombre: string) => { const s = por(nombre); actualizar(clave, s ? { estado: s.ok ? "ok" : "error", detalle: String(s.detail || "") } : { estado: "salteado", detalle: "no corrió" }); };
                marca("hora", "Hora"); marca("eventos", "Envío de eventos (HTTP host)"); marca("anpr", "Modo ANPR"); marca("h264", "Códec H.264"); marca("vivo", "Video en vivo (go2rtc)");
                if (cargarMatriculas) marca("matriculas", "Matrículas"); else actualizar("matriculas", { estado: "salteado", detalle: "se cargan después con «Poner a punto»" });
            } else {
                actualizar("hora", { estado: "corriendo" });
                const h = await fetch("/api/devices/sync-time", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: id, mode: "now" }) }).then((x) => x.json()).catch(() => null);
                actualizar("hora", { estado: h?.ok ? "ok" : "error", detalle: h?.ok ? "hora del servidor" : h?.error || "sin respuesta" });
                actualizar("eventos", { estado: "corriendo" });
                const a = await fetch(`/api/devices/alarm-host?deviceId=${id}`, { method: "POST" }).then((x) => x.json()).catch(() => null);
                actualizar("eventos", { estado: a?.ok ? "ok" : "error", detalle: a?.info || a?.error || (a?.ok ? "configurado" : "sin respuesta") });
                ["anpr", "h264", "vivo", "matriculas"].forEach((k) => actualizar(k, { estado: "salteado", detalle: "se configura desde la web de la Dahua" }));
            }

            // 8. Grabacion
            if (grabacionElegida?.nvrId) {
                actualizar("grabacion", { estado: "corriendo" });
                await asignarGrabacion(f.ip.trim(), grabacionElegida.nvrId, grabacionElegida.ch);
                actualizar("grabacion", { estado: "ok", detalle: `${grabacionElegida.nvrNombre || "NVR"} · canal ${grabacionElegida.ch}` });
                // 9. Retencion
                actualizar("retencion", { estado: "corriendo" });
                const rt = await calcularRetencion(id);
                actualizar("retencion", rt.ok && rt.retencion && !rt.retencion.error
                    ? { estado: "ok", detalle: `${rt.retencion.dias} días (desde ${rt.retencion.desde.slice(0, 10)})${rt.retencion.grabando === false ? " · NO está grabando ahora" : ""}` }
                    : { estado: "error", detalle: rt.error || rt.retencion?.error || "no se pudo calcular" });
            } else {
                actualizar("grabacion", { estado: "salteado", detalle: "sin NVR: no habrá clips ni playback" });
                actualizar("retencion", { estado: "salteado" });
            }
            setTerminado(true);
            onSuccess();
        } catch (e: any) {
            setTareas((ts) => ts.map((t) => (t.estado === "corriendo" || (t.clave === "crear" && !id) ? { ...t, estado: "error", detalle: e?.message || "error" } : t)));
            toast.error({ title: "No se pudo completar el alta", description: e?.message });
        } finally { setCorriendo(false); }
    };

    const clave = PASOS[paso].clave;
    const ultimo = paso === PASOS.length - 1;
    const fallas = tareas.filter((t) => t.estado === "error");

    const pie = (
        <div className="flex items-center gap-2 w-full">
            {paso > 0 && !corriendo && !terminado && <Button variant="outline" onClick={() => ir(paso - 1)} className="gap-1"><ChevronLeft size={15} /> Atrás</Button>}
            <span className="flex-1 text-[12px] text-muted-foreground truncate">{bloqueo || ""}</span>
            {!ultimo && <Button onClick={() => ir(paso + 1)} disabled={!!bloqueo} className="gap-1">Siguiente <ChevronRight size={15} /></Button>}
            {ultimo && !terminado && <Button onClick={puestaAPunto} disabled={corriendo || tareas.length > 0} className="gap-1.5 bg-[var(--accion)] text-white">{corriendo ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} Crear y poner a punto</Button>}
            {terminado && <Button onClick={() => setAbierto(false)} className="gap-1.5"><Check size={15} /> Listo</Button>}
        </div>
    );

    return (
        <Cajon open={abierto} onOpenChange={(v) => { if (!corriendo) setAbierto(v); }}>
            <CajonDisparador asChild>{children}</CajonDisparador>
            <CajonContenido ancho="medio" titulo="Nueva cámara LPR" descripcion="Alta guiada: conexión, ubicación, grabación y puesta a punto automática."
                encabezado={<BarraDePasos pasos={PASOS} actual={paso} alIr={(i) => !corriendo && !terminado && ir(i)} />} pie={pie}>
                <PasoAnimado clave={clave} hacia={hacia}>
                    {clave === "equipo" && (
                        <div className="space-y-6">
                            <CajonSeccion titulo="Fabricante" icono={Cpu}>
                                <div className="grid grid-cols-2 gap-3">
                                    {(["HIKVISION", "DAHUA"] as Marca[]).map((m) => (
                                        <button key={m} type="button" onClick={() => set("brand", m)}
                                            {...tip(m === "HIKVISION" ? "Se configura sola por ISAPI: hora, envío de eventos, ANPR, H.264 y matrículas." : "La hora y el envío de eventos se verifican; ANPR y video se ajustan desde la web de la cámara.")}
                                            className={cn("rounded-xl border p-4 text-left transition", f.brand === m ? "border-[var(--accion)] ring-2 ring-[var(--accion)]/30 bg-[var(--accion)]/5" : "border-border hover:bg-accent")}>
                                            <div className="font-bold">{m === "HIKVISION" ? "Hikvision" : "Dahua"}</div>
                                            <div className="text-[12px] text-muted-foreground mt-0.5">{m === "HIKVISION" ? "Puesta a punto completa automática" : "Puesta a punto parcial"}</div>
                                        </button>
                                    ))}
                                </div>
                            </CajonSeccion>
                            <CajonCampo etiqueta="Nombre" pista="Como va a aparecer en el monitor, el historial y los semáforos. Conviene incluir la garita: «P1 - Entrada (207)».">
                                <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="P1 - Entrada (207)" autoFocus />
                            </CajonCampo>
                        </div>
                    )}

                    {clave === "conexion" && (
                        <div className="space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <CajonCampo etiqueta="IP" pista="La IP fija de la cámara en la red del barrio. Con esta IP también se busca en qué NVR graba.">
                                    <Input value={f.ip} onChange={(e) => { set("ip", e.target.value); setInfo(null); setDonde(null); }} placeholder="172.16.2.210" className="font-mono" />
                                </CajonCampo>
                                <CajonCampo etiqueta="Autenticación" pista="Hikvision usa Digest. Si la detección falla con Digest se prueba Basic sola.">
                                    <Select value={f.authType} onValueChange={(v) => set("authType", v)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent><SelectItem value="DIGEST">Digest</SelectItem><SelectItem value="BASIC">Basic</SelectItem></SelectContent>
                                    </Select>
                                </CajonCampo>
                                <CajonCampo etiqueta="Usuario"><Input value={f.username} onChange={(e) => set("username", e.target.value)} /></CajonCampo>
                                <CajonCampo etiqueta="Contraseña"><PasswordInput value={f.password} onChange={(e: any) => set("password", e.target.value)} /></CajonCampo>
                            </div>
                            <div className="rounded-xl border border-border p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <Button type="button" variant="outline" onClick={detectar} disabled={!ipValida || detectando || f.brand !== "HIKVISION"} className="gap-1.5">
                                        {detectando ? <Loader2 size={15} className="animate-spin" /> : <Fingerprint size={15} />} Detectar equipo
                                    </Button>
                                    <span className="text-[12px] text-muted-foreground">Lee modelo, MAC y firmware para comprobar que la IP y la clave son correctas. <Ayuda texto="Se consulta /ISAPI/System/deviceInfo. Si responde, las credenciales sirven y la cámara es alcanzable desde el servidor." /></span>
                                </div>
                                <AnimatePresence>
                                    {info && (
                                        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                            className={cn("rounded-lg p-3 text-[13px] flex items-start gap-2.5", info.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-300")}>
                                            {info.ok ? <Check size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
                                            {info.ok
                                                ? <div className="grid grid-cols-2 gap-x-6 gap-y-0.5"><span>Modelo: <b>{info.model || "—"}</b></span><span>MAC: <b className="font-mono">{info.macAddress || "—"}</b></span><span>Firmware: <b>{info.firmwareVersion || "—"}</b></span><span>Auth: <b>{info.authType}</b></span></div>
                                                : <span>No respondió: {info.error || "revisá IP, usuario y contraseña"}</span>}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    )}

                    {clave === "lugar" && (
                        <div className="space-y-6">
                            <CajonSeccion titulo="Sentido" icono={MapPin} pista="Decide en qué columna del monitor aparece, si cuenta como entrada o salida para «adentro ahora» y si cierra visitas.">
                                <div className="grid grid-cols-2 gap-3">
                                    {[{ v: "ENTRY", t: "Entrada", I: LogIn, d: "Lee a los que entran al barrio" }, { v: "EXIT", t: "Salida", I: LogOut, d: "Lee a los que salen; cierra visitas" }].map((o) => (
                                        <button key={o.v} type="button" onClick={() => set("direction", o.v)}
                                            className={cn("rounded-xl border p-4 text-left flex items-center gap-3 transition", f.direction === o.v ? "border-[var(--accion)] ring-2 ring-[var(--accion)]/30 bg-[var(--accion)]/5" : "border-border hover:bg-accent")}>
                                            <span className={cn("grid h-11 w-11 place-items-center rounded-full", o.v === "ENTRY" ? "bg-emerald-500/15 text-emerald-500" : "bg-orange-500/15 text-orange-500")}><o.I size={20} /></span>
                                            <span><span className="block font-bold">{o.t}</span><span className="block text-[12px] text-muted-foreground">{o.d}</span></span>
                                        </button>
                                    ))}
                                </div>
                            </CajonSeccion>
                            <div className="grid grid-cols-2 gap-4">
                                <CajonCampo etiqueta="Garita / ubicación" pista="Texto libre. Si incluye «P1», «P2»… el monitor agrupa el semáforo en esa garita.">
                                    <Input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Garita P1" />
                                </CajonCampo>
                                <CajonCampo etiqueta="Grupo de acceso" pista="Quiénes pasan por esta cámara. Sin grupo queda cargada pero no habilita a nadie.">
                                    <Select value={f.groupId} onValueChange={(v) => set("groupId", v)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Sin grupo</SelectItem>
                                            {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </CajonCampo>
                            </div>
                            {f.groupId === "none" && <p className="text-[12px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1.5"><AlertTriangle size={13} /> Sin grupo de acceso la cámara no deja pasar a nadie por servidor.</p>}
                        </div>
                    )}

                    {clave === "grabacion" && (
                        <div className="space-y-5">
                            <div className="flex items-center gap-3">
                                <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500"><ScanSearch size={20} /></span>
                                <div className="flex-1">
                                    <div className="font-semibold">¿Dónde se graba esta cámara?</div>
                                    <div className="text-[12px] text-muted-foreground">Se busca la IP <b className="font-mono">{f.ip}</b> en los canales de todos los NVR dados de alta.</div>
                                </div>
                                <Button variant="outline" size="sm" onClick={buscarGrabacion} disabled={buscando} className="gap-1.5">{buscando ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />} Buscar de nuevo</Button>
                            </div>

                            {buscando && <div className="rounded-xl border border-dashed border-border p-6 grid place-items-center text-muted-foreground text-[13px] gap-2"><Loader2 size={22} className="animate-spin" /> Consultando los NVR…</div>}

                            {donde && !buscando && (
                                <>
                                    <div className="flex flex-wrap gap-2">
                                        {donde.nvrs.map((n) => (
                                            <span key={n.nombre} {...tip(n.ok ? `${n.canales} canales leídos` : `No respondió: ${n.error || "sin respuesta"}`)}
                                                className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px]", n.ok ? "border-border text-muted-foreground" : "border-red-500/30 text-red-500")}>
                                                <HardDrive size={12} /> {n.nombre} {n.ok ? <Check size={12} className="text-emerald-500" /> : <X size={12} />}
                                            </span>
                                        ))}
                                    </div>
                                    {donde.ubicacion ? (
                                        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
                                            <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500 text-white"><Check size={18} /></span>
                                            <div>
                                                <div className="font-bold">Graba en {donde.ubicacion.nvrNombre} · canal {donde.ubicacion.ch}</div>
                                                <div className="text-[12px] text-muted-foreground">{donde.ubicacion.canalNombre ? `El NVR la tiene como «${donde.ubicacion.canalNombre}». ` : ""}Se vincula sola al crear: clips y playback de cada lectura salen de ahí.</div>
                                            </div>
                                        </motion.div>
                                    ) : !donde.hayNvr ? (
                                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
                                            <div className="font-bold text-red-600 dark:text-red-300 inline-flex items-center gap-2"><AlertTriangle size={16} /> No hay ningún NVR dado de alta</div>
                                            <p className="text-[13px] text-muted-foreground">Sin NVR esta cámara <b>no va a tener grabaciones</b>: ni clips de las lecturas ni playback. Agregá el NVR desde Dispositivos → Nuevo equipo → NVR y volvé a buscar.</p>
                                        </div>
                                    ) : (
                                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                                            <div className="font-bold text-amber-700 dark:text-amber-300 inline-flex items-center gap-2"><AlertTriangle size={16} /> Ningún NVR tiene esta cámara en sus canales</div>
                                            <p className="text-[13px] text-muted-foreground">Puede que la graba un NVR que todavía no está dado de alta (sugerido: agregarlo), o que el NVR la tenga con otra IP. Si sabés dónde graba, elegilo a mano:</p>
                                            <div className="grid grid-cols-[1fr_120px] gap-3">
                                                <Select value={manual.nvrId} onValueChange={(v) => setManual((m) => ({ ...m, nvrId: v }))}>
                                                    <SelectTrigger><SelectValue placeholder="Elegí el NVR" /></SelectTrigger>
                                                    <SelectContent>{nvrs.map((n) => <SelectItem key={n.id} value={n.id}>{n.name} · {n.ip}</SelectItem>)}</SelectContent>
                                                </Select>
                                                <Input type="number" min={1} value={manual.ch} onChange={(e) => setManual((m) => ({ ...m, ch: e.target.value }))} placeholder="Canal" />
                                            </div>
                                        </div>
                                    )}
                                    {!donde.ubicacion && (
                                        <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none">
                                            <input type="checkbox" checked={sinGrabar} onChange={(e) => setSinGrabar(e.target.checked)} className="h-4 w-4 accent-[var(--accion)]" />
                                            Seguir sin grabaciones (la cámara lee y abre, pero sus lecturas no van a tener video)
                                        </label>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {clave === "puesta" && (
                        <div className="space-y-4">
                            {tareas.length === 0 ? (
                                <>
                                    <div className="rounded-xl border border-border p-4 space-y-2 text-[13px]">
                                        <div className="font-semibold">Resumen</div>
                                        <div className="grid grid-cols-2 gap-y-1 text-muted-foreground">
                                            <span>Equipo: <b className="text-foreground">{f.name}</b></span><span>IP: <b className="text-foreground font-mono">{f.ip}</b></span>
                                            <span>Sentido: <b className="text-foreground">{f.direction === "ENTRY" ? "Entrada" : "Salida"}</b></span><span>Grupo: <b className="text-foreground">{groups.find((g: any) => g.id === f.groupId)?.name || "sin grupo"}</b></span>
                                            <span className="col-span-2">Grabación: <b className={cn(grabacionElegida ? "text-foreground" : "text-amber-600")}>{grabacionElegida ? `${grabacionElegida.nvrNombre} · canal ${grabacionElegida.ch}` : "sin grabaciones"}</b></span>
                                        </div>
                                    </div>
                                    {f.brand === "HIKVISION" && (
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
                                                <div className="text-[13px] font-semibold flex items-center gap-1.5">{t.titulo} <Ayuda texto={t.ayuda} /></div>
                                                {t.detalle && <div className={cn("text-[12px] truncate", t.estado === "error" ? "text-red-500" : "text-muted-foreground")}>{t.detalle}</div>}
                                            </div>
                                        </motion.div>
                                    ))}
                                    {terminado && (
                                        <div className={cn("rounded-xl p-3 text-[13px] flex items-center gap-2", fallas.length ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
                                            {fallas.length ? <AlertTriangle size={16} /> : <Check size={16} />}
                                            {fallas.length ? `Quedó dada de alta, con ${fallas.length} paso${fallas.length !== 1 ? "s" : ""} para revisar. Se reintentan desde la tabla con «Poner a punto».` : "Lista: la cámara está dada de alta, configurada y grabando."}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </PasoAnimado>
                <Tooltip id={TT} place="top" className="!max-w-[300px] !text-[12px] !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}
