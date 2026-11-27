"use client";

import { useCallback, useEffect, useState } from "react";
import { Radio, ImageOff, Layers } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useTiempoReal } from "@/lib/tiempo-real";
import { getImagePath } from "@/lib/image-path";
import { conAncho } from "@/lib/ancho-foto";
import { fechaCorta, hora, horaSeg } from "@/lib/fechas";
import { ultimasCapturas } from "@/app/actions/calibrador";

/**
 * Las lecturas en vivo dentro del calibrador (26/11). Nico: «el calibrador detectará en vivo las
 * matrículas, dibujando y siguiendo el recuadro de la matrícula, como en los popup de eventos LPR».
 *
 * No le pide nada extra al lector: son las lecturas que OmniVision ya hace (el evento
 * `lectura_lpr`), que ahora traen el recorrido de la chapa en la ráfaga y el veredicto de la
 * geometría. Pedirle cuadros al lector una vez por segundo desde acá competiría por la GPU con la
 * lectura de verdad (el lector ya se cayó con trabajo concurrente: MAX_EN_VUELO=1).
 *
 * Cada lectura se dibuja como la caja de la chapa recorriendo su camino —de la primera lectura de
 * la ráfaga a la última, en poco más de un segundo— con la chapa y el veredicto arriba: qué carril
 * la tomó y en qué sentido, o por qué no (contramano, fuera de lo dibujado, rebote). Es la forma de
 * ver, con autos de verdad, si los carriles están bien dibujados.
 */
type Caja = { x: number; y: number; w: number; h: number };
/** `kmh`: velocidad aproximada con la chapa como regla (lib-geometria-lpr: velocidad); sin validar contra un auto a velocidad conocida. */
export type Veredicto = { pasa: boolean; motivo: string; nombre: string | null; sentido: string | null; geometria?: boolean; kmh?: number | null };
export type LecturaViva = {
    id: string; plate: string; confianza: number | null; baja: boolean; tray: Caja[]; veredicto: Veredicto | null; t: number;
    /** La captura guardada (ruta de la aplicación). Un rebote no guarda foto. */
    foto: string | null;
    /** Vino de la base al abrir, no del vivo: va a la pila pero no se dibuja sobre la escena. */
    historica?: boolean;
};

const VIDA_MS = 9000, RECORRIDO_MS = 1300, MAX = 14;

export function colorVeredicto(l: LecturaViva): string {
    // Las de la base (al abrir) no traen veredicto: neutras, para no parecer «aceptadas».
    if (l.historica || l.veredicto?.motivo === "rebote") return "#94a3b8";
    if (l.veredicto && !l.veredicto.pasa) return "#f87171";
    if (l.baja) return "#fbbf24";
    return "#34d399";
}
export function textoVeredicto(l: LecturaViva): string {
    const t = textoSinVelocidad(l), kmh = l.veredicto?.kmh;
    return kmh != null ? `${t} · ~${kmh} km/h` : t;
}
function textoSinVelocidad(l: LecturaViva): string {
    const v = l.veredicto;
    if (l.baja) return "confianza baja: no se registra";
    if (!v) return l.historica ? "guardada" : "leída";
    if (v.motivo === "rebote") return `rebote${v.nombre ? ` en ${v.nombre}` : ""}: ya contada`;
    if (v.motivo === "contramano") return `contramano en ${v.nombre || "el carril"}`;
    if (v.motivo === "fuera") return "fuera de lo dibujado";
    if (!v.pasa) return "lejos de la zona o la línea";
    if (v.motivo === "carril") return `${v.nombre || "carril"}${v.sentido ? ` · ${v.sentido === "entra" ? "entra" : "sale"}` : ""}`;
    if (v.motivo === "linea") return `cruzó ${v.nombre || "la línea"}`;
    if (v.motivo === "zona") return `en ${v.nombre || "la zona"}`;
    if (v.motivo === "sin") return v.geometria ? "leída" : "sin carriles: todo el cuadro";
    return v.pasa ? "leída" : "fuera de la zona o la línea";
}

