"use client";

import { useCallback, useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTiempoReal } from "@/lib/tiempo-real";

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
export type Veredicto = { pasa: boolean; motivo: string; nombre: string | null; sentido: string | null; geometria?: boolean };
export type LecturaViva = { id: string; plate: string; confianza: number | null; baja: boolean; tray: Caja[]; veredicto: Veredicto | null; t: number };

const VIDA_MS = 9000, RECORRIDO_MS = 1300, MAX = 8;

export function colorVeredicto(l: LecturaViva): string {
    if (l.veredicto?.motivo === "rebote") return "#94a3b8";
    if (l.veredicto && !l.veredicto.pasa) return "#f87171";
    if (l.baja) return "#fbbf24";
    return "#34d399";
}
export function textoVeredicto(l: LecturaViva): string {
    const v = l.veredicto;
    if (l.baja) return "confianza baja: no se registra";
    if (!v) return "leída";
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
    const sumar = useCallback((e: { deviceId?: string; plate?: string; confianza?: number | null; baja?: boolean; trayectoria?: Caja[]; veredicto?: Veredicto | null }) => {
        if (!activo || e?.deviceId !== deviceId || !e?.plate) return;
        const l: LecturaViva = { id: `${e.plate}-${Date.now()}`, plate: String(e.plate), confianza: typeof e.confianza === "number" ? e.confianza : null, baja: !!e.baja, tray: Array.isArray(e.trayectoria) ? e.trayectoria : [], veredicto: e.veredicto || null, t: Date.now() };
        setLecturas((xs) => [l, ...xs].slice(0, MAX)); setAhora(l.t);
    }, [deviceId, activo]);
    const { conectado } = useTiempoReal("lectura_lpr", sumar);
    // Mientras haya algo vivo en pantalla, se redibuja para mover la caja por su recorrido.
    const hayVivas = lecturas.some((l) => ahora - l.t < VIDA_MS);
    useEffect(() => {
        if (!hayVivas) return;
        const iv = setInterval(() => setAhora(Date.now()), 60);
        return () => clearInterval(iv);
    }, [hayVivas]);
    return { lecturas, conectado, ahora, vivas: lecturas.filter((l) => ahora - l.t < VIDA_MS) };
}

/** La capa sobre la escena: el recorrido, la caja moviéndose y la chapa con su veredicto. */
export function CapaEnVivo({ vivas, ahora }: { vivas: LecturaViva[]; ahora: number }) {
    return (
        <div className="pointer-events-none absolute inset-0">
            {vivas.map((l) => {
                if (!l.tray.length) return null;
                const edad = ahora - l.t;
                const k = Math.min(1, edad / RECORRIDO_MS) * (l.tray.length - 1);
                const i = Math.floor(k), f = k - i;
                const a = l.tray[i], b = l.tray[Math.min(l.tray.length - 1, i + 1)];
                const c: Caja = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f, h: a.h + (b.h - a.h) * f };
                const col = colorVeredicto(l);
                const opac = edad > VIDA_MS - 1500 ? Math.max(0, (VIDA_MS - edad) / 1500) : 1;
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
            <button type="button" onClick={() => cambiar(!activo)} className="flex w-full items-center gap-2.5 rounded-[10px] bg-white/[0.04] px-3 py-2.5 text-left">
                <Radio size={15} className={cn(activo && conectado ? "text-red-400" : "text-white/40", activo && conectado && "animate-pulse")} />
                <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-white">Ver las lecturas en vivo</span>
                    <span className="block text-[11px] text-white/50">{!activo ? "Apagado." : conectado ? "La caja sigue a la chapa y dice qué carril la tomó. No usa GPU extra." : "Conectando…"}</span>
                </span>
                <span className={cn("h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors", activo ? "bg-red-500" : "bg-white/15")}><span className={cn("block h-4 w-4 rounded-full bg-white transition-transform", activo && "translate-x-4")} /></span>
            </button>
            {activo && (lecturas.length === 0
                ? <p className="px-1 text-[11.5px] leading-snug text-white/45">Esperando que pase un auto. Las lecturas aparecen cuando la cámara dispara una ráfaga.</p>
                : (
                    <ul className="space-y-1">
                        {lecturas.map((l) => (
                            <li key={l.id} className="flex items-center gap-2 rounded-md bg-white/[0.03] px-2.5 py-1.5">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorVeredicto(l) }} />
                                <span className="rounded-[3px] bg-white px-1.5 text-[11px] font-black tracking-[0.12em] text-black">{l.plate}</span>
                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-white/70">{textoVeredicto(l)}</span>
                                <span className="text-[10.5px] tabular-nums text-white/40">{l.confianza != null ? `${Math.round(l.confianza * 100)}%` : ""}</span>
                            </li>
                        ))}
                    </ul>
                ))}
        </div>
    );
}
