"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, CircleCheck, CircleSlash, Loader2, Trash2, Undo2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CAJA_MIN, type Caja, type ClaseResumen, type FotoFila } from "@/lib/detector-propio";

/**
 * Dibujar recuadros sobre una foto, para el detector propio. La misma ventana sin bordes que el
 * etiquetado rápido: la foto grande, los botones encima, y el teclado para ir rápido.
 *
 *  · Arrastrar sobre la foto dibuja un recuadro de la clase elegida (1-9 la cambian).
 *  · Tocar un recuadro lo elige; Supr lo borra. Z deshace.
 *  · Enter guarda y pasa a la siguiente. Sin recuadros, Enter NO guarda: «acá no hay ninguno»
 *    es una decisión (N), no un Enter apretado de más — una negativa falsa le enseña al
 *    detector que el objeto que estaba ahí es fondo.
 *  · ← → se mueven entre fotos guardando lo que cambió.
 *
 * Un recuadro va AJUSTADO al objeto, entero aunque esté tapado en parte, y uno por objeto: tres
 * conos son tres recuadros. Lo dice la ayuda de abajo, porque es lo que más arruina un conjunto.
 */
export function Anotador({ fotos, inicio, clases, alGuardar, alBorrar, alCerrar }: {
    fotos: FotoFila[]; inicio: number; clases: ClaseResumen[];
    alGuardar: (id: string, cajas: Caja[]) => Promise<FotoFila | null>;
    alBorrar: (id: string) => Promise<boolean>;
    alCerrar: () => void;
}) {
    const [i, setI] = useState(inicio);
    const f = fotos[i];
    const [cajas, setCajas] = useState<Caja[]>(f?.cajas || []);
    const [historia, setHistoria] = useState<Caja[][]>([]);
    const [clase, setClase] = useState(clases[0]?.id || "");
    const [elegida, setElegida] = useState<number | null>(null);
    const [trazo, setTrazo] = useState<[number, number, number, number] | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [aviso, setAviso] = useState<string | null>(null);
    const [sucia, setSucia] = useState(false);
    const imgRef = useRef<HTMLImageElement>(null);
    const nombre = (id: string) => clases.find((c) => c.id === id)?.nombre || "?";

    useEffect(() => { setCajas(fotos[i]?.cajas || []); setHistoria([]); setElegida(null); setSucia(false); setAviso(null); }, [i, fotos]);
    useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 2600); return () => clearTimeout(t); }, [aviso]);

    const cambiar = (n: Caja[]) => { setHistoria((h) => [...h.slice(-30), cajas]); setCajas(n); setSucia(true); };

    const ir = useCallback(async (destino: number) => {
        if (destino < 0 || destino >= fotos.length) { if (destino >= fotos.length) alCerrar(); return; }
        // Moverse guarda lo que cambió. Si quedó vacía no se adivina: eso lo decide «No hay ninguno».
        if (sucia && !cajas.length) { setAviso("Quedó sin recuadros: si no hay ninguno tocá «No hay ninguno» (N); si no, Z deshace."); return; }
        if (sucia) { setGuardando(true); const r = await alGuardar(f.id, cajas); setGuardando(false); if (!r) return; }
        setI(destino);
    }, [fotos.length, sucia, cajas, f, alGuardar, alCerrar]);

    const guardar = useCallback(async (negativa = false) => {
        if (!f || guardando) return;
        if (!negativa && !cajas.length) { setAviso("Sin recuadros no se guarda: si no hay ninguno, tocá «No hay ninguno» (N)."); return; }
        setGuardando(true);
        const r = await alGuardar(f.id, negativa ? [] : cajas);
        setGuardando(false);
        if (r) { setSucia(false); if (i + 1 < fotos.length) setI(i + 1); else alCerrar(); }
    }, [f, guardando, cajas, alGuardar, i, fotos.length, alCerrar]);

    useEffect(() => {
        const tecla = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement)?.tagName === "INPUT") return;
            const n = Number(e.key);
            if (n >= 1 && n <= 9 && clases[n - 1]) { setClase(clases[n - 1].id); if (elegida != null) cambiar(cajas.map((c, k) => (k === elegida ? { ...c, clase: clases[n - 1].id } : c))); }
            else if (e.key === "Enter") { e.preventDefault(); guardar(false); }
            else if (e.key === "n" || e.key === "N") guardar(true);
            else if (e.key === "ArrowRight") ir(i + 1);
            else if (e.key === "ArrowLeft") ir(i - 1);
            else if ((e.key === "Delete" || e.key === "Backspace") && elegida != null) { cambiar(cajas.filter((_, k) => k !== elegida)); setElegida(null); }
            else if (e.key === "z" || e.key === "Z") { setHistoria((h) => { if (!h.length) return h; setCajas(h[h.length - 1]); setSucia(true); return h.slice(0, -1); }); }
        };
        window.addEventListener("keydown", tecla);
        return () => window.removeEventListener("keydown", tecla);
    });

    const punto = (e: React.PointerEvent) => {
        const r = imgRef.current!.getBoundingClientRect();
        return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] as const;
    };
    const bajar = (e: React.PointerEvent) => {
        if (!clase) { setAviso("Primero creá una clase."); return; }
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const [x, y] = punto(e); setTrazo([x, y, x, y]); setElegida(null);
    };
    const mover = (e: React.PointerEvent) => { if (!trazo) return; const [x, y] = punto(e); setTrazo([trazo[0], trazo[1], x, y]); };
    const soltar = () => {
        if (!trazo) return;
        const [a, b, c, d] = trazo;
        setTrazo(null);
        if (Math.abs(c - a) < CAJA_MIN || Math.abs(d - b) < CAJA_MIN) return;  // un clic suelto
        cambiar([...cajas, { clase, caja: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)] }]);
        setElegida(cajas.length);
    };

    if (!f) return null;
    const rect = (k: [number, number, number, number]) => ({ left: `${Math.min(k[0], k[2]) * 100}%`, top: `${Math.min(k[1], k[3]) * 100}%`, width: `${Math.abs(k[2] - k[0]) * 100}%`, height: `${Math.abs(k[3] - k[1]) * 100}%` });
    const vidrio = "bg-black/55 backdrop-blur-md border border-white/15 text-white";

    return (
        <Dialog open onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <DialogContent showCloseButton={false} className="sm:max-w-[min(1500px,96vw)] w-[96vw] p-0 gap-0 border-0 bg-transparent shadow-none overflow-visible">
                <DialogTitle className="sr-only">Dibujar recuadros</DialogTitle>
                <DialogDescription className="sr-only">Arrastrá sobre la foto para marcar cada objeto.</DialogDescription>
                <motion.div initial={{ opacity: 0, scale: 0.97, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 240, damping: 24 }}
                    className="relative rounded-[14px] overflow-hidden bg-black shadow-[0_24px_80px_-12px_rgba(0,0,0,0.75)] grid place-items-center min-h-[60vh]">
                    <div className="relative select-none touch-none my-16" onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} style={{ cursor: "crosshair" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img ref={imgRef} src={f.url} alt="" draggable={false} className="block max-h-[calc(86vh-128px)] max-w-[94vw] w-auto h-auto" />
                        {cajas.map((c, k) => (
                            <button key={k} type="button" onPointerDown={(e) => { e.stopPropagation(); setElegida(k); }} style={rect(c.caja)}
                                className={cn("absolute rounded-[3px] border-2 transition-colors", k === elegida ? "border-white bg-white/10" : c.clase === clase ? "border-[var(--accion-en-oscuro,#60a5fa)]" : "border-[var(--accion-en-oscuro,#60a5fa)] border-dashed")}>
                                <span className={cn("absolute -top-6 left-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", k === elegida ? "bg-white text-black" : "bg-[var(--accion)] text-white")}>{nombre(c.clase)}</span>
                                {k === elegida && (
                                    <span role="button" onPointerDown={(e) => { e.stopPropagation(); cambiar(cajas.filter((_, j) => j !== k)); setElegida(null); }}
                                        className="absolute -top-3 -right-3 grid place-items-center h-6 w-6 rounded-full bg-white text-black shadow"><X size={13} /></span>
                                )}
                            </button>
                        ))}
                        {trazo && <span className="absolute border-2 border-white border-dashed rounded-[3px] pointer-events-none" style={rect(trazo)} />}
                    </div>

                    {/* Arriba: las clases (1-9) y cerrar. */}
                    <div className="absolute top-3 inset-x-3 flex items-start gap-2">
                        <div className="flex flex-wrap gap-1.5">
                            {clases.map((c, k) => (
                                <button key={c.id} type="button" onClick={() => { setClase(c.id); if (elegida != null) cambiar(cajas.map((x, j) => (j === elegida ? { ...x, clase: c.id } : x))); }}
                                    className={cn("h-8 pl-1 pr-3 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors", clase === c.id ? "bg-[var(--accion)] text-white" : vidrio)}>
                                    <span className={cn("grid place-items-center h-6 w-6 rounded-full text-[11px] font-bold tabular-nums", clase === c.id ? "bg-white/25" : "bg-white/15")}>{k + 1}</span>{c.nombre}
                                </button>
                            ))}
                        </div>
                        <span className={cn("ml-auto h-8 px-3 rounded-full inline-flex items-center text-[12px] font-semibold tabular-nums", vidrio)}>{i + 1} / {fotos.length}{f.camara ? ` · ${f.camara}` : ""}</span>
                        <button type="button" onClick={alCerrar} aria-label="Cerrar" className={cn("h-8 w-8 grid place-items-center rounded-full", vidrio)}><X size={16} /></button>
                    </div>

                    {/* Abajo: moverse, deshacer, borrar la foto, «no hay ninguno» y guardar. */}
                    <div className="absolute bottom-3 inset-x-3 flex items-center gap-2 flex-wrap">
                        <button type="button" onClick={() => ir(i - 1)} disabled={i === 0} aria-label="Anterior" className={cn("h-10 w-10 grid place-items-center rounded-full disabled:opacity-30", vidrio)}><ChevronLeft size={18} /></button>
                        <button type="button" onClick={() => ir(i + 1)} aria-label="Siguiente" className={cn("h-10 w-10 grid place-items-center rounded-full", vidrio)}><ChevronRight size={18} /></button>
                        <button type="button" onClick={() => { if (historia.length) { setCajas(historia[historia.length - 1]); setHistoria((h) => h.slice(0, -1)); setSucia(true); } }} disabled={!historia.length}
                            className={cn("h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-[12.5px] font-semibold disabled:opacity-30", vidrio)}><Undo2 size={15} /> Deshacer <kbd className="opacity-60 text-[10.5px]">Z</kbd></button>
                        <button type="button" onClick={async () => { if (await alBorrar(f.id)) { if (i >= fotos.length - 1) alCerrar(); } }}
                            className={cn("h-10 px-3 rounded-full inline-flex items-center gap-1.5 text-[12.5px] font-semibold", vidrio)} title="La foto no sirve (borrosa, repetida): se saca del conjunto"><Trash2 size={15} /> Descartar foto</button>
                        <span className="ml-auto" />
                        <button type="button" onClick={() => guardar(true)} disabled={guardando}
                            className={cn("h-10 px-4 rounded-full inline-flex items-center gap-1.5 text-[13px] font-semibold", vidrio)}><CircleSlash size={15} /> No hay ninguno <kbd className="opacity-60 text-[10.5px]">N</kbd></button>
                        <button type="button" onClick={() => guardar(false)} disabled={guardando || !cajas.length}
                            className="h-10 px-4 rounded-full inline-flex items-center gap-1.5 text-[13px] font-semibold bg-[var(--accion)] text-white disabled:opacity-40">
                            {guardando ? <Loader2 size={15} className="animate-spin" /> : <CircleCheck size={15} />} Guardar {cajas.length ? `${cajas.length} recuadro${cajas.length === 1 ? "" : "s"}` : ""} <kbd className="opacity-70 text-[10.5px]">Enter</kbd>
                        </button>
                    </div>

                    <AnimatePresence>
                        {aviso && (
                            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                                className={cn("absolute bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-[12.5px] font-semibold", vidrio)}>{aviso}</motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
                <p className="text-center text-[11.5px] text-white/70 mt-2">Arrastrá para marcar. El recuadro, ajustado y con el objeto entero aunque esté tapado; uno por objeto. 1-9 cambia la clase, Supr borra el elegido.</p>
            </DialogContent>
        </Dialog>
    );
}
