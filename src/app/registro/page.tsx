import { funcionActiva } from "@/app/actions/funciones";
import { notFound } from "next/navigation";
import { Formulario } from "./Formulario";

export const dynamic = "force-dynamic";

/**
 * La puerta del censo. La función «Auto-registro del padrón» viene apagada de fábrica: esta
 * dirección es pública y escribe en la base, así que se enciende cuando el barrio lo pidió.
 *
 * Apagada no se explica: se contesta como cualquier dirección que no existe. Una página que dice
 * «el censo está deshabilitado» le confirma a cualquiera que acá hay un censo.
 */
export default async function Registro() {
    if (!(await funcionActiva("PADRON_CENSO"))) notFound();
    return <Formulario />;
}
