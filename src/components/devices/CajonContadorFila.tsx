"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Tooltip } from "react-tooltip";
import {
    Users, Network, User, KeyRound, Fingerprint, Tag, Type, MapPin, Cpu, ShieldCheck, Activity, Loader2, Check, X,
    AlertTriangle, Save, ScanSearch, Gauge, BellRing, Timer, SlidersHorizontal, CalendarClock, Radio, Plus,
} from "lucide-react";
import { Cajon, CajonContenido, CajonCerrar } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bloque, Campo, Dato, Etiqueta, Opcion, TT, tip } from "@/components/devices/CajonDispositivo";
import { VivoConPlay } from "@/components/queue/VivoConPlay";
import { createDevice, updateDevice, probeDeviceInfo, getCredencialesDispositivo } from "@/app/actions/devices";
import { getQueueAlerts, createQueueAlert, updateQueueAlert, getLatestQueueCounts } from "@/app/actions/queue";
import { nombreStreamFila } from "@/lib/stream-fila";
import { hora } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { SOSTENIDO_POR_DEFECTO_SEG } from "@/lib/filas/constantes";

/**
 * Alta y ficha de un contador de fila (cámara Bosch que cuenta gente en una zona), con el mismo
 * cajón y las mismas piezas que el resto de los equipos (CajonDispositivo).
 *
 * Pedido de Nico (HB, 19/10): en modo Filas Dispositivos abría el formulario viejo, sin vivo, sin
 * comprobar la cámara y sin nada de la fila. Acá está lo que hace falta para dejar una cámara
 * contando: conexión (con «Detectar» por ONVIF), el límite de aforo de esa fila, si está suscrita
 * y qué cuenta ahora, y los atajos a la zona/rebote (Calibración) y a los horarios.
 */

/** El límite que usa el servidor cuando la fila no tiene uno guardado (onvif-polling). */
const LIMITE_POR_DEFECTO = 10;
/** El canal de ocupación de la Bosch (la regla de conteo «Aforo»). */
const CANAL_AFORO = "Aforo";
const ES_AFORO = /aforo|occupancy|ocupaci/i;

type Suscripcion = { deviceId: string; lastPull?: string; expiresAt?: string };

