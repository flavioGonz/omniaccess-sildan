import {
    Armchair, Boxes, Box, Caravan, Cctv, Construction, Container, Cylinder, DoorOpen, Droplets, Drum, Fence, Flag, Flame, Forklift, Fuel, Hammer, HardHat,
    Lamp, Leaf, Lock, Mailbox, Package, Recycle, ShoppingCart, Shovel, Signpost, Star, Tag, ToyBrick, Tractor, TrafficCone, Trash2, TreePine, TriangleAlert, Truck, Zap,
    type LucideIcon,
} from "lucide-react";
import { PREFIJO_ICONO_IMAGEN, type ClaveIcono } from "@/lib/detector-propio";

/**
 * El dibujo de cada ícono que se puede elegir para una clase entrenada. Las claves están en
 * lib/detector-propio (ICONOS_CLASE), que también lee el servidor; el `Record<ClaveIcono, …>`
 * hace que no compile si una clave se queda sin dibujo.
 */
export const DIBUJO_ICONO: Record<ClaveIcono, LucideIcon> = {
    tacho: Trash2, reciclaje: Recycle, cono: TrafficCone, obra: Construction, caja: Box, paquete: Package,
    contenedor: Container, barril: Drum, cilindro: Cylinder, carretilla: Forklift, camion: Truck, tractor: Tractor,
    casilla: Caravan, carro: ShoppingCart, pala: Shovel, martillo: Hammer, cerco: Fence, puerta: DoorOpen,
    cartel: Signpost, farol: Lamp, fuego: Flame, agua: Droplets, rayo: Zap, combustible: Fuel,
    arbol: TreePine, hoja: Leaf, sillon: Armchair, buzon: Mailbox, candado: Lock, camara: Cctv,
    casco: HardHat, pelota: ToyBrick, bandera: Flag, aviso: TriangleAlert, estrella: Star, etiqueta: Tag,
};
/** El de siempre, para una clase sin ícono elegido. */
export const ICONO_CLASE_DEFECTO: LucideIcon = Boxes;

/** Lo guardado en ClasePropia.icono, resuelto: un dibujo de la lista o la dirección de la imagen subida. */
export function resolverIcono(icono: string | null | undefined): { dibujo: LucideIcon; imagen?: undefined } | { imagen: string; dibujo?: undefined } {
    if (icono?.startsWith(PREFIJO_ICONO_IMAGEN)) return { imagen: icono.slice(PREFIJO_ICONO_IMAGEN.length) };
    return { dibujo: (icono && DIBUJO_ICONO[icono as ClaveIcono]) || ICONO_CLASE_DEFECTO };
}

/** El ícono de una clase, para HTML (la lista de clases, el selector). En el vivo lo dibuja CapaAnalisis, en SVG. */
export function IconoClase({ icono, size = 16, className }: { icono: string | null | undefined; size?: number; className?: string }) {
    const r = resolverIcono(icono);
    // eslint-disable-next-line @next/next/no-img-element
    if (r.imagen) return <img src={r.imagen} alt="" width={size} height={size} className={className} style={{ width: size, height: size, objectFit: "contain" }} />;
    const D = r.dibujo!;
    return <D size={size} className={className} />;
}
