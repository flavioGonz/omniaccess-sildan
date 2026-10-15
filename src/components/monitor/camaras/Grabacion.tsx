"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Rewind, FastForward, Download, Radio, Loader2, CalendarDays, Clock, Car, User, PawPrint, Sparkles, Boxes } from "lucide-react";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import { geomDeIntrusion } from "@/lib/vision-capa";
import { Scrub, type MarcaScrub, type BandaScrub, type ScrubMando } from "@/components/Scrub";
import { nombrePropio, useNombresPropios } from "@/lib/nombres-propios";
import { metaDe } from "@/components/intrusion/comun";
import { DescargaClip, type VentanaClip } from "@/components/video/DescargaClip";
import { ZONA } from "@/lib/fechas";
import { Vivo, vivoDe, fotoDe, type Canal } from "./piezas";
import { cn } from "@/lib/utils";

/**
 * La grabación del canal, en el mismo cuadro donde se estaba viendo el vivo: sin ventana nueva.
 *
 * Por qué así (pedido 15/10): «Ver grabación» abría el visor de otra pantalla (LiveModal) encima
 * de la pared, con su marco y sus pestañas. Ahora el video del cuadro pasa a ser el de la
 * grabación y la regla se dibuja encima, abajo; el vivo queda chico en una esquina y un toque
 * vuelve a él.
 *
 * La regla es la misma rueda del visor (Scrub: la hora grande con sus dígitos, el cursor rojo,
 * se arrastra con inercia). Nico lo pidió así el 15/10 —«no estás usando la barra que
 * tenemos»— y con los controles ARRIBA de la regla, que queda al pie. Lo que se le sumó:
 *  · La franja de dónde HAY grabación (los tramos que informa el NVR), dibujada sobre los
 *    ticks: un hueco se ve antes de llegar. Antes se descubría esperando 9 s.
 *  · Las detecciones y las lecturas de la cámara como marcas (tono por resultado), y flechas
 *    para saltar a la anterior o a la siguiente: revisar una noche es ir de marca en marca.
 *  · Día y hora se eligen con sus campos; ±30 s con botones o ±10 s con ← →; , y . saltan de marca.
 *
 * El video: si el navegador reproduce H.265 se le pide la grabación tal cual (`hevc=1`) y el
 * servidor sólo la reempaqueta; si no arranca, se pide sin eso (el servidor la convierte). En
 * Safari se pide el clip entero (`whole=1`): el MP4 que se arma mientras llega no lo reproduce.
 */

/** Cuánto se pide al NVR de una vez; al terminar se sigue sola desde donde quedó. */
const TRAMO_SEG = 180;
/** En Safari el clip se arma entero antes de mandarlo: más corto, para que arranque antes. */
const TRAMO_SAFARI_SEG = 40;
/** Al saltar a una marca, cuánto antes de ella empieza el video: se ve llegar al que la causó. */
const ANTES_DE_MARCA_MS = 5000;
/** Sin cuadros en este tiempo, el tramo no vino: se reintenta convertido o se dice que no hay. */
const ESPERA_MS = 10_000;
/** El arrastre no pide nada al NVR hasta que la regla se queda quieta este tiempo. */
const ASENTAR_MS = 350;
const SALTO_MS = 30_000;
/** Cada cuánto se mira el cuadro de la grabación (si cambió) y a qué ancho se manda. */
const SILUETAS_CADA_MS = 400;
const SILUETAS_ANCHO = 640;
/**
 * La escala de la regla en la grabación, en px por minuto (la del visor es 2). Arrastrar en
 * cualquier parte del cuadro ES arrastrar la regla (pedido 15/10: «cuando arrastro la pantalla,
 * debe moverse también la barra de tiempo»): misma escala, mismo sentido, misma inercia. Antes el
 * cuadro tenía su propia escala (2 min por pantalla) y la regla se corría 4 px: parecía suelta.
 * A 6 px/min, 100 px son ~17 min y el paso de 15 s queda en 1,5 px; lo fino, con ← → y ±30 s.
 */
const PX_POR_MINUTO = 6;
/** El paso al soltar la regla: 15 s. Al minuto, un arrastre corto no se movía. */
const PASO_REGLA = "0.25";
/**
 * Cuánto se pinta cada evento en la regla cuando no trae su fin (la cámara y el lector dicen
 * un instante). Y eventos de la misma clase a menos de JUNTAR_MS se pintan como un solo tramo.
 */
const DURA_MS: Record<string, number> = { deteccion: 20_000, lectura: 10_000, vision: 5_000 };
const JUNTAR_MS = 30_000;
/** Lo que dura el desenfoque al saltar (botones, teclas, marcas, soltar el arrastre). */
const DESENFOQUE_MS = 480;
/** Desenfoque y corrimiento máximos, en px: lo justo para que se lea «movimiento», no «roto». */
const DESENFOQUE_MAX = 22;
const CORRIMIENTO_MAX = 64;
const VENTANA_POR_DEFECTO: VentanaClip = { antes: 10, despues: 10, topes: { antesMax: 60, despuesMax: 170, despuesMin: 3 } };

