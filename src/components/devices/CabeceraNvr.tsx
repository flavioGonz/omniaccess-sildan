"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, AlertTriangle, Check, ExternalLink, HardDrive, Loader2, MemoryStick, Network, Plus, RefreshCw, ScanSearch, SlidersHorizontal, Sparkles, Timer, Wifi, X } from "lucide-react";
import { IntrusionCalibrator } from "@/components/IntrusionCalibrator";
import { TIPOS_REGLA, TIPOS_RETIRADOS, type ReglaVision } from "@/lib/vision-reglas";
import { CajonCerrar } from "@/components/ui/cajon";
import { cn } from "@/lib/utils";

/**
 * La cabecera de la ficha de un NVR: el grabador dibujado como un switch (Nico, 14/10).
 *
 * Un puerto por canal, pegados, con su número: con cámara y conectada, con cámara pero caída, o
 * vacío. Así se ve de un vistazo qué tiene conectado el grabador — antes la cabecera era una
 * banda con un ícono de disco y la IP, y para saber qué había en cada canal había que importar.
 * Al pasar sobre un puerto se despliega abajo el vivo de ese canal (del equipo si la cámara ya
 * está dada de alta; si no, un vivo temporal del canal en el grabador). Debajo, la salud del
 * grabador: si contesta, hace cuánto está prendido, memoria y cada disco.
 *
 * A sangre, sin redondeo ni sombra: es la cabecera del cajón, no una tarjeta adentro de él.
 */

type Canal = { ch: number; nombre: string | null; ip: string | null; modelo: string | null; online: boolean | null; sensorDe: number | null; equipo: { id: string; nombre: string; tipo: string } | null };
type Disco = { nombre: string; estado: string; capacidadGB: number; usadoPct: number; modelo: string | null };
type Panel = {
    ok: boolean; error: string | null; capacidad: number; canales: Canal[];
    salud: { alcanzable: boolean; latenciaMs: number | null; uptimeSec: number | null; memoriaPct: number | null; discos: Disco[] | null };
};

/** Cuántos puertos por fila: como un switch de 16 bocas; más, en filas de 16. */
const POR_FILA = 16;
/** Lo que se espera antes de abrir el vivo de un puerto: pasar el mouse por encima de varios no tiene que abrir varios. */
const ESPERA_HOVER_MS = 220;
/** Lo que tarda en replegarse el vivo al salir de los puertos: da tiempo a bajar el mouse hasta el video. */
const ESPERA_SALIDA_MS = 450;
/**
 * Desde acá el disco se muestra «lleno». No es una alarma: un grabador en modo sobrescritura vive
 * lleno y pisa lo más viejo; lo que dice cuánto guarda es la retención de cada cámara.
 */
const DISCO_LLENO_PCT = 97;

const chip = "inline-flex items-center gap-1 h-6 px-2 rounded-md bg-white/10 text-white text-[10.5px] font-bold";

/*
 * Las analíticas de cada canal, dibujadas sobre su vivo (21/10, Nico: «en la mini captura del canal,
 * ¿podés dibujarle las analíticas? y tener un botón para editarlas todas desde ahí mismo: sería útil
 * para las configuraciones masivas»). Dos fuentes:
 *  · la de la cámara: su cruce de línea y su zona, leídas por ISAPI (/api/devices/analytics, en
 *    0–1000 con el origen abajo a la izquierda, como las guarda Hikvision);
 *  · las reglas de OmniVision de ese equipo (/api/vision/reglas), en fracciones del cuadro.
 * Cada una con su color fijo, para que se distingan de un vistazo.
 */
type Pt = [number, number];
type GeomCamara = { linea: Pt[]; zona: Pt[] } | { error: string };
const COLOR_LINEA_CAMARA = "#38bdf8";
const COLOR_ZONA_CAMARA = "#f43f5e";
const COLOR_OMNIVISION = "#a78bfa";
const deCamara = (p: { x: number; y: number }): Pt => [p.x / 1000, 1 - p.y / 1000];

function estadoDe(c: Canal | undefined): "vacio" | "conectada" | "caida" | "nosabe" {
    if (!c || (!c.ip && !c.nombre)) return "vacio";
    if (c.online === true) return "conectada";
    if (c.online === false) return "caida";
    return "nosabe";
}

const ROTULO: Record<ReturnType<typeof estadoDe>, string> = { vacio: "Vacío", conectada: "Conectada", caida: "Sin señal", nosabe: "Sin dato" };
const COLOR: Record<ReturnType<typeof estadoDe>, string> = {
    vacio: "bg-white/[0.06] text-white/30",
    conectada: "bg-[color-mix(in_oklab,var(--bien)_78%,black)] text-white",
    caida: "bg-[color-mix(in_oklab,var(--mal)_75%,black)] text-white",
    nosabe: "bg-white/25 text-white",
};

