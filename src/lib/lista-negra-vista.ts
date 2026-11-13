import { prisma } from "@/lib/prisma";
import { avisarPorSocket } from "@/lib/avisar";
import { crearAviso } from "@/lib/visitas/registro";
import { esRequerida, motivoALaVista } from "@/lib/min-interior";
import { nombreCamara } from "@/lib/rostros";
import { ESTADOS_DE_ESTADIA } from "@/lib/estadias";
import { motivoDePartida, puedeSerLaMisma } from "@/lib/seguimiento-chapa";

/**
 * Una chapa de la lista negra leída por una cámara de SEGUIMIENTO.
 *
 * Por qué existe (13/11). La lista negra sólo saltaba cuando la chapa pasaba por un acceso
 * (server.js, al armar el AccessEvent). Las cámaras comunes que leen matrículas —las que ven un
 * auto estacionado en la calle— guardaban el avistamiento y no le avisaban a nadie. El caso que
 * lo mostró: SCH1707, confirmada como requerida por el Ministerio del Interior, estacionada
 * frente a una cámara de seguimiento; el sistema la leía y la guardaba en silencio.
 *
 * Es un aviso de la guardia (AvisoGuardia), no un evento de acceso: no hubo barrera ni decisión.
 * Así queda en Gestión de alarmas, salta en la pila de toda la app y en la pared, y se decide
 * (real / falsa) como cualquier otro.
 *
 * UN aviso por chapa mientras nadie lo atienda, y después de atendido no vuelve a saltar hasta
 * pasada VENTANA_MIN: un auto quieto se vuelve a leer con cada vehículo que cruza, y un aviso por
 * lectura serían decenas por hora de lo mismo (crearAviso ya hace esa comprobación con candado).
 *
 * Mientras siga sin atender se vuelve a ANUNCIAR cada REANUNCIAR_MS, sin crear nada: la pila de
 * avisos es en vivo y una pantalla abierta después (o recargada) no lo tendría. Quien ya lo tiene
 * lo reconoce por su clave y no lo duplica.
 *
 * Límite conocido: avisa por el TEXTO leído. Una lectura equivocada que coincida con una chapa de
 * la lista dispara igual; por eso lleva la foto y se decide a mano.
 */

/** Cada cuánto se relee la lista negra (una consulta chica, compartida por todas las lecturas). */
const NEGRAS_MS = 15_000;
/** Atendido el aviso, cuánto pasa hasta que la misma chapa a la vista vuelve a avisar. */
const VENTANA_MIN = 6 * 60;
/** Sin atender: cada cuánto se vuelve a anunciar a las pantallas. */
const REANUNCIAR_MS = 10 * 60_000;

type Negra = { requerida: boolean; etiqueta: string; motivo: string | null };
let negras: { al: number; porChapa: Map<string, Negra> } = { al: 0, porChapa: new Map() };
const anunciado = new Map<string, number>();
const limpia = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function negrasVigentes(): Promise<Map<string, Negra>> {
    if (Date.now() - negras.al < NEGRAS_MS) return negras.porChapa;
    const filas = await prisma.plateWatch.findMany({ where: { active: true, category: "BLACKLISTED" }, select: { plate: true, label: true, motivo: true } });
    negras = { al: Date.now(), porChapa: new Map(filas.map((f) => [limpia(f.plate), { requerida: esRequerida(f.label, f.motivo), etiqueta: f.label, motivo: f.motivo }])) };
    return negras.porChapa;
}

