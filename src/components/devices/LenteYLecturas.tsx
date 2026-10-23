"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, Focus, Loader2, ScanLine, ZoomIn, ZoomOut, Plus, Minus } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { useTiempoReal } from "@/lib/tiempo-real";
import { Matricula } from "@/components/ui/celdas";

/*
 * Dos cosas sobre el video de la ficha del equipo (17/10, Nico):
 *   · el ZOOM y el FOCO del lente motorizado, para ajustar una cámara LPR sin entrar a su web;
 *   · las LECTURAS EN VIVO encima del video, para ver qué lee mientras se ajusta: lo que manda la
 *     cámara por ANPR (access_event) y lo que lee omni-lpr en el seguimiento (lectura_lpr).
 * Las dos van juntas a propósito: se ajusta el lente mirando si la chapa se sigue leyendo.
 * Las lecturas no le piden nada nuevo al lector: muestran las que el sistema ya hace.
 */

const vidrio = "bg-black/50 backdrop-blur-md ring-1 ring-white/15 text-white";
/** Si se suelta el botón fuera de la pantalla, el lente se para igual a los 5 s. */
const TOPE_MOVIMIENTO_MS = 5000;

type Lente = { zoom: boolean; foco: boolean; habilitado: boolean; motivo?: string };

/** Sin `tt` (una pantalla sin ReactTooltip, como el calibrador) la ayuda va en el `title` nativo. */
const ayudaDe = (tt: string | undefined, texto?: string) => (tt ? { "data-tooltip-id": tt, "data-tooltip-content": texto } : { title: texto });

