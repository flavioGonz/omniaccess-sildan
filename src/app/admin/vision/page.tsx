import { redirect } from "next/navigation";

/**
 * /admin/vision ya no es una pantalla: era el «Laboratorio», que pasó a ser una analítica más
 * (/admin/vision/probar, en el desplegable de Analíticas). 21/10, Nico: «lo que tenemos en
 * /admin/vision debe estar en Analíticas, y retirar ese ítem Laboratorio del menú». La ruta
 * queda para que los enlaces y marcadores viejos no caigan en un 404: lleva a Analíticas.
 */
export default function OmniVision() {
    redirect("/admin/vision/analiticas");
}