/*
 * La búsqueda con IA del grabador, por canal (21/10, Nico: «tengo que saber en qué canales se puede
 * realizar la búsqueda, poder activarlo o no; no sé si busca en todos»). No busca en todos: analiza
 * sólo los canales que tiene encendidos para eso (medido: 15 de 19 en el NVR01 de Otto Villa, 15 de
 * 21 en el NVR 02), y lo que no analizó no lo encuentra aunque se le pida. Cada puerto lleva una
 * raya celeste si busca, y «Elegir canales» deja prender y apagar puerto por puerto.
 */
type Busqueda = { motor: string; texto: number[] | null; imagen: number[] | null; /** Los que pueden buscar (null = no se sabe: se deja elegir cualquiera). */ posibles: number[] | null };
/** El celeste de lo que busca el grabador: el mismo distintivo de sus resultados en el Historial. */
const COLOR_BUSQUEDA = "bg-sky-400";
const enAlguna = (b: Busqueda | null, ch: number) => !!b && ((b.texto || []).includes(ch) || (b.imagen || []).includes(ch));

function hace(seg: number): string {
    const d = Math.floor(seg / 86400), h = Math.floor((seg % 86400) / 3600);
    return d ? `${d} d ${h} h` : h ? `${h} h` : `${Math.max(1, Math.floor(seg / 60))} min`;
}

