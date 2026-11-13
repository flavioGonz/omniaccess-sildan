"use client";

import { lineasDe, zonasDe } from "@/lib/geom-intrusion";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Disposicion } from "@/lib/monitor/disposiciones";
import { cn } from "@/lib/utils";

/** Lo que trae /api/monitor/camaras de cada canal (ver la ruta para el porqué de cada campo). */
export type Alerta = { id: string; tipo: string; ts: string;
    /** La captura de la detección y lo que OmniVision vio en ella (sólo las de la consulta, no las del socket). */
    foto?: string | null; verif?: { veredicto: string | null; analisis: any } | null };
export type Lectura = { id: string; ts: string; plate: string | null; decision: string; sentido: string; listaNegra: boolean };
export type Punto = { x: number; y: number };
export type Canal = {
    clave: string; nombre: string; nvrId: string | null; nvr: string | null; ch: number | null; online: boolean | null;
    stream: string; equipoId: string | null; alerta: Alerta | null;
    /** Área de Dispositivos (la del equipo o la de su NVR). */
    areaId?: string | null;
    funcion: "intrusion" | "lpr" | null; geom: { line: Punto[]; field: Punto[] } | null; ultima: Alerta | null; lecturas: Lectura[];
    /** Si OmniVision la analiza (todo: registro, reglas, verificación, lecturas) y lo que cuesta, medido. */
    vision?: { analiza: boolean; porSeg: number | null };
};
export type Modo = "directo" | "convertido" | "foto";

/** Cadencia de la foto en las baldosas que no van en vivo. */
export const FOTO_MS = 8000;
/** Sin imagen en este tiempo, el vivo se da por fallido. */
const VIVO_ESPERA_MS = 12_000;
/** El códec que se pregunta: H.265 Main, nivel 3.1 (alcanza para 640×360 y sobra). */
const TIPOS_H265 = ['video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"'];

export function reproduceH265(): boolean {
    try {
        const v = document.createElement("video");
        const ms = (window as any).MediaSource;
        return TIPOS_H265.some((t) => v.canPlayType(t) === "probably" || !!ms?.isTypeSupported?.(t));
    } catch { return false; }
}

export const fotoDe = (c: Canal, ancho = 640) => c.equipoId
    ? `/api/snapshot/${c.equipoId}?w=${ancho}`
    : c.nvrId && c.ch != null ? `/api/monitor/camaras/foto?nvr=${encodeURIComponent(c.nvrId)}&ch=${c.ch}&w=${ancho}` : null;
/**
 * Safari (y todo navegador de iPhone, que por dentro es Safari) no abre el MP4 continuo de
 * go2rtc: se le da HLS, que reproduce nativo. Medido el 15/10 en SN: con `&mp4` go2rtc arma HLS
 * en fMP4 con el H.265 tal cual (hvc1), y con `&video=h264` lo convierte (avc1). En Chrome se
 * sigue con MP4: menos demora que HLS, que trabaja por segmentos.
 */
export function usaHls(): boolean {
    try {
        const v = document.createElement("video");
        const ua = navigator.userAgent;
        return !!v.canPlayType("application/vnd.apple.mpegurl") && !/Chrome|Chromium|Android|Edg\//.test(ua);
    } catch { return false; }
}
export const vivoDe = (stream: string, convertido: boolean, hls = false) => hls
    ? `/go2rtc/api/stream.m3u8?src=${encodeURIComponent(stream)}${convertido ? "&video=h264" : "&mp4"}`
    : `/go2rtc/api/stream.mp4?src=${encodeURIComponent(stream)}${convertido ? "&video=h264" : ""}`;
export const ubicacion = (c: Canal) => [c.nvr, c.ch != null ? `CH ${c.ch}` : null].filter(Boolean).join(" · ") || "Cámara";
export const grupoDe = (c: Canal) => c.nvr || "Cámaras sueltas";
/**
 * El id de la cámara para todo lo que se guarda por cámara (seguimiento visual, OmniVision): el
 * del equipo, o `nvrch-<nvr>-<ch>` para un canal de NVR que no es equipo — el mismo nombre que su
 * stream en go2rtc.
 */
export const idCanal = (c: Pick<Canal, "equipoId" | "nvrId" | "ch">) => c.equipoId || `nvrch-${c.nvrId}-${c.ch}`;

