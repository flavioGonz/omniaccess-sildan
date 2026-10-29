"use client";
/**
 * «LPR en vivo»: la app del celular del supervisor y de la garita.
 *
 * Rehecha el 29/10 a pedido de Nico («debe adaptarse al theme light o dark; debe ser más funcional,
 * mismo estilo de Protect de UniFi»). Tres pestañas, como Protect:
 *  · Cámaras: la grilla en vivo (una o dos columnas), con la última lectura de cada una. Tocar una
 *    abre la cámara con la línea de tiempo y la grabación del NVR (VistaCamara).
 *  · Eventos: todas las lecturas, agrupadas por hora, con filtros por resultado y por cámara; cada
 *    una abre su ficha con la foto y «Ver grabación».
 *  · Buscar: por matrícula o nombre, con las búsquedas recientes.
 * Ajustes (arriba a la derecha): tema claro, oscuro o el del sistema, avisos push y pantalla encendida.
 *
 * Dos cosas que mentían y se corrigieron al pasar:
 *  · Los contadores eran el largo de la lista cargada (las últimas 60 lecturas), no lo del día:
 *    «2 permitidos, 59 denegados» describía la página, no el barrio. Ahora salen de
 *    getEventsCountToday y se dicen «hoy».
 *  · Una lectura sin chapa (NO_LEIDA) figuraba como «DENY». No es un acceso denegado: es que no se
 *    leyó. Ahora es «Sin lectura», salvo que OmniVision la haya releído.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import { useTheme } from "next-themes";
import { Bell, Camera, Car, LogIn, ChevronRight, Clock, Columns2, Download, History, LayoutList, Maximize2, Monitor, Moon, RefreshCw, Rows3, Search, Settings, Sun, SunMedium, Video, WifiOff, X } from "lucide-react";
import LiveEdgeKeeper from "@/components/LiveEdgeKeeper";
import PwaSplash from "@/components/PwaSplash";
import { cn } from "@/lib/utils";
import { getDevices, getEquiposApagados } from "@/app/actions/devices";
import { useFiltroArea, TODAS_LAS_AREAS } from "@/lib/use-filtro-area";
import { SIN_AREA } from "@/lib/filtro-areas";
import { getAccessEvents, getEventsCountToday } from "@/app/actions/history";
import { getSession } from "@/app/actions/auth";
import { fecha, hace, hora, horaSeg } from "@/lib/fechas";
import { Chapa, FilaLectura, FotoEvento, Hoja, RESULTADO, VivoCanal, chapaDe, esAnomala, fotoEvento, resultado, type Resultado } from "@/components/pwa/lpr/piezas";
import { VistaCamara } from "@/components/pwa/lpr/VistaCamara";

/** Cuántas lecturas trae Eventos de una vez («Cargar más» suma otras tantas). */
const PAGINA = 60;
/** Cada cuánto se rehacen los contadores del día (además, cada lectura nueva los suma). */
const CONTADORES_CADA_MS = 60_000;
/** Al volver a la app después de esto en segundo plano, se recarga entera (el vivo se corta). */
const RECARGA_TRAS_MS = 20_000;
const RECIENTES_MAX = 8;

/**
 * Las cámaras que muestra la app: las mismas que el Monitor LPR. Las LPR de acceso y las interiores
 * que miran un acceso, menos las apagadas por su área en Dispositivos. Antes la app pedía sólo
 * LPR_CAMERA y no sabía de áreas: las interiores de acceso no aparecían y las de un área apagada sí.
 */
const esCamaraDeAcceso = (x: any) => x.deviceType === "LPR_CAMERA" || (x.deviceType === "LPR_INTERIOR" && !!x.trackAcceso);

type Pestania = "camaras" | "eventos" | "buscar";
type Filtro = "todos" | Resultado;
type Tema = "light" | "dark" | "sistema";