export function CabeceraNvr({ device, titulo, subtitulo, ip, mac, detectando, puedeDetectar, onComprobar, info }: {
    device: any; titulo: string; subtitulo: string; ip: string; mac?: string;
    detectando: boolean; puedeDetectar: boolean; onComprobar: () => void; info: any;
}) {
    const [panel, setPanel] = useState<Panel | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sobre, setSobre] = useState<number | null>(null);
    const [vivo, setVivo] = useState<{ ch: number; stream: string | null; listo: boolean; falla: boolean } | null>(null);
    const timers = useRef<{ entrar?: any; salir?: any }>({});
    /** La forma del cuadro del canal que se ve: la capa de analíticas se dibuja sobre el cuadro entero, sin recortes. */
    const [aspecto, setAspecto] = useState(16 / 9);
    const [geomCam, setGeomCam] = useState<Record<string, GeomCamara | "cargando">>({});
    const [reglas, setReglas] = useState<ReglaVision[] | null>(null);
    const [menuAnalit, setMenuAnalit] = useState(false);
    /** La cámara que se está calibrando (línea y zona), en su ventana, sin salir de la ficha del NVR. */
    const [calibrando, setCalibrando] = useState<{ id: string; name: string } | null>(null);

    const [busq, setBusq] = useState<Busqueda | null>(null);
    /** Los canales elegidos mientras se edita (null = no se está editando). */
    const [eligiendo, setEligiendo] = useState<Set<number> | null>(null);
    const [guardandoBusq, setGuardandoBusq] = useState<"probando" | "guardando" | null>(null);
    /** Antes de guardar, si el grabador reinicia cámaras para aplicarlo: cuáles, para confirmarlo. */
    const [aviso, setAviso] = useState<{ reinician: number[] } | null>(null);
    const [errorBusq, setErrorBusq] = useState<string | null>(null);
    const leerBusq = useCallback(async () => {
        if (!device?.id) return;
        try {
            const r = await fetch(`/api/grabador/canales?nvr=${encodeURIComponent(device.id)}`, { cache: "no-store" });
            const j = await r.json().catch(() => null);
            // 404: el grabador no busca con IA. Ahí no se muestra nada (no es un error).
            setBusq(r.ok && j?.ok && (j.texto || j.imagen) ? { motor: j.motor, texto: j.texto, imagen: j.imagen, posibles: Array.isArray(j.posibles) ? j.posibles : null } : null);
        } catch { setBusq(null); }
    }, [device?.id]);
    useEffect(() => { leerBusq(); }, [leerBusq]);

    const cargar = useCallback(async () => {
        if (!device?.id) return;
        setCargando(true); setError(null);
        try {
            const r = await fetch(`/api/nvr/panel?nvr=${encodeURIComponent(device.id)}`, { cache: "no-store" });
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
            setPanel(j);
        } catch (e: any) { setError(e?.message || "No se pudo leer el NVR"); }
        finally { setCargando(false); }
    }, [device?.id]);
    useEffect(() => { cargar(); }, [cargar]);

    const porCanal = useMemo(() => new Map((panel?.canales || []).map((c) => [c.ch, c])), [panel]);
    const capacidad = panel?.capacidad || 0;
    const puertos = Array.from({ length: capacidad }, (_, i) => i + 1);
    const conCamara = (panel?.canales || []).filter((c) => estadoDe(c) !== "vacio");
    const conectadas = conCamara.filter((c) => c.online === true).length;
    const buscables = busq ? conCamara.filter((c) => enAlguna(busq, c.ch)).length : 0;
    const distintas = !!busq?.texto && !!busq?.imagen && busq.texto.join() !== busq.imagen.join();

    const empezarEleccion = () => {
        setErrorBusq(null); setAviso(null); setVivo(null); setSobre(null);
        setEligiendo(new Set([...(busq?.texto || []), ...(busq?.imagen || [])]));
    };
    /** Un canal que el grabador no deja prender (la cámara no le da su análisis): no se elige. */
    const puedeBuscar = (ch: number) => !busq?.posibles || busq.posibles.includes(ch) || enAlguna(busq, ch);
    const noPueden = busq?.posibles ? conCamara.filter((c) => !puedeBuscar(c.ch)) : [];
    const alternarCanal = (ch: number) => { if (!puedeBuscar(ch)) return; setAviso(null); setEligiendo((s) => { if (!s) return s; const n = new Set(s); if (n.has(ch)) n.delete(ch); else n.add(ch); return n; }); };
    const guardarBusq = async (confirmado: boolean) => {
        if (!eligiendo || !device?.id) return;
        const canales = [...eligiendo].sort((a, b) => a - b);
        const tipo = busq?.texto && busq?.imagen ? "ambos" : busq?.texto ? "texto" : "imagen";
        setErrorBusq(null);
        try {
            // Primero se prueba: si el grabador va a reiniciar cámaras para aplicarlo, se avisa antes.
            if (!confirmado) {
                setGuardandoBusq("probando");
                const p = await fetch("/api/grabador/canales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nvr: device.id, tipo, canales, probar: true }) }).then((r) => r.json());
                if (!p?.ok) { setErrorBusq(p?.error || "El grabador rechazó el cambio."); return; }
                if (p.reinician?.length) { setAviso({ reinician: p.reinician }); return; }
            }
            setGuardandoBusq("guardando"); setAviso(null);
            const r = await fetch("/api/grabador/canales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nvr: device.id, tipo, canales }) }).then((x) => x.json());
            if (!r?.ok) { setErrorBusq(r?.error || "El grabador no aceptó el cambio."); return; }
            setEligiendo(null);
            await leerBusq();
        } catch (e: any) { setErrorBusq(e?.message || "No se pudo hablar con el grabador."); }
        finally { setGuardandoBusq(null); }
    };
    const caidas = conCamara.filter((c) => c.online === false).length;

    // El vivo del puerto: el del equipo si la cámara está dada de alta; si no, uno temporal del canal.
    const abrirVivo = useCallback(async (ch: number) => {
        const c = porCanal.get(ch);
        if (estadoDe(c) === "vacio") { setVivo(null); return; }
        if (c?.equipo) { setVivo({ ch, stream: `lpr_${c.equipo.id}`, listo: false, falla: false }); return; }
        setVivo({ ch, stream: null, listo: false, falla: false });
        try {
            const r = await fetch("/api/nvr/canal-vivo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nvr: device.id, ch }) }).then((x) => x.json());
            setVivo((v) => (v && v.ch === ch ? { ...v, stream: r?.ok ? `lpr_${r.id}` : null, falla: !r?.ok } : v));
        } catch { setVivo((v) => (v && v.ch === ch ? { ...v, falla: true } : v)); }
    }, [porCanal, device?.id]);

    const entrar = (ch: number) => {
        if (eligiendo) return; // eligiendo canales, el puerto se prende y apaga: no abre el vivo
        clearTimeout(timers.current.salir); clearTimeout(timers.current.entrar);
        setSobre(ch);
        timers.current.entrar = setTimeout(() => { if (vivo?.ch !== ch) abrirVivo(ch); }, ESPERA_HOVER_MS);
    };
    const salir = () => {
        clearTimeout(timers.current.entrar);
        // Mientras se calibra (la ventana tapa todo) el vivo queda abierto: al volver se ve lo dibujado.
        if (calibrando) return;
        timers.current.salir = setTimeout(() => { setSobre(null); setVivo(null); setMenuAnalit(false); }, ESPERA_SALIDA_MS);
    };
    const quedarse = () => clearTimeout(timers.current.salir);
    useEffect(() => () => { clearTimeout(timers.current.entrar); clearTimeout(timers.current.salir); }, []);

    const canalVivo = vivo ? porCanal.get(vivo.ch) : undefined;
    const salud = panel?.salud;
    const equipoVivo = canalVivo?.equipo || null;

    const leerGeomCamara = useCallback(async (id: string) => {
        setGeomCam((g) => ({ ...g, [id]: "cargando" }));
        try {
            const d = await fetch(`/api/devices/analytics?deviceId=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => r.json());
            const g: GeomCamara = d?.ok
                ? { linea: d.line?.enabled ? (d.line.points || []).map(deCamara) : [], zona: d.field?.enabled ? (d.field.points || []).map(deCamara) : [] }
                : { error: d?.error || "la cámara no contestó" };
            setGeomCam((x) => ({ ...x, [id]: g }));
        } catch { setGeomCam((x) => ({ ...x, [id]: { error: "la cámara no contestó" } })); }
    }, []);
    const leerReglas = useCallback(async () => {
        try {
            const d = await fetch("/api/vision/reglas", { cache: "no-store" }).then((r) => r.json());
            setReglas(Array.isArray(d?.reglas) ? d.reglas : []);
        } catch { setReglas([]); }
    }, []);
    // Al abrir el vivo de un canal dado de alta: su geometría (una vez por cámara) y las reglas (una vez por ficha).
    useEffect(() => {
        if (!equipoVivo) return;
        if (!geomCam[equipoVivo.id]) leerGeomCamara(equipoVivo.id);
        if (reglas === null) leerReglas();
    }, [equipoVivo, geomCam, reglas, leerGeomCamara, leerReglas]);
    useEffect(() => { setMenuAnalit(false); }, [vivo?.ch]);
    const reglasVivo = useMemo(() => (equipoVivo && reglas ? reglas.filter((r) => r.deviceId === equipoVivo.id && !TIPOS_RETIRADOS.includes(r.tipo)) : []), [equipoVivo, reglas]);
    const gVivo = equipoVivo ? geomCam[equipoVivo.id] : undefined;
    const gOk = gVivo && gVivo !== "cargando" && !("error" in gVivo) ? gVivo : null;
    const nAnalit = (gOk ? (gOk.linea.length >= 2 ? 1 : 0) + (gOk.zona.length >= 3 ? 1 : 0) : 0) + reglasVivo.length;

    return (
        <div className="relative bg-[#0b0d11] text-white">
            {calibrando && <IntrusionCalibrator device={calibrando} onClose={() => { const id = calibrando.id; setCalibrando(null); leerGeomCamara(id); }} />}
            {/* Título y cerrar */}
            <div className="flex items-start gap-3 px-5 pt-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-white/[0.07] text-[var(--accion-en-oscuro)]"><HardDrive size={19} /></span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-[19px] font-bold leading-tight truncate">{titulo}</h2>
                    <p className="text-[12px] text-white/60 truncate">{subtitulo}</p>
                </div>
                <CajonCerrar className="shrink-0 h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition-colors" aria-label="Cerrar"><X size={17} /></CajonCerrar>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap px-5 mt-3">
                <span className={cn(chip, "font-mono")}><Network size={11} /> {ip}</span>
                {mac && <span className={cn(chip, "font-mono font-semibold")}>{mac}</span>}
                {info && <span title={info.nota || undefined} className={cn(chip, info.ok ? "text-[var(--bien)]" : "text-[var(--mal)]")}>{info.ok ? <Check size={11} /> : <AlertTriangle size={11} />} {info.ok ? `${info.model || "Responde"}${info.firmwareVersion ? ` · ${info.firmwareVersion}` : ""}` : (info.error || "No respondió")}</span>}
                <button type="button" onClick={onComprobar} disabled={detectando || !puedeDetectar}
                    className="ml-auto h-8 px-3 rounded-full bg-white/90 hover:bg-white text-black text-[12px] font-bold inline-flex items-center gap-1.5 disabled:opacity-60">
                    {detectando ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />} Comprobar
                </button>
            </div>

            {/* Los puertos */}
            <div className="px-5 pt-4">
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/50">Canales</span>
                    {panel && <span className="text-[11px] text-white/60 tabular-nums">{conCamara.length} de {capacidad} con cámara · {conectadas} conectadas{caidas ? ` · ${caidas} sin señal` : ""}</span>}
                    <button type="button" onClick={cargar} disabled={cargando} title="Volver a leer el NVR" className="ml-auto h-6 w-6 grid place-items-center rounded-md text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-40">
                        <RefreshCw size={12} className={cn(cargando && "animate-spin")} />
                    </button>
                </div>
                {cargando && !panel ? (
                    <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${POR_FILA}, minmax(0, 1fr))` }}>
                        {Array.from({ length: POR_FILA }).map((_, i) => <span key={i} className="h-[26px] rounded-[3px] bg-white/[0.06] animate-pulse" />)}
                    </div>
                ) : error && !panel ? (
                    <div className="rounded-[6px] bg-white/[0.05] px-3 py-2 text-[12px] text-white/70 flex items-center gap-2">
                        <AlertTriangle size={14} className="text-[var(--aviso)] shrink-0" /> No se pudieron leer los canales: {error}
                        <button type="button" onClick={cargar} className="ml-auto text-[12px] font-semibold text-[var(--accion-en-oscuro)] hover:underline">Reintentar</button>
                    </div>
                ) : (
                    <div onMouseLeave={salir} onMouseEnter={quedarse}>
                        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.min(POR_FILA, capacidad || POR_FILA)}, minmax(0, 1fr))` }}>
                            {puertos.map((ch) => {
                                const c = porCanal.get(ch);
                                const e = estadoDe(c);
                                return (
                                    <button key={ch} type="button" onMouseEnter={() => entrar(ch)} onFocus={() => entrar(ch)}
                                        onClick={() => (eligiendo ? alternarCanal(ch) : abrirVivo(ch))}
                                        aria-pressed={eligiendo ? eligiendo.has(ch) : undefined}
                                        aria-label={`Canal ${ch}: ${ROTULO[e]}${c?.nombre ? ` · ${c.nombre}` : ""}${enAlguna(busq, ch) ? " · busca con IA" : ""}`}
                                        title={`D${ch} · ${ROTULO[e]}${c?.nombre ? ` · ${c.nombre}` : ""}${c?.ip ? ` · ${c.ip}` : ""}${c?.equipo ? ` · en OmniAccess: ${c.equipo.nombre}` : ""}${busq ? (enAlguna(busq, ch) ? " · busca con IA" : puedeBuscar(ch) ? " · no busca con IA" : " · no puede buscar con IA: la cámara no le da su análisis al grabador") : ""}`}
                                        className={cn("relative h-[26px] rounded-[3px] text-[10px] font-bold tabular-nums grid place-items-center transition-shadow", COLOR[e],
                                            sobre === ch && !eligiendo && "ring-2 ring-white ring-offset-1 ring-offset-[#0b0d11]",
                                            eligiendo && (eligiendo.has(ch) ? "ring-2 ring-sky-400 ring-offset-1 ring-offset-[#0b0d11]" : puedeBuscar(ch) ? "opacity-45" : "opacity-20 cursor-not-allowed"))}>
                                        {ch}
                                        {/* El grabador analiza este canal para su búsqueda con IA. */}
                                        {!eligiendo && enAlguna(busq, ch) && <span className={cn("absolute left-[3px] right-[3px] bottom-[2px] h-[2px] rounded-full", COLOR_BUSQUEDA)} />}
                                        {/* La cámara ya es un equipo de OmniAccess. */}
                                        {c?.equipo && <span className="absolute right-[2px] top-[2px] h-[5px] w-[5px] rounded-full bg-[var(--accion-en-oscuro)]" />}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10.5px] text-white/50">
                            {(["conectada", "caida", "vacio"] as const).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-[2px]", COLOR[k])} /> {ROTULO[k]}</span>)}
                            <span className="inline-flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--accion-en-oscuro)]" /> Dada de alta en OmniAccess</span>
                            {busq && <span className="inline-flex items-center gap-1.5"><span className={cn("h-[2px] w-2.5 rounded-full", COLOR_BUSQUEDA)} /> Busca con IA</span>}
                        </div>

                        {/* La búsqueda con IA del grabador: en qué canales, y elegirlos. */}
                        {busq && (
                            <div className={cn("mt-3 rounded-[10px] px-3 py-2.5 text-[12px]", eligiendo ? "bg-sky-400/[0.10] ring-1 ring-sky-400/30" : "bg-white/[0.05]")}>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <ScanSearch size={14} className="text-sky-300 shrink-0" />
                                    <span className="font-semibold">Búsqueda con IA del grabador</span>
                                    <span className="text-white/45">{busq.motor}</span>
                                    {!eligiendo && (
                                        <span className="text-white/65 tabular-nums">
                                            · {buscables} de {conCamara.length} canales con cámara
                                            {distintas ? ` (por texto ${busq.texto!.length}, por foto ${busq.imagen!.length})` : ""}
                                        </span>
                                    )}
                                    {eligiendo ? (
                                        <span className="text-white/70 tabular-nums">{eligiendo.size} elegidos — tocá los puertos para prender o apagar</span>
                                    ) : (
                                        <button type="button" onClick={empezarEleccion} className="ml-auto h-7 px-2.5 rounded-full bg-white/10 hover:bg-white/20 text-[11.5px] font-semibold">Elegir canales</button>
                                    )}
                                </div>
                                {!eligiendo && conCamara.length > buscables && (
                                    <p className="mt-1 text-[11.5px] text-white/50 leading-snug">
                                        En los otros no encuentra nada: {conCamara.filter((c) => !enAlguna(busq, c.ch)).map((c) => `D${c.ch}`).join(", ")}.
                                        {noPueden.length > 0 && <> {noPueden.length === 1 ? "La" : "Las"} {noPueden.map((c) => `D${c.ch}`).join(", ")} no {noPueden.length === 1 ? "puede" : "pueden"}: la cámara no le da su análisis al grabador.</>}
                                    </p>
                                )}
                                {eligiendo && (
                                    <>
                                        <p className="mt-1.5 text-[11.5px] text-white/55 leading-snug">
                                            El grabador analiza lo que graba en los canales elegidos{distintas ? "; se guarda la misma lista para buscar por texto y por foto" : ""}. En un canal recién prendido, lo grabado antes puede no estar analizado. Cada grabador puede analizar una cantidad de canales: si se pasa, lo rechaza.
                                        </p>
                                        {aviso && (
                                            <div className="mt-2 rounded-[8px] bg-[color-mix(in_oklab,var(--aviso)_14%,transparent)] px-2.5 py-2 text-[11.5px] leading-snug flex items-start gap-2">
                                                <AlertTriangle size={13} className="text-[var(--aviso)] shrink-0 mt-px" />
                                                <span>Para aplicarlo el grabador reinicia {aviso.reinician.length === 1 ? "la cámara" : "las cámaras"} {aviso.reinician.map((n) => `D${n}`).join(", ")}: unos segundos sin video ni grabación. ¿Seguir?</span>
                                            </div>
                                        )}
                                        {errorBusq && <div className="mt-2 text-[11.5px] text-[var(--mal)] flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-px" /> {errorBusq}</div>}
                                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                            <button type="button" disabled={!!guardandoBusq} onClick={() => { setAviso(null); setEligiendo(new Set(conCamara.filter((c) => puedeBuscar(c.ch)).map((c) => c.ch))); }} className="h-7 px-2.5 rounded-full bg-white/10 hover:bg-white/20 text-[11.5px] font-semibold disabled:opacity-50">{noPueden.length ? "Todos los que pueden" : "Todos los con cámara"}</button>
                                            <button type="button" disabled={!!guardandoBusq} onClick={() => { setAviso(null); setEligiendo(new Set()); }} className="h-7 px-2.5 rounded-full bg-white/10 hover:bg-white/20 text-[11.5px] font-semibold disabled:opacity-50">Ninguno</button>
                                            <button type="button" disabled={!!guardandoBusq} onClick={() => { setEligiendo(null); setAviso(null); setErrorBusq(null); }} className="ml-auto h-7 px-2.5 rounded-full text-[11.5px] font-semibold text-white/70 hover:text-white disabled:opacity-50">Cancelar</button>
                                            <button type="button" disabled={!!guardandoBusq} onClick={() => guardarBusq(!!aviso)}
                                                className="h-7 px-3 rounded-full bg-white text-black text-[11.5px] font-bold inline-flex items-center gap-1.5 disabled:opacity-60">
                                                {guardandoBusq ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                {guardandoBusq === "probando" ? "Consultando al grabador…" : guardandoBusq === "guardando" ? "Guardando…" : aviso ? "Sí, guardar" : "Guardar en el grabador"}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* El vivo del puerto, desplegado abajo */}
                        <AnimatePresence initial={false}>
                            {vivo && (
                                <motion.div key="vivo" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                                    <div className="mt-3 -mx-5">
                                        <div className="relative bg-black" style={{ aspectRatio: String(aspecto) }}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img key={`f${vivo.ch}`} src={`/api/nvr/snapshot?nvr=${encodeURIComponent(device.id)}&ch=${vivo.ch}`} alt=""
                                                onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setAspecto(i.naturalWidth / i.naturalHeight); }}
                                                className={cn("absolute inset-0 w-full h-full object-cover transition-opacity", vivo.listo ? "opacity-0" : "opacity-100")}
                                                onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                                            {vivo.stream && !vivo.falla && (
                                                <video key={vivo.stream} src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(vivo.stream)}&video=h264`} autoPlay muted playsInline
                                                    onPlaying={() => setVivo((v) => (v ? { ...v, listo: true } : v))} onError={() => setVivo((v) => (v ? { ...v, falla: true } : v))}
                                                    className={cn("absolute inset-0 w-full h-full object-cover transition-opacity", vivo.listo ? "opacity-100" : "opacity-0")} />
                                            )}
                                            {/* Las analíticas del canal, encima del cuadro. */}
                                            {equipoVivo && <CapaAnaliticas cam={gOk} reglas={reglasVivo} />}
                                            {equipoVivo ? (
                                                <div className="absolute left-3 top-3 z-10">
                                                    <button type="button" onClick={() => setMenuAnalit((v) => !v)} aria-expanded={menuAnalit} aria-haspopup="menu"
                                                        title="Ver y editar las analíticas de esta cámara"
                                                        className="h-7 pl-2 pr-2.5 rounded-full bg-black/60 backdrop-blur-md ring-1 ring-white/15 text-[11.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-black/80">
                                                        {gVivo === "cargando" || reglas === null ? <Loader2 size={12} className="animate-spin" /> : <SlidersHorizontal size={12} />}
                                                        Analíticas{nAnalit ? <span className="tabular-nums text-white/70">· {nAnalit}</span> : null}
                                                    </button>
                                                    {menuAnalit && (
                                                        <div role="menu" className="mt-1.5 w-[268px] max-h-[230px] overflow-y-auto [scrollbar-width:thin] rounded-[12px] bg-[#12151b]/95 backdrop-blur-xl ring-1 ring-white/12 shadow-[0_12px_34px_-10px_rgba(0,0,0,0.6)] p-1.5 text-[12px]">
                                                            <div className="px-2 pt-1 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/45">De la cámara</div>
                                                            {gVivo && gVivo !== "cargando" && "error" in gVivo ? (
                                                                <div className="px-2 py-1 text-white/55">No se pudo leer: {gVivo.error}</div>
                                                            ) : (
                                                                <>
                                                                    <FilaAnalitica color={COLOR_LINEA_CAMARA} texto="Cruce de línea" estado={gOk ? (gOk.linea.length >= 2 ? "dibujada" : "sin dibujar") : "…"} />
                                                                    <FilaAnalitica color={COLOR_ZONA_CAMARA} texto="Zona (entrada a zona)" estado={gOk ? (gOk.zona.length >= 3 ? "dibujada" : "sin dibujar") : "…"} />
                                                                </>
                                                            )}
                                                            <button type="button" role="menuitem" onClick={() => { setMenuAnalit(false); setCalibrando({ id: equipoVivo.id, name: equipoVivo.nombre }); }}
                                                                className="mt-0.5 w-full h-8 px-2 rounded-[8px] inline-flex items-center gap-2 font-semibold text-[var(--accion-en-oscuro)] hover:bg-white/[0.07]">
                                                                <SlidersHorizontal size={13} /> Editar línea y zona de la cámara
                                                            </button>
                                                            <div className="my-1 h-px bg-white/10" />
                                                            <div className="px-2 pt-1 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/45">OmniVision</div>
                                                            {reglasVivo.length === 0 && <div className="px-2 py-1 text-white/55">{reglas === null ? "Leyendo las reglas…" : "Sin reglas en esta cámara."}</div>}
                                                            {reglasVivo.map((r) => (
                                                                <a key={r.id} role="menuitem" href={`/admin/vision/reglas?editar=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer"
                                                                    title="Abrir la regla en OmniVision › Reglas (en otra pestaña: esta ficha queda abierta)"
                                                                    className="w-full min-h-8 px-2 py-1 rounded-[8px] flex items-center gap-2 hover:bg-white/[0.07]">
                                                                    <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: COLOR_OMNIVISION, opacity: r.activa ? 1 : 0.35 }} />
                                                                    <span className="min-w-0 flex-1 truncate">{r.nombre || TIPOS_REGLA[r.tipo]?.nombre || r.tipo}</span>
                                                                    {!r.activa && <span className="text-[10px] text-white/45">apagada</span>}
                                                                    <ExternalLink size={11} className="text-white/45 shrink-0" />
                                                                </a>
                                                            ))}
                                                            <a role="menuitem" href={`/admin/vision/reglas?nueva=intrusion&camara=${encodeURIComponent(equipoVivo.id)}`} target="_blank" rel="noreferrer"
                                                                className="mt-0.5 w-full h-8 px-2 rounded-[8px] inline-flex items-center gap-2 font-semibold text-[var(--accion-en-oscuro)] hover:bg-white/[0.07]">
                                                                <Plus size={13} /> Nueva regla en esta cámara <ExternalLink size={11} className="ml-auto text-white/45" />
                                                            </a>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="absolute left-3 top-3 z-10 h-7 px-2.5 rounded-full bg-black/60 ring-1 ring-white/15 text-[11px] text-white/70 inline-flex items-center gap-1.5"><Sparkles size={12} /> Dala de alta para configurarle analíticas</span>
                                            )}
                                            {!vivo.listo && !vivo.falla && <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/80"><Loader2 size={13} className="animate-spin" /> Conectando el vivo…</span>}
                                            {vivo.falla && <span className="absolute right-3 top-3 text-[11px] font-semibold text-white/70">Sin vivo: se muestra la foto del canal</span>}
                                            <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
                                            <div className="absolute left-4 right-4 bottom-2.5 flex items-end gap-2 text-[12px]">
                                                <span className="px-1.5 rounded bg-black/60 font-mono font-bold">D{vivo.ch}</span>
                                                <span className="min-w-0 truncate font-semibold">{canalVivo?.nombre || `Canal ${vivo.ch}`}</span>
                                                <span className="text-white/60 font-mono truncate">{canalVivo?.ip || ""}{canalVivo?.modelo ? ` · ${canalVivo.modelo}` : ""}</span>
                                                <span className="ml-auto text-white/70 whitespace-nowrap">{canalVivo?.equipo ? `En OmniAccess: ${canalVivo.equipo.nombre}` : "No dada de alta"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            {/* La salud del grabador */}
            <div className="px-5 py-4 mt-1 space-y-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                    {!salud ? (
                        cargando ? <span className={cn(chip, "text-white/60")}><Loader2 size={11} className="animate-spin" /> Midiendo…</span> : null
                    ) : !salud.alcanzable ? (
                        <span className={cn(chip, "text-[var(--mal)]")}><AlertTriangle size={11} /> No contesta</span>
                    ) : (
                        <>
                            <span className={cn(chip, "text-[var(--bien)]")}><Wifi size={11} /> En línea{salud.latenciaMs != null ? ` · ${salud.latenciaMs} ms` : ""}</span>
                            {salud.uptimeSec != null && <span className={chip}><Timer size={11} /> Prendido hace {hace(salud.uptimeSec)}</span>}
                            {salud.memoriaPct != null && <span className={chip}><MemoryStick size={11} /> Memoria {salud.memoriaPct} %</span>}
                        </>
                    )}
                </div>
                {salud?.discos && (
                    salud.discos.length === 0 ? (
                        <div className="text-[12px] text-[var(--mal)] inline-flex items-center gap-1.5"><AlertTriangle size={13} /> Sin discos: este grabador no está guardando nada.</div>
                    ) : (
                        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(salud.discos.length, 2)}, minmax(0, 1fr))` }}>
                            {salud.discos.map((d) => {
                                const sano = d.estado === "ok";
                                const lleno = d.usadoPct >= DISCO_LLENO_PCT;
                                return (
                                    <div key={d.nombre} className="rounded-[6px] bg-white/[0.05] px-2.5 py-2" title={`${d.modelo || ""} · estado «${d.estado}»`}>
                                        <div className="flex items-center gap-1.5 text-[11.5px]">
                                            <HardDrive size={12} className={sano ? "text-white/60" : "text-[var(--mal)]"} />
                                            <span className="font-semibold">{d.nombre}</span>
                                            <span className="text-white/50 tabular-nums">{d.capacidadGB >= 1000 ? `${(d.capacidadGB / 1000).toFixed(1)} TB` : `${d.capacidadGB} GB`}</span>
                                            <span className={cn("ml-auto font-bold", sano ? "text-[var(--bien)]" : "text-[var(--mal)]")}>{sano ? "Sano" : d.estado}</span>
                                        </div>
                                        <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-white/50" style={{ width: `${d.usadoPct}%` }} /></div>
                                        <div className="mt-1 text-[10.5px] text-white/45 tabular-nums">{d.usadoPct} % ocupado{lleno ? " · lleno: graba encima de lo más viejo" : ""}</div>
                                    </div>
                                );
                            })}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

/** Un renglón del menú de analíticas: el color con que se dibuja, qué es y si está. */
function FilaAnalitica({ color, texto, estado }: { color: string; texto: string; estado: string }) {
    return (
        <div className="flex items-center gap-2 px-2 h-7">
            <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: color }} />
            <span className="flex-1 truncate">{texto}</span>
            <span className={cn("text-[10.5px]", estado === "dibujada" ? "text-white/80" : "text-white/45")}>{estado}</span>
        </div>
    );
}

/**
 * La capa de analíticas sobre el cuadro del canal (fracciones 0–1 del cuadro entero). La línea y la
 * zona de la cámara, en sus colores; las reglas de OmniVision en violeta, punteadas si están
 * apagadas, con su nombre al lado.
 */
function CapaAnaliticas({ cam, reglas }: { cam: { linea: Pt[]; zona: Pt[] } | null; reglas: ReglaVision[] }) {
    const rotulos: { x: number; y: number; texto: string; color: string }[] = [];
    reglas.forEach((r) => {
        const p = r.zona && r.zona.length >= 3 ? r.zona[0] : r.linea ? r.linea.a : null;
        if (p) rotulos.push({ x: p[0], y: p[1], texto: r.nombre || TIPOS_REGLA[r.tipo]?.nombre || r.tipo, color: COLOR_OMNIVISION });
    });
    return (
        <div className="absolute inset-0 pointer-events-none">
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                {cam && cam.zona.length >= 3 && <polygon points={cam.zona.map((p) => p.join(",")).join(" ")} fill="rgba(244,63,94,0.16)" stroke={COLOR_ZONA_CAMARA} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
                {cam && cam.linea.length >= 2 && <polyline points={cam.linea.map((p) => p.join(",")).join(" ")} fill="none" stroke={COLOR_LINEA_CAMARA} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
                {reglas.map((r) => (
                    <g key={r.id} opacity={r.activa ? 1 : 0.55}>
                        {r.zona && r.zona.length >= 3 && <polygon points={r.zona.map((p) => p.join(",")).join(" ")} fill="rgba(167,139,250,0.14)" stroke={COLOR_OMNIVISION} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeDasharray={r.activa ? undefined : "5 4"} />}
                        {r.linea && <line x1={r.linea.a[0]} y1={r.linea.a[1]} x2={r.linea.b[0]} y2={r.linea.b[1]} stroke={COLOR_OMNIVISION} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeDasharray={r.activa ? undefined : "5 4"} />}
                    </g>
                ))}
            </svg>
            {rotulos.map((l, i) => (
                <span key={i} className="absolute -translate-y-full max-w-[45%] truncate px-1.5 py-px rounded-[4px] text-[10px] font-bold text-white"
                    style={{ left: `${Math.min(l.x, 0.8) * 100}%`, top: `${Math.max(l.y, 0.06) * 100}%`, background: "rgba(76,29,149,0.85)" }}>{l.texto}</span>
            ))}
        </div>
    );
}
