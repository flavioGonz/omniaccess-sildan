"use client";

import { Accessibility, Ambulance, BusFront, Car, CarTaxiFront, Clock, Globe, Landmark, Shield, Siren, Stethoscope, Tractor, Truck, type LucideIcon } from "lucide-react";
import { leerChapa, tipoDeChapa, type CategoriaChapa, type GrupoCategoria } from "@/lib/categoria-chapa";

/**
 * Lo que la matrícula dice del vehículo, dibujado SOBRE el vehículo.
 *
 * Pedido de Nico (18/11): «que esta clasificación se vea en las detecciones, con iconos sobre la
 * silueta del vehículo, que pueda clasificar en vivo y en playback». La clasificación ya existía
 * (lib/categoria-chapa) y sólo se usaba para filtrar el historial: el guardia que mira la pared
 * veía SMI 1234 y tenía que saberse la nomenclatura de memoria para entender que es un patrullero.
 *
 * Va pegada a la matrícula dibujada y no suelta en una esquina, porque con dos autos en el cuadro
 * una insignia suelta no dice de cuál habla.
 *
 * Colores: son los de la categoría sobre FOTO, no los tonos de estado del panel —la capa de
 * análisis usa su propia paleta por el mismo motivo: el fondo no es nuestra superficie.
 */
export const ICONO_TIPO: Record<string, LucideIcon> = {
    taxi: CarTaxiFront,
    remise: Car,
    transporte: BusFront,
    policia: Siren,
    ambulancia: Ambulance,
    oficial: Landmark,
    militar: Shield,
    diplomatico: Globe,
    alquiler: Car,
    carga: Truck,
    medico: Stethoscope,
    maquinaria: Tractor,
    discapacidad: Accessibility,
    temporal: Clock,
};

const COLOR_GRUPO_CAT: Record<GrupoCategoria, string> = {
    emergencia: "#ef4444",
    diplomatico: "#f59e0b",
    oficial: "#3b82f6",
    militar: "#64748b",
    publico: "#0ea5e9",
    comercial: "#94a3b8",
    especial: "#22c55e",
    temporal: "#f59e0b",
};

/** El ícono de una categoría: por su tipo de filtro, y si no lo tiene, por su grupo. */
const ICONO_GRUPO_CAT: Record<GrupoCategoria, LucideIcon> = {
    emergencia: Siren, diplomatico: Globe, oficial: Landmark, militar: Shield,
    publico: BusFront, comercial: Truck, especial: Car, temporal: Clock,
};

export function iconoDeCategoria(cat: CategoriaChapa, tipo: string | null): LucideIcon {
    return (tipo && ICONO_TIPO[tipo]) || ICONO_GRUPO_CAT[cat.grupo];
}

/**
 * La insignia, en coordenadas de la IMAGEN (como el resto de la capa), para que escale con la
 * foto igual que la matrícula dibujada.
 *
 * `ancla` dice dónde está el borde de la matrícula: la insignia se apoya encima (o debajo, si
 * arriba no entra) y centrada en ella.
 */
export function InsigniaChapa({ cat, tipo, cx, y, alto, haciaArriba, dudosa }: {
    cat: CategoriaChapa;
    tipo: string | null;
    /** Centro horizontal, en píxeles de la imagen. */
    cx: number;
    /** El borde de la matrícula del que cuelga. */
    y: number;
    /** Alto de la píldora, en píxeles de la imagen. */
    alto: number;
    haciaArriba: boolean;
    /** En el interior la categoría es «probable»: se dice con un signo, no se afirma. */
    dudosa?: boolean;
}) {
    // Búsqueda en el mapa y no una llamada: una función que devuelve un componente adentro del
    // render dispara la regla de «componente creado en el render» (y, bien mirada, tiene razón).
    const Icono = (tipo && ICONO_TIPO[tipo]) || ICONO_GRUPO_CAT[cat.grupo];
    const texto = dudosa ? `${cat.corto}?` : cat.corto;
    const f = alto * 0.58;
    const ic = alto * 0.68;
    // 0,56 por letra es lo medido para Outfit a este peso: alcanza para que el texto no toque el borde.
    const ancho = ic + f * 0.5 + texto.length * f * 0.56 + alto * 0.7;
    const x = cx - ancho / 2;
    const py = haciaArriba ? y - alto : y;
    const color = COLOR_GRUPO_CAT[cat.grupo];
    return (
        <g>
            {/* Un solo hijo de texto: dos (uno vacío) hacen que el servidor y el cliente dibujen
                distinto y React rehace el árbol entero. */}
            <title>{dudosa ? `${cat.nombre} (probable: en el interior la segunda letra también es la localidad)` : cat.nombre}</title>
            <rect x={x} y={py} width={ancho} height={alto} rx={alto / 2} fill={color} stroke="#0b0f19" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {/* El ícono de lucide es un <svg> propio: anidado escala solo con width/height. */}
            <Icono x={x + alto * 0.3} y={py + (alto - ic) / 2} width={ic} height={ic} color="#ffffff" strokeWidth={2.4} />
            <text x={x + alto * 0.3 + ic + f * 0.45} y={py + alto * 0.5} dominantBaseline="central" fontSize={f} fontWeight={800}
                fill="#ffffff" fontFamily="Outfit, system-ui, sans-serif">{texto}</text>
        </g>
    );
}

/** Lo que hay que dibujar para una matrícula, o null si no dice nada (particular, extranjera). */
export function categoriaDeChapa(plate: string | null | undefined): { cat: CategoriaChapa; tipo: string | null; dudosa: boolean } | null {
    const l = leerChapa(plate);
    if (!l?.categoria) return null;
    return { cat: l.categoria, tipo: tipoDeChapa(plate), dudosa: l.confianza === "probable" };
}