/**
 * Lo que mantiene un vivo andando solo (12/11, Nico: «cada vez que abro una cámara y vuelvo atrás
 * se loopean las cámaras, tengo que darle F5; debemos asegurar que se van a poder ver 24 hs en
 * tiempo real»).
 *
 * El <video> abría la conexión una vez y nunca más miraba si seguía llegando imagen. Y el vivo es
 * una descarga que no termina, que pasa por go2rtc y por la aplicación: cualquier corte en el
 * medio (un reinicio de la aplicación —cada despliegue—, go2rtc que rearma el stream, el grabador
 * que renegocia, la red) la deja colgada con el último cuadro, o repitiendo lo que tenía en el
 * búfer, hasta apretar F5. En una pared que tiene que estar 24 horas eso pasa seguro.
 *
 *  · VIGIA_MS: cada cuánto se mira si el video avanzó.
 *  · QUIETO_MS: sin avanzar este tiempo (y con la pestaña a la vista), se vuelve a conectar.
 *    «Avanzar» es que llegue video nuevo, no que se mueva el reloj: cuando go2rtc rearma un stream
 *    (el grabador cortó y volvió), el navegador puede quedarse repitiendo lo que tenía — el reloj
 *    camina y en la pantalla se ve un loop. Por eso se mira hasta dónde llega lo descargado, y
 *    también que el reloj no vuelva para atrás.
 *  · ATRASO_MAX_S: si lo que se ve quedó más atrás que esto de lo último que llegó, se salta al
 *    final: un vivo atrasado medio minuto no es un vivo.
 *  · REINTENTO_*: la espera entre reconexiones crece hasta un tope, para no golpear a un
 *    grabador caído, y vuelve al mínimo cuando el video arranca.
 */
const VIGIA_MS = 2000;
const QUIETO_MS = 8000;
const ATRASO_MAX_S = 6;
const REINTENTO_MIN_MS = 1500;
const REINTENTO_MAX_MS = 30_000;
let serieVivo = 0;

/**
 * Un <video> de go2rtc que avisa si arrancó o no, se reconecta solo si se corta y suelta la
 * conexión al desmontarse.
 *
 * Cada conexión pide una dirección propia (`_=<n>.<intento>`): al reconectar, el navegador no
 * puede contestar con lo que le quedó guardado del intento anterior. go2rtc ignora el parámetro.
 * (Se probó si dos <video> con la misma dirección —la baldosa y la ficha del mismo canal—
 * compartían la descarga y se pisaban al cerrar una: no, cada uno abre la suya.)
 */
export function Vivo({ src, alResultado, className, alMedir }: { src: string; alResultado?: (ok: boolean) => void; className?: string;
    /** El tamaño real del video, cuando se sabe: lo usan las siluetas para caer donde van. */
    alMedir?: (ancho: number, alto: number) => void }) {
    const ref = useRef<HTMLVideoElement>(null);
    const avisar = useRef(alResultado); avisar.current = alResultado;
    const medir = useRef(alMedir); medir.current = alMedir;
    useEffect(() => {
        const v = ref.current; if (!v) return;
        const id = ++serieVivo;
        // HLS (Safari) se mantiene al día solo y carga por segmentos: no se le corrige el atraso a mano.
        const hls = src.includes(".m3u8");
        let avisado = false, vivo = true, intento = 0, espera = REINTENTO_MIN_MS, conImagen = false;
        let ultimoT = -1, ultimoFin = -1, ultimoAvance = Date.now(), reintento: ReturnType<typeof setTimeout> | null = null;

        const conectar = () => {
            if (!vivo) return;
            reintento = null; conImagen = false;
            ultimoT = -1; ultimoFin = -1; ultimoAvance = Date.now();
            v.src = `${src}${src.includes("?") ? "&" : "?"}_=${id}.${intento++}`;
            v.play().catch(() => { });
        };
        /** Se cortó o no avanza: soltar la conexión vieja y abrir otra, esperando cada vez un poco más. */
        const reconectar = () => {
            if (!vivo || reintento) return;
            try { v.pause(); v.removeAttribute("src"); v.load(); } catch { }
            reintento = setTimeout(conectar, espera);
            espera = Math.min(REINTENTO_MAX_MS, espera * 2);
        };
        const ok = () => {
            if (v.videoWidth) medir.current?.(v.videoWidth, v.videoHeight);
            espera = REINTENTO_MIN_MS; ultimoAvance = Date.now(); conImagen = true;
            if (!avisado) { avisado = true; avisar.current?.(true); }
        };
        // Al padre se le avisa UNA vez (decide el modo de la baldosa con eso); reconectar, se sigue siempre.
        const mal = () => { if (!avisado) { avisado = true; avisar.current?.(false); } };
        const corte = () => { mal(); reconectar(); };
        const to = setTimeout(mal, VIVO_ESPERA_MS);

        const vigia = setInterval(() => {
            // Con la pestaña oculta el navegador frena el video a propósito: eso no es un corte.
            if (document.hidden || reintento) { ultimoAvance = Date.now(); return; }
            const t = v.currentTime;
            let fin = -1;
            try { const b = v.buffered; if (b.length) fin = b.end(b.length - 1); } catch { }
            // El reloj volvió para atrás sin que nadie lo pidiera: está repitiendo lo viejo.
            if (conImagen && ultimoT > 1 && t < ultimoT - 1) { reconectar(); return; }
            // HLS baja por segmentos de varios segundos: para él alcanza con que el reloj camine.
            const llegoVideo = hls ? t !== ultimoT : fin > ultimoFin + 0.05;
            ultimoT = t;
            if (llegoVideo) {
                ultimoFin = fin; ultimoAvance = Date.now();
                // Atrasado respecto de lo que ya llegó: al final del búfer, que es el presente.
                if (!hls && fin - t > ATRASO_MAX_S) { try { v.currentTime = fin - 0.3; ultimoT = fin - 0.3; } catch { } }
                return;
            }
            // Antes del primer cuadro se espera lo mismo que para darlo por fallido: la alta calidad
            // de un grabador tarda varios segundos en abrir, y cortarla a los 8 era no dejarla abrir nunca.
            if (Date.now() - ultimoAvance > (conImagen ? QUIETO_MS : VIVO_ESPERA_MS + VIGIA_MS)) reconectar();
        }, VIGIA_MS);
        // Al volver a la pestaña, el reloj de «quieto» empieza de nuevo: se le da tiempo a retomar.
        const visible = () => { ultimoAvance = Date.now(); if (!document.hidden && v.paused && !reintento) v.play().catch(() => { }); };

        v.addEventListener("loadeddata", ok); v.addEventListener("error", corte); v.addEventListener("ended", corte);
        document.addEventListener("visibilitychange", visible);
        conectar();
        return () => {
            vivo = false;
            clearTimeout(to); clearInterval(vigia); if (reintento) clearTimeout(reintento);
            v.removeEventListener("loadeddata", ok); v.removeEventListener("error", corte); v.removeEventListener("ended", corte);
            document.removeEventListener("visibilitychange", visible);
            // Sin esto el navegador mantiene la descarga abierta y go2rtc sigue sirviendo el canal.
            try { v.pause(); v.removeAttribute("src"); v.load(); } catch { }
        };
    }, [src]);
    return <video ref={ref} muted playsInline autoPlay disablePictureInPicture className={className} />;
}

