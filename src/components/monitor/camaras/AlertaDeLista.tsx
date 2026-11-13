"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTiempoReal } from "@/lib/tiempo-real";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import { IconoPolicia } from "@/components/IconoPolicia";
import { ShieldAlert } from "lucide-react";
import { REQUERIDA_POLICIA, esRequerida } from "@/lib/min-interior";
import { nombreCamara } from "@/lib/rostros";
import { useSiluetasEnVivo, type Canal } from "./piezas";

/**
 * Una chapa de la lista negra en un canal de la pared de cámaras (13/11, Nico: «cuando se da una
 * detección de este tipo de matrículas requeridas, debe resaltar la analítica en ese cuadro en el
 * wall, dentro de su canal, la única que dibujaremos en vivo… con el menú contextual del vehículo,
 * pudiendo desactivar esa alerta y retirarla de la lista negra; se tiene que poder auditar»).
 *
 * La pared NO dibuja analítica en vivo: son decenas de cuadros y cada silueta es una pasada por la
 * GPU. Esta es la excepción, y por eso es una sola cosa: el cuadro donde está la chapa, y de ese
 * cuadro sólo el vehículo en alerta. Sin alerta no se abre ningún análisis.
 *
 * De dónde sale la alerta:
 *   - una lectura de acceso con la chapa en la lista negra (`access_event`): dura ALERTA_ACCESO_MS,
 *     porque el auto pasa y se va;
 *   - un aviso «lista negra a la vista» (lib/lista-negra-vista): queda hasta que alguien lo atiende,
 *     y los pendientes vienen con la consulta de la pared (por si se abrió después del aviso).
 * Aceptada como real sigue resaltada (ya no vence): se apaga cuando alguien la desactiva o la da
 * por falsa, acá o en cualquier otra pantalla (`alarma_atendida`, `alarma_resuelta`).
 */
export type AlertaLista = {
    clave: string; plate: string; requerida: boolean; ts: string; hasta: number | null;
    /** Alguien ya la aceptó como real: sigue resaltada hasta que se desactiva (igual que en la pila de avisos). */
    real?: boolean;
};
export type ALaVista = { clave: string; deviceId: string | null; camara: string | null; plate: string; requerida: boolean; ts: string };

