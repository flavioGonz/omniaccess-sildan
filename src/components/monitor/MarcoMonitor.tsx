"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Volume2, VolumeX, WifiOff, RefreshCw, AlertTriangle, Link2Off } from "lucide-react";
import { useTiempoReal } from "@/lib/tiempo-real";
import { usarDatos } from "@/lib/monitor/cliente";
import { bloqueado as audioBloqueado, habilitar as habilitarAudio } from "@/lib/sonido-monitor";
import { cn } from "@/lib/utils";
import { ZONA } from "@/lib/fechas";

/**
 * El marco de toda vista de pantalla.
 *
 * Una pantalla de pared no tiene a nadie que la mire de cerca ni que la toque. Por eso
 * lo que importa acá no es el menú (no hay) sino tres cosas: que se lea de lejos, que se
 * sepa SIEMPRE si está viva, y que arranque sola.
 *
 *  · Vitalidad: tres estados. "En vivo" (socket conectado y algún dato en el último
 *    minuto), "Reconectando" (socket caído hace menos de un minuto) y "Sin datos hace N
 *    min", que pinta el encabezado entero de ámbar: una pantalla congelada no puede
 *    confundirse con un barrio tranquilo.
 *  · Pantalla completa al primer gesto, y el cursor y los botones se esconden a los 5 s.
 *  · Oscuro fijo: el `div.dark` de afuera hace que los tokens y los `dark:` apliquen sin
 *    tocar la preferencia del panel en ese navegador.
 *  · Táctil: la misma vista puede estar en una tablet o en una pantalla táctil del puesto.
 *    Ahí no hay mouse que mover para que aparezcan los botones, así que con un puntero
 *    "grueso" (dedo) los controles quedan siempre a la vista y miden 48 px, el cursor no se
 *    esconde, y la página no se deja arrastrar ni recargar con el gesto de tirar hacia abajo.
 */

/** Sin datos ni socket por más de esto, la pantalla lo dice en ámbar. */
const SIN_DATOS_MS = 60_000;
/** Cursor y botones se esconden tras este tiempo quieto. */
const OCULTAR_CURSOR_MS = 5000;
/** Cada cuánto el marco repite su propia lectura (nombre del barrio, ajustes). */
const INTERVALO_MARCO_MS = 5 * 60 * 1000;

type Ajustes = { sonido: Record<string, string>; rotacion: { vistas: string[]; segundos: number } };
type Marco = {
    barrio: string;
    ajustes: Ajustes | null;
    pantalla: { enlaceId: string; vista: string } | null;
    /** Llamar cada vez que llega un dato: es lo que sostiene "En vivo". */
    latir: () => void;
    /** Hay un dedo y no un mouse: las vistas agrandan lo tocable y no dependen del hover. */
    tactil: boolean;
    conectado: boolean;
    /** El nombre de la vista para el encabezado; lo pone cada vista. */
    setTitulo: (t: string) => void;
    silencio: boolean;
    audioBloqueado: boolean;
};
const Ctx = createContext<Marco | null>(null);
export const useMarco = () => { const c = useContext(Ctx); if (!c) throw new Error("useMarco fuera de MarcoMonitor"); return c; };

