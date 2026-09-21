/**
 * GET /api/users/:id/historial — todo lo que el sistema sabe de una persona, en una línea
 * de tiempo.
 *
 * ## Por qué hace falta que esté junto
 *
 * Hoy la misma persona deja rastro en cuatro lugares y cada uno se mira en otra pantalla:
 * los accesos con su identidad quedan en AccessEvent; las lecturas de sus matrículas en la
 * barrera quedan en AccessEvent pero muchas veces SIN userId (la cámara leyó una chapa, no
 * reconoció a una persona); las lecturas del seguimiento adentro del barrio quedan en
 * PlateSighting; y las llamadas del portero en CallEvent. Para contestar "¿a qué hora
 * entró y por dónde anduvo?" había que abrir cuatro pantallas y cruzarlas a mano.
 *
 * ## La parte que importa: por qué se busca por chapa y no sólo por userId
 *
 * Un evento de barrera se guarda con `plateDetected` y, cuando el sistema pudo atribuirlo,
 * con `userId`. Cuando no pudo —porque la matrícula está cargada en el vehículo pero el
 * evento entró por otro camino, o porque el OCR la leyó distinto— el evento existe igual y
 * no aparece en ninguna consulta por persona. Filtrar sólo por userId daría una auditoría
 * incompleta que PARECE completa, que es la peor forma de estar mal: se concluye que la
 * persona no pasó cuando en realidad pasó y no se la reconoció.
 *
 * Por eso cada fila trae `atribucion`: "directa" cuando el evento apunta a la persona, y
 * "por matrícula" cuando se lo trajo la chapa de uno de sus vehículos. Es una diferencia
 * real y la pantalla tiene que poder mostrarla en vez de esconderla.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Tope de filas por origen. Una auditoría es para leerla, no para descargar la base. */
const TOPE = 300;

/** Ventana por defecto, en días. */
const DIAS_POR_DEFECTO = 90;

