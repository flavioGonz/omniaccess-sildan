import { PantallaDeCarga } from "@/components/brand/CargaOmni";

/** Mientras llega una pantalla fuera del panel (login, consola, monitores): el loader de la marca, a pantalla completa. */
export default function Cargando() {
    return <PantallaDeCarga pantalla />;
}
