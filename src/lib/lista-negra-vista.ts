import { prisma } from "@/lib/prisma";
import { avisarPorSocket } from "@/lib/avisar";
import { crearAviso } from "@/lib/visitas/registro";
import { esRequerida, motivoALaVista } from "@/lib/min-interior";
import { nombreCamara } from "@/lib/rostros";

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
export async function avisarListaNegraALaVista(v: { plate: string; camara: string | null; foto: string | null }): Promise<void> {
    try {
        const plate = limpia(v.plate);
        const hallada = (await negrasVigentes()).get(plate);
        if (!hallada) return;
        // El nombre de la cámara y el rótulo viejo llegan con las entidades de HTML («Ext. -&gt; Cairoli»): el aviso se lee tal cual.
        const camara = nombreCamara(v.camara);
        const n = { ...hallada, etiqueta: nombreCamara(hallada.etiqueta) || "" };
        const creado = await crearAviso({
            tipo: "LISTA_NEGRA_VISTA", plate, camara, motivo: motivoALaVista(n, camara),
            datos: { foto: v.foto || null, requerida: n.requerida, etiqueta: n.etiqueta, motivoLista: n.motivo },
        }, VENTANA_MIN);
        if (creado) { anunciado.set(plate, Date.now()); return; }
        if (Date.now() - (anunciado.get(plate) || 0) < REANUNCIAR_MS) return;
        const pendiente = await prisma.avisoGuardia.findFirst({ where: { tipo: "LISTA_NEGRA_VISTA", plate, atendidoAt: null }, orderBy: { creado: "desc" } });
        anunciado.set(plate, Date.now());
        if (pendiente) avisarPorSocket("aviso_guardia", { accion: "nuevo", aviso: pendiente });
    } catch { /* la lectura sigue su camino */ }
}
