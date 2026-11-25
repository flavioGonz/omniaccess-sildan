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
export default async function RegistroConClave({ params, searchParams }: { params: Promise<{ clave: string }>; searchParams: Promise<{ de?: string }> }) {
    if (!(await funcionActiva("PADRON_CENSO"))) notFound();
    const { clave: cruda } = await params;
    const clave = normalizarClave(decodeURIComponent(cruda));
    const inv = clave
        ? await prisma.invitacionCenso.findUnique({ where: { clave }, select: { id: true, lote: true, lotes: true, email: true, nombre: true, clave: true, unitId: true } }).catch(() => null)
        : null;

    if (!inv) return <ClaveNoSirve />;
    /* El mismo código del lote le llega a todos sus residentes (25/11): el enlace de cada copia dice a
       quién (?de=…), y el formulario arranca con SU correo, no con el de la principal. Una copia de
       otro lote, o que no existe, se ignora: el enlace sigue sirviendo, sin saludar a nadie. */
    const { de } = await searchParams;
    const copia = de ? await prisma.copiaCenso.findFirst({ where: { id: String(de).slice(0, 40), invitacionId: inv.id }, select: { id: true, email: true, nombre: true } }).catch(() => null) : null;
    const { center } = await getBarrioMap();
    /* Una persona puede tener más de un lote (21/11: el código es por persona). Al formulario van
       los nombres y qué es de cada uno, nunca los ids: la carga se hace para UNO, que elige ella. */
    const lotes = (Array.isArray(inv.lotes) ? (inv.lotes as { nombre?: unknown; vinculo?: unknown }[]) : [])
        .filter((l) => typeof l?.nombre === "string" && l.nombre).map((l) => ({ nombre: String(l.nombre), vinculo: String(l.vinculo || "PROPIETARIO") }));
    /* Dónde queda el lote (25/11): el punto del plano del barrio, para que nadie tenga que pelearse
       con el GPS ni arrastrar el mapa hasta su techo. */
    const u = inv.unitId ? await prisma.unit.findUnique({ where: { id: inv.unitId }, select: { coordinates: true } }).catch(() => null) : null;
    const [lat, lng] = String(u?.coordinates || "").split(/[,;\s]+/).map(Number);
    const ubicacion: [number, number] | null = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0 ? [lat, lng] : null;
    return <Formulario centro={center} invitacion={{ clave: inv.clave, lote: lotes[0]?.nombre || inv.lote, lotes, email: copia?.email || inv.email, nombre: copia ? copia.nombre : inv.nombre, ubicacion, de: copia?.id }} />;
}
