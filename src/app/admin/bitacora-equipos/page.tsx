import { redirect } from "next/navigation";

/**
 * Era «Bitácora de equipos» (18/11) y desde el 24/11 es el Monitor Face, en /admin/face: Nico
 * pidió el nombre nuevo porque es un historial de capturas de rostros, no una bitácora. La
 * dirección vieja queda para los marcadores y los enlaces que ya circulaban.
 */
export default function BitacoraEquiposPage() {
    redirect("/admin/face");
}
