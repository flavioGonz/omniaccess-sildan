import { PantallaDeCarga } from "@/components/brand/CargaOmni";

/**
 * Mientras cambia de pantalla dentro del panel: el loader de la marca en el área de contenido (el
 * menú y la barra quedan donde están). Antes no había nada: la pantalla vieja quedaba congelada
 * hasta que llegaba la nueva, y parecía que el clic no había andado.
 */
export default function CargandoPanel() {
    return <PantallaDeCarga />;
}