/** Foto que se renueva sola. La nueva sólo reemplaza a la vieja cuando terminó de bajar. */
export function Foto({ src, ms, className }: { src: string; ms: number; className?: string }) {
    const [k, setK] = useState(() => Date.now());
    const [mostrada, setMostrada] = useState<string | null>(null);
    const [falla, setFalla] = useState(false);
    useEffect(() => { const iv = setInterval(() => setK(Date.now()), ms); return () => clearInterval(iv); }, [ms]);
    useEffect(() => { setMostrada(null); setFalla(false); }, [src]);
    const pedida = `${src}${src.includes("?") ? "&" : "?"}t=${k}`;
    return (
        <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {mostrada && <img src={mostrada} alt="" draggable={false} className={className} />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={pedida} src={pedida} alt="" className="hidden" onLoad={() => { setMostrada(pedida); setFalla(false); }} onError={() => setFalla(true)} />
            {!mostrada && !falla && <span className="absolute inset-0 grid place-items-center text-white/30"><Loader2 size={22} className="animate-spin" /></span>}
            {!mostrada && falla && <span className="absolute inset-0 grid place-items-center text-white/40 text-[13px]">Sin foto del canal</span>}
        </>
    );
}

/**
 * La línea y la zona de la cámara, sobre su video. Las coordenadas vienen en 0–100 del cuadro
 * de la cámara (16:9). GeomOverlay de intrusión estira el dibujo a la baldosa entera, que sólo
 * coincide si la baldosa es 16:9; acá el SVG copia el ajuste del video — `slice` es
 * object-cover y `meet` es object-contain — así la línea cae donde la cámara la tiene.
 */
export function Geometria({ geom, alerta, ajuste }: { geom: { line: Punto[]; field: Punto[]; lines?: Punto[][]; fields?: Punto[][] }; alerta: boolean; ajuste: "cover" | "contain" }) {
    const p = (q: Punto[]) => q.map((x) => `${(x.x * 1.6).toFixed(1)},${(x.y * 0.9).toFixed(1)}`).join(" ");
    const linea = alerta ? "#f87171" : "#38bdf8";
    return (
        <svg viewBox="0 0 160 90" preserveAspectRatio={ajuste === "cover" ? "xMidYMid slice" : "xMidYMid meet"} className="absolute inset-0 w-full h-full pointer-events-none">
            {zonasDe(geom).map((z, i) => <polygon key={`z${i}`} points={p(z)} fill={alerta ? "rgba(239,68,68,0.28)" : "rgba(244,63,94,0.12)"} stroke={alerta ? "#ef4444" : "#f43f5e"} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />)}
            {lineasDe(geom).map((l, i) => <polyline key={`l${i}`} points={p(l)} fill="none" stroke={linea} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
        </svg>
    );
}

/** El dibujo de una disposición, como los íconos de división de pantalla de un NVR. */
export function Glifo({ d, tam = 22, className }: { d: Disposicion; tam?: number; className?: string }) {
    const W = 24, H = 16, g = 1.4;
    const cw = (W - g * (d.cols - 1)) / d.cols, ch = (H - g * (d.filas - 1)) / d.filas;
    return (
        <svg width={tam} height={(tam * H) / W} viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden>
            {d.casillas.map((c, i) => (
                <rect key={i} x={c.x * (cw + g)} y={c.y * (ch + g)} width={c.w * cw + (c.w - 1) * g} height={c.h * ch + (c.h - 1) * g}
                    rx={1} fill="currentColor" opacity={c.w > 1 ? 0.95 : 0.55} />
            ))}
        </svg>
    );
}

/** El posicionamiento de una casilla en la cuadrícula CSS. */
export const estiloCasilla = (c: { x: number; y: number; w: number; h: number }) =>
    ({ gridColumn: `${c.x + 1} / span ${c.w}`, gridRow: `${c.y + 1} / span ${c.h}` }) as React.CSSProperties;

/**
 * Un menú flotante propio. No se usa ui/popover: se monta en <body>, fuera del `dark` del marco
 * de la pared, y salía en tema claro sobre una pantalla negra.
 */
export function Flotante({ abierto, alCerrar, children, className, lado = "izquierda" }: {
    abierto: boolean; alCerrar: () => void; children: React.ReactNode; className?: string; lado?: "izquierda" | "derecha";
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!abierto) return;
        const fuera = (e: PointerEvent) => { if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) alCerrar(); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") alCerrar(); };
        window.addEventListener("pointerdown", fuera); window.addEventListener("keydown", esc);
        return () => { window.removeEventListener("pointerdown", fuera); window.removeEventListener("keydown", esc); };
    }, [abierto, alCerrar]);
    if (!abierto) return null;
    return (
        <div ref={ref} className={cn("absolute top-[calc(100%+6px)] z-40 rounded-[14px] border border-border bg-card p-1.5 shadow-[var(--sombra-flotante)]",
            lado === "izquierda" ? "left-0" : "right-0", className)}>
            {children}
        </div>
    );
}

/** Si no llega un cuadro analizado en este tiempo, las siluetas se borran: dibujar las viejas sería mentir. */
const SILUETAS_VIEJAS_MS = 2000;

/**
 * Las siluetas del canal en vivo (/api/monitor/camaras/siluetas, por EventSource). Devuelve el
 * último análisis, lo que tardó y si el servidor no dio lugar (tope de canales a la vez).
 * `activo` en false no abre nada: la GPU no trabaja para una ficha que no las muestra.
 */
export function useSiluetasEnVivo(stream: string | null, activo: boolean) {
    const [analisis, setAnalisis] = useState<any | null>(null);
    const [ms, setMs] = useState<number | null>(null);
    const [estado, setEstado] = useState<"apagado" | "conectando" | "vivo" | "ocupado" | "error">("apagado");
    useEffect(() => {
        if (!stream || !activo) { setAnalisis(null); setEstado("apagado"); return; }
        setEstado("conectando");
        let viejo: ReturnType<typeof setTimeout> | null = null;
        let es: EventSource | null = null;
        const abrir = () => {
            es = new EventSource(`/api/monitor/camaras/siluetas?stream=${encodeURIComponent(stream)}`);
            // Sin lugar (tope de canales a la vez): el servidor lo dice y se cierra; sin cerrar acá,
            // EventSource reintentaría solo para siempre.
            es.addEventListener("ocupado", () => { es?.close(); setEstado("ocupado"); });
            es.addEventListener("cuadro", (e: MessageEvent) => {
                const d = JSON.parse(e.data);
                setAnalisis(d.analisis); setMs(d.ms); setEstado("vivo");
                if (viejo) clearTimeout(viejo);
                viejo = setTimeout(() => setAnalisis(null), SILUETAS_VIEJAS_MS);
            });
            es.onerror = () => { if (es?.readyState === EventSource.CLOSED) { setEstado("error"); } };
        };
        abrir();
        return () => { if (viejo) clearTimeout(viejo); es?.close(); };
    }, [stream, activo]);
    return { analisis, ms, estado };
}
