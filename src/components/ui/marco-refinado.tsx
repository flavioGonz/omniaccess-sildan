"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Clock01Icon, ImageNotFound01Icon, Loading03Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

/*
 * Un marco para una imagen que todavía no llegó (20/10, Nico: «usaremos esta animación para cuando
 * tengamos que hacer loading de imágenes … siempre cuidando el rendimiento y la velocidad de carga.
 * Es solo un mimo visual»).
 *
 * La idea es la de RefineFrame de React Bits (reactbits.dev, Micro › Refine Frame, licencia MIT):
 * la imagen pasa por etapas —en cola, trayendo, afinando, lista— sin mover el layout, con un brillo
 * que barre mientras trabaja y una pastilla que dice en qué etapa está. Está escrita de nuevo y no
 * copiada, por el costo: el original dibuja cada etapa en un <canvas> (el pixelado que se afina), y
 * en Buscar parecidos van sesenta miniaturas a la vez. Acá todo es CSS que corre en la GPU: una trama
 * de píxeles de fondo, el barrido (una banda con `transform`, sin repintar), y la foto que entra
 * desenfocada y sin color y se afina en dos pasos. No pide nada extra al servidor.
 *
 * Si la imagen ya estaba en caché (vuelve a la grilla, la misma búsqueda) entra directo: animar lo
 * que ya está es demora disfrazada. Con «reducir movimiento» del sistema no hay barrido ni afinado.
 */

/** cola: todavía no hay qué pedir · cargando: pedida · afinando: llegó y se está enfocando · listo · error. */
export type EtapaMarco = "cola" | "cargando" | "afinando" | "listo" | "error";

/** Lo que dura el primer paso del afinado (desenfocada → casi): el segundo lo hace la transición. */
const PRIMER_PASO_MS = 260;

const ROTULO: Record<Exclude<EtapaMarco, "listo">, { texto: string; icono: typeof Clock01Icon; gira?: boolean }> = {
    cola: { texto: "En cola", icono: Clock01Icon },
    cargando: { texto: "Trayendo", icono: Loading03Icon, gira: true },
    afinando: { texto: "Afinando", icono: SparklesIcon },
    error: { texto: "Sin imagen", icono: ImageNotFound01Icon },
};

export function MarcoRefinado({ src, alt = "", etapa: forzada, className, imgClassName, style, retardo = 0, conEtapa = true, carga = "lazy", children }: {
    /** Sin src, el marco queda «en cola» (un lugar reservado mientras se busca). */
    src?: string | null;
    alt?: string;
    /** Para forzar una etapa (los lugares vacíos de una búsqueda en curso, por ejemplo). */
    etapa?: EtapaMarco;
    className?: string;
    imgClassName?: string;
    style?: CSSProperties;
    /** Posición en una grilla: desfasa el barrido para que no pasen todos juntos como una ola. */
    retardo?: number;
    /** La pastilla con la etapa. */
    conEtapa?: boolean;
    carga?: "lazy" | "eager";
    /** Lo que va encima (datos, controles): se dibuja sobre la foto. */
    children?: ReactNode;
}) {
    const [llego, setLlego] = useState<"no" | "afinando" | "si" | "error">("no");
    const ref = useRef<HTMLImageElement>(null);
    // Otra imagen en el mismo marco: vuelve a empezar. Si ya está decodificada (caché), entra directo.
    useEffect(() => {
        const el = ref.current;
        setLlego(el && el.complete && el.naturalWidth > 0 ? "si" : "no");
    }, [src]);
    useEffect(() => {
        if (llego !== "afinando") return;
        const t = setTimeout(() => setLlego("si"), PRIMER_PASO_MS);
        return () => clearTimeout(t);
    }, [llego]);

    const etapa: EtapaMarco = forzada ?? (!src ? "cola" : llego === "error" ? "error" : llego === "no" ? "cargando" : llego === "afinando" ? "afinando" : "listo");
    const trabajando = etapa === "cola" || etapa === "cargando" || etapa === "afinando";
    const rotulo = etapa !== "listo" ? ROTULO[etapa] : null;

    return (
        <div className={cn("relative overflow-hidden bg-[#0b0e13] isolate", className)} style={style} aria-busy={trabajando || undefined}>
            {/* La trama: se ve mientras no hay foto y se va cuando la foto está entera. */}
            <div aria-hidden className={cn("absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none",
                "bg-[linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.045)_1px,transparent_1px)] bg-[size:11px_11px]",
                etapa === "listo" ? "opacity-0" : "opacity-100")} />
            {src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img ref={ref} src={src} alt={alt} loading={carga} decoding="async" draggable={false}
                    onLoad={() => setLlego((v) => (v === "si" ? v : "afinando"))} onError={() => setLlego("error")}
                    className={cn("absolute inset-0 w-full h-full object-cover motion-reduce:transition-none",
                        "transition-[filter,opacity,scale] ease-out",
                        etapa === "cargando" || etapa === "cola" ? "opacity-0 blur-xl saturate-0 scale-[1.08] duration-0"
                            : etapa === "afinando" ? "opacity-100 blur-[5px] saturate-[.55] scale-[1.03] duration-[260ms]"
                                : etapa === "error" ? "opacity-0" : "opacity-100 blur-0 saturate-100 scale-100 duration-[520ms]",
                        imgClassName)} />
            )}
            {/* El barrido: una banda clara que cruza mientras se trabaja. Sólo `transform`: no repinta la foto. */}
            {trabajando && (
                <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden motion-reduce:hidden">
                    <div className="absolute inset-y-0 -left-1/2 w-1/2 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.09),transparent)] animate-[marco-barrido_1.6s_cubic-bezier(.45,0,.25,1)_infinite]"
                        style={{ animationDelay: `${(retardo % 8) * 110}ms` }} />
                </div>
            )}
            {conEtapa && rotulo && (
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[1] h-6 pl-1.5 pr-2.5 rounded-full bg-black/55 backdrop-blur-md border border-white/10 text-white/80 text-[10.5px] font-semibold inline-flex items-center gap-1.5 pointer-events-none whitespace-nowrap">
                    <HugeiconsIcon icon={rotulo.icono} size={13} strokeWidth={1.8} className={cn(rotulo.gira && "animate-spin motion-reduce:animate-none")} />
                    {rotulo.texto}
                </span>
            )}
            {children}
        </div>
    );
}
