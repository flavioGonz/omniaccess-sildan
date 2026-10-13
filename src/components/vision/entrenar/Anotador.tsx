"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, CircleCheck, CircleSlash, Keyboard, Loader2, Trash2, Undo2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CAJA_MIN, type Caja, type ClaseResumen, type FotoFila } from "@/lib/detector-propio";

/**
 * Dibujar recuadros sobre una foto, para el detector propio.
 *
 * Rediseño del 13/10 (pedido de Nico: «estilizá la ventana, la accesibilidad de los controles,
 * cómo se dibuja el recuadro»). Lo que estaba mal y cómo quedó:
 *  · Los controles flotaban SOBRE la foto (vidrio negro arriba y abajo) y tapaban justo los
 *    bordes, donde suelen estar los objetos. Ahora la foto tiene su lienzo y nada la tapa: las
 *    clases y los recuadros van en una columna a la izquierda, las acciones en una barra abajo.
 *  · Todas las clases eran del mismo azul: con tres clases en una foto no se sabía cuál era cuál
 *    sin leer cada rótulo. Cada clase tiene su color (identidad, no estado: ver COLORES_CLASE).
 *  · Un recuadro mal dibujado sólo se podía borrar y volver a hacer. Ahora se ajusta: ocho asas
 *    para los bordes, arrastrar el cuerpo lo mueve, y las flechas lo corren de a un píxel
 *    (Mayús: de a diez).
 *  · Para dibujar ajustado hacían falta referencias: líneas guía que siguen al puntero y el
 *    tamaño en píxeles mientras se arrastra.
 *  · Marcar dos veces el mismo objeto (lo que de verdad arruina un conjunto: el detector
 *    aprende a ver dos donde hay uno) se rechaza — ver DUPLICADO_IOU.
 *
 * Lo que NO se prohíbe: que se toquen o se pisen recuadros de objetos DISTINTOS. Dos tachos uno
 * al lado del otro, o basura delante de un tacho, se tapan en la foto; sus recuadros se pisan
 * porque así es la escena (COCO, con lo que se entrenó el detector de fábrica, está lleno de
 * eso). Obligar a que no se pisen sería achicar recuadros a propósito, y eso le enseña que el
 * borde del objeto es fondo.
 *
 * Teclado: 1-9 clase · arrastrar dibuja · Enter guarda y sigue · N no hay ninguno · Z deshace ·
 * Supr borra el elegido · flechas mueven el elegido (o cambian de foto si no hay elegido) ·
 * Esc suelta el elegido.
 */

/**
 * Colores de IDENTIDAD de cada clase (la 1, la 2…), no de estado: por eso no salen de los cinco
 * tonos. Claros y saturados porque van sobre fotos (muchas de noche, en blanco y negro), y con
 * texto negro encima. Se reparten en orden fijo: la clase 1 es siempre azul.
 */
const COLORES_CLASE = ["#5AA9FF", "#FFB020", "#34D399", "#FB7185", "#C4B5FD", "#FDE047", "#22D3EE", "#FB923C", "#A3E635"];
/** Un recuadro nuevo que pisa a otro de la MISMA clase en más de esto es el mismo objeto marcado dos veces. */
const DUPLICADO_IOU = 0.6;
/** De distinta clase y casi el mismo recuadro: dos nombres para un objeto. Se avisa, no se impide. */
const MISMO_OBJETO_IOU = 0.85;
/** Cuánto corre una flecha (en píxeles de la foto); con Mayús, diez veces más. */
const PASO_PX = 1;

type C4 = [number, number, number, number];
type Asa = "n" | "s" | "e" | "o" | "ne" | "no" | "se" | "so";
type Arrastre =
    | { tipo: "nuevo"; desde: [number, number]; hasta: [number, number] }
    | { tipo: "mover"; k: number; desde: [number, number]; original: C4 }
    | { tipo: "asa"; k: number; asa: Asa; original: C4 };

