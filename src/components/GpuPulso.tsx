"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pista } from "@/components/ui/pista";

/**
 * La GPU, en vivo y de reojo, en el sidebar: el uso en porcentaje, y al pasar el mouse la
 * memoria de video, los vatios y la temperatura.
 *
 * Antes mostraba vatios y no porcentaje, y había una razón: con el lector de matrículas
 * trabado, un hilo de CUDA girando en vacío marcaba 100 % con la placa a 37,5 de 70 W. Medido
 * el 9/10/2026, con el lector de a un pedido (MAX_EN_VUELO=1) y el carril rápido de visión
 * sólo con movimiento: en reposo 2 % y 24 W, así que el porcentaje vuelve a decir trabajo. Igual
 * se cuida el caso viejo: uso alto con vatios bajos no se pinta como carga, se avisa como
 * «uso sin consumo», que es la firma de ese giro en vacío.
 *
 * El dato viene de /api/gpu/vivo, que comparte una lectura cada pocos segundos entre todas las
 * sesiones. Si deja de llegar, el indicador se apaga solo: un número viejo mostrado como de
 * ahora es peor que ninguno.
 */

type Vivo = {
    hay: boolean; uso?: number; memUsada?: number; memTotal?: number; watts?: number | null; limite?: number | null;
    temp?: number | null; enGpu?: boolean | null; edadSeg?: number;
    /** Sin lectura: por qué (ver /api/gpu/vivo). */
    motivo?: "sin-placa" | "sin-driver"; detalle?: string | null;
};

/** Cada cuánto se pregunta: la ruta comparte una lectura de 4 s, más seguido no trae nada nuevo. */
const CADA_MS = 5000;
/** Más viejo que esto ya no es «en vivo». */
const VIEJA_SEG = 30;
/** Uso alto con menos de esta fracción del límite de potencia: la placa no está calculando. */
const GIRO_EN_VACIO = { uso: 85, potencia: 0.6 };

export function GpuPulso({ collapsed }: { collapsed?: boolean }) {
    const [p, setP] = useState<Vivo | null>(null);
    const [recibido, setRecibido] = useState(0);

    useEffect(() => {
        let vivo = true;
        const leer = async () => {
            if (document.hidden) return;
            try {
                const r = await fetch("/api/gpu/vivo", { cache: "no-store" });
                if (!r.ok) return;
                const d = await r.json();
                if (vivo) { setP(d); setRecibido(Date.now()); }
            } catch { }
        };
        leer();
        const iv = setInterval(leer, CADA_MS);
        return () => { vivo = false; clearInterval(iv); };
    }, []);

    // Sin lectura no se esconde: una placa que no responde es justo lo que hay que ver. Antes el
    // indicador desaparecía y el lab corría todo en CPU sin que el menú lo dijera.
    if (p && !p.hay) {
        const sinDriver = p.motivo !== "sin-placa";
        const texto = (
            <span className="block space-y-1.5 text-[12px] leading-snug">
                {sinDriver ? (
                    <>
                        <span className="block text-[var(--mal-texto)] font-semibold">La placa no responde.</span>
                        <span className="block">El driver de NVIDIA no está cargado (o el servidor no deja usarlo): OmniVision y el lector de matrículas corren en CPU, mucho más lentos, y no se puede entrenar.</span>
                        <span className="block text-muted-foreground">Si el equipo tiene Secure Boot, hay que enrolar la llave del driver en la consola, o apagar Secure Boot.</span>
                        {p.detalle && <span className="block text-muted-foreground font-mono text-[10.5px] break-words">{p.detalle}</span>}
                    </>
                ) : (
                    <span className="block">Este servidor no tiene una placa NVIDIA (no hay nvidia-smi): todo corre en CPU.</span>
                )}
            </span>
        );
        return (
            <Pista titulo={sinDriver ? "GPU sin driver" : "Sin GPU"} texto={texto} ancho={270}>
                <Link href="/admin/vision/entrenar/salud" aria-label={sinDriver ? "GPU sin driver" : "Sin GPU"}
                    className={cn("flex items-center gap-1.5 rounded-lg border px-2 py-1.5 shrink-0 transition-colors hover:bg-accent", sinDriver ? "border-[color-mix(in_oklab,var(--mal)_45%,var(--border))]" : "border-border bg-card/60", collapsed && "px-1.5")}>
                    <span className={cn("h-2 w-2 rounded-full shrink-0", sinDriver ? "bg-[var(--mal)] animate-pulse" : "bg-muted-foreground/40")} />
                    {!collapsed && <span className={cn("text-xs font-semibold", sinDriver ? "text-[var(--mal-texto)]" : "text-muted-foreground")}><span className="text-[10px] mr-0.5 opacity-75">GPU</span>{sinDriver ? "sin driver" : "no hay"}</span>}
                    {collapsed && <Cpu size={13} className="text-muted-foreground" />}
                </Link>
            </Pista>
        );
    }
    if (!p?.hay || p.uso == null) return null;

    const edad = (p.edadSeg ?? 0) + (Date.now() - recibido) / 1000;
    const vieja = edad > VIEJA_SEG;
    const fracW = p.watts != null && p.limite ? p.watts / p.limite : null;
    const giro = p.uso >= GIRO_EN_VACIO.uso && fracW != null && fracW < GIRO_EN_VACIO.potencia;

    const tono = vieja ? "bg-muted-foreground/40"
        : giro ? "bg-[var(--aviso)]"
            : p.uso >= 85 ? "bg-[var(--mal)]"
                : p.uso >= 60 ? "bg-[var(--aviso)]"
                    : "bg-[var(--bien)]";

    const fila = (k: string, v: string) => <span className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{v}</span></span>;
    const detalle = (
        <span className="block space-y-1 text-[12px]">
            {fila("Uso", `${p.uso} %`)}
            {p.memUsada != null && p.memTotal ? fila("Memoria de video", `${(p.memUsada / 1024).toFixed(1)} de ${(p.memTotal / 1024).toFixed(0)} GB`) : null}
            {p.watts != null ? fila("Potencia", p.limite ? `${Math.round(p.watts)} de ${Math.round(p.limite)} W` : `${Math.round(p.watts)} W`) : null}
            {p.temp != null ? fila("Temperatura", `${p.temp} °C`) : null}
            {giro && <span className="block pt-1 text-[var(--aviso-texto)]">Uso alto sin consumo: la placa no está calculando. Suele ser el lector trabado girando en vacío.</span>}
            {p.enGpu === false && <span className="block pt-1 text-[var(--mal-texto)]">El lector de matrículas NO está usando la placa.</span>}
            {vieja && <span className="block pt-1 text-muted-foreground">Sin datos nuevos hace {Math.round(edad)} s.</span>}
        </span>
    );

    return (
        <Pista titulo="GPU en vivo" texto={detalle} ancho={250}>
            <Link
                href="/admin/settings"
                className={cn(
                    "flex items-center gap-1.5 rounded-lg border border-border bg-card/60 hover:bg-accent transition-colors px-2 py-1.5 shrink-0",
                    collapsed && "px-1.5",
                )}
            >
                <span className={cn("h-2 w-2 rounded-full shrink-0", tono)} />
                {!collapsed && (
                    <span className={cn("text-xs font-semibold tabular-nums", vieja ? "text-muted-foreground" : "text-foreground/90")}>
                        <span className="text-[10px] text-muted-foreground mr-0.5">GPU</span>{p.uso}<span className="text-[10px] text-muted-foreground ml-0.5">%</span>
                    </span>
                )}
                {collapsed && <Cpu size={13} className="text-muted-foreground" />}
            </Link>
        </Pista>
    );
}