export function useLecturasVivas(deviceId: string, activo: boolean) {
    const [lecturas, setLecturas] = useState<LecturaViva[]>([]);
    const [ahora, setAhora] = useState(0);
    const sumar = useCallback((e: { deviceId?: string; plate?: string; confianza?: number | null; baja?: boolean; trayectoria?: Caja[]; veredicto?: Veredicto | null; foto?: string | null }) => {
        if (!activo || e?.deviceId !== deviceId || !e?.plate) return;
        const l: LecturaViva = { id: `${e.plate}-${Date.now()}`, plate: String(e.plate), confianza: typeof e.confianza === "number" ? e.confianza : null, baja: !!e.baja, tray: Array.isArray(e.trayectoria) ? e.trayectoria : [], veredicto: e.veredicto || null, t: Date.now(), foto: getImagePath(e.foto || null) };
        setLecturas((xs) => [l, ...xs].slice(0, MAX)); setAhora(l.t);
    }, [deviceId, activo]);
    const { conectado } = useTiempoReal("lectura_lpr", sumar);

    // Al abrir, la pila arranca con lo último que leyó la cámara: no vacía esperando un auto.
    useEffect(() => {
        if (!activo) return;
        let vivo = true;
        ultimasCapturas(deviceId, MAX).then((fs) => {
            if (!vivo || !Array.isArray(fs)) return;
            const viejas: LecturaViva[] = fs.map((f) => ({ id: `h-${f.id}`, plate: f.plate, confianza: f.confianza, baja: false, tray: [], veredicto: null, t: new Date(f.ts).getTime(), foto: f.foto, historica: true }));
            // Las del vivo que ya llegaron quedan arriba; las de la base, debajo y sin repetir.
            setLecturas((xs) => [...xs, ...viejas.filter((v) => !xs.some((x) => x.plate === v.plate && Math.abs(x.t - v.t) < 15_000))].slice(0, MAX));
        }).catch(() => { });
        return () => { vivo = false; };
    }, [deviceId, activo]);

    // Mientras haya algo vivo en pantalla, se redibuja para mover la caja por su recorrido.
    const hayVivas = lecturas.some((l) => !l.historica && ahora - l.t < VIDA_MS);
    useEffect(() => {
        if (!hayVivas) return;
        const iv = setInterval(() => setAhora(Date.now()), 60);
        return () => clearInterval(iv);
    }, [hayVivas]);
    return { lecturas, conectado, ahora, vivas: lecturas.filter((l) => !l.historica && ahora - l.t < VIDA_MS) };
}