/** Una lectura de acceso resalta su cuadro este tiempo: después el vehículo ya no está ahí. */
const ALERTA_ACCESO_MS = 3 * 60_000;
const limpia = (p: unknown) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Las alertas de lista por equipo. `pendientes` viene de la consulta de la pared; lo demás, por el socket. */
export function useAlertasDeLista(pendientes: ALaVista[] | undefined, canales: Canal[]) {
    const [vivas, setVivas] = useState<Record<string, AlertaLista>>({});
    const [atendidas, setAtendidas] = useState<Set<string>>(() => new Set());
    const equipoDe = useCallback((deviceId: string | null | undefined, camara: string | null | undefined): string | null => {
        if (deviceId && canales.some((c) => c.equipoId === deviceId)) return deviceId;
        // Un aviso viejo (o de una cámara sin equipo) trae sólo el nombre.
        const n = nombreCamara(camara);
        return n ? canales.find((c) => nombreCamara(c.nombre) === n)?.equipoId || null : null;
    }, [canales]);

    useTiempoReal("access_event", (e: any) => {
        const dev = e?.deviceId || e?.device?.id;
        if (!e?.id || !dev || String(e.watch?.category || "").toUpperCase() !== "BLACKLISTED") return;
        setVivas((p) => ({ ...p, [dev]: { clave: `l:${e.id}`, plate: limpia(e.plateDetected), requerida: esRequerida(e.watch?.label, e.watch?.motivo), ts: e.timestamp || new Date().toISOString(), hasta: Date.now() + ALERTA_ACCESO_MS } }));
    });
    useTiempoReal("aviso_guardia", (x: any) => {
        const a = x?.aviso;
        if (!a?.id || a.tipo !== "LISTA_NEGRA_VISTA") return;
        if (x.accion === "atendido") { setAtendidas((s) => new Set(s).add(`a:${a.id}`)); return; }
        const dev = equipoDe(a.datos?.deviceId, a.camara);
        if (!dev || x.accion !== "nuevo") return;
        setVivas((p) => ({ ...p, [dev]: { clave: `a:${a.id}`, plate: limpia(a.plate), requerida: !!a.datos?.requerida, ts: a.creado || new Date().toISOString(), hasta: null } }));
    });
    const [reales, setReales] = useState<Set<string>>(() => new Set());
    useTiempoReal("alarma_atendida", (x: any) => {
        if (!x?.id) return;
        if (x.resultado === "real") setReales((s) => new Set(s).add(String(x.id)));
        else setAtendidas((s) => new Set(s).add(String(x.id)));
    });
    useTiempoReal("alarma_resuelta", (x: any) => { if (x?.id) setAtendidas((s) => new Set(s).add(String(x.id))); });

    // Las de acceso vencen solas: una vuelta cada tanto sólo mientras haya alguna con vencimiento.
    const hayVencibles = Object.values(vivas).some((a) => a.hasta != null);
    const [, setVuelta] = useState(0);
    useEffect(() => { if (!hayVencibles) return; const t = setInterval(() => setVuelta((n) => n + 1), 15_000); return () => clearInterval(t); }, [hayVencibles]);

    const porEquipo = useMemo(() => {
        const out: Record<string, AlertaLista> = {};
        for (const p of pendientes || []) {
            const dev = equipoDe(p.deviceId, p.camara);
            if (dev && !atendidas.has(p.clave)) out[dev] = { clave: p.clave, plate: limpia(p.plate), requerida: p.requerida, ts: p.ts, hasta: null };
        }
        const ahora = Date.now();
        for (const [dev, a] of Object.entries(vivas)) {
            if (atendidas.has(a.clave) || (a.hasta != null && a.hasta < ahora && !reales.has(a.clave))) continue;
            // La «a la vista» (que no vence) manda sobre una lectura de acceso del mismo cuadro.
            if (!out[dev] || a.hasta == null) out[dev] = a;
        }
        for (const dev of Object.keys(out)) if (reales.has(out[dev].clave)) out[dev] = { ...out[dev], real: true };
        return out;
    }, [pendientes, vivas, atendidas, reales, equipoDe, hayVencibles]); // eslint-disable-line react-hooks/exhaustive-deps
    const quitar = useCallback((clave: string) => setAtendidas((s) => new Set(s).add(clave)), []);
    return { porEquipo, quitar };
}

/**
 * Lo que se dibuja sobre el cuadro en alerta: el marco que late, el cartel, y —sólo acá— la
 * silueta en vivo del vehículo en alerta. Las demás siluetas del canal no se dibujan: en la pared
 * distraen, y la que importa es una.
 */
export function CapaAlertaLista({ stream, a, grande }: { stream: string; a: AlertaLista; grande: boolean }) {
    const sil = useSiluetasEnVivo(stream, true);
    const enAlerta = useMemo(() => {
        const an = sil.analisis as { ancho: number; alto: number; objetos: any[] } | null;
        if (!an?.objetos?.length) return null;
        const objetos = an.objetos.filter((o) => o.alerta);
        return objetos.length ? { ...an, objetos } : null;
    }, [sil.analisis]);
    const Ico = a.requerida ? IconoPolicia : ShieldAlert;
    return (
        <>
            {enAlerta && <CapaAnalisis analisis={enAlerta} ajuste="cover" etiquetas={false} className="z-[5]" />}
            <span aria-hidden="true" className="marco-alerta-lista absolute inset-0 z-[6] rounded-[10px] pointer-events-none" />
            <span role="alert" className={cn("absolute left-1/2 -translate-x-1/2 z-[7] inline-flex items-center gap-1.5 rounded-full pleno-mal font-bold whitespace-nowrap max-w-[92%] pointer-events-none",
                grande ? "top-12 px-3.5 py-1.5 text-[14px]" : "top-11 px-2.5 py-1 text-[11.5px]")}>
                <Ico size={grande ? 16 : 13} className="shrink-0" />
                <span className="truncate">{a.requerida ? REQUERIDA_POLICIA : "Lista negra"}</span>
                {a.plate && <span className="tabular-nums tracking-wider opacity-95">· {a.plate}</span>}
            </span>
        </>
    );
}