function urlB64ToUint8(base64: string) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
/** Preferencias de este teléfono. El almacenamiento puede no estar (modo privado): sin él, valores por defecto. */
const leer = (k: string, def: string) => { try { return localStorage.getItem(k) ?? def; } catch { return def; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

/**
 * El tema de la app. next-themes guarda claro u oscuro; «sistema» lo decide el teléfono y se
 * sigue en vivo (el panel tiene enableSystem apagado, por eso se resuelve acá).
 */
function useTemaApp(): [Tema, (t: Tema) => void] {
    const { setTheme } = useTheme();
    const [tema, setTema] = useState<Tema>("sistema");
    useEffect(() => { setTema(leer("pwa-lpr-tema", "sistema") as Tema); }, []);
    useEffect(() => {
        if (tema !== "sistema") { setTheme(tema); return; }
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const aplicar = () => setTheme(mq.matches ? "dark" : "light");
        aplicar(); mq.addEventListener("change", aplicar);
        return () => mq.removeEventListener("change", aplicar);
    }, [tema, setTheme]);
    return [tema, (t) => { guardar("pwa-lpr-tema", t); setTema(t); }];
}

export default function LprPwa() {
    const [camaras, setCamaras] = useState<any[]>([]);
    const [eventos, setEventos] = useState<any[]>([]);
    const [masPaginas, setMasPaginas] = useState(true);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(false);
    // Sin sesión del panel el servidor rechaza todas las consultas (roles y permisos): no es un
    // problema de conexión, y decir «revisá la conexión» mandaba a buscar el error donde no está.
    const [sinSesion, setSinSesion] = useState(false);
    const [hoy, setHoy] = useState<{ total: number; grants: number; denies: number } | null>(null);
    const [pestania, setPestania] = useState<Pestania>("camaras");
    const [columnas, setColumnas] = useState<1 | 2>(1);
    const [filtro, setFiltro] = useState<Filtro>("todos");
    const [camFiltro, setCamFiltro] = useState<string | null>(null);
    const [conectado, setConectado] = useState(false);
    const [enLinea, setEnLinea] = useState(true);
    const [push, setPush] = useState<"idle" | "on" | "denied" | "loading">("idle");
    const [despierta, setDespierta] = useState(false);
    const wake = useRef<any>(null);
    const [ajustes, setAjustes] = useState(false);
    const [abierta, setAbierta] = useState<{ cam: { id: string; name: string }; desde: number | null } | null>(null);
    const [ficha, setFicha] = useState<any | null>(null);
    const [q, setQ] = useState("");
    const [resultados, setResultados] = useState<any[] | null>(null);
    const [buscando, setBuscando] = useState(false);
    const [recientes, setRecientes] = useState<string[]>([]);
    const [tema, setTema] = useTemaApp();
    // El área de Dispositivos, como en el Monitor LPR (se recuerda en este teléfono).
    const fa = useFiltroArea("pwa-lpr");

    useEffect(() => {
        setColumnas(leer("pwa-lpr-columnas", "1") === "2" ? 2 : 1);
        try { setRecientes(JSON.parse(leer("pwa-lpr-recientes", "[]")).slice(0, RECIENTES_MAX)); } catch { /* lista vacía */ }
    }, []);

    const contadores = useCallback(() => { getEventsCountToday("PLATE").then(setHoy).catch(() => {}); }, []);
    const cargar = useCallback(async () => {
        setError(false);
        // getSession es una de las acciones que se pueden llamar sin sesión: pregunta primero, así
        // el teléfono que nunca entró ve «entrá con tu usuario» y no tres consultas rechazadas.
        const sesion = await getSession().catch(() => undefined);
        if (sesion === null) { setSinSesion(true); setCargando(false); return; }
        setSinSesion(false);
        try {
            const [todos, apagados, evs]: any = await Promise.all([
                getDevices(),
                getEquiposApagados().catch(() => [] as string[]),
                getAccessEvents({ take: PAGINA, type: "PLATE", from: new Date(Date.now() - 7 * 86_400_000), omitEnrichment: true }),
            ]);
            const off = new Set<string>(apagados || []);
            setCamaras((todos as any[]).filter((d) => esCamaraDeAcceso(d) && !off.has(d.id)));
            const lista = (evs?.events || []) as any[];
            setEventos(lista); setMasPaginas(lista.length >= PAGINA);
            contadores();
        } catch (e) {
            console.error(e);
            // La sesión dura 24 h: si venció mientras la app estaba abierta, el fallo es ése.
            const s = await getSession().catch(() => undefined);
            if (s === null) setSinSesion(true); else setError(true);
        }
        finally { setCargando(false); }
    }, [contadores]);
    const cargarMas = async () => {
        const r: any = await getAccessEvents({ take: PAGINA, skip: eventos.length, type: "PLATE", omitEnrichment: true }).catch(() => null);
        const lista = (r?.events || []) as any[];
        setEventos((p) => [...p, ...lista.filter((e) => !p.some((x) => x.id === e.id))]);
        setMasPaginas(lista.length >= PAGINA);
    };

    useEffect(() => { cargar(); const iv = setInterval(contadores, CONTADORES_CADA_MS); return () => clearInterval(iv); }, [cargar, contadores]);

    useEffect(() => {
        if ("Notification" in window) { if (Notification.permission === "granted") setPush("on"); else if (Notification.permission === "denied") setPush("denied"); }
        if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then((r) => r.update()).catch(() => {});
        const on = () => setEnLinea(true), off = () => setEnLinea(false);
        window.addEventListener("online", on); window.addEventListener("offline", off); setEnLinea(navigator.onLine);
        let oculta = 0;
        const vis = () => { if (document.visibilityState === "hidden") oculta = Date.now(); else if (oculta && Date.now() - oculta > RECARGA_TRAS_MS) location.reload(); };
        document.addEventListener("visibilitychange", vis);
        return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); document.removeEventListener("visibilitychange", vis); };
    }, []);

    // En vivo: cada lectura nueva entra arriba y suma en los contadores del día.
    useEffect(() => {
        const s = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"] });
        s.on("connect", () => setConectado(true));
        s.on("disconnect", () => setConectado(false));
        s.on("access_event", (ev: any) => {
            const p = String(ev.plateDetected || "").toUpperCase();
            if (p === "DOOR_OPEN" || p === "DOOR_CLOSE" || ev.accessType && ev.accessType !== "PLATE") return;
            setEventos((prev) => (prev.some((x) => x.id === ev.id) ? prev : [ev, ...prev].slice(0, 400)));
            setHoy((h) => (h ? { total: h.total + 1, grants: h.grants + (ev.decision === "GRANT" ? 1 : 0), denies: h.denies + (ev.decision === "DENY" ? 1 : 0) } : h));
        });
        return () => { s.disconnect(); };
    }, []);

    /** La última lectura con chapa de cada cámara (para la grilla). */
    const ultima = useMemo(() => {
        const m: Record<string, any> = {};
        for (const e of eventos) { const id = e.device?.id || e.deviceId; if (id && !m[id] && !esAnomala(e.plateDetected)) m[id] = e; }
        return m;
    }, [eventos]);

    const visibles = useMemo(() => camaras.filter((c) => fa.enArea(c.id)), [camaras, fa]);
    /** Sólo las áreas que tienen alguna de estas cámaras (y «Sin área» si queda alguna afuera). */
    const areasConCamaras = useMemo(() => {
        if (!fa.hayAreas) return [] as { id: string; nombre: string }[];
        const out = fa.areas.filter((a) => camaras.some((c) => fa.enAreaDe(a.id, c.id))).map((a) => ({ id: a.id, nombre: a.nombre }));
        if (camaras.some((c) => fa.enAreaDe(SIN_AREA, c.id))) out.push({ id: SIN_AREA, nombre: "Sin área" });
        return out;
    }, [fa, camaras]);
    const filtrados = useMemo(() => eventos.filter((e) => {
        const id = e.device?.id || e.deviceId;
        return (filtro === "todos" || resultado(e) === filtro) && (!camFiltro || id === camFiltro) && fa.enArea(id);
    }), [eventos, filtro, camFiltro, fa]);

    /** Eventos agrupados por día y hora, como el feed de Protect. */
    const grupos = useMemo(() => {
        const out: { clave: string; titulo: string; items: any[] }[] = [];
        const hoyDia = fecha(new Date());
        for (const e of filtrados) {
            const d = new Date(e.timestamp);
            const dia = fecha(d);
            const clave = `${dia} ${d.getHours()}`;
            const titulo = `${dia === hoyDia ? "Hoy" : dia} · ${String(d.getHours()).padStart(2, "0")}:00`;
            const g = out[out.length - 1];
            if (g && g.clave === clave) g.items.push(e); else out.push({ clave, titulo, items: [e] });
        }
        return out;
    }, [filtrados]);

    const activarPush = async () => {
        if (push === "on") return;
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setPush("denied"); return; }
        setPush("loading");
        try {
            const reg = await navigator.serviceWorker.ready;
            if ((await Notification.requestPermission()) !== "granted") { setPush("denied"); return; }
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "") });
            await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
            setPush("on");
        } catch (e) { console.error(e); setPush("idle"); }
    };
    const alternarDespierta = async () => {
        try {
            if (despierta) { wake.current?.release?.(); wake.current = null; setDespierta(false); }
            else { wake.current = await (navigator as any).wakeLock?.request("screen"); setDespierta(!!wake.current); }
        } catch { setDespierta(false); }
    };
    const pantallaCompleta = () => { const el: any = document.documentElement; if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.().catch(() => {}); };
    const elegirColumnas = (n: 1 | 2) => { setColumnas(n); guardar("pwa-lpr-columnas", String(n)); };

    const buscar = async (termino?: string) => {
        const t = (termino ?? q).trim().toUpperCase(); if (!t) return;
        setQ(t); setBuscando(true);
        const nuevas = [t, ...recientes.filter((x) => x !== t)].slice(0, RECIENTES_MAX);
        setRecientes(nuevas); guardar("pwa-lpr-recientes", JSON.stringify(nuevas));
        try { const r: any = await getAccessEvents({ search: t, type: "PLATE", take: 40, omitEnrichment: true }); setResultados((r?.events || []) as any[]); }
        catch { setResultados([]); } finally { setBuscando(false); }
    };

    const abrirCamaraDe = (e: any, desde: number | null) => {
        const id = e.device?.id || e.deviceId; if (!id) return;
        const cam = camaras.find((c) => c.id === id) || { id, name: e.device?.name || "Cámara" };
        // La ficha se cierra primero: su «history.back()» llega por popstate un instante después, y
        // si la cámara ya estuviera abierta, ese «atrás» la cerraría a ella.
        setFicha(null);
        setTimeout(() => setAbierta({ cam: { id: cam.id, name: cam.name }, desde }), 150);
    };

    const titulo = pestania === "camaras" ? "Cámaras" : pestania === "eventos" ? "Eventos" : "Buscar";

    return (
        <div className="fixed inset-0 flex flex-col bg-background text-foreground overflow-hidden">
            <PwaSplash target="lpr" />
            <LiveEdgeKeeper />
            {sinSesion && (
                // Tapa todo: sin sesión no hay cámaras ni lecturas que mostrar, y un panel vacío con
                // contadores en «—» parecía una falla del servidor.
                <div className="absolute inset-0 z-[80] bg-background flex flex-col items-center justify-center text-center px-8 gap-3">
                    <div className="w-14 h-14 rounded-full bg-muted grid place-items-center"><Camera size={24} className="text-muted-foreground" /></div>
                    <div className="text-[19px] font-bold tracking-[-0.01em]">Entrá con tu usuario</div>
                    <div className="text-[13px] text-muted-foreground max-w-[300px]">LPR en vivo muestra cámaras y lecturas, así que pide el mismo usuario y contraseña del panel. Después de entrar volvés directo acá.</div>
                    <a href={`/login?volver=${encodeURIComponent("/pwa/lpr")}`} className="mt-2 h-11 px-6 rounded-full bg-[var(--accion)] text-white text-[14px] font-semibold inline-flex items-center gap-2"><LogIn size={16} /> Entrar</a>
                </div>
            )}
            {!enLinea && <div className="absolute top-0 inset-x-0 z-[90] pleno-mal text-[11px] font-semibold text-center py-1 flex items-center justify-center gap-1.5"><WifiOff size={12} /> Sin conexión</div>}

            {/* Encabezado */}
            <header className="shrink-0 px-4 pt-[max(0.8rem,env(safe-area-inset-top))] pb-2 flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <span className={cn("w-1.5 h-1.5 rounded-full", conectado ? "pleno-bien" : "pleno-quieto")} />
                        LPR en vivo · {conectado ? "conectado" : "reconectando"}
                    </div>
                    <h1 className="text-[26px] font-bold tracking-[-0.01em] leading-tight">{titulo}</h1>
                </div>
                <button type="button" onClick={() => setAjustes(true)} aria-label="Ajustes" className="relative w-10 h-10 grid place-items-center rounded-full border border-border bg-card active:bg-muted">
                    <Settings size={18} />
                    {push === "on" && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--accion)]" />}
                </button>
            </header>

            {/* ── CÁMARAS ── */}
            {pestania === "camaras" && (
                <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden pb-24 animate-in fade-in duration-200">
                    <div className="px-4 grid grid-cols-3 gap-2">
                        {([["Lecturas hoy", hoy?.total, ""], ["Permitidos", hoy?.grants, "tono-bien"], ["Denegados", hoy?.denies, "tono-mal"]] as const).map(([r, v, t]) => (
                            <button key={r} type="button" onClick={() => { setPestania("eventos"); setFiltro(t === "tono-bien" ? "permitido" : t === "tono-mal" ? "denegado" : "todos"); }}
                                className="text-left rounded-[10px] border border-border bg-card px-3 py-2 active:bg-muted">
                                <div className="text-[11px] text-muted-foreground">{r}</div>
                                <div className={cn("text-[20px] font-bold tabular-nums leading-tight", t)}>{v ?? "—"}</div>
                            </button>
                        ))}
                    </div>
                    {areasConCamaras.length > 1 && (
                        <div className="mt-3 px-4 flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                            {[{ id: TODAS_LAS_AREAS, nombre: "Todas las áreas" }, ...areasConCamaras].map((a) => (
                                <button key={a.id} type="button" onClick={() => fa.setArea(a.id)} aria-pressed={fa.area === a.id}
                                    className={cn("shrink-0 h-8 px-3 rounded-full border text-[12.5px] font-semibold", fa.area === a.id ? "bg-foreground text-background border-transparent" : "border-border bg-card text-muted-foreground")}>{a.nombre}</button>
                            ))}
                        </div>
                    )}
                    <div className="px-4 mt-4 mb-2 flex items-center justify-between">
                        <span className="text-[13px] font-semibold">{visibles.length} {visibles.length === 1 ? "cámara" : "cámaras"}{fa.nombre ? ` · ${fa.nombre}` : ""}</span>
                        <div className="flex items-center rounded-full border border-border bg-card p-0.5">
                            <button type="button" aria-label="Una columna" onClick={() => elegirColumnas(1)} className={cn("w-8 h-7 grid place-items-center rounded-full", columnas === 1 ? "bg-muted text-foreground" : "text-muted-foreground")}><Rows3 size={15} /></button>
                            <button type="button" aria-label="Dos columnas" onClick={() => elegirColumnas(2)} className={cn("w-8 h-7 grid place-items-center rounded-full", columnas === 2 ? "bg-muted text-foreground" : "text-muted-foreground")}><Columns2 size={15} /></button>
                        </div>
                    </div>
                    {cargando ? (
                        <div className="px-4 grid gap-3">{[0, 1].map((i) => <div key={i} className="aspect-video rounded-[10px] bg-muted animate-pulse" />)}</div>
                    ) : error ? (
                        <div className="mx-4 rounded-[10px] border border-border bg-card p-6 text-center">
                            <div className="text-[14px] font-semibold">No se pudieron traer las cámaras</div>
                            <div className="text-[12.5px] text-muted-foreground mt-1">Revisá la conexión con el servidor.</div>
                            <button type="button" onClick={cargar} className="mt-3 h-9 px-4 rounded-full bg-[var(--accion)] text-white text-[13px] font-semibold inline-flex items-center gap-1.5"><RefreshCw size={14} /> Reintentar</button>
                        </div>
                    ) : visibles.length === 0 ? (
                        <div className="py-16 flex flex-col items-center gap-2 text-muted-foreground text-center px-6"><Camera size={26} />
                            <span className="text-[13px]">{camaras.length ? "No hay cámaras LPR en esta área." : "No hay cámaras LPR encendidas. Revisá en Dispositivos que su área no esté apagada."}</span>
                            {camaras.length > 0 && <button type="button" onClick={() => fa.setArea(TODAS_LAS_AREAS)} className="tono-accion text-[13px] font-semibold">Ver todas las áreas</button>}
                        </div>
                    ) : (
                        <div className={cn("px-3 grid gap-3", columnas === 2 ? "grid-cols-2" : "grid-cols-1")}>
                            {visibles.map((c) => {
                                const lp = ultima[c.id];
                                const r = lp ? RESULTADO[resultado(lp)] : null;
                                return (
                                    <button key={c.id} type="button" onClick={() => setAbierta({ cam: { id: c.id, name: c.name }, desde: null })}
                                        className="text-left rounded-[10px] overflow-hidden border border-border bg-card active:opacity-90">
                                        <div className="relative aspect-video bg-black">
                                            <VivoCanal deviceId={c.id} className="absolute inset-0 w-full h-full" />
                                            <span className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-black/60 text-white text-[9.5px] font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-[var(--mal)] animate-pulse" />VIVO</span>
                                            {lp && columnas === 1 && (
                                                <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 px-2 py-1 rounded-[6px] bg-black/65 text-white">
                                                    <span className={cn("w-2 h-2 rounded-full", r!.punto)} />
                                                    <span className="text-[13px] font-bold tracking-[0.12em] tabular-nums">{chapaDe(lp)}</span>
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 px-2.5 py-2">
                                            <div className="min-w-0 flex-1">
                                                <div className={cn("font-semibold truncate", columnas === 2 ? "text-[12.5px]" : "text-[14px]")}>{c.name}</div>
                                                <div className="text-[11px] text-muted-foreground truncate">
                                                    {lp ? <>{columnas === 2 && <span className="font-semibold text-foreground tracking-wider">{chapaDe(lp)} · </span>}{r!.rotulo.toLowerCase()} {hace(lp.timestamp)}</> : "Sin lecturas recientes"}
                                                </div>
                                            </div>
                                            {columnas === 1 && <ChevronRight size={16} className="text-muted-foreground shrink-0" />}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ── EVENTOS ── */}
            {pestania === "eventos" && (
                <div className="flex-1 min-h-0 flex flex-col animate-in fade-in duration-200">
                    <div className="shrink-0 space-y-2 pb-2">
                        <div className="px-4 flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                            {([["todos", "Todos"], ["permitido", "Permitidos"], ["denegado", "Denegados"], ["noleida", "Sin lectura"]] as [Filtro, string][]).map(([k, r]) => (
                                <button key={k} type="button" onClick={() => setFiltro(k)} aria-pressed={filtro === k}
                                    className={cn("shrink-0 h-8 px-3 rounded-full border text-[12.5px] font-semibold", filtro === k ? "bg-foreground text-background border-transparent" : "border-border bg-card text-muted-foreground")}>{r}</button>
                            ))}
                        </div>
                        {visibles.length > 1 && (
                            <div className="px-4 flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                                <button type="button" onClick={() => setCamFiltro(null)} className={cn("shrink-0 h-7 px-2.5 rounded-full border text-[11.5px]", !camFiltro ? "border-[var(--accion)] tono-accion font-semibold" : "border-border text-muted-foreground")}>{fa.nombre ? `Todas · ${fa.nombre}` : "Todas las cámaras"}</button>
                                {visibles.map((c) => (
                                    <button key={c.id} type="button" onClick={() => setCamFiltro(c.id)} className={cn("shrink-0 h-7 px-2.5 rounded-full border text-[11.5px]", camFiltro === c.id ? "border-[var(--accion)] tono-accion font-semibold" : "border-border text-muted-foreground")}>{c.name}</button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden px-3 pb-24">
                        {cargando ? <div className="space-y-1.5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[66px] rounded-[10px] bg-muted animate-pulse" />)}</div>
                            : error ? <div className="text-center py-16 text-[13px] text-muted-foreground">No se pudieron traer las lecturas. <button type="button" onClick={cargar} className="tono-accion font-semibold">Reintentar</button></div>
                                : grupos.length === 0 ? <div className="py-16 flex flex-col items-center gap-2 text-muted-foreground"><Car size={26} /><span className="text-[13px]">Sin lecturas con este filtro.</span></div>
                                    : grupos.map((g) => (
                                        <section key={g.clave} className="mb-3">
                                            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-1.5 px-1 text-[11.5px] font-semibold text-muted-foreground flex items-center gap-1.5"><Clock size={12} />{g.titulo}<span className="ml-auto tabular-nums">{g.items.length}</span></div>
                                            <div className="space-y-1.5">{g.items.map((e) => <FilaLectura key={e.id} e={e} hora={horaSeg(new Date(e.timestamp))} alTocar={() => setFicha(e)} />)}</div>
                                        </section>
                                    ))}
                        {!cargando && !error && masPaginas && filtrados.length > 0 && (
                            <button type="button" onClick={cargarMas} className="w-full h-10 mt-1 rounded-full border border-border bg-card text-[13px] font-semibold active:bg-muted">Cargar más</button>
                        )}
                    </div>
                </div>
            )}

            {/* ── BUSCAR ── */}
            {pestania === "buscar" && (
                <div className="flex-1 min-h-0 flex flex-col animate-in fade-in duration-200">
                    <form onSubmit={(e) => { e.preventDefault(); buscar(); }} className="shrink-0 px-4 pb-3 flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                            <input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder="Matrícula o nombre" enterKeyHint="search"
                                className="w-full h-11 rounded-full border border-border bg-card pl-9 pr-9 text-[15px] tracking-wider outline-none focus:border-[var(--accion)]" />
                            {q && <button type="button" aria-label="Borrar" onClick={() => { setQ(""); setResultados(null); }} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full text-muted-foreground"><X size={15} /></button>}
                        </div>
                        <button type="submit" disabled={buscando || !q.trim()} className="h-11 px-4 rounded-full bg-[var(--accion)] text-white text-[14px] font-semibold disabled:opacity-50 flex items-center gap-1.5">
                            {buscando ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}Buscar
                        </button>
                    </form>
                    <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden px-3 pb-24">
                        {resultados == null ? (
                            recientes.length > 0 ? (
                                <div>
                                    <div className="px-1 pb-1.5 text-[11.5px] font-semibold text-muted-foreground flex items-center gap-1.5"><History size={12} /> Búsquedas recientes</div>
                                    <div className="rounded-[10px] border border-border bg-card divide-y divide-border">
                                        {recientes.map((r) => (
                                            <button key={r} type="button" onClick={() => buscar(r)} className="w-full flex items-center justify-between px-3 h-11 text-left active:bg-muted">
                                                <span className="text-[14px] font-semibold tracking-wider">{r}</span><ChevronRight size={15} className="text-muted-foreground" />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : <div className="text-center text-[13px] text-muted-foreground py-16">Escribí una matrícula o un nombre para ver todas sus pasadas.</div>
                        ) : resultados.length === 0 ? (
                            <div className="text-center text-[13px] text-muted-foreground py-16">{buscando ? "Buscando…" : `No hay pasadas de «${q}».`}</div>
                        ) : (
                            <div className="space-y-1.5">
                                <div className="px-1 pb-0.5 text-[11.5px] text-muted-foreground">{resultados.length} pasadas{resultados.length >= 40 ? " (las últimas 40)" : ""}</div>
                                {resultados.map((e) => <FilaLectura key={e.id} e={e} hora={`${fecha(new Date(e.timestamp))} ${hora(new Date(e.timestamp))}`} alTocar={() => setFicha(e)} />)}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Barra de abajo */}
            <nav className="absolute bottom-0 inset-x-0 z-30 border-t border-border bg-background/90 backdrop-blur-xl pb-[max(0.4rem,env(safe-area-inset-bottom))]">
                <div className="grid grid-cols-3">
                    {([["camaras", "Cámaras", Video], ["eventos", "Eventos", LayoutList], ["buscar", "Buscar", Search]] as const).map(([k, r, Ico]) => (
                        <button key={k} type="button" onClick={() => setPestania(k)} aria-current={pestania === k ? "page" : undefined}
                            className={cn("h-14 flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold", pestania === k ? "tono-accion" : "text-muted-foreground")}>
                            <Ico size={20} strokeWidth={pestania === k ? 2.3 : 1.8} />{r}
                        </button>
                    ))}
                </div>
            </nav>

            {/* La cámara abierta */}
            <VistaCamara camara={abierta?.cam || null} desde={abierta?.desde ?? null} abierta={!!abierta} alCerrar={() => setAbierta(null)} />

            {/* La ficha de una lectura */}
            <Hoja abierta={!!ficha} alCerrar={() => setFicha(null)} alto="media">
                {ficha && (() => {
                    const r = RESULTADO[resultado(ficha)];
                    const t = new Date(ficha.timestamp);
                    const foto = fotoEvento(ficha.snapshotPath);
                    const filas: [string, React.ReactNode][] = [
                        ["Resultado", <span key="r" className={cn("text-[11.5px] font-semibold px-2 py-0.5 rounded-full border", r.chip)}>{r.rotulo}</span>],
                        ["Persona", ficha.user?.name ? `${ficha.user.name}${ficha.user.unit?.name ? ` · ${ficha.user.unit.name}` : ""}` : "Sin registrar"],
                        ["Cámara", ficha.device?.name || "—"],
                        ["Sentido", ficha.direction === "EXIT" ? "Salida" : ficha.direction === "ENTRY" ? "Entrada" : "—"],
                        ["Hora", `${fecha(t)} · ${horaSeg(t)}`],
                    ];
                    if (esAnomala(ficha.plateDetected) && ficha.relectura?.plate) filas.splice(1, 0, ["Leída por", "OmniVision (la cámara no la leyó)"]);
                    return (
                        <>
                            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                                <Chapa p={chapaDe(ficha)} grande />
                                <button type="button" aria-label="Cerrar" onClick={() => setFicha(null)} className="w-9 h-9 grid place-items-center rounded-full border border-border"><X size={16} /></button>
                            </div>
                            <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                                <FotoEvento src={foto} className="w-full aspect-video rounded-[10px]" />
                                <dl className="mt-3 rounded-[10px] border border-border bg-card divide-y divide-border">
                                    {filas.map(([k, v]) => (
                                        <div key={k} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                            <dt className="text-[12.5px] text-muted-foreground">{k}</dt><dd className="text-[13px] font-semibold text-right">{v}</dd>
                                        </div>
                                    ))}
                                </dl>
                                <div className="grid grid-cols-2 gap-2 mt-3">
                                    <button type="button" onClick={() => abrirCamaraDe(ficha, +t - 4000)} className="h-11 rounded-full bg-[var(--accion)] text-white text-[13.5px] font-semibold flex items-center justify-center gap-1.5"><Video size={16} /> Ver grabación</button>
                                    {foto ? <a href={foto} download className="h-11 rounded-full border border-border text-[13.5px] font-semibold flex items-center justify-center gap-1.5"><Download size={16} /> Guardar foto</a>
                                        : <span className="h-11 rounded-full border border-border text-[13px] text-muted-foreground flex items-center justify-center">Sin foto</span>}
                                </div>
                            </div>
                        </>
                    );
                })()}
            </Hoja>

            {/* Ajustes */}
            <Hoja abierta={ajustes} alCerrar={() => setAjustes(false)} alto="media">
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <span className="text-[17px] font-bold">Ajustes</span>
                    <button type="button" aria-label="Cerrar" onClick={() => setAjustes(false)} className="w-9 h-9 grid place-items-center rounded-full border border-border"><X size={16} /></button>
                </div>
                <div className="overflow-y-auto px-4 pb-[max(1.2rem,env(safe-area-inset-bottom))] space-y-4">
                    <div>
                        <div className="text-[11.5px] font-semibold text-muted-foreground mb-1.5">Tema</div>
                        <div className="grid grid-cols-3 gap-1 rounded-[10px] border border-border bg-card p-1">
                            {([["light", "Claro", SunMedium], ["dark", "Oscuro", Moon], ["sistema", "Sistema", Monitor]] as const).map(([k, r, Ico]) => (
                                <button key={k} type="button" onClick={() => setTema(k)} aria-pressed={tema === k}
                                    className={cn("h-10 rounded-[7px] text-[12.5px] font-semibold flex items-center justify-center gap-1.5", tema === k ? "bg-muted text-foreground" : "text-muted-foreground")}>
                                    <Ico size={15} />{r}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="rounded-[10px] border border-border bg-card divide-y divide-border">
                        <Interruptor icono={Bell} titulo="Notificaciones push" detalle={push === "denied" ? "Bloqueadas en el navegador: habilitalas en los ajustes del teléfono." : "Las alertas de las reglas, aunque la app esté cerrada."} prendido={push === "on"} cargando={push === "loading"} alCambiar={activarPush} />
                        <Interruptor icono={Sun} titulo="Pantalla siempre encendida" detalle="Para dejar el teléfono fijo en la garita." prendido={despierta} alCambiar={alternarDespierta} />
                        <button type="button" onClick={pantallaCompleta} className="w-full flex items-center gap-3 px-3 h-12 text-left active:bg-muted"><Maximize2 size={17} className="text-muted-foreground" /><span className="flex-1 text-[13.5px] font-semibold">Pantalla completa</span></button>
                        <button type="button" onClick={() => { setAjustes(false); cargar(); }} className="w-full flex items-center gap-3 px-3 h-12 text-left active:bg-muted"><RefreshCw size={17} className="text-muted-foreground" /><span className="flex-1 text-[13.5px] font-semibold">Actualizar</span></button>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground px-1">
                        {conectado ? "Conectado al servidor: las lecturas llegan en vivo." : "Reconectando con el servidor…"} El tema, las columnas y las búsquedas recientes se guardan en este teléfono.
                    </p>
                </div>
            </Hoja>
        </div>
    );
}

function Interruptor({ icono: Ico, titulo, detalle, prendido, cargando, alCambiar }: {
    icono: any; titulo: string; detalle: string; prendido: boolean; cargando?: boolean; alCambiar: () => void;
}) {
    return (
        <button type="button" role="switch" aria-checked={prendido} onClick={alCambiar} disabled={cargando} className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-muted">
            <Ico size={17} className={prendido ? "tono-accion" : "text-muted-foreground"} />
            <span className="flex-1 min-w-0"><span className="block text-[13.5px] font-semibold">{titulo}</span><span className="block text-[11.5px] text-muted-foreground">{detalle}</span></span>
            <span className={cn("relative w-10 h-6 rounded-full transition-colors shrink-0", prendido ? "bg-[var(--accion)]" : "bg-muted border border-border")}>
                <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform", prendido && "translate-x-4")} />
            </span>
        </button>
    );
}