export function CajonContadorFila({ device, open, onOpenChange, onSuccess }: {
    /** Con equipo: ficha. Sin equipo: alta. */
    device?: any | null;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onSuccess: () => void;
}) {
    const esEdicion = !!device;
    const blanco = useCallback(() => ({
        name: device?.name || "", ip: device?.ip || "", location: device?.location || "",
        username: device?.username || "admin", password: "", authType: device?.authType || "DIGEST",
        mac: device?.mac || "", deviceModel: device?.deviceModel || "",
    }), [device]);
    const [f, setF] = useState(blanco());
    const set = (k: keyof ReturnType<typeof blanco>, v: string) => setF((p) => ({ ...p, [k]: v }));

    const [info, setInfo] = useState<any>(null);
    const [detectando, setDetectando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    // La fila: límite (QueueAlert de este equipo, canal de aforo) y lo que cuenta ahora.
    const [alerta, setAlerta] = useState<any>(null);
    const [limite, setLimite] = useState(String(LIMITE_POR_DEFECTO));
    const [avisa, setAvisa] = useState(true);
    // Minutos seguidos en el límite antes de avisar (QueueAlert.sostenidoSeg; 0 = en el momento).
    const [durante, setDurante] = useState(String(SOSTENIDO_POR_DEFECTO_SEG / 60));
    const [ahora, setAhora] = useState<{ aforo: number | null; cuando: string | null; canales: number }>({ aforo: null, cuando: null, canales: 0 });
    const [susc, setSusc] = useState<Suscripcion | null | undefined>(undefined);

    useEffect(() => {
        if (!open) return;
        setF(blanco()); setInfo(null); setGuardando(false); setAlerta(null);
        setLimite(String(LIMITE_POR_DEFECTO)); setAvisa(true); setDurante(String(SOSTENIDO_POR_DEFECTO_SEG / 60)); setAhora({ aforo: null, cuando: null, canales: 0 }); setSusc(undefined);
        if (!device?.id) return;
        getCredencialesDispositivo(device.id).then((c) => { if (c) setF((p) => ({ ...p, username: c.username || p.username, password: c.password || "" })); }).catch(() => { });
        getQueueAlerts().then((l: any[]) => {
            const a = l.find((x) => x.deviceId === device.id && (!x.channelName || ES_AFORO.test(x.channelName)));
            if (a) { setAlerta(a); setLimite(String(a.threshold)); setAvisa(!!a.enabled); setDurante(String(Math.round((a.sostenidoSeg || 0) / 60))); }
        }).catch(() => { });
        getLatestQueueCounts().then((l: any[]) => {
            const d = l.find((x) => x.device.id === device.id);
            const c = d?.channels.find((x: any) => ES_AFORO.test(x.channelName || ""));
            setAhora({ aforo: c ? c.peopleCount : null, cuando: c ? c.lastUpdate : null, canales: d?.channels.length || 0 });
        }).catch(() => { });
        fetch("/api/queue/poll?info=1").then((r) => r.json()).then((j) => {
            setSusc((j?.subscriptions || []).find((s: Suscripcion) => s.deviceId === device.id) || null);
        }).catch(() => setSusc(null));
    }, [open, blanco, device]);

    const ipValida = /^\d{1,3}(\.\d{1,3}){3}$/.test(f.ip.trim());
    const limiteN = parseInt(limite, 10);
    const limiteValido = Number.isFinite(limiteN) && limiteN > 0;
    const duranteSeg = Math.max(0, parseInt(durante || "0", 10) || 0) * 60;

    async function detectar() {
        if (!ipValida) return;
        setDetectando(true); setInfo(null);
        try {
            const r: any = await probeDeviceInfo({ ip: f.ip.trim(), username: f.username, password: f.password, authType: f.authType, brand: "BOSCH" });
            setInfo(r);
            if (r?.ok) setF((p) => ({ ...p, mac: r.macAddress || p.mac, deviceModel: r.model || p.deviceModel }));
        } catch (e: any) { setInfo({ ok: false, error: e?.message }); }
        finally { setDetectando(false); }
    }

    function formulario(): FormData {
        const fd = new FormData();
        fd.set("name", f.name.trim()); fd.set("ip", f.ip.trim()); fd.set("brand", "BOSCH"); fd.set("deviceType", "QUEUE_COUNTER");
        fd.set("direction", "ENTRY"); fd.set("location", f.location.trim());
        fd.set("username", f.username.trim()); fd.set("password", f.password); fd.set("authType", f.authType);
        fd.set("mac", f.mac.trim()); fd.set("deviceModel", f.deviceModel || "");
        return fd;
    }

    async function guardarLimite(deviceId: string) {
        if (!limiteValido) return;
        if (alerta) {
            if (alerta.threshold !== limiteN || !!alerta.enabled !== avisa || (alerta.sostenidoSeg || 0) !== duranteSeg) await updateQueueAlert(alerta.id, { threshold: limiteN, enabled: avisa, sostenidoSeg: duranteSeg });
        } else {
            const a = await createQueueAlert({ name: f.name.trim() || "Fila", deviceId, channelName: CANAL_AFORO, threshold: limiteN, sostenidoSeg: duranteSeg });
            if (!avisa) await updateQueueAlert(a.id, { enabled: false });
        }
    }

    const bloqueo = !f.name.trim() ? "Falta el nombre" : !ipValida ? "Falta una IP válida" : !limiteValido ? "El límite tiene que ser un número mayor que cero" : !esEdicion && !f.password ? "Falta la contraseña" : null;

    async function guardar() {
        if (bloqueo) return;
        setGuardando(true);
        try {
            if (esEdicion) {
                await updateDevice(device.id, formulario());
                await guardarLimite(device.id);
                toast.success({ title: "Cambios guardados", description: f.name });
            } else {
                const r: any = await createDevice(formulario());
                if (!r?.ok || !r.id) throw new Error("No se pudo crear el equipo");
                await guardarLimite(r.id);
                toast.success({ title: "Contador de fila agregado", description: "En unos segundos el servidor se suscribe a su conteo." });
            }
            onSuccess(); onOpenChange(false);
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    }

    const subtitulo = `Contador de fila · Bosch${f.deviceModel ? ` · ${f.deviceModel}` : ""}`;

    const bloqueConexion = (
        <>
            <div className="grid grid-cols-2 gap-4">
                <Campo etiqueta="Dirección IP" icono={Network} value={f.ip} onChange={(v) => { set("ip", v); setInfo(null); }} placeholder="10.96.8.77" mono
                    ayuda="La IP fija de la cámara en la red del lugar. Conviene una reserva DHCP en el router para que no cambie." />
                <label className="block">
                    <Etiqueta texto="Autenticación" ayuda="Bosch acepta Digest. El conteo llega por ONVIF con este mismo usuario." />
                    <Select value={f.authType} onValueChange={(v) => set("authType", v)}>
                        <SelectTrigger className="h-10"><ShieldCheck size={15} className="text-muted-foreground mr-1" /><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="DIGEST">Digest</SelectItem><SelectItem value="BASIC">Basic</SelectItem></SelectContent>
                    </Select>
                </label>
                <Campo etiqueta="Usuario" icono={User} value={f.username} onChange={(v) => set("username", v)} placeholder="admin"
                    ayuda="Un usuario de la cámara con nivel «service» si se van a cambiar la zona y el rebote desde OmniAccess; para sólo contar alcanza «user»." />
                <Campo etiqueta="Contraseña" icono={KeyRound} tipo="password" value={f.password} onChange={(v) => set("password", v)} placeholder={esEdicion ? "Sin cambios" : "••••••••"}
                    ayuda="Queda guardada en el servidor y no se muestra en las listas. En la ficha, vacía = no se cambia." />
                <Campo etiqueta="MAC" icono={Fingerprint} value={f.mac} onChange={(v) => set("mac", v)} placeholder="Se completa al detectar" mono className="col-span-2"
                    ayuda="Identifica a la cámara aunque le cambien la IP. La completa «Detectar»." />
            </div>
            {!esEdicion && (
                <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
                    <div className="flex items-center gap-3">
                        <Button type="button" variant="outline" onClick={detectar} disabled={!ipValida || detectando} className="gap-1.5 shrink-0">
                            {detectando ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={15} />} Detectar cámara
                        </Button>
                        <span className="text-[12px] text-muted-foreground">Pregunta por ONVIF modelo, firmware y MAC: si contesta, la IP y la clave están bien.</span>
                    </div>
                    {info && <ResultadoDeteccion info={info} />}
                </div>
            )}
        </>
    );

    const bloqueFila = (
        <>
            {esEdicion && (
                <div className="grid grid-cols-2 gap-3">
                    <div className={cn("rounded-xl border p-3.5 flex items-center gap-3", susc ? "border-emerald-500/25 bg-emerald-500/5" : susc === null ? "border-amber-500/30 bg-amber-500/5" : "border-border")}>
                        {susc === undefined ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : susc ? <Radio size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-amber-500" />}
                        <div className="min-w-0 text-[12.5px]">
                            <div className="font-semibold">{susc === undefined ? "Consultando…" : susc ? "Recibiendo el conteo" : "Sin suscripción ONVIF"}</div>
                            <div className="text-muted-foreground truncate">{susc?.lastPull ? `Último pedido ${hora(susc.lastPull)}` : susc === null ? "El servidor reintenta cada 2 minutos" : ""}</div>
                        </div>
                    </div>
                    <div className="rounded-xl border border-border p-3.5 flex items-center gap-3">
                        <Users size={16} className="text-[var(--accion)]" />
                        <div className="min-w-0 text-[12.5px]">
                            <div className="font-semibold">{ahora.aforo == null ? "Sin datos de aforo" : `${ahora.aforo} ${ahora.aforo === 1 ? "persona" : "personas"} en la fila`}</div>
                            <div className="text-muted-foreground truncate">{ahora.cuando ? `Dato de las ${hora(ahora.cuando)}` : "Todavía no llegó ningún conteo"}</div>
                        </div>
                    </div>
                </div>
            )}
            <div className="grid grid-cols-[130px_130px_1fr] gap-4 items-end">
                <Campo etiqueta="Límite de la fila" icono={Gauge} value={limite} onChange={(v) => setLimite(v.replace(/\D/g, ""))} placeholder={String(LIMITE_POR_DEFECTO)} mono
                    ayuda="Cuántas personas entran en la fila antes de considerarla llena. Con este número se pinta el estado (bien / aviso / llena) y se dispara el aviso." />
                <Campo etiqueta="Durante (min)" icono={Timer} value={durante} onChange={(v) => setDurante(v.replace(/\D/g, ""))} placeholder={String(SOSTENIDO_POR_DEFECTO_SEG / 60)} mono
                    ayuda="Minutos seguidos en el límite antes de avisar. Con 0 avisa en el momento; con 2, una ráfaga de segundos no avisa y una fila que se mantiene sí. Un aviso por cada vez que se carga." />
                <label className="flex items-center gap-3 h-10 rounded-lg border border-border px-3 cursor-pointer" {...tip("Si está apagado, la fila igual se cuenta y se ve, pero no manda avisos a la guardia ni a los destinatarios.")}>
                    <BellRing size={15} className="text-muted-foreground" />
                    <span className="flex-1 text-[13px]">Avisar cuando llega al límite</span>
                    <Switch checked={avisa} onCheckedChange={setAvisa} />
                </label>
            </div>
            {esEdicion && (
                <div className="flex flex-wrap gap-2">
                    <Link href={`/admin/calibracion-aforo?device=${device.id}`} onClick={() => onOpenChange(false)}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold hover:bg-accent" {...tip("Dibujar la zona de la fila sobre el video, el rebote y la ventana anti doble conteo, guardados en la cámara.")}>
                        <SlidersHorizontal size={14} /> Zona y rebote en la cámara
                    </Link>
                    <Link href="/admin/horarios-filas" onClick={() => onOpenChange(false)}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold hover:bg-accent" {...tip("Cuándo atiende la fila y cuándo se pone el contador en cero.")}>
                        <CalendarClock size={14} /> Horarios de la fila
                    </Link>
                </div>
            )}
        </>
    );

    const pie = (
        <div className="flex items-center gap-2 w-full">
            <span className="flex-1 text-[12px] text-muted-foreground truncate">{bloqueo || (esEdicion ? `${subtitulo} · ${device?.ip}` : "")}</span>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando || !!bloqueo} className="gap-1.5">
                {guardando ? <Loader2 size={15} className="animate-spin" /> : esEdicion ? <Save size={15} /> : <Plus size={15} />} {esEdicion ? "Guardar cambios" : "Agregar contador"}
            </Button>
        </div>
    );

    return (
        <Cajon open={open} onOpenChange={(v) => { if (!guardando) onOpenChange(v); }}>
            <CajonContenido ancho={esEdicion ? "intermedio" : "medio"} tituloOculto={esEdicion} sinCabecera={esEdicion}
                titulo={esEdicion ? (device?.name || "Contador de fila") : "Nuevo contador de fila"}
                descripcion={esEdicion ? subtitulo : "Una cámara Bosch que cuenta las personas en la zona de una fila."}
                pie={pie}>
                {esEdicion && (
                    <CabeceraFila device={device} titulo={f.name || device?.name || "Contador de fila"} subtitulo={subtitulo} ip={f.ip} mac={f.mac}
                        aforo={ahora.aforo} limite={limiteValido ? limiteN : null} detectando={detectando} puedeDetectar={ipValida} onComprobar={detectar} info={info} />
                )}
                {!esEdicion && (
                    <Bloque titulo="Fabricante" icono={Cpu} ayuda="El conteo de filas se hace con las analíticas de la cámara (IVA de Bosch): ella cuenta y le avisa al servidor por ONVIF.">
                        <Opcion activa onClick={() => { }} icono={Cpu} color="bg-sky-500/10 text-sky-500" titulo="Bosch"
                            detalle="Conteo por la regla de ocupación de la cámara; zona y rebote editables desde OmniAccess" />
                    </Bloque>
                )}
                <Bloque titulo="Identidad" icono={Tag} ayuda="Cómo se llama la fila y dónde está. Es lo que se ve en el monitor, el kiosco, los reportes y los avisos.">
                    <Campo etiqueta="Nombre" icono={Type} value={f.name} onChange={(v) => set("name", v)} placeholder="Caja 1" autoFocus={!esEdicion}
                        ayuda="El nombre de la fila, no el de la cámara. Ej.: «Caja 1», «Admisión planta baja»." />
                    <div className="grid grid-cols-2 gap-4">
                        <Dato etiqueta="Modelo" icono={Cpu} valor={f.deviceModel} faltante={esEdicion ? "Sin leer: «Comprobar» lo trae de la cámara" : "Lo trae «Detectar cámara»"}
                            ayuda="Lo informa la cámara por ONVIF; no se escribe a mano." />
                        <Campo etiqueta="Ubicación" icono={MapPin} value={f.location} onChange={(v) => set("location", v)} placeholder="Hall central"
                            ayuda="Texto libre para ubicarla. Ej.: «Hall central, planta baja»." />
                    </div>
                </Bloque>
                <Bloque titulo="La fila" icono={Users} ayuda="El límite de personas de esta fila y si avisa al llenarse. La zona donde se cuenta vive en la cámara: se ajusta en Calibración.">
                    {bloqueFila}
                </Bloque>
                <Bloque titulo="Conexión" icono={Network} ayuda="Cómo llega el servidor a la cámara. Con estos datos se suscribe al conteo (ONVIF) y se arma el vivo.">
                    {bloqueConexion}
                </Bloque>
                <Tooltip id={TT} place="top" className="!max-w-[300px] !text-[12px] !leading-snug !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}

function ResultadoDeteccion({ info }: { info: any }) {
    return (
        <div className={cn("rounded-lg p-3 text-[12.5px] flex items-start gap-2.5", info.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-300")}>
            {info.ok ? <Check size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
            {info.ok
                ? <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 flex-1"><span>Modelo: <b>{info.model || "—"}</b></span><span>MAC: <b className="font-mono">{info.macAddress || "—"}</b></span><span>Firmware: <b>{info.firmwareVersion || "—"}</b></span><span>Serie: <b className="font-mono">{info.serialNumber || "—"}</b></span></div>
                : <span>No respondió: {info.error || "revisá IP, usuario y contraseña"}</span>}
        </div>
    );
}

/**
 * Cabecera de la ficha: el vivo a sangre como en las demás fichas, pero pausado de entrada (en
 * HB la salida es un LTE), con el aforo de ahora contra el límite y «Comprobar».
 */
function CabeceraFila({ device, titulo, subtitulo, ip, mac, aforo, limite, detectando, puedeDetectar, onComprobar, info }: {
    device: any; titulo: string; subtitulo: string; ip: string; mac: string; aforo: number | null; limite: number | null;
    detectando: boolean; puedeDetectar: boolean; onComprobar: () => void; info: any;
}) {
    const chip = "inline-flex items-center gap-1 h-6 px-2 rounded-md bg-black/45 backdrop-blur-md text-white text-[10.5px] font-bold ring-1 ring-white/10";
    const lleno = aforo != null && limite != null && aforo >= limite;
    return (
        <div className="sticky top-0 z-20">
            <div className="relative w-full overflow-hidden bg-black aspect-video">
                <VivoConPlay deviceId={device.id}>
                    <video src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(nombreStreamFila(device.ip))}`} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
                </VivoConPlay>
                <span className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none" />
                <span className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
                <div className="absolute left-5 top-4 right-4 flex items-start gap-3 z-30">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-[19px] font-bold text-white leading-tight truncate drop-shadow">{titulo}</h2>
                        <p className="text-[12px] text-white/75 truncate drop-shadow">{subtitulo}</p>
                        <div className="flex items-center gap-1.5 mt-2">
                            <span className={chip}><Users size={12} /> Contador de fila</span>
                            {aforo != null && <span className={cn(chip, lleno ? "!bg-red-600/85" : "!bg-emerald-600/80")}>{aforo}{limite != null ? ` / ${limite}` : ""} en la fila</span>}
                        </div>
                    </div>
                    <CajonCerrar className="shrink-0 h-9 w-9 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md text-white grid place-items-center ring-1 ring-white/15 transition-colors" aria-label="Cerrar"><X size={17} /></CajonCerrar>
                </div>
                <div className="absolute left-4 right-4 bottom-12 flex items-end gap-3 z-30 pointer-events-none">
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn(chip, "font-mono")}><Network size={11} /> {ip}</span>
                            {mac && <span className={cn(chip, "font-mono font-semibold")}>{mac}</span>}
                        </div>
                        {info && <div className={cn(chip, "max-w-full truncate", info.ok ? "!bg-emerald-600/80" : "!bg-red-600/80")}>{info.ok ? <Check size={11} /> : <AlertTriangle size={11} />} {info.ok ? `${info.model || "Responde"}${info.firmwareVersion ? ` · ${info.firmwareVersion}` : ""}` : (info.error || "No respondió")}</div>}
                    </div>
                    <button type="button" onClick={onComprobar} disabled={detectando || !puedeDetectar} {...tip("Comprobar: consulta la cámara ahora por ONVIF (modelo, MAC, firmware) para confirmar que responde con estas credenciales.")}
                        className="pointer-events-auto shrink-0 h-9 px-3 rounded-full bg-white/90 hover:bg-white text-black text-[12px] font-bold inline-flex items-center gap-1.5 shadow-lg disabled:opacity-60">
                        {detectando ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />} Comprobar
                    </button>
                </div>
            </div>
        </div>
    );
}