/** Se llama con cada avistamiento válido. No tira: un aviso que falla no puede perder la lectura. */
export async function avisarListaNegraALaVista(v: { plate: string; camara: string | null; foto: string | null; deviceId?: string | null }): Promise<void> {
    try {
        const plate = limpia(v.plate);
        const hallada = (await negrasVigentes()).get(plate);
        if (!hallada) return;
        // El nombre de la cámara y el rótulo viejo llegan con las entidades de HTML («Ext. -&gt; Cairoli»): el aviso se lee tal cual.
        const camara = nombreCamara(v.camara);
        const n = { ...hallada, etiqueta: nombreCamara(hallada.etiqueta) || "" };
        const creado = await crearAviso({
            tipo: "LISTA_NEGRA_VISTA", plate, camara, motivo: motivoALaVista(n, camara),
            // `deviceId`: para que la pared de cámaras sepa en qué cuadro resaltarla.
            datos: { foto: v.foto || null, requerida: n.requerida, etiqueta: n.etiqueta, motivoLista: n.motivo, deviceId: v.deviceId || null },
        }, VENTANA_MIN);
        if (creado) { anunciado.set(plate, Date.now()); return; }
        if (Date.now() - (anunciado.get(plate) || 0) < REANUNCIAR_MS) return;
        const pendiente = await prisma.avisoGuardia.findFirst({ where: { tipo: "LISTA_NEGRA_VISTA", plate, atendidoAt: null }, orderBy: { creado: "desc" } });
        anunciado.set(plate, Date.now());
        if (pendiente) avisarPorSocket("aviso_guardia", { accion: "nuevo", aviso: pendiente });
    } catch { /* la lectura sigue su camino */ }
}

/** Atendido un «se fue», la misma chapa no vuelve a avisar su partida antes de esto (la estadía pudo reabrirse y cerrarse). */
const VENTANA_SE_FUE_MIN = 10;

/**
 * La partida de una chapa de la lista negra: quedó vacío su lugar (lib/ocupaciones — la franja o
 * la analítica de estacionamiento, que miden el LUGAR). No se llama desde las estadías por chapa
 * (lib/estadias): esas se cierran cuando dejan de leerla, que no es lo mismo que irse.
 *
 * Dos cuidados, los dos por el mismo defecto conocido —un auto quieto leído con dos o tres chapas—:
 *  - la estadía que se cierra puede estar a nombre de una mala lectura (SDH1707 por SCH1707): vale
 *    si en esa cámara, durante esa estadía, también se leyó la chapa de la lista;
 *  - y que se cierre una de esas estadías no quiere decir que el auto se fue: si en la misma cámara
 *    queda abierta otra a nombre de una lectura parecida, sigue ahí y no se avisa nada.
 * No tira: un aviso que falla no puede romper el cierre de la estadía.
 */
export async function avisarPartidaDeListaNegra(v: { id: string; plate: string | null; camara: string | null; deviceId: string | null; desde: Date | null; hasta: Date | null; foto?: string | null }): Promise<void> {
    try {
        if (!v.plate) return;
        const negras = await negrasVigentes();
        if (!negras.size) return;
        const leida = limpia(v.plate), hasta = v.hasta || new Date();
        let chapa: string | null = negras.has(leida) ? leida : null;
        if (!chapa && v.deviceId && v.desde) {
            for (const n of negras.keys()) {
                if (!puedeSerLaMisma(n, leida)) continue;
                if (await prisma.plateSighting.count({ where: { plate: n, deviceId: v.deviceId, timestamp: { gte: v.desde, lte: hasta } } })) { chapa = n; break; }
            }
        }
        if (!chapa) return;
        if (v.deviceId) {
            const abiertas = await prisma.plateSighting.findMany({ where: { deviceId: v.deviceId, estCerrada: false, estado: { in: [...ESTADOS_DE_ESTADIA] }, estDesde: { not: null }, id: { not: v.id } }, select: { plate: true }, take: 50 });
            if (abiertas.some((a) => puedeSerLaMisma(chapa!, limpia(a.plate)))) return;
        }
        const n = negras.get(chapa)!, camara = nombreCamara(v.camara);
        await crearAviso({
            tipo: "LISTA_NEGRA_SE_FUE", plate: chapa, camara,
            motivo: motivoDePartida(camara, v.desde ? v.desde.getTime() : null, hasta.getTime(), leida !== chapa ? leida : null),
            datos: { foto: v.foto || null, requerida: n.requerida, deviceId: v.deviceId || null, desde: v.desde?.toISOString() || null, hasta: hasta.toISOString() },
        }, VENTANA_SE_FUE_MIN);
    } catch { /* el cierre de la estadía sigue su camino */ }
}
