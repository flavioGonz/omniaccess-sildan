import { prisma } from "@/lib/prisma";
import { avisarPorSocket } from "@/lib/avisar";
import { notificarEvento } from "@/lib/reglas-notificacion";
import { estaEnListaNegra, detalleListaNegra } from "@/lib/lista-negra";

/**
 * Una lectura del contenedor en una cámara que mira un ACCESO se convierte en un evento
 * de acceso — el mismo registro que deja una lectora de barrera.
 *
 * Por qué existe: la cámara de la entrada de San Nicolás (.86) no tiene ANPR; la lee el
 * contenedor por RTSP y sus lecturas quedaban como avistamientos del seguimiento. Para
 * el guardia eso era una entrada que no figuraba en el monitor LPR, ni en el historial,
 * ni en el reporte, ni en el `ultimo` del bot. Un acceso es un acceso venga de donde
 * venga: la diferencia entre ANPR y lectura por RTSP se anota en el evento (Metodo) para
 * que se sepa cómo se leyó, y la confianza del OCR va al lado, porque una lectura al 62 %
 * no vale lo mismo que una al 97 %.
 *
 * La decisión se toma como en server.js para las lectoras: la matrícula está cargada
 * como credencial → PERMITIDO (o DENEGADO si el modo LPR es lista negra); si no, DENEGADO.
 * Esta cámara no abre nada: "permitido" acá significa "vehículo conocido", igual que en
 * la barrera cuando la decide el servidor y no la cámara.
 */

/** Cómo se leyó la chapa; aparece en `details` como `Metodo: …`. */
export const METODO_RTSP = "RTSP Detect";
export const METODO_ANPR = "ANPR";

/**
 * Dos lecturas de la misma chapa en la misma cámara dentro de esta ventana son el mismo
 * paso: el contenedor puede volver a leer al auto que espera en la barrera. Dos minutos
 * es más que lo que tarda un auto en entrar y menos que lo que tarda en salir y volver.
 */
const ANTIRREBOTE_ACCESO_MIN = 2;

type Lectura = {
    sightingId: string;
    plate: string;
    deviceId: string | null | undefined;
    eventType: string | null | undefined;
    confidence: number | null | undefined;
    reads: number | null | undefined;
    snapshotUrl: string | null | undefined;
    timestamp: Date;
};

/** Devuelve el id del AccessEvent creado, o null si no correspondía. Nunca lanza. */
export async function registrarPasoPorAcceso(l: Lectura): Promise<string | null> {
    try {
        if (!l.deviceId || (l.eventType !== "ENTRY" && l.eventType !== "EXIT")) return null;
        const device = await prisma.device.findUnique({ where: { id: l.deviceId } });
        if (!device || !device.trackAcceso) return null;

        const desde = new Date(l.timestamp.getTime() - ANTIRREBOTE_ACCESO_MIN * 60 * 1000);
        const repetido = await prisma.accessEvent.findFirst({
            where: { deviceId: device.id, plateDetected: l.plate, timestamp: { gte: desde } },
            select: { id: true },
        });
        if (repetido) return repetido.id;

        const credential = await prisma.credential.findFirst({
            where: { type: "PLATE", value: l.plate },
            include: { user: { include: { unit: true } } },
        });
        // La lista negra manda sobre la credencial y el modo (misma regla que server.js).
        const negra = await estaEnListaNegra(l.plate);
        let decision: "GRANT" | "DENY" = "DENY";
        if (negra.negra) decision = "DENY";
        else if (credential) {
            const modo = (await prisma.setting.findUnique({ where: { key: "MODE_LPR" } }))?.value || "WHITELIST";
            decision = modo === "BLACKLIST" ? "DENY" : "GRANT";
        }

        const confianza = l.confidence != null ? Math.round(Number(l.confidence) * 100) : null;
        const details = [
            negra.negra ? detalleListaNegra(negra.motivo) : null,
            `Metodo: ${METODO_RTSP}`,
            confianza != null ? `Confianza: ${confianza}%` : null,
            l.reads != null ? `Lecturas: ${l.reads}` : null,
            "Source: Server",
        ].filter(Boolean).join(", ");

        const event = await prisma.accessEvent.create({
            data: {
                deviceId: device.id,
                credentialId: credential?.id || null,
                userId: credential?.user?.id || null,
                timestamp: l.timestamp,
                accessType: "PLATE",
                direction: l.eventType,
                decision,
                snapshotPath: l.snapshotUrl || null,
                plateNumber: l.plate,
                plateDetected: l.plate,
                details,
            },
        });
        await prisma.plateSighting.update({ where: { id: l.sightingId }, data: { accessEventId: event.id, decision } }).catch(() => null);

        // La misma forma que emite server.js para las lectoras: el monitor no distingue.
        const watch = negra.watch ? { label: negra.watch.label, category: negra.watch.category, color: negra.watch.color, source: negra.watch.origen === "rol" ? "role" : "manual", motivo: negra.watch.motivo } : null;
        avisarPorSocket("access_event", { ...event, device, user: credential?.user || null, direction: event.direction, watch, guest: null });
        notificarEvento({
            modulo: "LPR",
            evento: credential ? (decision === "GRANT" ? "ALLOW" : "DENY") : "UNKNOWN",
            deviceId: device.id, deviceName: device.name,
            plate: l.plate, direction: event.direction, snapshotPath: event.snapshotPath,
            instante: l.timestamp.getTime(),
        }).catch(() => 0);
        if (negra.watch && (negra.watch.category === "BLACKLISTED" || negra.watch.category === "SEARCH")) {
            notificarEvento({
                modulo: "LPR", evento: "WATCHLIST", deviceId: device.id, deviceName: device.name,
                plate: l.plate, direction: event.direction, snapshotPath: event.snapshotPath,
                instante: l.timestamp.getTime(),
                extra: { categoria: negra.watch.category, motivo: negra.motivo, origen: negra.origen },
            } as any).catch(() => 0);
        }
        return event.id;
    } catch (e) {
        console.error("[paso-por-acceso] no se pudo registrar el acceso:", (e as any)?.message);
        return null;
    }
}
