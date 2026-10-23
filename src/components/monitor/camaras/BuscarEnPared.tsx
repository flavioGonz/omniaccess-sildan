"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { AnimatePresence, motion } from "framer-motion";
import { Backpack, Camera, Car, ChevronLeft, Loader2, PawPrint, RefreshCw, ScanSearch, Smartphone, User, VideoOff, X } from "lucide-react";
import { BuscarParecidos, type RutasParecidos } from "@/components/visor/BuscarParecidos";
import { fotoDe, type Canal } from "@/components/monitor/camaras/piezas";
import { cn } from "@/lib/utils";

/**
 * «Buscar parecidos» en la pared de Cámaras (openspec pared-vms, 23/10, Nico: «el monitor de
 * cámaras debe, para los operarios en el wall, poder buscar parecidos; debe preguntar antes:
 * Objeto, Persona, Vehículo, Animal. Buscar mediante foto capturada de una escena, o por QR,
 * subir una foto de un celular»).
 *
 * Tres pasos, como una app que se navega dentro de la pared:
 *   1. QUÉ: cuatro tarjetas grandes (se toca desde lejos o en una pantalla táctil).
 *   2. DE DÓNDE: el cuadro de un canal de la pared, o una foto del celular (QR).
 *   3. La búsqueda misma: la del visor (BuscarParecidos), con la clase elegida y las rutas de la
 *      pared, que también abren a un enlace de pantalla.
 *
 * Abierto desde la ficha de un canal, el paso 2 ya está decidido: va directo a ese cuadro.
 *
 * Entrada y salida (Nico, 24/10: «estilizado, interactivo, splash animadas, entradas y salidas
 * cuidadas, premium»): la pared se desenfoca y se aleja un poco, y la búsqueda aparece encima
 * con escala y foco; cada paso entra desde la derecha y el anterior se corre a la izquierda;
 * volver hace lo contrario. Sin rebotes: es una herramienta de trabajo.
 */

type Clase = "objeto" | "persona" | "vehiculo" | "animal";
const CLASES: { id: Clase; nombre: string; texto: string; Ico: typeof User }[] = [
    { id: "persona", nombre: "Persona", texto: "Ropa, colores, lo que lleva", Ico: User },
    { id: "vehiculo", nombre: "Vehículo", texto: "Autos, motos, camiones; con su chapa", Ico: Car },
    { id: "objeto", nombre: "Objeto", texto: "Mochilas, bolsos, paquetes", Ico: Backpack },
    { id: "animal", nombre: "Animal", texto: "Perros, gatos, caballos", Ico: PawPrint },
];

/** El paso en que está la búsqueda. */
type Paso =
    | { id: "que" }
    | { id: "origen" }
    | { id: "qr" }
    | { id: "cuadro"; canal: Canal }
    | { id: "buscar"; foto: string; desde: string; instanteMs: number };

/** Cada cuánto pregunta la pared si llegó la foto del celular. */
const CONSULTA_QR_MS = 2000;
/** El ancho con que se pide el cuadro de un canal: alcanza para recortar una persona lejos. */
const ANCHO_CUADRO = 1920;

const RESORTE = { type: "spring" as const, stiffness: 380, damping: 34, mass: 0.85 };
const ADELANTE = { initial: { opacity: 0, x: 48, filter: "blur(6px)" }, animate: { opacity: 1, x: 0, filter: "blur(0px)" }, exit: { opacity: 0, x: -36, filter: "blur(4px)" } };
const ATRAS = { initial: { opacity: 0, x: -48, filter: "blur(6px)" }, animate: { opacity: 1, x: 0, filter: "blur(0px)" }, exit: { opacity: 0, x: 36, filter: "blur(4px)" } };

