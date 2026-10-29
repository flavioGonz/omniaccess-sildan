"use client";
/**
 * Piezas de la app «LPR en vivo» (29/10, Nico mirando el celular: «debe adaptarse al theme light o
 * dark; debe ser más funcional, mismo estilo de Protect de UniFi»).
 *
 * Qué estaba mal: la pantalla pintaba el fondo con `bg-card` (blanco en tema claro) y TODO el texto
 * en `text-white`. En claro quedaba blanco sobre blanco: el encabezado, los contadores y la barra
 * de abajo no se leían. Era la mezcla de dos sistemas — un token que cambia con el tema y un color
 * fijo que no —, el mismo error que ya se había corregido en el panel. Ahora todo lo que no es video
 * usa los tokens (`background`, `card`, `foreground`, `muted-foreground`, `border`) y los tonos de
 * estado (`chip-bien`, `chip-mal`, `chip-quieto`). El video sigue negro en los dos temas: es una
 * imagen, como en Protect, y sobre él va texto claro con su degradado.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, Car } from "lucide-react";
import { cn } from "@/lib/utils";

/** Lo que la cámara manda cuando no hay chapa: no es una matrícula. */
const ANOMALAS = ["NO_LEIDA", "NOLEIDA", "UNKNOWN", "S/P", "SP", "DOOR_OPEN", "DOOR_CLOSE", ""];
export const esAnomala = (p?: string | null) => !p || ANOMALAS.includes(String(p).toUpperCase());

/** La foto guardada de un evento (ruta propia o del almacenamiento). */
export const fotoEvento = (p?: string | null) => (p ? (String(p).startsWith("/") ? p : `/api/files/lpr-prod/${p}`) : null);

export type Resultado = "permitido" | "denegado" | "noleida";
/** Cómo terminó una lectura. Una chapa no leída no es «denegada»: es que no hubo chapa. */
export function resultado(e: any): Resultado {
    if (esAnomala(e?.plateDetected) && !e?.relectura?.plate) return "noleida";
    return e?.decision === "GRANT" ? "permitido" : "denegado";
}
export const RESULTADO: Record<Resultado, { rotulo: string; chip: string; punto: string }> = {
    permitido: { rotulo: "Permitido", chip: "chip-bien", punto: "pleno-bien" },
    denegado: { rotulo: "Denegado", chip: "chip-mal", punto: "pleno-mal" },
    noleida: { rotulo: "Sin lectura", chip: "chip-quieto", punto: "pleno-quieto" },
};
/** La chapa a mostrar: la de la cámara o, si no leyó, la que releyó OmniVision. */
export const chapaDe = (e: any): string | null => (!esAnomala(e?.plateDetected) ? String(e.plateDetected) : e?.relectura?.plate || null);

/** La foto del canal, renovada cada 4 s: lo que se ve mientras el video arranca o si no arranca. */
export function FotoCanal({ deviceId, className }: { deviceId: string; className?: string }) {
    const [t, setT] = useState(() => Date.now());
    const [error, setError] = useState(false);
    useEffect(() => { const iv = setInterval(() => { setT(Date.now()); setError(false); }, 4000); return () => clearInterval(iv); }, [deviceId]);
    if (error) {
        return (
            <div className={cn("flex flex-col items-center justify-center gap-1.5 bg-black text-white/45", className)}>
                <Camera className="w-6 h-6" /><span className="text-[10.5px]">Sin señal</span>
            </div>
        );
    }
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img src={`/api/snapshot/${deviceId}?t=${t}`} alt="" className={cn("object-cover", className)} onError={() => setError(true)} draggable={false} />;
}

/**
 * El vivo de una cámara LPR por go2rtc. Arranca sobre la foto y se funde cuando llega el primer
 * cuadro; si no llega después de unos reintentos, se queda con la foto (y lo dice el rótulo).
 */