/** Una opción del menú de un canal. `confirmar`: pide un segundo clic con ese texto (lo que no se deshace con un clic). */
export type OpcionCanal = {
    clave: string; rotulo: string; Icono: LucideIcon | typeof IconoPolicia;
    tono?: "mal" | "bien";
    confirmar?: string;
    /** Por qué no se puede: va apagada, con esto debajo. */
    motivo?: string;
    /** Una raya antes de esta opción: separa lo de la alerta de lo del canal. */
    separa?: boolean;
    alElegir: () => void | Promise<unknown>;
};

/**
 * El menú contextual de un canal de la pared (clic derecho; con el dedo, mantener apretado).
 * Flota donde se tocó, sin salirse de la pantalla, y se cierra con Esc, al elegir o al tocar afuera.
 */
export function MenuCanal({ x, y, titulo, sub, opciones, alCerrar }: { x: number; y: number; titulo: string; sub?: string | null; opciones: OpcionCanal[]; alCerrar: () => void }) {
    const caja = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x, y });
    const [confirmando, setConfirmando] = useState<string | null>(null);
    const [corriendo, setCorriendo] = useState<string | null>(null);
    useLayoutEffect(() => {
        const b = caja.current?.getBoundingClientRect(); if (!b) return;
        setPos({ x: Math.max(8, Math.min(x, window.innerWidth - b.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - b.height - 8)) });
    }, [x, y, opciones.length]);
    useEffect(() => {
        const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); alCerrar(); } };
        const afuera = (e: PointerEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) alCerrar(); };
        window.addEventListener("keydown", k, true); window.addEventListener("pointerdown", afuera, true);
        return () => { window.removeEventListener("keydown", k, true); window.removeEventListener("pointerdown", afuera, true); };
    }, [alCerrar]);
    const elegir = async (o: OpcionCanal) => {
        if (o.motivo || corriendo) return;
        if (o.confirmar && confirmando !== o.clave) { setConfirmando(o.clave); return; }
        setCorriendo(o.clave);
        try { await o.alElegir(); } finally { setCorriendo(null); alCerrar(); }
    };
    if (typeof document === "undefined") return null;
    return createPortal(
        <div ref={caja} role="menu" aria-label={`Acciones de ${titulo}`} onContextMenu={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}
            style={{ left: pos.x, top: pos.y }} className="fixed z-[var(--capa-menu)] w-[264px] rounded-[14px] visor-panel text-white p-1.5">
            <div className="px-2.5 pt-1.5 pb-2">
                <div className="text-[13px] font-bold truncate">{titulo}</div>
                {sub && <div className="text-[11px] text-white/60 truncate">{sub}</div>}
            </div>
            {opciones.map((o) => {
                const pide = confirmando === o.clave;
                return (
                    <div key={o.clave}>
                        {o.separa && <div className="my-1 mx-2 h-px bg-white/12" />}
                        <button type="button" role="menuitem" disabled={!!o.motivo || !!corriendo} onClick={() => void elegir(o)}
                            className={cn("w-full flex items-start gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-semibold transition-colors",
                                o.motivo ? "opacity-45 cursor-not-allowed" : pide ? "pleno-mal" : "hover:bg-white/12",
                                !pide && !o.motivo && o.tono === "mal" && "text-[color-mix(in_oklab,var(--mal)_55%,#fff)]", !pide && !o.motivo && o.tono === "bien" && "text-[color-mix(in_oklab,var(--bien)_55%,#fff)]")}>
                            <o.Icono size={16} className="shrink-0 mt-[1px]" />
                            <span className="min-w-0">
                                <span className="block leading-tight">{pide ? o.confirmar : o.rotulo}{corriendo === o.clave ? "…" : ""}</span>
                                {o.motivo && <span className="block text-[11px] font-normal text-white/70 mt-0.5">{o.motivo}</span>}
                            </span>
                        </button>
                    </div>
                );
            })}
        </div>, document.body);
}