export function BuscarEnPared({ abierto, canales, canalInicial = null, rutas, alCerrar }: {
    abierto: boolean;
    /** Los canales de la pared que se pueden usar para sacar el cuadro (los de video, no las fuentes web). */
    canales: Canal[];
    /** Abierto desde la ficha de un canal: el cuadro sale de ése. */
    canalInicial?: Canal | null;
    rutas: RutasParecidos;
    alCerrar: () => void;
}) {
    const [clase, setClase] = useState<Clase | null>(null);
    const [paso, setPaso] = useState<Paso>({ id: "que" });
    const [atras, setAtras] = useState(false);
    const ir = useCallback((p: Paso, haciaAtras = false) => { setAtras(haciaAtras); setPaso(p); }, []);

    // Cada vez que se abre, desde el principio.
    useEffect(() => { if (abierto) { setClase(null); setAtras(false); setPaso({ id: "que" }); } }, [abierto]);

    // La foto en memoria (cuadro o celular) se suelta al salir del paso de búsqueda.
    const fotoActual = paso.id === "buscar" ? paso.foto : null;
    useEffect(() => () => { if (fotoActual?.startsWith("blob:")) URL.revokeObjectURL(fotoActual); }, [fotoActual]);

    const elegirClase = (c: Clase) => {
        setClase(c);
        if (canalInicial) ir({ id: "cuadro", canal: canalInicial }); else ir({ id: "origen" });
    };
    const volver = () => {
        if (paso.id === "origen") ir({ id: "que" }, true);
        else if (paso.id === "qr" || paso.id === "cuadro") ir(canalInicial ? { id: "que" } : { id: "origen" }, true);
        else if (paso.id === "buscar") ir(canalInicial ? { id: "que" } : { id: "origen" }, true);
    };

    // Esc: un paso atrás; en el primero, cerrar. En la búsqueda, Esc lo maneja ella (cierra su detalle, después vuelve).
    useEffect(() => {
        if (!abierto || paso.id === "buscar") return;
        // En captura y cortando: abierta desde la ficha de un canal, Esc no tiene que cerrar también la ficha.
        const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (paso.id === "que") alCerrar(); else volver(); } };
        window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
    }); // eslint-disable-line react-hooks/exhaustive-deps

    const c = CLASES.find((x) => x.id === clase) || null;

    return (
        <AnimatePresence>
            {abierto && (
                <motion.div key="buscar-en-pared" className="fixed inset-0 z-[3000] dark text-foreground"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.22 } }}>
                    {/* El velo: la pared queda detrás, desenfocada, para que se sepa de dónde se vino. */}
                    <motion.div aria-hidden className="absolute inset-0 bg-[rgba(4,6,10,.72)] backdrop-blur-[14px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={paso.id === "que" ? alCerrar : undefined} />
                    <motion.section role="dialog" aria-label="Buscar parecidos"
                        initial={{ opacity: 0, scale: 0.96, y: 18, filter: "blur(8px)" }} animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.97, y: 10, filter: "blur(6px)" }} transition={RESORTE}
                        className={cn("absolute overflow-hidden rounded-[18px] border border-white/10 bg-[#0b0e14]/95 shadow-[0_40px_120px_-30px_rgba(0,0,0,.9)] flex flex-col",
                            paso.id === "buscar" ? "inset-3 lg:inset-5" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(1080px,calc(100vw-32px))] h-[min(680px,calc(100dvh-32px))]")}>
                        {paso.id !== "buscar" && (
                            <header className="shrink-0 flex items-center gap-3 px-6 h-[64px] border-b border-white/[.07]">
                                <AnimatePresence initial={false}>
                                    {paso.id !== "que" && (
                                        <motion.button key="atras" type="button" onClick={volver} aria-label="Un paso atrás" title="Un paso atrás  ( Esc )"
                                            initial={{ opacity: 0, x: -8, width: 0 }} animate={{ opacity: 1, x: 0, width: 36 }} exit={{ opacity: 0, x: -8, width: 0 }} transition={RESORTE}
                                            className="h-9 rounded-full grid place-items-center text-white/80 hover:text-white hover:bg-white/10 shrink-0 overflow-hidden"><ChevronLeft size={20} /></motion.button>
                                    )}
                                </AnimatePresence>
                                <span className="grid place-items-center h-9 w-9 rounded-[11px] bg-[color-mix(in_oklab,var(--accion)_22%,transparent)] text-[var(--accion-en-oscuro)] shrink-0"><ScanSearch size={18} /></span>
                                <div className="min-w-0">
                                    <div className="text-[17px] font-bold tracking-[-0.01em] leading-tight">Buscar parecidos</div>
                                    <div className="text-[12.5px] text-white/55 leading-tight">En lo que registraron las cámaras</div>
                                </div>
                                {/* Lo elegido, como migas: se ve qué se está buscando y se vuelve tocándolo. */}
                                <div className="ml-4 flex items-center gap-1.5 min-w-0">
                                    <AnimatePresence initial={false}>
                                        {c && paso.id !== "que" && (
                                            <motion.button key={`miga-${c.id}`} type="button" onClick={() => ir({ id: "que" }, true)} title="Cambiar qué se busca"
                                                initial={{ opacity: 0, y: -6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.9 }} transition={RESORTE}
                                                className="h-8 pl-1 pr-3 rounded-full bg-white/[.07] border border-white/10 inline-flex items-center gap-1.5 text-[12.5px] font-semibold hover:bg-white/[.12]">
                                                <span className="grid place-items-center h-6 w-6 rounded-full bg-white/10"><c.Ico size={13} /></span>{c.nombre}
                                            </motion.button>
                                        )}
                                        {(paso.id === "qr" || paso.id === "cuadro") && (
                                            <motion.span key={`miga-${paso.id}`} initial={{ opacity: 0, y: -6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.9 }} transition={RESORTE}
                                                className="h-8 pl-1 pr-3 rounded-full bg-white/[.07] border border-white/10 inline-flex items-center gap-1.5 text-[12.5px] font-semibold min-w-0">
                                                <span className="grid place-items-center h-6 w-6 rounded-full bg-white/10 shrink-0">{paso.id === "qr" ? <Smartphone size={13} /> : <Camera size={13} />}</span>
                                                <span className="truncate">{paso.id === "qr" ? "Foto del celular" : paso.canal.nombre}</span>
                                            </motion.span>
                                        )}
                                    </AnimatePresence>
                                </div>
                                <button type="button" onClick={alCerrar} aria-label="Volver a la pared" title="Volver a la pared"
                                    className="ml-auto h-9 pl-3 pr-3.5 rounded-full inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/75 hover:text-white hover:bg-white/10"><X size={16} /> Volver a la pared</button>
                            </header>
                        )}

                        <div className="relative flex-1 min-h-0">
                            <AnimatePresence initial={false} mode="popLayout">
                                <motion.div key={paso.id === "cuadro" ? `cuadro-${paso.canal.clave}` : paso.id} className="absolute inset-0"
                                    {...(atras ? ATRAS : ADELANTE)} transition={RESORTE}>
                                    {paso.id === "que" && <PasoQue alElegir={elegirClase} />}
                                    {paso.id === "origen" && c && <PasoOrigen clase={c} canales={canales} alCanal={(canal) => ir({ id: "cuadro", canal })} alQr={() => ir({ id: "qr" })} />}
                                    {paso.id === "qr" && <PasoQr alLlegar={(foto) => ir({ id: "buscar", foto, desde: "Foto del celular", instanteMs: Date.now() })} />}
                                    {paso.id === "cuadro" && <PasoCuadro canal={paso.canal} alListo={(foto, ms) => ir({ id: "buscar", foto, desde: paso.canal.nombre, instanteMs: ms })} alQr={() => ir({ id: "qr" })} />}
                                    {paso.id === "buscar" && c && (
                                        <BuscarParecidos foto={paso.foto} instanteMs={paso.instanteMs} rutas={rutas} grupo={c.id}
                                            titulo={`Buscar ${c.nombre.toLowerCase()}`} subtitulo={paso.desde} textoCerrar="Volver a la pared" onCerrar={alCerrar} />
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </motion.section>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

/** Paso 1: qué se busca. */
function PasoQue({ alElegir }: { alElegir: (c: Clase) => void }) {
    return (
        <div className="h-full flex flex-col justify-center px-8 lg:px-14">
            <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...RESORTE, delay: 0.04 }}
                className="text-[30px] lg:text-[34px] font-bold tracking-[-0.025em] leading-[1.08]">¿Qué buscás?</motion.h2>
            <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...RESORTE, delay: 0.08 }}
                className="mt-2 text-[15px] text-white/60 max-w-[560px]">Elegilo primero: así la pared marca sólo eso en la imagen y los resultados son de esa clase.</motion.p>
            <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                {CLASES.map((c, i) => (
                    <motion.button key={c.id} type="button" onClick={() => alElegir(c.id)}
                        initial={{ opacity: 0, y: 22, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...RESORTE, delay: 0.1 + i * 0.05 }}
                        whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }}
                        className="group relative text-left rounded-[16px] p-5 lg:p-6 min-h-[200px] flex flex-col border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.02))] hover:border-[color-mix(in_oklab,var(--accion-en-oscuro)_70%,transparent)] transition-colors overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion-en-oscuro)]">
                        {/* El brillo que sigue a la tarjeta elegida: la única decoración, y sólo al pasar. */}
                        <span aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accion)_45%,transparent),transparent)] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        <span className="relative grid place-items-center h-14 w-14 rounded-[16px] bg-white/[.08] border border-white/10 text-white group-hover:bg-[var(--accion)] group-hover:border-transparent transition-colors duration-200">
                            <c.Ico size={26} />
                        </span>
                        <span className="relative mt-auto">
                            <span className="block text-[21px] font-bold tracking-[-0.015em]">{c.nombre}</span>
                            <span className="block mt-0.5 text-[13px] text-white/55 leading-snug">{c.texto}</span>
                        </span>
                    </motion.button>
                ))}
            </div>
        </div>
    );
}