/** La capa sobre la escena: el recorrido, la caja moviéndose y la chapa con su veredicto. */
export function CapaEnVivo({ vivas, ahora, resaltada }: { vivas: LecturaViva[]; ahora: number; resaltada?: LecturaViva | null }) {
    // La que se señala en la pila se dibuja quieta en su último lugar, aunque ya haya pasado.
    const lista = resaltada && resaltada.tray.length && !vivas.some((v) => v.id === resaltada.id) ? [...vivas, resaltada] : vivas;
    return (
        <div className="pointer-events-none absolute inset-0">
            {lista.map((l) => {
                if (!l.tray.length) return null;
                const fija = resaltada?.id === l.id;
                const edad = fija ? RECORRIDO_MS : ahora - l.t;
                const k = Math.min(1, edad / RECORRIDO_MS) * (l.tray.length - 1);
                const i = Math.floor(k), f = k - i;
                const a = l.tray[i], b = l.tray[Math.min(l.tray.length - 1, i + 1)];
                const c: Caja = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f, h: a.h + (b.h - a.h) * f };
                const col = colorVeredicto(l);
                const opac = fija ? 1 : edad > VIDA_MS - 1500 ? Math.max(0, (VIDA_MS - edad) / 1500) : 1;
                const centros = l.tray.map((q) => `${(q.x + q.w / 2) * 100},${(q.y + q.h / 2) * 100}`).join(" ");
                return (
                    <div key={l.id} className="absolute inset-0" style={{ opacity: opac }}>
                        {l.tray.length > 1 && (
                            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                                <polyline points={centros} fill="none" stroke={col} strokeWidth={2} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity={0.8} />
                            </svg>
                        )}
                        {/* La caja de la chapa, con esquinas marcadas como en el popup de un evento LPR. */}
                        <div className="absolute rounded-[3px]" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%`, boxShadow: `0 0 0 2px ${col}, 0 0 14px ${col}88`, background: `${col}1f` }}>
                            <div className="absolute -top-[30px] left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-black/80 px-2 py-0.5 ring-1" style={{ ["--tw-ring-color" as string]: col }}>
                                <span className="rounded-[3px] bg-white px-1.5 text-[11px] font-black tracking-[0.12em] text-black">{l.plate}</span>
                                <span className="text-[10.5px] font-semibold" style={{ color: col }}>{textoVeredicto(l)}</span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** La lista del panel: las últimas lecturas con su veredicto. */
export function ListaEnVivo({ lecturas, conectado, activo, cambiar }: { lecturas: LecturaViva[]; conectado: boolean; activo: boolean; cambiar: (v: boolean) => void }) {
    return (
        <div className="space-y-2">
            <button type="button" onClick={() => cambiar(!activo)} className="flex w-full items-center gap-2.5 rounded-[10px] bg-foreground/[0.04] px-3 py-2.5 text-left">
                <Radio size={15} className={cn(activo && conectado ? "text-red-600 dark:text-red-400" : "text-foreground/40", activo && conectado && "animate-pulse")} />
                <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-foreground">Ver las lecturas en vivo</span>
                    <span className="block text-[11px] text-foreground/50">{!activo ? "Apagado." : conectado ? "La caja sigue a la chapa y dice qué carril la tomó. No usa GPU extra." : "Conectando…"}</span>
                </span>
                <span className={cn("h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors", activo ? "bg-red-500" : "bg-foreground/15")}><span className={cn("block h-4 w-4 rounded-full bg-white transition-transform", activo && "translate-x-4")} /></span>
            </button>
            {activo && (lecturas.length === 0
                ? <p className="px-1 text-[11.5px] leading-snug text-foreground/45">Esperando que pase un auto. Las lecturas aparecen cuando la cámara dispara una ráfaga.</p>
                : (
                    <ul className="space-y-1">
                        {lecturas.map((l) => (
                            <li key={l.id} className="flex items-center gap-2 rounded-md bg-foreground/[0.03] px-2.5 py-1.5">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorVeredicto(l) }} />
                                <span className="rounded-[3px] bg-white px-1.5 text-[11px] font-black tracking-[0.12em] text-black">{l.plate}</span>
                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground/70">{textoVeredicto(l)}</span>
                                <span className="text-[10.5px] tabular-nums text-foreground/40">{l.confianza != null ? `${Math.round(l.confianza * 100)}%` : ""}</span>
                            </li>
                        ))}
                    </ul>
                ))}
        </div>
    );
}

/**
 * La pila de últimas capturas, acoplada a la derecha de la escena (26/11).
 *
 * Nico: «el calibrador, en vivo, deberá tener las últimas capturas que realizó, apiladas
 * acopladas a la derecha del video, mini capturas stackeadas». La más nueva arriba; cada una con
 * su chapa, la hora y el color de su veredicto. Pasar el mouse por una que trae recorrido la
 * dibuja quieta sobre la escena —así se ve dónde la leyó respecto de los carriles—; un clic la
 * abre grande.
 */
export function PilaCapturas({ lecturas, ahora, alResaltar }: { lecturas: LecturaViva[]; ahora: number; alResaltar: (l: LecturaViva | null) => void }) {
    const [ampliada, setAmpliada] = useState<LecturaViva | null>(null);
    // Al ocultar la pila con una señalada, que no quede dibujada sobre la escena.
    useEffect(() => () => alResaltar(null), [alResaltar]);
    return (
        <aside className="flex h-full w-[172px] shrink-0 flex-col" onMouseLeave={() => alResaltar(null)}>
            <div className="mb-2 flex items-center gap-1.5 px-0.5">
                <Layers size={12} className="text-foreground/45" />
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-foreground/50">Últimas capturas</span>
                <span className="ml-auto text-[10.5px] tabular-nums text-foreground/35">{lecturas.length}</span>
            </div>
            {lecturas.length === 0 ? (
                <div className="grid flex-1 place-items-center rounded-[10px] border border-dashed border-foreground/10 px-3 text-center text-[11px] leading-snug text-foreground/40">
                    Todavía no hay capturas de esta cámara. Aparecen acá cuando lee una chapa.
                </div>
            ) : (
                <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
                    <AnimatePresence initial={false}>
                        {lecturas.map((l) => {
                            const col = colorVeredicto(l);
                            const nueva = !l.historica && ahora - l.t < VIDA_MS;
                            const mini = conAncho(l.foto, 360);
                            return (
                                <motion.li key={l.id} layout initial={{ opacity: 0, y: -14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
                                    <button type="button" onMouseEnter={() => alResaltar(l)} onFocus={() => alResaltar(l)} onClick={() => l.foto && setAmpliada(l)}
                                        title={`${l.plate} · ${textoVeredicto(l)}`}
                                        className={cn("group relative block w-full overflow-hidden rounded-[10px] bg-foreground/[0.04] text-left ring-1 transition", nueva ? "ring-2" : "ring-foreground/10 hover:ring-foreground/30")}
                                        style={nueva ? { ["--tw-ring-color" as string]: col } : undefined}>
                                        <div className="relative aspect-video w-full bg-neutral-900">
                                            {mini
                                                // eslint-disable-next-line @next/next/no-img-element
                                                ? <img src={mini} alt="" loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                                                : <span className="absolute inset-0 grid place-items-center text-white/25"><ImageOff size={18} /></span>}
                                            <span className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/85 to-transparent" />
                                            <span className="absolute left-0 top-0 h-full w-[3px]" style={{ background: col }} />
                                            <span className="absolute bottom-1.5 left-2 rounded-[3px] bg-white px-1.5 text-[10.5px] font-black tracking-[0.12em] text-black">{l.plate}</span>
                                            {nueva && <span className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-1.5 text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: col }}>nueva</span>}
                                        </div>
                                        <div className="flex items-center gap-1.5 px-2 py-1.5">
                                            <span className="min-w-0 flex-1 truncate text-[10.5px]" style={{ color: col }}>{textoVeredicto(l)}</span>
                                            <span className="shrink-0 text-[10px] tabular-nums text-foreground/40">{l.historica ? `${fechaCorta(l.t)} ${hora(l.t)}` : horaSeg(l.t)}</span>
                                        </div>
                                    </button>
                                </motion.li>
                            );
                        })}
                    </AnimatePresence>
                </ul>
            )}

            <AnimatePresence>
                {ampliada?.foto && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAmpliada(null)}
                        className="fixed inset-0 z-[3500] grid cursor-zoom-out place-items-center bg-black/80 p-8 backdrop-blur-sm">
                        <motion.figure initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="relative max-h-full max-w-[min(1400px,92vw)]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={ampliada.foto} alt="" className="max-h-[82vh] w-auto rounded-[14px] shadow-[0_30px_80px_rgba(0,0,0,0.6)]" />
                            <figcaption className="mt-3 flex items-center gap-2.5 text-[12.5px] text-white/80">
                                <span className="rounded-[4px] bg-white px-2 text-[13px] font-black tracking-[0.12em] text-black">{ampliada.plate}</span>
                                <span style={{ color: colorVeredicto(ampliada) }}>{textoVeredicto(ampliada)}</span>
                                {ampliada.confianza != null && <span className="tabular-nums text-white/50">{Math.round(ampliada.confianza * 100)} %</span>}
                                <span className="ml-auto tabular-nums text-white/50">{fechaCorta(ampliada.t)} {horaSeg(ampliada.t)}</span>
                            </figcaption>
                        </motion.figure>
                    </motion.div>
                )}
            </AnimatePresence>
        </aside>
    );
}
