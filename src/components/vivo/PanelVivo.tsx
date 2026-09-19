"use client";

import {
    createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { Minus, Pin, PinOff, Radio, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { montarVivo } from "@/lib/vivo";

/**
 * Las cámaras fijadas: ventanas de video que sobreviven a cambiar de pantalla.
 *
 * El vivo del mapa está atado al mapa: la burbuja cuelga del marcador de la cámara y
 * desaparece al irse de `/admin/mapa`. Está bien para mirar dónde pasa algo, y está mal
 * para lo que un puesto de guardia hace de verdad, que es dejar una cámara puesta mientras
 * trabaja en otra pantalla. Cortar el RTSP al navegar no es un detalle: volver a abrirlo
 * cuesta unos segundos de negro, y el momento que se quería ver ya pasó.
 *
 * Por eso esto vive en el ARMAZÓN de `/admin`, no en la pantalla del mapa. El `layout` de
 * Next no se desmonta al cambiar de ruta, así que el mismo elemento `<video>` sigue ahí,
 * con su flujo abierto, mientras abajo cambia la página. Montarlo en cada pantalla — o en
 * un portal creado por la pantalla — no alcanza: el portal muere con quien lo creó.
 *
 * Posición, tamaño y qué está fijado se guardan en el navegador. Es a propósito: esto es
 * la disposición del escritorio de un puesto, no una configuración del barrio. El puesto
 * de la entrada y el del fondo miran cosas distintas, y hacer que uno le mueva la ventana
 * al otro sería un error, no una función.
 */

const LLAVE = "omni.vivo.fijadas";
const ANCHO_MIN = 200;
const ANCHO_MAX = 900;
const PROPORCION = 16 / 9;

export type Fijada = {
    deviceId: string;
    nombre: string;
    x: number;
    y: number;
    ancho: number;
    minimizada?: boolean;
};

type Ctx = {
    fijadas: Fijada[];
    fijar: (deviceId: string, nombre: string) => void;
    soltar: (deviceId: string) => void;
    esFija: (deviceId: string) => boolean;
};

const VivoCtx = createContext<Ctx>({ fijadas: [], fijar: () => { }, soltar: () => { }, esFija: () => false });

export const useVivo = () => useContext(VivoCtx);

function leer(): Fijada[] {
    try {
        const s = localStorage.getItem(LLAVE);
        const v = s ? JSON.parse(s) : [];
        return Array.isArray(v) ? v.filter((f) => f?.deviceId) : [];
    } catch { return []; }
}

export function VivoProvider({ children }: { children: React.ReactNode }) {
    const [fijadas, setFijadas] = useState<Fijada[]>([]);
    const [listo, setListo] = useState(false);

    // Se lee después de montar: en el servidor no hay `localStorage`, y leerlo durante el
    // primer render haría que lo que pinta el servidor y lo que pinta el navegador no
    // coincidan.
    useEffect(() => { setFijadas(leer()); setListo(true); }, []);

    useEffect(() => {
        if (!listo) return;
        try { localStorage.setItem(LLAVE, JSON.stringify(fijadas)); } catch { }
    }, [fijadas, listo]);

    const fijar = useCallback((deviceId: string, nombre: string) => {
        setFijadas((prev) => {
            if (prev.some((f) => f.deviceId === deviceId)) return prev;
            // Cada una entra un poco más abajo y a la derecha que la anterior: apiladas en
            // el mismo punto parecen una sola.
            const n = prev.length;
            return [...prev, {
                deviceId, nombre,
                x: 24 + (n % 5) * 28,
                y: 96 + (n % 5) * 28,
                ancho: 288,
            }];
        });
    }, []);

    const soltar = useCallback((deviceId: string) => {
        setFijadas((prev) => prev.filter((f) => f.deviceId !== deviceId));
    }, []);

    const esFija = useCallback((deviceId: string) => fijadas.some((f) => f.deviceId === deviceId), [fijadas]);

    const mover = useCallback((deviceId: string, cambio: Partial<Fijada>) => {
        setFijadas((prev) => prev.map((f) => (f.deviceId === deviceId ? { ...f, ...cambio } : f)));
    }, []);

    return (
        <VivoCtx.Provider value={{ fijadas, fijar, soltar, esFija }}>
            {children}
            {listo && <Ventanas fijadas={fijadas} mover={mover} soltar={soltar} />}
        </VivoCtx.Provider>
    );
}

function Ventanas({ fijadas, mover, soltar }: {
    fijadas: Fijada[];
    mover: (id: string, c: Partial<Fijada>) => void;
    soltar: (id: string) => void;
}) {
    const [montado, setMontado] = useState(false);
    useEffect(() => setMontado(true), []);
    if (!montado || !fijadas.length) return null;

    return createPortal(
        <div className="fixed inset-0 z-[3000] pointer-events-none">
            {fijadas.map((f) => <Ventana key={f.deviceId} f={f} mover={mover} soltar={soltar} />)}
        </div>,
        document.body,
    );
}

function Ventana({ f, mover, soltar }: {
    f: Fijada;
    mover: (id: string, c: Partial<Fijada>) => void;
    soltar: (id: string) => void;
}) {
    const video = useRef<HTMLVideoElement | null>(null);
    const caja = useRef<HTMLDivElement | null>(null);
    const gesto = useRef<{ clase: "mover" | "medir"; x: number; y: number; px: number; py: number; pa: number } | null>(null);
    const [activo, setActivo] = useState(false);

    /**
     * El flujo se monta UNA vez, por `deviceId`.
     *
     * No depende de la posición ni del tamaño: si dependiera, arrastrar la ventana
     * reiniciaría el video en cada píxel. Es el mismo motivo por el que esto vive en el
     * armazón y no en la pantalla.
     */
    useEffect(() => {
        const v = video.current;
        if (!v) return;
        return montarVivo(v, f.deviceId);
    }, [f.deviceId]);

    // Al volver de otra pantalla o de otra pestaña, algunos navegadores dejan el video
    // pausado. Se lo vuelve a pedir, que es gratis si ya está andando.
    useEffect(() => {
        const despertar = () => { if (!document.hidden) video.current?.play().catch(() => { }); };
        document.addEventListener("visibilitychange", despertar);
        return () => document.removeEventListener("visibilitychange", despertar);
    }, []);

    // Que una ventana no quede fuera de la pantalla cuando se achica la ventana del
    // navegador: si queda afuera, no hay forma de traerla de vuelta.
    useLayoutEffect(() => {
        const acomodar = () => {
            const alto = f.ancho / PROPORCION + 30;
            const x = Math.max(0, Math.min(window.innerWidth - 80, f.x));
            const y = Math.max(0, Math.min(window.innerHeight - 40, f.y));
            const ancho = Math.min(f.ancho, Math.max(ANCHO_MIN, window.innerWidth - 32));
            if (x !== f.x || y !== f.y || ancho !== f.ancho) mover(f.deviceId, { x, y, ancho });
            void alto;
        };
        acomodar();
        window.addEventListener("resize", acomodar);
        return () => window.removeEventListener("resize", acomodar);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [f.x, f.y, f.ancho]);

    const empezar = (clase: "mover" | "medir") => (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        gesto.current = { clase, x: e.clientX, y: e.clientY, px: f.x, py: f.y, pa: f.ancho };
    };

    const seguir = (e: React.PointerEvent) => {
        const g = gesto.current;
        if (!g) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (g.clase === "mover") {
            mover(f.deviceId, {
                x: Math.max(0, Math.min(window.innerWidth - 80, g.px + dx)),
                y: Math.max(0, Math.min(window.innerHeight - 40, g.py + dy)),
            });
        } else {
            // Se mide por el ancho y el alto sale de la proporción: un video estirado a
            // mano se ve mal y no aporta nada.
            mover(f.deviceId, { ancho: Math.max(ANCHO_MIN, Math.min(ANCHO_MAX, g.pa + dx)) });
        }
    };

    const soltarGesto = () => { gesto.current = null; };

    const alto = Math.round(f.ancho / PROPORCION);

    return (
        <div
            ref={caja}
            onPointerMove={seguir}
            onPointerUp={soltarGesto}
            onPointerCancel={soltarGesto}
            onMouseEnter={() => setActivo(true)}
            onMouseLeave={() => setActivo(false)}
            style={{ left: f.x, top: f.y, width: f.ancho }}
            className="absolute pointer-events-auto rounded-xl overflow-hidden border border-white/15 bg-[#0a0d12] shadow-2xl shadow-black/70 select-none">

            <div className="relative bg-black" style={{ height: f.minimizada ? 0 : alto }}>
                <video ref={video} muted autoPlay playsInline
                    className="block w-full h-full object-cover" />

                {/* ── LOS CONTROLES, ESCONDIDOS ──────────────────────────────────
                    Aparecen al pasar el mouse y se van solos. Una ventana de video
                    chica con una barra de botones permanente es media ventana de
                    botones; lo que se vino a ver es la imagen. */}
                <div className={cn(
                    "absolute inset-x-0 top-0 flex items-center gap-1 px-1.5 py-1.5 transition-opacity duration-150",
                    "bg-gradient-to-b from-black/85 to-transparent",
                    activo ? "opacity-100" : "opacity-0",
                )}>
                    {/* Toda la franja de arriba es el agarre: es lo que uno intenta
                        primero, antes de buscar un botón para arrastrar. */}
                    <div onPointerDown={empezar("mover")}
                        className="flex-1 flex items-center gap-1.5 min-w-0 cursor-grab active:cursor-grabbing">
                        <Radio size={10} className="text-red-400 shrink-0 animate-pulse" />
                        <span className="text-[11px] font-bold text-white truncate">{f.nombre}</span>
                    </div>
                    <button onClick={() => mover(f.deviceId, { minimizada: !f.minimizada })}
                        title={f.minimizada ? "Mostrar la imagen" : "Plegar a la barra de título"}
                        className="w-6 h-6 rounded text-white/70 hover:text-white hover:bg-white/15 flex items-center justify-center shrink-0 transition-colors">
                        {f.minimizada ? <Square size={11} /> : <Minus size={12} />}
                    </button>
                    <button onClick={() => soltar(f.deviceId)}
                        title="Soltar esta cámara"
                        className="w-6 h-6 rounded text-white/70 hover:text-white hover:bg-rose-500/60 flex items-center justify-center shrink-0 transition-colors">
                        <X size={12} />
                    </button>
                </div>

                {/* El agarre para medir. También escondido: sale al acercarse. */}
                <div onPointerDown={empezar("medir")}
                    title="Cambiar el tamaño"
                    className={cn(
                        "absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize transition-opacity duration-150",
                        activo ? "opacity-60 hover:opacity-100" : "opacity-0",
                    )}>
                    <span className="absolute bottom-1 right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-white rounded-br-[3px]" />
                </div>
            </div>

            {/* Plegada, la ventana es solo su barra: sigue con el flujo abierto y ocupa
                el alto de un renglón. Cerrarla es otra cosa y tiene su propio botón. */}
            {f.minimizada && (
                <div onPointerDown={empezar("mover")}
                    className="flex items-center gap-1.5 px-2 py-1.5 cursor-grab active:cursor-grabbing">
                    <Radio size={10} className="text-red-400 shrink-0 animate-pulse" />
                    <span className="text-[11px] font-bold text-white truncate flex-1">{f.nombre}</span>
                    <button onClick={() => mover(f.deviceId, { minimizada: false })}
                        className="w-5 h-5 rounded text-white/60 hover:text-white hover:bg-white/15 flex items-center justify-center"><Square size={10} /></button>
                    <button onClick={() => soltar(f.deviceId)}
                        className="w-5 h-5 rounded text-white/60 hover:text-white hover:bg-rose-500/60 flex items-center justify-center"><X size={11} /></button>
                </div>
            )}
        </div>
    );
}

/** El botón de fijar, para usar dentro de una burbuja del mapa. */
export function BotonFijar({ deviceId, nombre, className }: { deviceId: string; nombre: string; className?: string }) {
    const { fijar, soltar, esFija } = useVivo();
    const fija = esFija(deviceId);
    return (
        <button
            onClick={(e) => { e.stopPropagation(); fija ? soltar(deviceId) : fijar(deviceId, nombre); }}
            title={fija
                ? "Soltar: vuelve a colgar del marcador y se cierra al salir del mapa"
                : "Fijar: queda en pantalla y sigue abierta aunque cambies de página"}
            className={cn(
                "w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors",
                fija ? "text-sky-300 bg-sky-500/25" : "text-white/45 hover:text-white hover:bg-white/10",
                className,
            )}>
            {fija ? <PinOff size={11} /> : <Pin size={11} />}
        </button>
    );
}