/** Paso 2: de dónde sale la imagen. */
function PasoOrigen({ clase, canales, alCanal, alQr }: { clase: (typeof CLASES)[number]; canales: Canal[]; alCanal: (c: Canal) => void; alQr: () => void }) {
    const conImagen = canales.filter((c) => c.online !== false && fotoDe(c));
    return (
        <div className="h-full grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] min-h-0">
            <div className="min-h-0 flex flex-col px-7 pt-6 pb-5">
                <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={RESORTE} className="text-[24px] font-bold tracking-[-0.02em]">
                    ¿Dónde está {clase.id === "persona" ? "la persona" : clase.id === "vehiculo" ? "el vehículo" : clase.id === "animal" ? "el animal" : "el objeto"}?
                </motion.h2>
                <p className="mt-1 text-[14px] text-white/55">Tocá el canal: la pared congela lo que está mostrando y marca {clase.nombre === "Objeto" ? "los objetos" : `cada ${clase.nombre.toLowerCase()}`}.</p>
                <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
                    {conImagen.length ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
                            {conImagen.map((c, i) => (
                                <motion.button key={c.clave} type="button" onClick={() => alCanal(c)}
                                    initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...RESORTE, delay: Math.min(i, 12) * 0.025 }}
                                    whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
                                    className="group relative aspect-video rounded-[12px] overflow-hidden bg-black border border-white/10 hover:border-[var(--accion-en-oscuro)] transition-colors text-left">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={fotoDe(c, 320)!} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500" />
                                    <span className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,.8),transparent_55%)]" />
                                    <span className="absolute left-2.5 right-2.5 bottom-2 text-[12.5px] font-semibold text-white truncate [text-shadow:0_1px_6px_rgba(0,0,0,.6)]">{c.nombre}</span>
                                    <span className="absolute right-2 top-2 h-7 w-7 rounded-full grid place-items-center bg-[var(--accion)] text-white opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all"><Camera size={14} /></span>
                                </motion.button>
                            ))}
                        </div>
                    ) : (
                        <div className="h-full grid place-items-center text-center text-white/55 text-[14px]">
                            <div><VideoOff size={26} className="mx-auto mb-2 opacity-70" />Ningún canal de la pared tiene imagen ahora.<br />Usá la foto del celular.</div>
                        </div>
                    )}
                </div>
            </div>
            <motion.aside initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ ...RESORTE, delay: 0.06 }}
                className="border-t lg:border-t-0 lg:border-l border-white/[.07] p-6 flex flex-col">
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/45">O desde afuera</div>
                <button type="button" onClick={alQr}
                    className="group mt-3 flex-1 rounded-[16px] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.02))] hover:border-[var(--accion-en-oscuro)] transition-colors p-6 flex flex-col items-center justify-center text-center">
                    <motion.span className="grid place-items-center h-16 w-16 rounded-[18px] bg-[var(--accion)] text-white shadow-[0_18px_40px_-14px_var(--accion)]"
                        animate={{ y: [0, -4, 0] }} transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}>
                        <Smartphone size={28} />
                    </motion.span>
                    <span className="mt-4 text-[19px] font-bold tracking-[-0.01em]">Foto del celular</span>
                    <span className="mt-1 text-[13px] text-white/55 leading-snug">La pared muestra un QR; con el teléfono se saca o se elige la foto y llega sola.</span>
                </button>
            </motion.aside>
        </div>
    );
}

