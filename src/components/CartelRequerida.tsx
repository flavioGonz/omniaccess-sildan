import { Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { REQUERIDA_CORTA, confirmacionDe } from "@/lib/min-interior";

/**
 * El cartel de «matrícula requerida por el Ministerio del Interior».
 *
 * Por qué es una pieza y no un chip más (13/11, Nico: «una vez detectada una matrícula requerida
 * por el ministerio, en todas las búsquedas, estados, fotos, debe indicar la fecha de consulta y
 * confirmación, cartel visual claro»). Hasta ese día una requerida se veía igual que cualquier
 * otra de la lista negra: un chip rojo que decía «Lista negra» y, con suerte, el motivo cortado.
 * Y no son lo mismo: la lista negra la carga el barrio; esta la confirmó el sitio oficial, tiene
 * fecha, y lo que corresponde es llamar al 9-1-1. Tiene que leerse igual en el visor, en el
 * Monitor LPR, en la pared y en el Historial, así que se dibuja en un solo lugar.
 *
 * La fecha sale del motivo con que se cargó en la lista (lib/min-interior → motivoRequerida): no
 * hay otra consulta. Si el motivo no la trae (una fila cargada a mano con la misma etiqueta), el
 * cartel no inventa una fecha: dice que está requerida y nada más.
 *
 * Tres tamaños, porque se lee a tres distancias:
 *   - `sello`: una miniatura (tira de la pared, mosaico del Historial, fila de tabla). Sólo la
 *     sirena y dos palabras; la fecha va en la ayuda al pasar.
 *   - `cartel`: sobre una foto o en la franja de un visor. Dos renglones.
 *   - `pared`: la lectura grande del Monitor LPR de la pared, a varios metros.
 *
 * Late (`cartel-requerida`, globals.css) salvo en `sello`: cuarenta sellos latiendo en un mosaico
 * serían ruido, y el rojo pleno ya alcanza.
 */
export function CartelRequerida({ motivo, tam = "cartel", className }: {
    /** El motivo de la fila de la lista: de ahí sale «confirmada el …». */
    motivo?: string | null;
    tam?: "sello" | "cartel" | "pared";
    className?: string;
}) {
    const confirmada = confirmacionDe(motivo);
    const cuando = confirmada ? `Confirmada en el sitio oficial el ${confirmada}` : "Confirmada en el sitio oficial";
    if (tam === "sello") {
        return (
            <span title={`Matrícula requerida por el Ministerio del Interior. ${cuando}. Está en la lista negra.`}
                className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 pleno-mal text-[9px] font-bold uppercase tracking-[0.08em] whitespace-nowrap", className)}>
                <Siren size={11} className="shrink-0" />{REQUERIDA_CORTA}
            </span>
        );
    }
    const pared = tam === "pared";
    return (
        <span role="alert" className={cn("cartel-requerida inline-flex items-center pleno-mal text-left", pared ? "gap-4 rounded-2xl px-5 py-3" : "gap-2.5 rounded-[8px] px-3.5 py-1.5 min-h-9", className)}>
            <Siren size={pared ? 38 : 18} className="shrink-0" />
            <span className="min-w-0">
                <span className={cn("block font-black uppercase leading-tight", pared ? "text-[clamp(20px,2.2vw,30px)] tracking-[0.06em]" : "text-[12px] tracking-[0.08em]")}>Matrícula requerida · Ministerio del Interior</span>
                <span className={cn("block font-semibold opacity-90 tabular-nums", pared ? "text-[16px] mt-1" : "text-[11px]")}>{cuando} · en lista negra</span>
            </span>
        </span>
    );
}