export function VivoCanal({ deviceId, className, alEstado }: { deviceId: string; className?: string; alEstado?: (s: "cargando" | "vivo" | "foto") => void }) {
    const ref = useRef<HTMLVideoElement>(null);
    const [listo, setListo] = useState(false);
    const [fallo, setFallo] = useState(false);
    const reintentos = useRef(0);
    useEffect(() => {
        const v = ref.current; if (!v) return;
        let fin = false; let timer: any;
        reintentos.current = 0; setListo(false); setFallo(false); alEstado?.("cargando");
        const src = `/go2rtc/api/stream.mp4?src=lpr_${deviceId}&video=h264`;
        const arrancar = () => { if (fin) return; v.src = src; v.play().catch(() => {}); };
        const enVivo = () => { if (!fin) { setListo(true); alEstado?.("vivo"); } };
        const error = () => {
            if (fin) return; setListo(false); reintentos.current++;
            if (reintentos.current > 4) { setFallo(true); alEstado?.("foto"); return; }
            timer = setTimeout(arrancar, Math.min(800 * reintentos.current, 4000));
        };
        v.addEventListener("playing", enVivo); v.addEventListener("error", error); arrancar();
        return () => { fin = true; clearTimeout(timer); v.removeEventListener("playing", enVivo); v.removeEventListener("error", error); v.pause(); v.removeAttribute("src"); v.load(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deviceId]);
    if (fallo) return <FotoCanal deviceId={deviceId} className={className} />;
    return (
        <div className={cn("relative bg-black overflow-hidden", className)}>
            <FotoCanal deviceId={deviceId} className={cn("absolute inset-0 w-full h-full transition-opacity duration-500", listo ? "opacity-0" : "opacity-100")} />
            <video ref={ref} className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-500", listo ? "opacity-100" : "opacity-0")} autoPlay muted playsInline />
        </div>
    );
}

/** La matrícula como se lee en la calle: fondo claro, borde y cifras de ancho fijo. */
export function Chapa({ p, grande, className }: { p?: string | null; grande?: boolean; className?: string }) {
    if (!p) return <span className={cn("text-muted-foreground", grande ? "text-[15px]" : "text-[13px]")}>Sin lectura</span>;
    return (
        <span className={cn(
            "inline-flex items-center rounded-[6px] border border-border bg-muted font-bold tabular-nums text-foreground",
            grande ? "px-3 py-1 text-[20px] tracking-[0.16em]" : "px-2 py-0.5 text-[13px] tracking-[0.12em]",
            className,
        )}>{p}</span>
    );
}

/** El cuadro de un evento, o un hueco que lo dice. */
export function FotoEvento({ src, className, chica }: { src: string | null; className?: string; chica?: boolean }) {
    const [error, setError] = useState(false);
    if (!src || error) {
        return <div className={cn("flex items-center justify-center bg-muted text-muted-foreground/50", className)}><Car size={chica ? 16 : 26} /></div>;
    }
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img src={src} alt="" className={cn("object-cover bg-black", className)} onError={() => setError(true)} loading="lazy" draggable={false} />;
}

/** Una lectura en una lista: foto, chapa, quién, cámara y hora. Igual en Eventos, Buscar y la cámara. */
export function FilaLectura({ e, alTocar, hora, sinCamara, activa }: { e: any; alTocar: () => void; hora: string; sinCamara?: boolean; activa?: boolean }) {
    const r = RESULTADO[resultado(e)];
    const quien = e.user?.name ? `${e.user.name}${e.user.unit?.name ? ` · ${e.user.unit.name}` : ""}` : null;
    return (
        <button type="button" onClick={alTocar}
            className={cn("w-full flex items-center gap-3 rounded-[10px] border p-2 text-left transition-colors active:bg-muted",
                activa ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border bg-card")}>
            <FotoEvento src={fotoEvento(e.snapshotPath)} chica className="w-[76px] h-[48px] rounded-[6px] shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                    <Chapa p={chapaDe(e)} />
                    {!esAnomala(e.plateDetected) ? null : e.relectura?.plate ? <span className="text-[10.5px] font-semibold tono-info">OmniVision</span> : null}
                </div>
                <div className="mt-1 text-[11.5px] text-muted-foreground truncate">
                    {[quien, sinCamara ? null : e.device?.name].filter(Boolean).join(" · ") || "Sin registrar"}
                </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={cn("text-[10.5px] font-semibold px-2 py-0.5 rounded-full border", r.chip)}>{r.rotulo}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{hora}</span>
            </div>
        </button>
    );
}

/**
 * Una hoja que sube desde abajo, como las de Protect. Ocupa la pantalla entera en el celular;
 * se cierra con la flecha, tocando afuera o con «Atrás» del sistema.
 */
export function Hoja({ abierta, alCerrar, children, alto = "completa", className }: {
    abierta: boolean; alCerrar: () => void; children: React.ReactNode; alto?: "completa" | "media"; className?: string;
}) {
    // «Atrás» del celular cierra la hoja en vez de salir de la app.
    useEffect(() => {
        if (!abierta) return;
        history.pushState({ hoja: true }, "");
        const atras = () => alCerrar();
        window.addEventListener("popstate", atras);
        return () => { window.removeEventListener("popstate", atras); if (history.state?.hoja) history.back(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierta]);
    if (!abierta) return null;
    return (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
            <div className="absolute inset-0 bg-black/50 animate-in fade-in duration-200" onClick={alCerrar} />
            <div className={cn("relative bg-background text-foreground flex flex-col animate-in slide-in-from-bottom duration-300",
                alto === "completa" ? "h-full" : "max-h-[85vh] rounded-t-[14px] border-t border-border", className)}>
                {children}
            </div>
        </div>
    );
}
