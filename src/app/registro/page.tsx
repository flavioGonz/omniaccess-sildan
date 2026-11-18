import { funcionActiva } from "@/app/actions/funciones";
import { getBarrioMap } from "@/app/actions/barriomap";
import { notFound } from "next/navigation";
import { Formulario } from "./Formulario";

export const dynamic = "force-dynamic";

/**
 * La puerta del censo. La función «Auto-registro del padrón» viene apagada de fábrica: esta
 * dirección es pública y escribe en la base, así que se enciende cuando el barrio lo pidió.
 *
 * Apagada no se explica: se contesta como cualquier dirección que no existe. Una página que dice
 * «el censo está deshabilitado» le confirma a cualquiera que acá hay un censo.
 *
 * Del mapa del barrio se saca SÓLO el centro, acá en el servidor. Es lo único que el formulario
 * necesita para abrir el mapa en el lugar correcto, y así esta página pública nunca sirve los
 * lotes, los perímetros ni —sobre todo— dónde está cada cámara.
 */
export default async function Registro() {
    if (!(await funcionActiva("PADRON_CENSO"))) notFound();
    const { center } = await getBarrioMap();
    return <Formulario centro={center} />;
}
