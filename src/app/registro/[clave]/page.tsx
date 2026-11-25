import { notFound } from "next/navigation";
import { funcionActiva } from "@/app/actions/funciones";
import { getBarrioMap } from "@/app/actions/barriomap";
import { prisma } from "@/lib/prisma";
import { normalizarClave } from "@/lib/censo-invitaciones";
import { Formulario, type CargaDelLote, type CargaPrevia } from "../Formulario";
import { lineaDeServicio } from "@/lib/censo-servidor";
import { ZONA } from "@/lib/fechas";
import { TIPOS_VEHICULO, type ServicioCargado, type VehiculoCargado } from "@/lib/registro-padron";
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
    /* Lo que ya cargó la gente de este lote (25/11, el código le llega a todos): para que el que entra
       vea qué hay y no cargue a ciegas lo mismo. Sólo de ESTE lote, sólo con su clave, y nunca las
       rechazadas. Sin teléfonos ni correos. */
    const filas = await prisma.solicitudPadron.findMany({
        where: { estado: { in: ["pendiente", "aprobada"] }, OR: [...(inv.unitId ? [{ unitId: inv.unitId }] : []), { clave: inv.clave }] },
        orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, nombre: true, apellido: true, createdAt: true, estado: true, vehiculos: true, servicios: true, paraUserId: true, email: true, telefono: true, tenencia: true, comentario: true, lat: true, lng: true },
    }).catch(() => []);
    const miCorreo = (copia?.email || "").trim().toLowerCase();
    const yo = copia ? await prisma.copiaCenso.findUnique({ where: { id: copia.id }, select: { userId: true } }).catch(() => null) : null;
    const rotulo = (t: string) => TIPOS_VEHICULO.find((x) => x.id === t)?.rotulo || t;
    /* De quién es cada carga: la de la copia por la que entró (su persona), o —entrando por el enlace
       de la principal— la que se hizo con el correo de la invitación y sin copia. */
    const esSuya = (c: (typeof filas)[number]) => copia
        ? !!((yo?.userId && c.paraUserId === yo.userId) || (miCorreo && c.email.trim().toLowerCase() === miCorreo))
        : !c.paraUserId && !!inv.email && c.email.trim().toLowerCase() === inv.email.trim().toLowerCase();
    /* Su carga que todavía espera revisión: el formulario arranca con ella para corregirla (25/11, el
       reclamo de que «todo vuelve a empezar desde cero»). Una ya aprobada no se reabre: se ve arriba
       como «(vos)» y lo nuevo es una carga nueva. */
    const mia = filas.find((c) => c.estado === "pendiente" && esSuya(c));
    const previa: CargaPrevia | null = mia ? {
        id: mia.id, cuando: mia.createdAt.toLocaleDateString("es-UY", { day: "numeric", month: "short", timeZone: ZONA }),
        datos: {
            nombre: mia.nombre, apellido: mia.apellido, telefono: mia.telefono, email: mia.email || copia?.email || inv.email,
            tenencia: mia.tenencia === "INQUILINO" ? "INQUILINO" : "PROPIETARIO", comentario: mia.comentario,
            vehiculos: ((mia.vehiculos as unknown as VehiculoCargado[]) || []).length ? (mia.vehiculos as unknown as VehiculoCargado[]) : [{ chapa: "", tipo: "PROPIO" }],
            servicios: (mia.servicios as unknown as ServicioCargado[]) || [], lat: mia.lat, lng: mia.lng,
        },
    } : null;
    const cargas: CargaDelLote[] = filas.map((c) => ({
        quien: [c.nombre, c.apellido].filter(Boolean).join(" ").trim() || "Alguien del lote",
        cuando: c.createdAt.toLocaleDateString("es-UY", { day: "numeric", month: "short", timeZone: ZONA }),
        estado: c.estado === "aprobada" ? "aprobada" : "pendiente",
        suya: esSuya(c),
        vehiculos: ((c.vehiculos as unknown as VehiculoCargado[]) || []).filter((v) => v?.chapa).map((v) => ({ chapa: v.chapa, tipo: v.tipo, detalle: [rotulo(v.tipo), v.marca, v.color].filter(Boolean).join(" · ") })),
        servicios: ((c.servicios as unknown as ServicioCargado[]) || []).map(lineaDeServicio),
    }));
    return <Formulario centro={center} cargas={cargas} previa={previa} invitacion={{ clave: inv.clave, lote: lotes[0]?.nombre || inv.lote, lotes, email: copia?.email || inv.email, nombre: copia ? copia.nombre : inv.nombre, ubicacion, de: copia?.id }} />;
}