/** clase: quién lo detectó — la cámara (deteccion), el lector de chapas (lectura) u OmniVision (vision; tipo = grupo). */
type Evento = { id: string; ts: number; fin?: number; clase: "deteccion" | "lectura" | "vision"; tipo: string; nombre?: string | null; plate: string | null; ok: boolean | null };
/** OmniVision, por grupo: ícono y nombre. Van en azul (tono info) para distinguirlos de lo que avisó la cámara. */
const VISION_GRUPO: Record<string, { Icon: any; nombre: string }> = { persona: { Icon: User, nombre: "Persona" }, vehiculo: { Icon: Car, nombre: "Vehículo" }, animal: { Icon: PawPrint, nombre: "Animal" }, propio: { Icon: Boxes, nombre: "Objeto propio" } };
/** El color de cada clase en la regla (marca y tramo). El rojo es «sin grabación»: la cámara va en ámbar. */
const tonoDe = (e: Evento) => (e.clase === "vision" ? (e.tipo === "propio" ? "propio" : "info") : e.clase === "deteccion" ? "aviso" : "lectura");
type Linea = { dia: string; desde: number; hasta: number; tramos: [number, number][] | null; eventos: Evento[] };

const partes = (ms: number) => {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(ms));
    const g = (t: string) => f.find((x) => x.type === t)?.value || "00";
    return { dia: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}:${g("second")}` };
};
/** «YYYY-MM-DD» + «HH:MM[:SS]» de la hora del barrio → ms. */
function msDe(dia: string, hora: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia), h = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hora);
    if (!m || !h) return null;
    const comoUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +h[1], +h[2], +(h[3] || 0));
    const p = partes(comoUtc);
    const [y, mo, d] = p.dia.split("-").map(Number), [hh, mi, ss] = p.hora.split(":").map(Number);
    return comoUtc - (Date.UTC(y, mo - 1, d, hh, mi, ss) - comoUtc);
}
const horaCorta = (ms: number) => partes(ms).hora.slice(0, 5);

function Boton({ children, onClick, titulo, disabled, grande, activo }: { children: React.ReactNode; onClick: () => void; titulo: string; disabled?: boolean; grande?: boolean; activo?: boolean }) {
    return (
        <button type="button" onClick={onClick} title={titulo} aria-label={titulo} disabled={disabled}
            className={cn("rounded-full grid place-items-center transition-colors disabled:opacity-30 disabled:pointer-events-none",
                grande ? "w-12 h-12" : "w-10 h-10",
                activo ? "bg-white text-black" : grande ? "bg-white/15 text-white hover:bg-white/25" : "text-white/85 hover:text-white hover:bg-white/15")}>
            {children}
        </button>
    );
}

export function Grabacion({ c, h265, hls, desdeMs, visibles, alVivo, deviceIdEnvio }: {
    c: Canal; h265: boolean; hls: boolean;
    /** Dónde arranca (el instante de la alerta, o un minuto atrás). */
    desdeMs: number;
    /** Los controles del cuadro están a la vista (el mouse se movió hace poco). */
    visibles: boolean;
    alVivo: () => void;
    /** Con cámara (y sesión) el cajón de exportar ofrece WhatsApp; sin ella, sólo bajar. */
    deviceIdEnvio?: string;
}) {
    const [t, setT] = useState(desdeMs);                 // el instante pedido
    const [cargaT, setCargaT] = useState(desdeMs);       // el que se le pidió al NVR (asentado)
    const [posMs, setPosMs] = useState<number | null>(null);
    const [jugando, setJugando] = useState(false);
    const [estado, setEstado] = useState<"buscando" | "viendo" | "sin">("buscando");
    const [convertir, setConvertir] = useState(!h265);
    const [intento, setIntento] = useState(0);
    const pausado = useRef(false);
    const video = useRef<HTMLVideoElement>(null);
    // Siluetas sobre la grabación: el navegador manda el cuadro que muestra (ver POST de
    // /api/monitor/camaras/siluetas). Prendidas por defecto; se apagan con el ícono de abajo.
    const [verSiluetas, setVerSiluetas] = useState(true);
    const [siluetas, setSiluetas] = useState<{ analisis: any; ms: number } | null>(null);
    const [linea, setLinea] = useState<Linea | null>(null);
    const [descarga, setDescarga] = useState(false);
    const [ventana, setVentana] = useState<VentanaClip>(VENTANA_POR_DEFECTO);
    useEffect(() => { fetch("/api/playback/ventana", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && typeof d.antes === "number") setVentana(d); }).catch(() => { }); }, []);

    const ahora = posMs ?? t;
    const dia = partes(ahora).dia;

    // La regla del día que se mira: tramos con grabación y marcas.
    useEffect(() => {
        if (!c.nvrId || c.ch == null) return;
        let vivo = true;
        const q = new URLSearchParams({ nvr: c.nvrId, ch: String(c.ch), dia, ...(c.equipoId ? { equipo: c.equipoId } : {}) }); // sin equipo, la ruta busca lo de OmniVision como nvrch-<nvr>-<ch>
        fetch(`/api/monitor/camaras/linea?${q}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (vivo && d) setLinea(d); }).catch(() => { });
        return () => { vivo = false; };
    }, [c.nvrId, c.ch, c.equipoId, dia]);

    // ¿Hay grabación en ese instante? null = no se sabe (NVR que no informa tramos).
    const hayEn = useCallback((ms: number) => {
        if (!linea?.tramos || ms < linea.desde || ms > linea.hasta) return null;
        return linea.tramos.some(([a, b]) => ms >= a - 2000 && ms <= b);
    }, [linea]);
    const proximoTramo = useMemo(() => linea?.tramos?.find(([a]) => a > t)?.[0] ?? null, [linea, t]);

    /**
     * El último cuadro, congelado, mientras el NVR abre el tramo nuevo. Por qué (15/10, Nico: «el
     * desenfoque está bien pero en un momento mete una pantalla negra y rompe la idea de
     * movimiento»): cada salto cambia la dirección del video y el <video> se vuelve a montar; hasta
     * el primer cuadro del tramo nuevo (1–2 s de NVR) quedaba negro. Ahora se copia el cuadro que
     * se estaba viendo y queda debajo, desenfocado, hasta que el nuevo arranca y lo cubre.
     * Al abrir la grabación no hay cuadro anterior: va la foto de la cámara, bien desenfocada.
     */
    const [congelado, setCongelado] = useState<string | null>(() => fotoDe(c, 960));
    const [nuevoListo, setNuevoListo] = useState(false);
    const congelar = useCallback(() => {
        const v = video.current;
        if (!v || v.readyState < 2 || !v.videoWidth) return;
        try {
            const ancho = Math.min(1280, v.videoWidth), alto = Math.round((ancho * v.videoHeight) / v.videoWidth);
            const lienzo = document.createElement("canvas"); lienzo.width = ancho; lienzo.height = alto;
            lienzo.getContext("2d")?.drawImage(v, 0, 0, ancho, alto);
            setCongelado(lienzo.toDataURL("image/jpeg", 0.82));
        } catch { /* sin cuadro: queda el anterior */ }
    }, []);
    const ir = useCallback((ms: number) => {
        const v = Math.min(Date.now() - 5000, ms);
        congelar();
        pausado.current = false; setPosMs(null); setT(v);
    }, [congelar]);
    // ── El movimiento: desenfoque horizontal hacia donde se va ───────────────────────────
    // Un SVG feGaussianBlur con desvío sólo en X es un desenfoque de movimiento de verdad (el
    // blur() de CSS es redondo). El corrimiento dice el sentido: adelante, el cuadro llega desde
    // la derecha; atrás, desde la izquierda.
    const uid = useId().replace(/:/g, "");
    const [efecto, setEfecto] = useState<{ blur: number; x: number }>({ blur: 0, x: 0 });
    const pulsoRaf = useRef(0);
    const pulso = useCallback((dir: number) => {
        cancelAnimationFrame(pulsoRaf.current);
        const t0 = performance.now();
        const paso = (t: number) => {
            const k = Math.min(1, (t - t0) / DESENFOQUE_MS), e = 1 - Math.pow(1 - k, 3);
            setEfecto({ blur: DESENFOQUE_MAX * (1 - e), x: dir * CORRIMIENTO_MAX * (1 - e) });
            if (k < 1) pulsoRaf.current = requestAnimationFrame(paso);
        };
        pulsoRaf.current = requestAnimationFrame(paso);
    }, []);
    useEffect(() => () => cancelAnimationFrame(pulsoRaf.current), []);
    /** Ir a un instante con el efecto de movimiento en el sentido del salto. */
    const saltar = useCallback((ms: number, desde: number) => { pulso(ms >= desde ? 1 : -1); ir(ms); }, [ir, pulso]);

    // El arrastre y los saltos seguidos no le piden al NVR cada paso: sólo donde se queda.
    useEffect(() => { setEstado("buscando"); const k = setTimeout(() => { setCargaT(t); setIntento(0); setConvertir(!h265); }, ASENTAR_MS); return () => clearTimeout(k); }, [t, h265]);

    /** El arrastre sobre el cuadro: de dónde salió, cuánto se movió y a qué velocidad va. Lo mueve la regla (`mando`). */
    const [tirando, setTirando] = useState<{ x0: number; t0: number; dx: number; vx: number; xa: number; ta: number } | null>(null);
    const mando = useRef<ScrubMando | null>(null);
    /** Dónde está la regla mientras se arrastra (ms), para el cartel del centro. */
    const [enRegla, setEnRegla] = useState<number | null>(null);

    const sinGrabacionAhi = hayEn(cargaT) === false;
    // Un tramo nuevo empieza invisible: el cuadro congelado queda arriba hasta su primer cuadro.
    useEffect(() => { setNuevoListo(false); }, [cargaT, intento]);
    const url = c.nvrId && c.ch != null && !sinGrabacionAhi
        ? `/api/nvr/playback?ch=${c.ch}&nvr=${encodeURIComponent(c.nvrId)}&t=${Math.floor(cargaT)}&pre=0` + (hls ? `&whole=1&dur=${TRAMO_SAFARI_SEG}` : `&dur=${TRAMO_SEG}${convertir ? "" : "&hevc=1"}`)
        : null;
    useEffect(() => { if (sinGrabacionAhi) setEstado("sin"); }, [sinGrabacionAhi]);

    // Si a ESPERA_MS no llegó nada: primero se prueba convertido, después se dice que no hay.
    useEffect(() => {
        if (!url) return;
        setEstado("buscando"); setJugando(false);
        const k = setTimeout(() => {
            const v = video.current;
            if (v && v.readyState >= 2) return;
            if (!convertir && !hls) { setConvertir(true); setIntento((i) => i + 1); } else setEstado("sin");
        }, ESPERA_MS);
        return () => clearTimeout(k);
    }, [url, intento]); // eslint-disable-line react-hooks/exhaustive-deps

    /**
     * El bucle de las siluetas: cada SILUETAS_CADA_MS, si el cuadro en pantalla cambió desde el
     * último mirado (o recién se pausó), lo saca del <video> a 640 px y lo manda. Uno por vez: si
     * el anterior no volvió, se espera. Un 429 (tope entre todas las pantallas) espera un segundo.
     * En pausa se mira una sola vez: el cuadro no cambia.
     */
    useEffect(() => {
        if (!verSiluetas) { setSiluetas(null); return; }
        let vivo = true, enVuelo = false, ultimo = -1, esperarHasta = 0;
        const lienzo = document.createElement("canvas");
        const vuelta = async () => {
            const v = video.current;
            if (!vivo || enVuelo || !v || v.readyState < 2 || !v.videoWidth || Date.now() < esperarHasta) return;
            if (Math.abs(v.currentTime - ultimo) < 0.05) return;
            ultimo = v.currentTime;
            const ancho = Math.min(SILUETAS_ANCHO, v.videoWidth), alto = Math.round((ancho * v.videoHeight) / v.videoWidth);
            lienzo.width = ancho; lienzo.height = alto;
            const g = lienzo.getContext("2d"); if (!g) return;
            g.drawImage(v, 0, 0, ancho, alto);
            const blob: Blob | null = await new Promise((r) => lienzo.toBlob(r, "image/jpeg", 0.78));
            if (!blob || !vivo) return;
            enVuelo = true;
            try {
                const r = await fetch("/api/monitor/camaras/siluetas", { method: "POST", body: blob, headers: { "content-type": "image/jpeg" } });
                if (r.status === 429) { esperarHasta = Date.now() + 1000; return; }
                const j = await r.json().catch(() => null);
                // Las coordenadas vienen en 0–1: se dibujan con el tamaño real del video.
                if (vivo && r.ok && j?.analisis) setSiluetas({ analisis: { ...j.analisis, ancho: v.videoWidth, alto: v.videoHeight }, ms: j.ms });
            } catch { /* la próxima vuelta */ } finally { enVuelo = false; }
        };
        const iv = setInterval(vuelta, SILUETAS_CADA_MS);
        return () => { vivo = false; clearInterval(iv); };
    }, [verSiluetas]);
    // Un salto deja las siluetas del cuadro anterior: se borran hasta que llegue el nuevo análisis.
    useEffect(() => { setSiluetas(null); }, [cargaT]);

    const alternarPlay = useCallback(() => {
        const v = video.current; if (!v) return;
        if (v.paused) { pausado.current = false; v.play().catch(() => { }); } else { pausado.current = true; v.pause(); }
    }, []);

    // Marcas: anterior y siguiente respecto de donde está el video.
    const eventos = linea?.eventos || [];
    const siguiente = eventos.find((e) => e.ts - ANTES_DE_MARCA_MS > ahora + 1500) || null;
    const anterior = [...eventos].reverse().find((e) => e.ts - ANTES_DE_MARCA_MS < ahora - 3000) || null;
    const irAMarca = (e: Evento | null) => { if (e) saltar(e.ts - ANTES_DE_MARCA_MS, ahora); };

    useEffect(() => {
        const k = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
            if (e.key === " ") { e.preventDefault(); alternarPlay(); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); saltar(ahora - 10_000, ahora); }
            else if (e.key === "ArrowRight") { e.preventDefault(); saltar(ahora + 10_000, ahora); }
            else if (e.key === ",") irAMarca(anterior);
            else if (e.key === ".") irAMarca(siguiente);
        };
        window.addEventListener("keydown", k);
        return () => window.removeEventListener("keydown", k);
    });

    // ── La regla: la misma rueda del visor (Scrub), con los tramos y las marcas de este día ──
    const cajaRegla = useRef<HTMLDivElement>(null);
    const [ancho, setAncho] = useState(800);
    useLayoutEffect(() => {
        const el = cajaRegla.current; if (!el) return;
        const ro = new ResizeObserver(() => setAncho(el.clientWidth || 800));
        ro.observe(el); setAncho(el.clientWidth || 800);
        return () => ro.disconnect();
    }, []);
    // Todo en minutos desde la medianoche del día que se mira, SIN envolver: así la regla, los
    // tramos y el arrastre hablan del mismo día aunque se pase de las 00:00 para atrás.
    const medianoche = (linea?.dia === dia ? linea.desde : null) ?? msDe(dia, "00:00") ?? 0;
    const minRel = (ms: number) => (ms - medianoche) / 60_000;
    const lineaDeHoy = linea?.dia === dia ? linea : null;
    const tramosMin = useMemo(() => lineaDeHoy?.tramos?.map(([a, b]) => [Math.max(0, minRel(a)), Math.min(1440, minRel(b))] as [number, number]), [lineaDeHoy]); // eslint-disable-line react-hooks/exhaustive-deps
    // Hasta dónde se sabe si hay grabación: el día entero, o hasta ahora si es hoy.
    const rangoTramos: [number, number] | undefined = tramosMin ? [0, Math.min(1440, minRel(Date.now()))] : undefined;
    useNombresPropios();
    const marcas = useMemo<MarcaScrub[]>(() => eventos.map((e) => {
        const hora = partes(e.ts).hora;
        if (e.clase === "vision") {
            const g = VISION_GRUPO[e.tipo] || VISION_GRUPO.persona;
            const nombre = e.tipo === "propio" ? nombrePropio(e.nombre || "") || g.nombre : g.nombre;
            return { id: e.id, m: minRel(e.ts), Icon: g.Icon, titulo: `OmniVision · ${nombre} · ${hora}`, tono: tonoDe(e) };
        }
        const det = e.clase === "deteccion";
        return {
            id: e.id, m: minRel(e.ts), Icon: det ? metaDe(e.tipo).Icon : Car,
            titulo: det ? `Cámara · ${metaDe(e.tipo).label} · ${hora}` : `${e.plate || "Sin leer"} · ${e.tipo === "EXIT" ? "sale" : "entra"} · ${hora}`,
            // La lectura conserva su resultado en la marca (autorizada o no); su tramo va en blanco.
            tono: det ? "aviso" : e.ok ? "bien" : "mal",
        };
    }), [eventos, medianoche]); // eslint-disable-line react-hooks/exhaustive-deps
    /**
     * Los tramos con detección (pedido 15/10: «los tramos de detecciones, cada uno con su color»):
     * cada evento dura lo que estuvo a la vista (OmniVision) o DURA_MS, y los de la misma clase
     * que se tocan se juntan. Como en la línea de tiempo de un NVR: de un vistazo, dónde pasó algo.
     */
    const bandas = useMemo<BandaScrub[]>(() => {
        const abiertas = new Map<string, { a: number; b: number }>();
        const out: BandaScrub[] = [];
        for (const e of eventos) {
            const tono = tonoDe(e), a = e.ts, b = Math.max(e.fin ?? 0, e.ts + (DURA_MS[e.clase] || 10_000));
            const u = abiertas.get(tono);
            if (u && a <= u.b + JUNTAR_MS) { u.b = Math.max(u.b, b); continue; }
            if (u) out.push({ a: minRel(u.a), b: minRel(u.b), tono });
            abiertas.set(tono, { a, b });
        }
        for (const [tono, u] of abiertas) out.push({ a: minRel(u.a), b: minRel(u.b), tono });
        return out;
    }, [eventos, medianoche]); // eslint-disable-line react-hooks/exhaustive-deps
    const irAMarcaScrub = (k: MarcaScrub) => irAMarca(eventos.find((e) => e.id === k.id) || null);

    const sigueVisible = visibles || !jugando || estado !== "viendo" || !!tirando;
    const hrefDescarga = (antes: number, despues: number, instante: number) => `/api/nvr/playback?ch=${c.ch}&t=${Math.floor(instante)}&pre=${antes}&dur=${antes + despues}&download=1&nvr=${encodeURIComponent(c.nvrId || "")}`;
    const p = partes(ahora);

    if (!c.nvrId || c.ch == null) {
        return <div className="absolute inset-0 grid place-items-center text-white/70 text-[16px] px-6 text-center">No se sabe en qué NVR graba esta cámara: no hay grabación para mostrar.</div>;
    }

    return (
        <>
            <svg width="0" height="0" className="absolute" aria-hidden>
                <filter id={`mov-${uid}`} x="-10%" y="0" width="120%" height="100%"><feGaussianBlur stdDeviation={`${efecto.blur.toFixed(1)} 0`} /></filter>
            </svg>
            <div className="absolute inset-0 overflow-hidden bg-black">
            <div className="absolute inset-0 will-change-transform"
                style={efecto.blur > 0.3 || Math.abs(efecto.x) > 0.5 ? { filter: `url(#mov-${uid})`, transform: `translateX(${efecto.x.toFixed(1)}px)` } : undefined}>
            {congelado && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={congelado} alt="" draggable={false}
                    className={cn("absolute inset-0 w-full h-full object-contain transition-[filter,opacity] duration-300", nuevoListo ? "opacity-0" : "opacity-100",
                        estado === "buscando" ? "blur-[6px] brightness-[0.75]" : estado === "sin" ? "blur-[10px] brightness-50" : "")} />
            )}
            {url && (
                <video key={`${url}#${intento}`} ref={video} src={url} muted playsInline autoPlay preload="auto" disablePictureInPicture
                    onPlay={() => setJugando(true)} onPause={() => setJugando(false)}
                    onPlaying={() => { setEstado("viendo"); setJugando(true); setNuevoListo(true); }}
                    onLoadedData={() => { if (!pausado.current) video.current?.play().catch(() => { }); }}
                    onTimeUpdate={(e) => { const ms = cargaT + e.currentTarget.currentTime * 1000; if (Math.abs(ms - (posMs ?? 0)) >= 900) setPosMs(ms); }}
                    onEnded={(e) => {
                        // Terminó el tramo: se sigue desde donde quedó, salvo pausa o que haya muerto enseguida.
                        const v = e.currentTarget;
                        if (v.currentTime < 3) { setEstado("sin"); return; }
                        const sig = cargaT + v.currentTime * 1000 + 200;
                        if (!pausado.current && sig < Date.now() - 15_000) ir(sig);
                    }}
                    onError={() => { if (!convertir && !hls) { setConvertir(true); setIntento((i) => i + 1); } else setEstado("sin"); }}
                    className={cn("absolute inset-0 w-full h-full object-contain transition-opacity duration-300", nuevoListo ? "opacity-100" : "opacity-0")} />
            )}
            {verSiluetas && siluetas && estado === "viendo" && (
                <CapaAnalisis analisis={siluetas.analisis} geom={geomDeIntrusion(c.geom)} ajuste="contain" className="pointer-events-none" />
            )}
            </div>
            </div>

            {/* Arrastrar en cualquier parte del cuadro es arrastrar la regla de abajo: se mueve bajo el
                dedo, con su inercia (a la izquierda adelanta, a la derecha vuelve, como la regla).
                Un toque sin arrastrar pausa o sigue, como en cualquier reproductor. */}
            <div className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none"
                onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
                    cancelAnimationFrame(pulsoRaf.current);
                    setTirando({ x0: e.clientX, t0: ahora, dx: 0, vx: 0, xa: e.clientX, ta: performance.now() });
                    mando.current?.empezar(e.clientX);
                }}
                onPointerMove={(e) => {
                    if (!tirando) return;
                    mando.current?.mover(e.clientX);
                    const now = performance.now();
                    const vx = (e.clientX - tirando.xa) / Math.max(1, now - tirando.ta); // px/ms
                    const dx = e.clientX - tirando.x0;
                    setTirando({ ...tirando, dx, vx: tirando.vx * 0.6 + vx * 0.4, xa: e.clientX, ta: now });
                    // Mientras se arrastra, el desenfoque sigue a la velocidad y el cuadro acompaña al dedo.
                    setEfecto({ blur: Math.min(DESENFOQUE_MAX, Math.abs(vx) * 14 + 3), x: Math.max(-CORRIMIENTO_MAX, Math.min(CORRIMIENTO_MAX, dx * 0.08)) });
                }}
                onPointerUp={() => {
                    if (!tirando) return;
                    // Al soltar, la regla sigue con su inercia y, cuando se asienta, su onChange salta.
                    if (Math.abs(tirando.dx) > 6) mando.current?.soltar();
                    else { mando.current?.cancelar(); setEfecto({ blur: 0, x: 0 }); alternarPlay(); }
                    setTirando(null);
                }}
                onPointerCancel={() => { mando.current?.cancelar(); setTirando(null); pulso(0); }} />

            {/* Mientras se arrastra: hacia dónde, cuánto y a qué hora se llega. */}
            {tirando && Math.abs(tirando.dx) > 6 && enRegla != null && (() => {
                const destino = Math.min(Date.now() - 5000, enRegla);
                const d = Math.round((destino - tirando.t0) / 1000), adelante = d >= 0;
                const abs = Math.abs(d), txt = `${adelante ? "+" : "−"}${abs >= 60 ? `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}` : `${abs} s`}`;
                return (
                    <>
                        <span className={cn("absolute inset-y-0 w-1/3 pointer-events-none", adelante ? "right-0 bg-gradient-to-l" : "left-0 bg-gradient-to-r", "from-white/10 to-transparent")} />
                        <div className="absolute inset-0 grid place-items-center pointer-events-none">
                            <span className="visor-panel rounded-[18px] px-6 py-4 flex items-center gap-4 text-white">
                                {adelante ? <FastForward size={34} /> : <Rewind size={34} />}
                                <span className="flex flex-col leading-none">
                                    <span className="text-[30px] font-bold tabular-nums tracking-[-0.02em]">{txt}</span>
                                    <span className="text-[14px] text-white/70 tabular-nums mt-1.5">{partes(destino).hora}</span>
                                </span>
                            </span>
                        </div>
                    </>
                );
            })()}

            {/* El vivo, chico, en una esquina: un toque vuelve a él. */}
            <button type="button" onClick={alVivo} title="Volver al vivo"
                className={cn("absolute right-4 bottom-[200px] sm:bottom-[176px] w-[180px] sm:w-[240px] aspect-video rounded-[10px] overflow-hidden ring-1 ring-white/25 bg-black transition-opacity", !sigueVisible && "opacity-0 pointer-events-none")}>
                <Vivo src={vivoDe(c.stream, !h265, hls)} className="absolute inset-0 w-full h-full object-cover" />
                <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white"><Radio size={11} className="text-[var(--mal)] animate-pulse" /> Vivo</span>
            </button>

            {/* Estado en el centro: buscando o sin grabación (con la salida). */}
            {estado !== "viendo" && (
                <div className="absolute inset-x-0 top-0 bottom-[190px] grid place-items-center pointer-events-none">
                    {estado === "buscando" ? (
                        // Chico y sobre el cuadro congelado: un cartel grande en el medio cortaba la sensación de movimiento.
                        <span className="inline-flex items-center gap-2 rounded-full visor-panel px-3.5 py-1.5 text-white/90 text-[13px] font-semibold"><Loader2 size={14} className="animate-spin" /> Buscando en el NVR</span>
                    ) : (
                        <span className="flex flex-col items-center gap-2 text-center visor-sombra-texto pointer-events-auto">
                            <span className="text-white text-[18px] font-bold">Sin grabación a esta hora</span>
                            {proximoTramo != null && (
                                <button type="button" onClick={() => saltar(proximoTramo, ahora)} className="h-10 px-4 rounded-full bg-white/15 hover:bg-white/25 text-white text-[14px] font-semibold">
                                    Ir a la próxima grabación · {horaCorta(proximoTramo)}
                                </button>
                            )}
                        </span>
                    )}
                </div>
            )}

            {/* Abajo, sobre el video: arriba los controles, y al pie la regla. */}
            <div className={cn("absolute bottom-0 inset-x-0 px-3 sm:px-6 pb-2 pt-16 bg-gradient-to-t from-black/90 via-black/55 to-transparent transition-opacity duration-300", !sigueVisible && "opacity-0 pointer-events-none")}>
                <div className="flex flex-wrap items-center justify-center gap-2">
                    <button type="button" onClick={alVivo} title="Volver al vivo  ( Esc )"
                        className="h-10 px-3.5 rounded-full visor-panel text-white text-[13px] font-semibold inline-flex items-center gap-1.5"><Radio size={14} className="text-[var(--mal)]" /> Vivo</button>

                    <span className="visor-panel rounded-full h-10 px-1 inline-flex items-center gap-1">
                        <label className="relative h-8 pl-2.5 pr-2 inline-flex items-center gap-1.5 rounded-full hover:bg-white/10 cursor-pointer text-white text-[13px] tabular-nums">
                            <CalendarDays size={14} className="text-white/60" /> {p.dia.split("-").reverse().join("/")}
                            <input type="date" value={p.dia} max={partes(Date.now()).dia} aria-label="Día"
                                onChange={(e) => { const ms = msDe(e.target.value, p.hora); if (ms) ir(ms); }}
                                className="absolute inset-0 opacity-0 cursor-pointer [color-scheme:dark]" />
                        </label>
                        <label className="h-8 pl-2.5 pr-1 inline-flex items-center gap-1.5 rounded-full hover:bg-white/10 text-white text-[13px]">
                            <Clock size={14} className="text-white/60" />
                            <input type="time" step={1} value={p.hora} aria-label="Hora"
                                onChange={(e) => { const ms = msDe(p.dia, e.target.value); if (ms) ir(ms); }}
                                className="bg-transparent tabular-nums outline-none [color-scheme:dark] w-[92px]" />
                        </label>
                    </span>

                    <span className="visor-panel rounded-full p-1 inline-flex items-center gap-0.5">
                        <Boton onClick={() => irAMarca(anterior)} disabled={!anterior} titulo={anterior ? `Evento anterior · ${partes(anterior.ts).hora}  ( , )` : "No hay eventos antes en este día"}><SkipBack size={18} /></Boton>
                        <Boton onClick={() => saltar(ahora - SALTO_MS, ahora)} titulo="30 s atrás  ( ← 10 s )"><Rewind size={18} /></Boton>
                        <Boton onClick={alternarPlay} titulo={jugando ? "Pausar  ( espacio )" : "Reproducir  ( espacio )"} grande disabled={!url}>
                            {estado === "buscando" && url ? <Loader2 size={20} className="animate-spin" /> : jugando ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                        </Boton>
                        <Boton onClick={() => saltar(ahora + SALTO_MS, ahora)} titulo="30 s adelante  ( → 10 s )" disabled={ahora + SALTO_MS > Date.now()}><FastForward size={18} /></Boton>
                        <Boton onClick={() => irAMarca(siguiente)} disabled={!siguiente} titulo={siguiente ? `Evento siguiente · ${partes(siguiente.ts).hora}  ( . )` : "No hay eventos después en este día"}><SkipForward size={18} /></Boton>
                    </span>

                    <span className="visor-panel rounded-full p-1 inline-flex items-center">
                        <Boton onClick={() => setVerSiluetas((x) => !x)} activo={verSiluetas}
                            titulo={verSiluetas ? `Siluetas de OmniVision sobre la grabación${siluetas ? ` · ${siluetas.ms} ms por cuadro` : ""} · tocar para apagar` : "Mostrar las siluetas de OmniVision sobre la grabación"}><Sparkles size={17} /></Boton>
                        <Boton onClick={() => setDescarga(true)} titulo="Exportar un clip de este momento"><Download size={17} /></Boton>
                    </span>

                    <span className="hidden lg:inline-flex items-center gap-3 text-[12px] text-white/60 ml-1">
                        {estado === "viendo" && !convertir && <span title="El servidor no la convierte: la pasa tal cual la grabó el NVR">H.265 directo</span>}
                        {tramosMin && <span className="inline-flex items-center gap-1"><span className="w-3.5 h-1.5 bg-[var(--bien)]" /> grabación</span>}
                        {tramosMin && <span className="inline-flex items-center gap-1"><span className="w-3.5 h-1.5 bg-[var(--mal)]" /> sin grabación</span>}
                        {eventos.some((e) => e.clase === "deteccion") && <span className="inline-flex items-center gap-1"><span className="w-3.5 h-1.5 bg-[var(--aviso)]" /> cámara</span>}
                        {eventos.some((e) => e.clase === "vision" && e.tipo !== "propio") && <span className="inline-flex items-center gap-1"><span className="w-3.5 h-1.5 bg-[var(--accion-en-oscuro)]" /> OmniVision</span>}
                        {eventos.some((e) => e.clase === "vision" && e.tipo === "propio") && <span className="inline-flex items-center gap-1"><span className="w-3.5 h-1.5 bg-[#c084fc]" /> entrenado</span>}
                        {eventos.some((e) => e.clase === "lectura") && <span className="inline-flex items-center gap-1"><span className="w-3.5 h-1.5 bg-white" /> lectura</span>}
                    </span>
                </div>

                {/* La regla de siempre (la del visor): la hora grande arriba, se arrastra, y las marcas se tocan. */}
                <div ref={cajaRegla} className="mt-1">
                    <Scrub step={PASO_REGLA} momentum={30} format="24h" width={ancho} difuminado={8} value={minRel(ahora)} start={minRel(ahora)}
                        sinEnvolver pxPorMinuto={PX_POR_MINUTO} mando={mando}
                        alArrastrar={(m) => setEnRegla(m == null ? null : medianoche + m * 60_000)}
                        onChange={(mins) => {
                            // Minutos desde la medianoche del día que se mira, sin envolver: negativos son
                            // el día anterior (pasar las 00:00 hacia atrás), más de 1440 el siguiente.
                            const ms = medianoche + mins * 60_000;
                            if (Math.abs(ms - ahora) > 1000) saltar(ms, ahora);
                        }}
                        marcas={marcas} onMarca={irAMarcaScrub} tramos={tramosMin || undefined} rangoTramos={rangoTramos} bandas={bandas} />
                </div>
            </div>

            {descarga && <DescargaClip instante={ahora} ventana={ventana} href={hrefDescarga} onClose={() => setDescarga(false)} deviceId={deviceIdEnvio} camara={c.nombre} />}
        </>
    );
}