type Fila = {
    id: string;
    momento: string;
    origen: "acceso" | "lectura" | "seguimiento" | "llamada";
    atribucion: "directa" | "por matricula";
    tipo: string | null;
    decision: string | null;
    equipo: string | null;
    lugar: string | null;
    matricula: string | null;
    foto: string | null;
    detalle: string | null;
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const dias = Math.min(365, Math.max(1, parseInt(req.nextUrl.searchParams.get("dias") || String(DIAS_POR_DEFECTO), 10)));
    const desde = new Date(Date.now() - dias * 24 * 3600 * 1000);

    try {
        const persona = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true, name: true, accessTags: true,
                vehicles: { select: { plate: true } },
                credentials: { select: { type: true, value: true } },
            },
        });
        if (!persona) return NextResponse.json({ ok: false, error: "no existe esa persona" }, { status: 404 });

        // Las chapas de la persona: las de sus vehículos y las cargadas como credencial.
        // Se normalizan porque el mismo auto entra escrito de las dos formas según quién lo
        // haya cargado, y una comparación exacta perdería la mitad de los eventos.
        const chapas = [...new Set([
            ...persona.vehicles.map((v) => v.plate),
            ...persona.credentials.filter((c) => c.type === "PLATE").map((c) => c.value),
        ].map((p) => (p || "").toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean))];

        const [accesos, porChapa, avistamientos, llamadas] = await Promise.all([
            prisma.accessEvent.findMany({
                where: { userId: id, timestamp: { gte: desde } },
                orderBy: { timestamp: "desc" }, take: TOPE,
                include: { device: { select: { name: true, location: true } } },
            }),
            // Estas dos van en SQL crudo por una razón concreta: la comparación tiene que
            // NORMALIZAR LOS DOS LADOS. La chapa del vehículo se carga a mano y aparece como
            // "SDM 1707", "sdm-1707" o "SDM1707" según quién la escribió; la cámara escribe
            // siempre alfanumérico. Un `in` de Prisma compara literal, así que la mitad de
            // los eventos de esa persona no aparecerían — y una auditoría incompleta que
            // parece completa es justo lo que esto no puede ser.
            chapas.length
                ? prisma.$queryRaw<any[]>`
                    SELECT e.*, d."name" AS "equipoNombre", d."location" AS "equipoLugar"
                    FROM "AccessEvent" e LEFT JOIN "Device" d ON d."id" = e."deviceId"
                    WHERE e."timestamp" >= ${desde}
                      AND regexp_replace(upper(e."plateDetected"), '[^A-Z0-9]', '', 'g') = ANY(${chapas})
                      AND (e."userId" IS NULL OR e."userId" <> ${id})
                    ORDER BY e."timestamp" DESC LIMIT ${TOPE}`
                : Promise.resolve([] as any[]),
            chapas.length
                ? prisma.$queryRaw<any[]>`
                    SELECT s.* FROM "PlateSighting" s
                    WHERE s."timestamp" >= ${desde}
                      AND regexp_replace(upper(s."plate"), '[^A-Z0-9]', '', 'g') = ANY(${chapas})
                    ORDER BY s."timestamp" DESC LIMIT ${TOPE}`
                : Promise.resolve([] as any[]),
            // El portero registra la llamada contra el nombre o el id del llamador; se
            // consultan los dos porque según el equipo viene uno u otro.
            prisma.callEvent.findMany({
                where: { timestamp: { gte: desde }, OR: [{ callerId: id }, { calleeId: id }] },
                orderBy: { timestamp: "desc" }, take: TOPE,
                include: { device: { select: { name: true, location: true } } },
            }),
        ]);

        const filas: Fila[] = [
            ...accesos.map((e): Fila => ({
                id: `acc:${e.id}`,
                momento: e.timestamp.toISOString(),
                origen: "acceso",
                atribucion: "directa",
                tipo: e.accessType || null,
                decision: e.decision,
                equipo: e.device?.name || null,
                lugar: e.device?.location || e.location || null,
                matricula: e.plateDetected || e.plateNumber || null,
                foto: e.snapshotPath || e.imagePath || null,
                detalle: e.details || null,
            })),
            ...porChapa.map((e: any): Fila => ({
                id: `chapa:${e.id}`,
                momento: new Date(e.timestamp).toISOString(),
                origen: "lectura",
                atribucion: "por matricula",
                tipo: e.accessType || "PLATE",
                decision: e.decision,
                equipo: e.equipoNombre || null,
                lugar: e.equipoLugar || e.location || null,
                matricula: e.plateDetected || e.plateNumber || null,
                foto: e.snapshotPath || e.imagePath || null,
                detalle: e.userId ? "el evento está atribuido a otra persona" : null,
            })),
            ...avistamientos.map((s: any): Fila => ({
                id: `vis:${s.id}`,
                momento: new Date(s.timestamp).toISOString(),
                origen: "seguimiento",
                atribucion: "por matricula",
                tipo: s.eventType || s.source,
                decision: s.decision || null,
                equipo: s.cameraName || null,
                lugar: s.cameraName || null,
                matricula: s.plate,
                foto: s.snapshotUrl || null,
                detalle: s.estado === "ESTACIONADO"
                    ? `estacionado${s.estDesde ? " desde " + new Date(s.estDesde).toISOString() : ""}`
                    : null,
            })),
            ...llamadas.map((c): Fila => ({
                id: `lla:${c.id}`,
                momento: c.timestamp.toISOString(),
                origen: "llamada",
                atribucion: "directa",
                tipo: c.direction,
                decision: null,
                equipo: c.device?.name || null,
                lugar: c.device?.location || null,
                matricula: null,
                foto: null,
                detalle: `${c.status}${c.duration ? ` · ${c.duration}s` : ""}`,
            })),
        ].sort((a, b) => b.momento.localeCompare(a.momento));

        // Los totales se cuentan sobre lo que efectivamente se devuelve, no con un count
        // aparte: si el tope recortó, un resumen mayor a la lista visible haría creer que
        // la pantalla está escondiendo algo.
        const resumen = {
            total: filas.length,
            accesos: filas.filter((f) => f.origen === "acceso").length,
            lecturas: filas.filter((f) => f.origen === "lectura").length,
            seguimiento: filas.filter((f) => f.origen === "seguimiento").length,
            llamadas: filas.filter((f) => f.origen === "llamada").length,
            concedidos: filas.filter((f) => f.decision === "GRANT").length,
            denegados: filas.filter((f) => f.decision === "DENY").length,
        };

        return NextResponse.json({
            ok: true,
            persona: { id: persona.id, name: persona.name },
            dias,
            chapas,
            // Se dice si algún origen llegó al tope: una lista cortada en silencio es una
            // auditoría que miente por omisión.
            recortado: [accesos, porChapa, avistamientos, llamadas].some((l) => l.length >= TOPE),
            tope: TOPE,
            resumen,
            filas,
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "no se pudo armar el historial" }, { status: 500 });
    }
}
