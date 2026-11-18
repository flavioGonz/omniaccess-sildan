import { notFound } from "next/navigation";
import { funcionActiva } from "@/app/actions/funciones";
import { getBarrioMap } from "@/app/actions/barriomap";
import { prisma } from "@/lib/prisma";
import { normalizarClave } from "@/lib/censo-invitaciones";
import { Formulario } from "../Formulario";
import { ClaveNoSirve } from "../ClaveNoSirve";

export const dynamic = "force-dynamic";

/**
 * El censo con la clave del lote: la dirección que viaja en el correo (/registro/ABCD-3456).
 *
 * El lote y el correo salen de la invitación, no de lo que escriba quien entra: la clave del
 * lote B4 no puede cargar el padrón del C7. El formulario muestra el lote y no lo deja cambiar.
 */
export default async function RegistroConClave({ params }: { params: Promise<{ clave: string }> }) {
    if (!(await funcionActiva("PADRON_CENSO"))) notFound();
    const { clave: cruda } = await params;
    const clave = normalizarClave(decodeURIComponent(cruda));
    const inv = clave
        ? await prisma.invitacionCenso.findUnique({ where: { clave }, select: { lote: true, email: true, nombre: true, clave: true } }).catch(() => null)
        : null;

    if (!inv) return <ClaveNoSirve />;
    const { center } = await getBarrioMap();
    return <Formulario centro={center} invitacion={{ clave: inv.clave, lote: inv.lote, email: inv.email, nombre: inv.nombre }} />;
}