export function ControlesLente({ deviceId, tt, className }: { deviceId: string; tt?: string; className?: string }) {
    const [lente, setLente] = useState<Lente | null>(null);
    const [autofoco, setAutofoco] = useState(false);
    const moviendo = useRef<{ que: string; t: ReturnType<typeof setTimeout> } | null>(null);

    useEffect(() => {
        let vivo = true;
        fetch(`/api/devices/lente?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" })
            .then((r) => r.json()).then((j) => { if (vivo) setLente(j); }).catch(() => { });
        return () => { vivo = false; };
    }, [deviceId]);

    const mandar = useCallback(async (que: string, sentido: number) => {
        const r = await fetch(`/api/devices/lente?deviceId=${encodeURIComponent(deviceId)}`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ que, sentido }),
        }).catch(() => null);
        if (!r) { toast.error({ title: "La cámara no respondió" }); return false; }
        if (!r.ok) { const j = await r.json().catch(() => ({})); toast.error({ title: "No se movió el lente", description: j?.error || `El servidor respondió ${r.status}` }); return false; }
        return true;
    }, [deviceId]);

    const parar = useCallback(() => {
        const m = moviendo.current; if (!m) return;
        clearTimeout(m.t); moviendo.current = null;
        void mandar(m.que, 0);
    }, [mandar]);
    // Al cerrar la ficha con el botón apretado, el lente no queda girando.
    useEffect(() => () => { parar(); }, [parar]);

    if (!lente || (!lente.zoom && !lente.foco)) return null;
    const off = !lente.habilitado;

    // Una función que devuelve el botón (no un componente): definido adentro, se remontaría en cada render.
    const mantener = ({ que, sentido, icono: I, ayuda }: { que: "zoom" | "foco"; sentido: 1 | -1; icono: any; ayuda: string }) => (
        <button key={`${que}${sentido}`} type="button" disabled={off} aria-label={ayuda}
            {...ayudaDe(tt, off ? lente.motivo : `${ayuda} (mantener apretado)`)}
            onPointerDown={(e) => {
                if (off) return;
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                parar();
                moviendo.current = { que, t: setTimeout(parar, TOPE_MOVIMIENTO_MS) };
                void mandar(que, sentido);
            }}
            onPointerUp={parar} onPointerCancel={parar} onLostPointerCapture={parar}
            className="h-8 w-8 grid place-items-center rounded-full hover:bg-white/15 active:bg-white/25 disabled:opacity-40 touch-none select-none">
            <I size={15} />
        </button>
    );

    return (
        <div className={cn("absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 rounded-full p-1", vidrio, className)}>
            {lente.zoom && <>
                {mantener({ que: "zoom", sentido: 1, icono: ZoomIn, ayuda: "Acercar (zoom)" })}
                {mantener({ que: "zoom", sentido: -1, icono: ZoomOut, ayuda: "Alejar (zoom)" })}
            </>}
            {lente.zoom && lente.foco && <span className="w-4 h-px bg-white/25 my-0.5" />}
            {lente.foco && <>
                <span className="text-white/60" {...ayudaDe(tt, "Foco")}><Focus size={12} /></span>
                {mantener({ que: "foco", sentido: 1, icono: Plus, ayuda: "Foco: más lejos" })}
                {mantener({ que: "foco", sentido: -1, icono: Minus, ayuda: "Foco: más cerca" })}
                <button type="button" disabled={off || autofoco} aria-label="Autofoco"
                    {...ayudaDe(tt, off ? lente.motivo : "Autofoco: la cámara busca el foco sola sobre lo que ve ahora")}
                    onClick={async () => { setAutofoco(true); await mandar("autofoco", 0); setTimeout(() => setAutofoco(false), 2500); }}
                    className="h-8 w-8 grid place-items-center rounded-full hover:bg-white/15 disabled:opacity-40">
                    {autofoco ? <Loader2 size={15} className="animate-spin" /> : <Crosshair size={15} />}
                </button>
            </>}
        </div>
    );
}

type Lectura = { id: string; plate: string; confianza: number | null; fuente: "Cámara" | "omni-lpr"; ts: number; decision?: string | null; baja?: boolean };
/** Cuántas se ven a la vez, y cuánto queda cada una antes de desvanecerse. */
const MAX_LECTURAS = 4;
const VIDA_MS = 90_000;

const confianzaDe = (details: unknown): number | null => {
    const m = /Confianza:\s*(\d{1,3})\s*%/i.exec(String(details || ""));
    return m ? Number(m[1]) / 100 : null;
};

export function LecturasEnVivo({ deviceId, tt }: { deviceId: string; tt: string }) {
    const [lecturas, setLecturas] = useState<Lectura[]>([]);
    const [, setTic] = useState(0);
    useEffect(() => { const i = setInterval(() => setTic((x) => x + 1), 1000); return () => clearInterval(i); }, []);

    const sumar = useCallback((l: Lectura) => {
        setLecturas((xs) => [l, ...xs.filter((x) => !(x.plate === l.plate && x.fuente === l.fuente && Math.abs(x.ts - l.ts) < 3000))].slice(0, MAX_LECTURAS));
    }, []);
    useTiempoReal("access_event", (e: any) => {
        const id = e?.deviceId || e?.device?.id;
        if (id !== deviceId || !e?.plateDetected) return;
        const p = String(e.plateDetected);
        if (/^(unknown|NO_LEIDA|S\/P)$/i.test(p)) return;
        sumar({ id: String(e.id || `${p}-${Date.now()}`), plate: p, confianza: confianzaDe(e.details), fuente: "Cámara", ts: Date.now(), decision: e.decision || null });
    });
    useTiempoReal("lectura_lpr", (e: any) => {
        if (e?.deviceId !== deviceId || !e?.plate) return;
        sumar({ id: `lpr-${e.plate}-${Date.now()}`, plate: String(e.plate), confianza: typeof e.confianza === "number" ? e.confianza : null, fuente: "omni-lpr", ts: Date.now(), baja: !!e.baja });
    });

    const vivas = lecturas.filter((l) => Date.now() - l.ts < VIDA_MS);
    return (
        <div className="absolute left-4 top-[92px] flex flex-col items-start gap-1.5 pointer-events-auto">
            {vivas.length === 0 ? (
                <span className={cn("inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold", vidrio)}
                    data-tooltip-id={tt} data-tooltip-content="Cada matrícula que lea esta cámara (su ANPR) u omni-lpr aparece acá al instante.">
                    <ScanLine size={13} className="animate-pulse" /> Esperando lecturas…
                </span>
            ) : vivas.map((l, i) => {
                const s = Math.round((Date.now() - l.ts) / 1000);
                return (
                    <span key={l.id} className={cn("inline-flex items-center gap-2 h-8 pl-1 pr-2.5 rounded-full text-[11px] font-semibold oa-aparecer transition-opacity", vidrio, i > 0 && "opacity-75", l.baja && "opacity-60")}
                        data-tooltip-id={tt} data-tooltip-content={`${l.fuente === "Cámara" ? "La leyó la cámara (ANPR)" : "La leyó omni-lpr"}${l.confianza != null ? ` con ${Math.round(l.confianza * 100)} %` : ""}${l.baja ? " · por debajo del mínimo: se descarta" : ""}${l.decision === "GRANT" ? " · autorizado" : l.decision === "DENY" ? " · denegado" : ""}`}>
                        <Matricula p={l.plate} />
                        {l.confianza != null && <span className="tabular-nums">{Math.round(l.confianza * 100)} %</span>}
                        <span className="text-white/60">{l.fuente === "Cámara" ? "ANPR" : "omni-lpr"} · {s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`}</span>
                    </span>
                );
            })}
        </div>
    );
}