/** Paso 2b: el cuadro de un canal, congelado. Un destello de obturador y pasa a la búsqueda. */
function PasoCuadro({ canal, alListo, alQr }: { canal: Canal; alListo: (url: string, ms: number) => void; alQr: () => void }) {
    const [error, setError] = useState<string | null>(null);
    const [intento, setIntento] = useState(0);
    const listo = useRef(alListo); listo.current = alListo;
    useEffect(() => {
        const src = fotoDe(canal, ANCHO_CUADRO);
        if (!src) { setError("Este canal no entrega imagen."); return; }
        let vivo = true; setError(null);
        const ms = Date.now();
        fetch(`${src}${src.includes("?") ? "&" : "?"}t=${ms}`, { cache: "no-store" })
            .then(async (r) => { if (!r.ok) throw new Error(r.status === 404 ? "Este canal no tiene imagen ahora." : `El canal no contestó (${r.status}).`); return r.blob(); })
            .then((b) => { if (!b.size || !b.type.startsWith("image/")) throw new Error("Este canal no tiene imagen ahora."); if (vivo) setTimeout(() => vivo && listo.current(URL.createObjectURL(b), ms), 420); })
            .catch((e) => { if (vivo) setError(e?.message || "No se pudo sacar el cuadro."); });
        return () => { vivo = false; };
    }, [canal, intento]);
    return (
        <div className="h-full grid place-items-center px-8">
            <AnimatePresence mode="wait">
                {error ? (
                    <motion.div key="error" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={RESORTE} className="text-center max-w-[420px]">
                        <span className="mx-auto grid place-items-center h-16 w-16 rounded-full bg-white/[.07] text-white/70"><VideoOff size={26} /></span>
                        <p className="mt-4 text-[18px] font-semibold">{error}</p>
                        <div className="mt-6 flex items-center justify-center gap-2">
                            <button type="button" onClick={() => setIntento((x) => x + 1)} className="h-11 px-4 rounded-[12px] border border-white/15 inline-flex items-center gap-2 text-[14px] font-semibold hover:bg-white/10"><RefreshCw size={16} /> Probar de nuevo</button>
                            <button type="button" onClick={alQr} className="h-11 px-4 rounded-[12px] bg-[var(--accion)] text-white inline-flex items-center gap-2 text-[14px] font-semibold"><Smartphone size={16} /> Foto del celular</button>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div key="cargando" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative w-[min(720px,100%)] aspect-video rounded-[16px] overflow-hidden bg-black border border-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {fotoDe(canal, 640) && <img src={fotoDe(canal, 640)!} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />}
                        {/* El obturador: dos hojas que se cierran y abren, y un destello. Dice «sacando el cuadro» sin texto de más. */}
                        <motion.span className="absolute inset-x-0 top-0 h-1/2 bg-black origin-top" initial={{ scaleY: 0 }} animate={{ scaleY: [0, 1, 0] }} transition={{ duration: 0.42, times: [0, 0.5, 1], ease: "easeInOut" }} />
                        <motion.span className="absolute inset-x-0 bottom-0 h-1/2 bg-black origin-bottom" initial={{ scaleY: 0 }} animate={{ scaleY: [0, 1, 0] }} transition={{ duration: 0.42, times: [0, 0.5, 1], ease: "easeInOut" }} />
                        <motion.span className="absolute inset-0 bg-white" initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 0.55, 0] }} transition={{ duration: 0.6, times: [0, 0.45, 0.55, 1] }} />
                        <span className="absolute left-4 bottom-4 h-9 px-3.5 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white text-[13px] font-semibold inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Congelando {canal.nombre}…</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/** Paso 2c: el QR. Pide el código, lo dibuja y pregunta cada dos segundos si llegó la foto. */
function PasoQr({ alLlegar }: { alLlegar: (url: string) => void }) {
    const [codigo, setCodigo] = useState<{ id: string; url: string; qr: string; vence: number } | null>(null);
    const [estado, setEstado] = useState<"pidiendo" | "esperando" | "llego" | "vencido" | "error">("pidiendo");
    const [error, setError] = useState<string | null>(null);
    const [ahora, setAhora] = useState(Date.now());
    const [intento, setIntento] = useState(0);
    const [llegada, setLlegada] = useState<string | null>(null);
    const llegar = useRef(alLlegar); llegar.current = alLlegar;

    useEffect(() => {
        let vivo = true;
        setEstado("pidiendo"); setCodigo(null); setError(null);
        fetch("/api/monitor/camaras/subida", { method: "POST", cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`); return j; })
            .then(async (j) => {
                const url = `${window.location.origin}/subir/${j.token}`;
                const qr = await QRCode.toDataURL(url, { margin: 1, width: 520, errorCorrectionLevel: "M", color: { dark: "#0b0e14", light: "#ffffff" } });
                if (vivo) { setCodigo({ id: j.id, url, qr, vence: new Date(j.vence).getTime() }); setEstado("esperando"); }
            })
            .catch((e) => { if (vivo) { setError(e?.message || "No se pudo abrir el código"); setEstado("error"); } });
        return () => { vivo = false; };
    }, [intento]);

    // Preguntar si llegó, y el reloj del vencimiento.
    useEffect(() => {
        if (!codigo || estado !== "esperando") return;
        let vivo = true;
        const reloj = setInterval(() => setAhora(Date.now()), 1000);
        const preguntar = async () => {
            try {
                const r = await fetch(`/api/monitor/camaras/subida/${codigo.id}`, { cache: "no-store" });
                if (!vivo) return;
                if ((r.headers.get("content-type") || "").startsWith("image/")) {
                    const b = await r.blob();
                    if (!vivo) return;
                    setLlegada(URL.createObjectURL(b)); setEstado("llego");
                    return;
                }
                const j = await r.json().catch(() => ({}));
                if (j.estado === "vencido" || j.estado === "retirada") { setEstado("vencido"); return; }
            } catch { /* un corte de red: se vuelve a preguntar */ }
            if (vivo) t = setTimeout(preguntar, CONSULTA_QR_MS);
        };
        let t = setTimeout(preguntar, CONSULTA_QR_MS);
        return () => { vivo = false; clearInterval(reloj); clearTimeout(t); };
    }, [codigo, estado]);

    // Llegó: un instante para ver el tilde, y a la búsqueda. Aparte del efecto de arriba, que se
    // corta justamente al cambiar el estado.
    useEffect(() => {
        if (!llegada) return;
        const t = setTimeout(() => llegar.current(llegada), 700);
        return () => clearTimeout(t);
    }, [llegada]);

    const quedan = codigo ? Math.max(0, Math.round((codigo.vence - ahora) / 1000)) : 0;
    useEffect(() => { if (estado === "esperando" && codigo && quedan === 0) setEstado("vencido"); }, [quedan, estado, codigo]);

    return (
        <div className="h-full grid grid-cols-1 lg:grid-cols-[auto_minmax(0,1fr)] items-center gap-10 px-10 lg:px-14">
            {/* El anillo que gira alrededor del QR mientras espera: dice «estoy esperando» sin un spinner.
                Es un degradé cónico grande que gira DETRÁS de un marco de 3 px que lo recorta. */}
            <div className="relative mx-auto rounded-[28px] p-[3px] overflow-hidden bg-white/[.06]">
                <motion.span aria-hidden className="absolute left-1/2 top-1/2 w-[160%] aspect-square bg-[conic-gradient(from_0deg,transparent_0deg,var(--accion-en-oscuro)_60deg,transparent_140deg)]"
                    style={{ x: "-50%", y: "-50%" }}
                    animate={estado === "esperando" ? { rotate: 360, opacity: 1 } : { rotate: 0, opacity: estado === "llego" ? 0 : 0.35 }}
                    transition={estado === "esperando" ? { rotate: { duration: 2.6, repeat: Infinity, ease: "linear" } } : { duration: 0.3 }} />
                <div className="relative rounded-[24px] bg-white p-4 w-[300px] h-[300px] lg:w-[340px] lg:h-[340px] grid place-items-center overflow-hidden">
                    <AnimatePresence mode="wait">
                        {codigo && estado !== "vencido" && estado !== "error" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <motion.img key="qr" src={codigo.qr} alt={`QR para abrir ${codigo.url}`} className={cn("w-full h-full transition-[filter] duration-500", estado === "llego" && "blur-[3px] opacity-40")}
                                initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={RESORTE} />
                        ) : estado === "pidiendo" ? (
                            <motion.span key="pidiendo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Loader2 size={30} className="animate-spin text-[#0b0e14]/50" /></motion.span>
                        ) : (
                            <motion.button key="otro" type="button" onClick={() => setIntento((x) => x + 1)} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                                className="text-center text-[#0b0e14]">
                                <RefreshCw size={30} className="mx-auto" />
                                <span className="block mt-2 text-[15px] font-bold">{estado === "vencido" ? "El código venció" : "No se pudo abrir"}</span>
                                <span className="block text-[13px] opacity-60">Tocá para pedir otro</span>
                            </motion.button>
                        )}
                    </AnimatePresence>
                    <AnimatePresence>
                        {estado === "llego" && (
                            <motion.span className="absolute inset-0 grid place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 22 }}
                                    className="grid place-items-center h-20 w-20 rounded-full bg-[var(--bien)] text-white shadow-[0_0_0_12px_color-mix(in_oklab,var(--bien)_25%,transparent)]">
                                    <Smartphone size={32} />
                                </motion.span>
                            </motion.span>
                        )}
                    </AnimatePresence>
                </div>
            </div>
            <div className="min-w-0">
                <h2 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">{estado === "llego" ? "Llegó la foto" : "Escaneá con el celular"}</h2>
                <ol className="mt-5 space-y-3.5 text-[15px] text-white/75">
                    {["Abrí la cámara del teléfono y apuntá al código.", "Sacá la foto o elegila de la galería.", "Tocá «Mandar a la pared»: aparece acá sola."].map((t, i) => (
                        <motion.li key={i} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...RESORTE, delay: 0.08 + i * 0.06 }} className="flex items-start gap-3">
                            <span className="grid place-items-center h-7 w-7 rounded-full bg-white/[.08] border border-white/10 text-[13px] font-bold tabular-nums shrink-0">{i + 1}</span>
                            <span className="pt-0.5">{t}</span>
                        </motion.li>
                    ))}
                </ol>
                {error && <p className="mt-5 text-[13.5px] text-[var(--mal-texto)]">{error}</p>}
                {codigo && estado === "esperando" && (
                    <div className="mt-6 flex items-center gap-3 text-[13px] text-white/55">
                        <span className="relative flex h-2.5 w-2.5"><span className="absolute inset-0 rounded-full bg-[var(--accion-en-oscuro)] animate-ping opacity-60" /><span className="relative h-2.5 w-2.5 rounded-full bg-[var(--accion-en-oscuro)]" /></span>
                        Esperando la foto · vence en <span className="tabular-nums font-semibold text-white/80">{Math.floor(quedan / 60)}:{String(quedan % 60).padStart(2, "0")}</span>
                    </div>
                )}
                {codigo && estado === "esperando" && <div className="mt-2 text-[12px] text-white/35 break-all">{codigo.url.replace(/\/subir\/.{8}.*$/, "/subir/…")}</div>}
                <p className="mt-6 text-[12.5px] text-white/40 max-w-[440px]">El código sirve para una sola foto y vence a los 10 minutos. La foto no queda guardada: se usa para esta búsqueda.</p>
            </div>
        </div>
    );
}

/** Los canales de la pared que pueden dar un cuadro: los de video, sin repetir. */
export function canalesParaBuscar(lista: (Canal | null | undefined)[]): Canal[] {
    const vistos = new Set<string>(); const out: Canal[] = [];
    for (const c of lista) if (c && !vistos.has(c.clave) && fotoDe(c)) { vistos.add(c.clave); out.push(c); }
    return out;
}