export function MarcoMonitor({ children }: { children: React.ReactNode }) {
    const [titulo, setTitulo] = useState("");
    const [ultimoDato, setUltimoDato] = useState<number>(() => Date.now());
    const [desconectadoDesde, setDesconectadoDesde] = useState<number | null>(null);
    const [ahora, setAhora] = useState(() => Date.now());
    const [lleno, setLleno] = useState(false);
    const [quieto, setQuieto] = useState(false);
    const [silencio, setSilencio] = useState<boolean>(() => { try { return localStorage.getItem("oa.monitor.silencio") === "1"; } catch { return false; } });
    const [bloqueado, setBloqueado] = useState(true);
    const [tactil, setTactil] = useState(false);
    /* La hora se dibuja recién en el navegador: la del servidor (al armar la página) nunca
       coincide al segundo con la del cliente, y React lo marcaba como error de hidratación. */
    const [montado, setMontado] = useState(false);
    useEffect(() => { setMontado(true); }, []);
    useEffect(() => {
        try {
            const mq = window.matchMedia("(any-pointer: coarse)");
            const leer = () => setTactil(mq.matches);
            leer(); mq.addEventListener?.("change", leer);
            return () => mq.removeEventListener?.("change", leer);
        } catch { /* sin matchMedia: se asume mouse */ }
    }, []);
    const latir = useCallback(() => setUltimoDato(Date.now()), []);

    const { datos: marco, revocado } = usarDatos<{ barrio: string; ajustes: Ajustes; pantalla: Marco["pantalla"] }>("/api/monitor/marco", INTERVALO_MARCO_MS, latir);

    // Cualquier evento del socket cuenta como señal de vida.
    const { conectado } = useTiempoReal("access_event", latir);
    useTiempoReal("general_detection", latir);
    useEffect(() => { if (conectado) setDesconectadoDesde(null); else setDesconectadoDesde((d) => d ?? Date.now()); }, [conectado]);

    useEffect(() => { const iv = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(iv); }, []);

    // Pantalla completa al primer gesto; cursor oculto tras 5 s quieto.
    useEffect(() => {
        let reloj: any = null;
        const despertar = () => { setQuieto(false); clearTimeout(reloj); reloj = setTimeout(() => setQuieto(true), OCULTAR_CURSOR_MS); };
        const primerGesto = async () => {
            if (!document.fullscreenElement) { try { await document.documentElement.requestFullscreen(); } catch { } }
            if (await habilitarAudio()) setBloqueado(false);
        };
        const cambioLleno = () => setLleno(!!document.fullscreenElement);
        // pointerdown también despierta: un dedo no genera pointermove si no arrastra.
        window.addEventListener("pointermove", despertar); window.addEventListener("pointerdown", despertar); window.addEventListener("keydown", despertar);
        window.addEventListener("pointerdown", primerGesto); window.addEventListener("keydown", primerGesto);
        document.addEventListener("fullscreenchange", cambioLleno);
        despertar(); setBloqueado(audioBloqueado());
        return () => { clearTimeout(reloj); window.removeEventListener("pointermove", despertar); window.removeEventListener("pointerdown", despertar); window.removeEventListener("keydown", despertar); window.removeEventListener("pointerdown", primerGesto); window.removeEventListener("keydown", primerGesto); document.removeEventListener("fullscreenchange", cambioLleno); };
    }, []);

    const sinDatos = ahora - ultimoDato > SIN_DATOS_MS && (!conectado || ahora - ultimoDato > SIN_DATOS_MS * 2);
    const reconectando = !conectado && !sinDatos;
    const minutosSin = Math.max(1, Math.floor((ahora - ultimoDato) / 60000));

    const valor = useMemo<Marco>(() => ({
        barrio: marco?.barrio || "OmniAccess", ajustes: marco?.ajustes || null, pantalla: marco?.pantalla || null,
        latir, tactil, conectado, setTitulo, silencio, audioBloqueado: bloqueado,
    }), [marco, latir, tactil, conectado, silencio, bloqueado]);

    const hora = new Date(ahora).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: ZONA });
    const fecha = new Date(ahora).toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long", timeZone: ZONA });

    const alternarLleno = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { } };
    const alternarSilencio = () => { const v = !silencio; setSilencio(v); try { localStorage.setItem("oa.monitor.silencio", v ? "1" : "0"); } catch { } };

    if (revocado) {
        return (
            <div className="dark min-h-screen bg-background text-foreground grid place-items-center p-8">
                <div className="max-w-lg text-center space-y-4">
                    <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[var(--aviso-suave)] text-[var(--aviso-texto)]"><Link2Off size={40} /></span>
                    <h1 className="text-[32px] font-bold">Este enlace ya no abre la pantalla</h1>
                    <p className="text-[18px] text-muted-foreground">Fue revocado desde el panel, o la sesión venció. Pedile a un administrador un enlace nuevo en Monitores.</p>
                    <p className="text-[14px] text-muted-foreground/70 tabular-nums">{hora}</p>
                </div>
            </div>
        );
    }

    return (
        <Ctx.Provider value={valor}>
            <div className={cn("dark h-[100dvh] overflow-hidden bg-background text-foreground flex flex-col select-none overscroll-none touch-manipulation [-webkit-tap-highlight-color:transparent]", quieto && !tactil && "cursor-none")}>
                {/* Encabezado: barrio, vista, vitalidad y reloj. En "sin datos" se pinta ENTERO de ámbar. */}
                <header className={cn("shrink-0 flex items-center gap-4 lg:gap-6 px-4 lg:px-8 h-[64px] border-b transition-colors",
                    sinDatos ? "bg-[var(--aviso)] text-[#16120a] border-transparent" : "bg-card/60 border-border")}>
                    <div className="min-w-0 flex items-baseline gap-3">
                        <span className="text-[22px] font-bold truncate">{valor.barrio}</span>
                        {titulo && <span className={cn("text-[18px] font-semibold truncate", sinDatos ? "opacity-80" : "text-muted-foreground")}>· {titulo}</span>}
                    </div>
                    <div className={cn("ml-auto flex items-center gap-2 text-[14px] lg:text-[16px] font-bold uppercase tracking-[0.12em] whitespace-nowrap", !sinDatos && (reconectando ? "text-[var(--aviso-texto)]" : "text-[var(--bien-texto)]"))}>
                        {sinDatos ? <><AlertTriangle size={22} /> Sin datos hace {minutosSin} min</>
                            : reconectando ? <><RefreshCw size={18} className="animate-spin" /> Reconectando</>
                                : <><span className="h-3 w-3 rounded-full bg-[var(--bien)] animate-pulse" /> En vivo</>}
                    </div>
                    <div className="flex items-baseline gap-3 tabular-nums">
                        <span className={cn("hidden lg:inline text-[16px] capitalize whitespace-nowrap", sinDatos ? "opacity-80" : "text-muted-foreground")} suppressHydrationWarning>{montado ? fecha : ""}</span>
                        <span className="text-[26px] lg:text-[30px] font-bold leading-none" suppressHydrationWarning>{montado ? hora : "--:--:--"}</span>
                    </div>
                    <div className={cn("flex items-center gap-1 transition-opacity duration-300", quieto && !tactil ? "opacity-0" : "opacity-100")}>
                        <button onClick={alternarSilencio} title={silencio ? "Activar sonido" : "Silenciar esta pantalla"} aria-label={silencio ? "Activar sonido" : "Silenciar"}
                            className={cn("grid place-items-center rounded-xl hover:bg-accent active:scale-95 active:bg-accent transition-transform duration-150", tactil ? "h-12 w-12" : "h-10 w-10")}>{silencio ? <VolumeX size={tactil ? 24 : 20} /> : <Volume2 size={tactil ? 24 : 20} />}</button>
                        <button onClick={alternarLleno} title={lleno ? "Salir de pantalla completa" : "Pantalla completa"} aria-label="Pantalla completa"
                            className={cn("grid place-items-center rounded-xl hover:bg-accent active:scale-95 active:bg-accent transition-transform duration-150", tactil ? "h-12 w-12" : "h-10 w-10")}>{lleno ? <Minimize2 size={tactil ? 24 : 20} /> : <Maximize2 size={tactil ? 24 : 20} />}</button>
                    </div>
                </header>
                {bloqueado && !silencio && (
                    <div className="shrink-0 bg-[var(--info-suave)] text-[var(--info-texto)] text-[15px] font-semibold text-center py-1.5">Tocá la pantalla para habilitar el sonido y la pantalla completa</div>
                )}
                <main className="flex-1 min-h-0 relative overflow-y-auto overscroll-contain">{children}</main>
                {!conectado && (
                    <div className="fixed bottom-4 left-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border text-[14px] text-muted-foreground"><WifiOff size={16} /> Sin conexión en vivo: se actualiza por consulta</div>
                )}
            </div>
        </Ctx.Provider>
    );
}