const ASAS: { a: Asa; x: number; y: number; cursor: string }[] = [
    { a: "no", x: 0, y: 0, cursor: "nwse-resize" }, { a: "n", x: 0.5, y: 0, cursor: "ns-resize" }, { a: "ne", x: 1, y: 0, cursor: "nesw-resize" },
    { a: "e", x: 1, y: 0.5, cursor: "ew-resize" }, { a: "se", x: 1, y: 1, cursor: "nwse-resize" }, { a: "s", x: 0.5, y: 1, cursor: "ns-resize" },
    { a: "so", x: 0, y: 1, cursor: "nesw-resize" }, { a: "o", x: 0, y: 0.5, cursor: "ew-resize" },
];

const lim = (v: number) => Math.min(1, Math.max(0, v));
const orden = (k: C4): C4 => [Math.min(k[0], k[2]), Math.min(k[1], k[3]), Math.max(k[0], k[2]), Math.max(k[1], k[3])];
function iou(a: C4, b: C4) {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
    const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
    return u > 0 ? i / u : 0;
}

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
    const [arrastre, setArrastre] = useState<Arrastre | null>(null);
    const [puntero, setPuntero] = useState<[number, number] | null>(null);
    const [encima, setEncima] = useState<number | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [aviso, setAviso] = useState<{ t: string; tono: "mal" | "aviso" | "info" } | null>(null);
    const [sucia, setSucia] = useState(false);
    const [atajos, setAtajos] = useState(false);
    const imgRef = useRef<HTMLImageElement>(null);

    const colorDe = useCallback((id: string) => COLORES_CLASE[Math.max(0, clases.findIndex((c) => c.id === id)) % COLORES_CLASE.length], [clases]);
    const nombre = (id: string) => clases.find((c) => c.id === id)?.nombre || "?";
    const porClase = useMemo(() => Object.fromEntries(clases.map((c) => [c.id, cajas.filter((x) => x.clase === c.id).length])), [clases, cajas]);

    useEffect(() => { setCajas(fotos[i]?.cajas || []); setHistoria([]); setElegida(null); setSucia(false); setAviso(null); }, [i, fotos]);
    useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 3200); return () => clearTimeout(t); }, [aviso]);

    const cambiar = (n: Caja[]) => { setHistoria((h) => [...h.slice(-40), cajas]); setCajas(n); setSucia(true); };
    const deshacer = () => { if (!historia.length) return; setCajas(historia[historia.length - 1]); setHistoria((h) => h.slice(0, -1)); setSucia(true); setElegida(null); };

    const ir = useCallback(async (destino: number) => {
        if (destino < 0 || destino >= fotos.length) { if (destino >= fotos.length) alCerrar(); return; }
        // Moverse guarda lo que cambió. Si quedó vacía no se adivina: eso lo decide «No hay ninguno».
        if (sucia && !cajas.length) { setAviso({ t: "Quedó sin recuadros: si no hay ninguno tocá «No hay ninguno» (N); si no, Z deshace.", tono: "aviso" }); return; }
        if (sucia) { setGuardando(true); const r = await alGuardar(f.id, cajas); setGuardando(false); if (!r) return; }
        setI(destino);
    }, [fotos.length, sucia, cajas, f, alGuardar, alCerrar]);

    const guardar = useCallback(async (negativa = false) => {
        if (!f || guardando) return;
        if (!negativa && !cajas.length) { setAviso({ t: "Sin recuadros no se guarda: si no hay ninguno, tocá «No hay ninguno» (N).", tono: "aviso" }); return; }
        setGuardando(true);
        const r = await alGuardar(f.id, negativa ? [] : cajas);
        setGuardando(false);
        if (r) { setSucia(false); if (i + 1 < fotos.length) setI(i + 1); else alCerrar(); }
    }, [f, guardando, cajas, alGuardar, i, fotos.length, alCerrar]);

    const cambiarClase = (id: string) => {
        setClase(id);
        if (elegida != null && cajas[elegida] && cajas[elegida].clase !== id) cambiar(cajas.map((c, k) => (k === elegida ? { ...c, clase: id } : c)));
    };

    /** Correr el elegido con las flechas, en píxeles de la foto. */
    const correr = (dx: number, dy: number) => {
        if (elegida == null || !cajas[elegida] || !f) return;
        const [x1, y1, x2, y2] = cajas[elegida].caja as C4;
        const ddx = Math.max(-x1, Math.min(1 - x2, dx / (f.ancho || 1))), ddy = Math.max(-y1, Math.min(1 - y2, dy / (f.alto || 1)));
        cambiar(cajas.map((c, k) => (k === elegida ? { ...c, caja: [x1 + ddx, y1 + ddy, x2 + ddx, y2 + ddy] } : c)));
    };

    useEffect(() => {
        const tecla = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement)?.tagName === "INPUT") return;
            const n = Number(e.key);
            const paso = (e.shiftKey ? 10 : 1) * PASO_PX;
            if (n >= 1 && n <= 9 && clases[n - 1]) cambiarClase(clases[n - 1].id);
            else if (e.key === "Enter") { e.preventDefault(); guardar(false); }
            else if (e.key === "n" || e.key === "N") guardar(true);
            else if (e.key === "Escape" && elegida != null) { e.preventDefault(); e.stopPropagation(); setElegida(null); }
            else if (e.key.startsWith("Arrow") && elegida != null) {
                e.preventDefault();
                correr(e.key === "ArrowLeft" ? -paso : e.key === "ArrowRight" ? paso : 0, e.key === "ArrowUp" ? -paso : e.key === "ArrowDown" ? paso : 0);
            }
            else if (e.key === "ArrowRight") ir(i + 1);
            else if (e.key === "ArrowLeft") ir(i - 1);
            else if ((e.key === "Delete" || e.key === "Backspace") && elegida != null) { cambiar(cajas.filter((_, k) => k !== elegida)); setElegida(null); }
            else if (e.key === "z" || e.key === "Z") deshacer();
            else if (e.key === "?") setAtajos((x) => !x);
        };
        window.addEventListener("keydown", tecla, true);
        return () => window.removeEventListener("keydown", tecla, true);
    });

    const punto = (e: React.PointerEvent): [number, number] => {
        const r = imgRef.current!.getBoundingClientRect();
        return [lim((e.clientX - r.left) / r.width), lim((e.clientY - r.top) / r.height)];
    };

    const empezarNuevo = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        if (!clase) { setAviso({ t: "Primero creá una clase.", tono: "aviso" }); return; }
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const p = punto(e); setArrastre({ tipo: "nuevo", desde: p, hasta: p }); setElegida(null);
    };
    const empezarMover = (e: React.PointerEvent, k: number) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        setElegida(k); setClase(cajas[k].clase);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setArrastre({ tipo: "mover", k, desde: punto(e), original: cajas[k].caja as C4 });
    };
    const empezarAsa = (e: React.PointerEvent, k: number, asa: Asa) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setArrastre({ tipo: "asa", k, asa, original: cajas[k].caja as C4 });
    };

    /** La caja mientras se arrastra (sin tocar la historia hasta soltar). */
    const enCurso = (a: Arrastre, p: [number, number]): C4 => {
        if (a.tipo === "nuevo") return orden([a.desde[0], a.desde[1], p[0], p[1]]);
        const [x1, y1, x2, y2] = a.original;
        if (a.tipo === "mover") {
            const dx = Math.max(-x1, Math.min(1 - x2, p[0] - a.desde[0])), dy = Math.max(-y1, Math.min(1 - y2, p[1] - a.desde[1]));
            return [x1 + dx, y1 + dy, x2 + dx, y2 + dy];
        }
        let [a1, b1, a2, b2] = [x1, y1, x2, y2];
        if (a.asa.includes("n")) b1 = p[1];
        if (a.asa.includes("s")) b2 = p[1];
        if (a.asa.includes("o")) a1 = p[0];
        if (a.asa.includes("e")) a2 = p[0];
        return orden([a1, b1, a2, b2]);
    };

    const moverPuntero = (e: React.PointerEvent) => {
        const p = punto(e); setPuntero(p);
        if (!arrastre) return;
        if (arrastre.tipo === "nuevo") setArrastre({ ...arrastre, hasta: p });
        else setCajas((cs) => cs.map((c, k) => (k === arrastre.k ? { ...c, caja: enCurso(arrastre, p) } : c)));
    };

    const soltar = (e: React.PointerEvent) => {
        const a = arrastre; if (!a) return;
        setArrastre(null);
        const p = punto(e);
        if (a.tipo === "nuevo") {
            const k = orden([a.desde[0], a.desde[1], p[0], p[1]]);
            if (k[2] - k[0] < CAJA_MIN || k[3] - k[1] < CAJA_MIN) return;  // un clic suelto
            const igual = cajas.findIndex((c) => c.clase === clase && iou(c.caja as C4, k) >= DUPLICADO_IOU);
            if (igual >= 0) { setElegida(igual); setAviso({ t: `Ese ${nombre(clase).toLowerCase()} ya está marcado: un objeto, un recuadro. Para corregirlo, arrastrá sus bordes.`, tono: "mal" }); return; }
            const otro = cajas.findIndex((c) => c.clase !== clase && iou(c.caja as C4, k) >= MISMO_OBJETO_IOU);
            if (otro >= 0) setAviso({ t: `Casi el mismo recuadro que un «${nombre(cajas[otro].clase)}»: ¿es el mismo objeto con dos clases? Si es así, borrá uno.`, tono: "aviso" });
            cambiar([...cajas, { clase, caja: k }]);
            setElegida(cajas.length);
            return;
        }
        // Mover o ajustar: la historia guarda cómo estaba antes de arrastrar.
        const final = enCurso(a, p);
        if (final[2] - final[0] < CAJA_MIN || final[3] - final[1] < CAJA_MIN) { setCajas((cs) => cs.map((c, k) => (k === a.k ? { ...c, caja: a.original } : c))); return; }
        const otraIgual = cajas.findIndex((c, k) => k !== a.k && c.clase === cajas[a.k].clase && iou(c.caja as C4, final) >= DUPLICADO_IOU);
        if (otraIgual >= 0) {
            setCajas((cs) => cs.map((c, k) => (k === a.k ? { ...c, caja: a.original } : c)));
            setAviso({ t: "Así quedaría encima de otro de la misma clase: un objeto, un recuadro.", tono: "mal" });
            return;
        }
        if (final.some((v, j) => Math.abs(v - a.original[j]) > 1e-4)) {
            setHistoria((h) => [...h.slice(-40), cajas.map((c, k) => (k === a.k ? { ...c, caja: a.original } : c))]);
            setSucia(true);
        }
    };

    if (!f) return null;
    const rect = (k: C4) => ({ left: `${k[0] * 100}%`, top: `${k[1] * 100}%`, width: `${(k[2] - k[0]) * 100}%`, height: `${(k[3] - k[1]) * 100}%` });
    const nuevo = arrastre?.tipo === "nuevo" ? orden([arrastre.desde[0], arrastre.desde[1], arrastre.hasta[0], arrastre.hasta[1]]) : null;
    const px = (k: C4) => `${Math.round((k[2] - k[0]) * (f.ancho || 0))} × ${Math.round((k[3] - k[1]) * (f.alto || 0))} px`;
    const colorActivo = colorDe(clase);
    const guias = !arrastre && puntero && encima == null;
    const boton = "inline-flex items-center gap-1.5 rounded-[10px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion-en-oscuro)] disabled:opacity-35 disabled:pointer-events-none";
    const suave = "bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/10";

    return (
        <Dialog open onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <DialogContent showCloseButton={false} className="sm:max-w-[min(1640px,97vw)] w-[97vw] p-0 gap-0 border-0 bg-transparent shadow-none overflow-visible">
                <DialogTitle className="sr-only">Dibujar recuadros</DialogTitle>
                <DialogDescription className="sr-only">Arrastrá sobre la foto para marcar cada objeto. 1 a 9 elige la clase, Enter guarda y pasa a la siguiente, N si no hay ninguno.</DialogDescription>
                <motion.div initial={{ opacity: 0, scale: 0.98, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}
                    className="relative h-[92vh] rounded-[14px] overflow-hidden bg-[#0d0f12] text-white border border-white/10 [box-shadow:var(--sombra-flotante)] grid grid-rows-[56px_minmax(0,1fr)_68px]">

                    {/* ── Arriba: qué foto es y cuánto falta ── */}
                    <header className="flex items-center gap-3 px-4 border-b border-white/10">
                        <span className="text-[14px] font-bold">Dibujar</span>
                        <span className="text-[12.5px] text-white/60 tabular-nums">Foto {i + 1} de {fotos.length}{f.camara ? ` · ${f.camara}` : f.origen === "SUBIDA" ? " · subida" : ""}</span>
                        <span className="hidden md:block relative w-40 h-1 rounded-full bg-white/10 overflow-hidden" aria-hidden>
                            <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--accion-en-oscuro)] transition-all" style={{ width: `${((i + 1) / fotos.length) * 100}%` }} />
                        </span>
                        {sucia && <span className="text-[11.5px] text-[#FFB020] font-semibold">sin guardar</span>}
                        <span className="ml-auto" />
                        <button type="button" onClick={() => setAtajos((x) => !x)} aria-pressed={atajos} aria-label="Atajos de teclado" title="Atajos de teclado (?)" className={cn(boton, suave, "h-9 px-3 text-[12.5px]")}><Keyboard size={15} /> Atajos</button>
                        <button type="button" onClick={alCerrar} aria-label="Cerrar" title="Cerrar (Esc)" className={cn(boton, suave, "h-9 w-9 justify-center")}><X size={17} /></button>
                    </header>

                    <div className="grid grid-cols-1 md:grid-cols-[236px_minmax(0,1fr)] min-h-0">
                        {/* ── Izquierda: clases y recuadros de esta foto ── */}
                        <aside className="border-b md:border-b-0 md:border-r border-white/10 p-3 flex md:flex-col gap-3 overflow-auto min-h-0">
                            <div className="space-y-1 min-w-0">
                                <div className="hidden md:block text-[9px] font-bold uppercase tracking-[0.14em] text-white/45 px-1 pb-1">Clase</div>
                                <div role="radiogroup" aria-label="Clase del recuadro" className="flex md:flex-col gap-1">
                                    {clases.map((c, k) => {
                                        const on = clase === c.id;
                                        return (
                                            <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => cambiarClase(c.id)}
                                                className={cn(boton, "h-10 px-2 text-[12.5px] w-full shrink-0 md:shrink text-left", on ? "bg-white/[0.11] ring-1 ring-white/25" : "hover:bg-white/[0.06]")}>
                                                <span className="grid place-items-center h-6 w-6 rounded-[7px] text-[11px] font-bold tabular-nums text-black shrink-0" style={{ background: COLORES_CLASE[k % COLORES_CLASE.length] }}>{k + 1}</span>
                                                <span className={cn("truncate flex-1", !on && "text-white/75")}>{c.nombre}</span>
                                                {porClase[c.id] > 0 && <span className="text-[11px] tabular-nums text-white/55">{porClase[c.id]}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="hidden md:block space-y-1 min-w-0">
                                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/45 px-1 pb-1 pt-2 border-t border-white/10">En esta foto · {cajas.length}</div>
                                {cajas.length === 0 && <p className="text-[11.5px] text-white/45 px-1 leading-snug">Arrastrá sobre la foto para marcar cada {nombre(clase).toLowerCase()}. Ajustado a lo que se ve, uno por objeto.</p>}
                                {cajas.map((c, k) => (
                                    <div key={k} onMouseEnter={() => setEncima(k)} onMouseLeave={() => setEncima(null)}
                                        className={cn("group flex items-center gap-2 rounded-[8px] pl-2 pr-1 h-8 text-[12px]", k === elegida ? "bg-white/[0.11]" : "hover:bg-white/[0.06]")}>
                                        <button type="button" onClick={() => { setElegida(k); setClase(c.clase); }} aria-label={`Elegir ${nombre(c.clase)} ${k + 1}`} className="flex items-center gap-2 flex-1 min-w-0 text-left outline-none focus-visible:underline">
                                            <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: colorDe(c.clase) }} />
                                            <span className="truncate">{nombre(c.clase)}</span>
                                            <span className="ml-auto text-[10.5px] text-white/45 tabular-nums">{px(c.caja as C4)}</span>
                                        </button>
                                        <button type="button" onClick={() => { cambiar(cajas.filter((_, j) => j !== k)); setElegida(null); }} aria-label={`Borrar ${nombre(c.clase)} ${k + 1}`} title="Borrar (Supr)"
                                            className="h-6 w-6 grid place-items-center rounded-md text-white/45 hover:text-white hover:bg-white/10 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion-en-oscuro)]"><Trash2 size={13} /></button>
                                    </div>
                                ))}
                            </div>
                        </aside>

                        {/* ── El lienzo: la foto y nada encima que la tape ── */}
                        <div className="relative grid place-items-center min-h-0 p-4 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.035),transparent_70%)]">
                            <div className="relative select-none touch-none" style={{ cursor: arrastre?.tipo === "mover" ? "grabbing" : "crosshair" }}
                                onPointerDown={empezarNuevo} onPointerMove={moverPuntero} onPointerUp={soltar} onPointerLeave={() => setPuntero(null)}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img ref={imgRef} src={f.url} alt={`Foto ${i + 1}`} draggable={false}
                                    className="block max-h-[calc(92vh-56px-68px-32px)] max-w-[calc(97vw-236px-48px)] w-auto h-auto rounded-[4px] [box-shadow:var(--sombra-captura)]" />

                                {/* Líneas guía: para empezar el recuadro justo en el borde del objeto. */}
                                {guias && (
                                    <>
                                        <span className="absolute inset-x-0 h-px pointer-events-none" style={{ top: `${puntero![1] * 100}%`, background: colorActivo, opacity: 0.55 }} />
                                        <span className="absolute inset-y-0 w-px pointer-events-none" style={{ left: `${puntero![0] * 100}%`, background: colorActivo, opacity: 0.55 }} />
                                    </>
                                )}

                                {cajas.map((c, k) => {
                                    const col = colorDe(c.clase), sel = k === elegida, luz = k === encima;
                                    const k4 = c.caja as C4;
                                    const arriba = k4[1] > 0.06;  // el rótulo va arriba si hay lugar; si no, adentro
                                    return (
                                        <div key={k} role="button" tabIndex={0} aria-label={`${nombre(c.clase)}, ${px(k4)}${sel ? ", elegido" : ""}`}
                                            onPointerDown={(e) => empezarMover(e, k)} onFocus={() => setElegida(k)}
                                            className={cn("absolute rounded-[2px] outline-none", sel ? "cursor-grab" : "cursor-pointer")}
                                            style={{ ...rect(k4), border: `2px solid ${col}`, background: sel || luz ? `${col}22` : "transparent", boxShadow: sel ? `0 0 0 1px rgba(0,0,0,.6), 0 0 0 4px ${col}55` : "0 0 0 1px rgba(0,0,0,.55)" }}>
                                            <span className="absolute left-[-2px] whitespace-nowrap rounded-[5px] px-1.5 py-[1px] text-[10.5px] font-bold text-black pointer-events-none"
                                                style={{ background: col, ...(arriba ? { bottom: "100%", marginBottom: 2 } : { top: 0 }) }}>
                                                {nombre(c.clase)}
                                            </span>
                                            {sel && ASAS.map((h) => (
                                                <span key={h.a} onPointerDown={(e) => empezarAsa(e, k, h.a)}
                                                    className="absolute h-3 w-3 -ml-1.5 -mt-1.5 rounded-[3px] bg-white border-2"
                                                    style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, borderColor: col, cursor: h.cursor }} />
                                            ))}
                                        </div>
                                    );
                                })}

                                {nuevo && (
                                    <span className="absolute pointer-events-none rounded-[2px]" style={{ ...rect(nuevo), border: `2px dashed ${colorActivo}`, background: `${colorActivo}1f` }}>
                                        <span className="absolute top-full mt-1 left-0 whitespace-nowrap rounded-[5px] bg-black/80 px-1.5 py-[1px] text-[10.5px] font-semibold tabular-nums text-white">{px(nuevo)}</span>
                                    </span>
                                )}
                            </div>

                            <AnimatePresence>
                                {aviso && (
                                    <motion.div role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                                        className={cn("absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[80%] px-4 py-2 rounded-[10px] text-[12.5px] font-semibold border [box-shadow:var(--sombra-flotante)]",
                                            aviso.tono === "mal" ? "bg-[#3a1418] border-[#FB7185]/50 text-[#ffd5db]" : aviso.tono === "aviso" ? "bg-[#33270d] border-[#FFB020]/50 text-[#ffe7b3]" : "bg-[#0f2236] border-[#5AA9FF]/50 text-[#d6e9ff]")}>
                                        {aviso.t}
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Atajos, a pedido: no se muestran siempre (ocupaban un renglón fijo debajo). */}
                            <AnimatePresence>
                                {atajos && (
                                    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                                        className="absolute top-3 right-3 w-[270px] rounded-[12px] bg-[#16191e] border border-white/12 p-3 text-[12px] space-y-1.5 [box-shadow:var(--sombra-flotante)]">
                                        {[["Arrastrar", "dibujar un recuadro"], ["1 – 9", "elegir la clase"], ["Enter", "guardar y seguir"], ["N", "no hay ninguno"], ["Z", "deshacer"], ["Supr", "borrar el elegido"], ["Flechas", "correr el elegido (Mayús: ×10)"], ["← →", "cambiar de foto (sin elegido)"], ["Esc", "soltar el elegido"]].map(([k, d]) => (
                                            <div key={k} className="flex items-center gap-2"><kbd className="min-w-[64px] text-center rounded-[6px] bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold">{k}</kbd><span className="text-white/75">{d}</span></div>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* ── Abajo: moverse y decidir ── */}
                    <footer className="flex items-center gap-2 px-4 border-t border-white/10">
                        <button type="button" onClick={() => ir(i - 1)} disabled={i === 0} aria-label="Foto anterior" title="Foto anterior (←)" className={cn(boton, suave, "h-11 w-11 justify-center")}><ChevronLeft size={19} /></button>
                        <button type="button" onClick={() => ir(i + 1)} aria-label="Foto siguiente" title="Foto siguiente (→)" className={cn(boton, suave, "h-11 w-11 justify-center")}><ChevronRight size={19} /></button>
                        <span className="w-px h-7 bg-white/10 mx-1" />
                        <button type="button" onClick={deshacer} disabled={!historia.length} title="Deshacer (Z)" className={cn(boton, suave, "h-11 px-3.5 text-[13px]")}><Undo2 size={16} /> Deshacer</button>
                        <button type="button" onClick={async () => { if (await alBorrar(f.id)) { if (i >= fotos.length - 1) alCerrar(); } }}
                            className={cn(boton, "h-11 px-3.5 text-[13px] text-[#ffb4bf] hover:bg-[#FB7185]/15 border border-transparent hover:border-[#FB7185]/30")} title="La foto no sirve (borrosa, repetida): se saca del conjunto"><Trash2 size={16} /> Descartar foto</button>
                        <span className="ml-auto" />
                        <button type="button" onClick={() => guardar(true)} disabled={guardando} title="En esta foto no hay ninguno: le enseña qué NO marcar (N)"
                            className={cn(boton, suave, "h-11 px-4 text-[13px]")}><CircleSlash size={16} /> No hay ninguno <kbd className="ml-1 rounded-[5px] bg-white/10 px-1.5 text-[10.5px]">N</kbd></button>
                        <button type="button" onClick={() => guardar(false)} disabled={guardando || !cajas.length}
                            className={cn(boton, "h-11 px-5 text-[13.5px] bg-[var(--accion)] hover:brightness-110 text-white")}>
                            {guardando ? <Loader2 size={16} className="animate-spin" /> : <CircleCheck size={16} />}
                            Guardar{cajas.length ? ` ${cajas.length} recuadro${cajas.length === 1 ? "" : "s"}` : ""}
                            <kbd className="ml-1 rounded-[5px] bg-white/20 px-1.5 text-[10.5px]">Enter</kbd>
                        </button>
                    </footer>
                </motion.div>
            </DialogContent>
        </Dialog>
    );
}
