"use client";

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

/** Un <video> de go2rtc que avisa si arrancó o no, y suelta la conexión al desmontarse. */
export function Vivo({ src, alResultado, className, alMedir }: { src: string; alResultado?: (ok: boolean) => void; className?: string;
    /** El tamaño real del video, cuando se sabe: lo usan las siluetas para caer donde van. */
    alMedir?: (ancho: number, alto: number) => void }) {
    const ref = useRef<HTMLVideoElement>(null);
    const avisar = useRef(alResultado); avisar.current = alResultado;
    const medir = useRef(alMedir); medir.current = alMedir;
    useEffect(() => {
        const v = ref.current; if (!v) return;
        let listo = false;
        const ok = () => { if (v.videoWidth) medir.current?.(v.videoWidth, v.videoHeight); if (!listo) { listo = true; avisar.current?.(true); } };
        const mal = () => { if (!listo) { listo = true; avisar.current?.(false); } };
        const to = setTimeout(mal, VIVO_ESPERA_MS);
        v.addEventListener("loadeddata", ok); v.addEventListener("error", mal);
        v.src = src; v.play().catch(() => { });
        return () => {
            clearTimeout(to); v.removeEventListener("loadeddata", ok); v.removeEventListener("error", mal);
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
export function Geometria({ geom, alerta, ajuste }: { geom: { line: Punto[]; field: Punto[] }; alerta: boolean; ajuste: "cover" | "contain" }) {
    const p = (q: Punto[]) => q.map((x) => `${(x.x * 1.6).toFixed(1)},${(x.y * 0.9).toFixed(1)}`).join(" ");
    const linea = alerta ? "#f87171" : "#38bdf8";
    return (
        <svg viewBox="0 0 160 90" preserveAspectRatio={ajuste === "cover" ? "xMidYMid slice" : "xMidYMid meet"} className="absolute inset-0 w-full h-full pointer-events-none">
            {geom.field.length >= 3 && <polygon points={p(geom.field)} fill={alerta ? "rgba(239,68,68,0.28)" : "rgba(244,63,94,0.12)"} stroke={alerta ? "#ef4444" : "#f43f5e"} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />}
            {geom.line.length >= 2 && <polyline points={p(geom.line)} fill="none" stroke={linea} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
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
