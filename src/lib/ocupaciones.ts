import path from "path";
import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { notificarEvento } from "@/lib/reglas-notificacion";
import { avisarPorSocket } from "@/lib/avisar";
import { capturarCuadro, CUADROS_A_TIRAR } from "@/lib/cuadro";
import {
    ANCHO_MIRADA, VUELTAS_OCUPAR, VUELTAS_LIBERAR,
    cuadroUtil, enGrises, huellasDeLaFranja, juzgarCelda, leerEsquinas, leerVacio, refrescarVacio,
    type EstadoCelda, type Esquinas,
} from "@/lib/franja";

/**
 * Abrir y cerrar estadías mirando el LUGAR, no la chapa.
 *
 * El motor anterior no podía distinguir "el auto sigue" de "lo volví a leer", y cuando se
 * le agregó una mirada a los píxeles tampoco pudo distinguir "el auto sigue" de "acá no
 * cambió nada, porque acá no hay nada". Acá la pregunta es otra y por eso se contesta: la
 * franja no se mueve, su aspecto vacío se conoce, y un auto encima tapa la celda entera.
 *
 * Tres cosas que este archivo hace a propósito y conviene no deshacer:
 *
 * 1. **Un auto puede ocupar un lugar sin tener nombre.** `plate` queda en `null` hasta que
 *    una lectura caiga adentro de esa celda. Es la diferencia entre "hay un auto y no sé
 *    cuál" y "no hay un auto", y meterlas en la misma bolsa fue el error original.
 *
 * 2. **Hace falta insistir para abrir y para cerrar.** Un peatón, un camión que pasa
 *    delante o una sombra dan una vuelta ocupada; un auto estacionado da todas. Sin esa
 *    espera el panel parpadearía, que es la forma que tiene un dato malo de parecer vivo.
 *
 * 3. **Los avisos son los mismos de antes** (`PARKED` / `LEFT`, `estadia_abierta` /
 *    `estadia_cerrada`). Las reglas de notificación que el operador ya configuró y el mapa
 *    que ya los dibuja no se enteran de que abajo cambió el motor, que es como debería ser.
 */

/** Cuánto tiene que llevar ocupado el lugar para que sea *estacionó* y no *alguien frenó*. */
export const OCUPACION_MIN_MIN = Number(process.env.TRACKING_FRANJA_CONFIRMA_MIN || 3);

const carpeta = () => path.join(process.env.TRACKING_SHOTS_DIR || "/datos/track", "franja");

/** La racha de cada celda: positiva si viene ocupada, negativa si viene libre. */
type Nota = { rachas: number[]; mirada: string };

async function leerNota(id: string): Promise<Nota | null> {
    try { return JSON.parse(await fs.readFile(path.join(carpeta(), `${id}.json`), "utf8")); }
    catch { return null; }
}

async function guardarNota(id: string, nota: Nota) {
    try {
        await fs.mkdir(carpeta(), { recursive: true });
        await fs.writeFile(path.join(carpeta(), `${id}.json`), JSON.stringify(nota));
    } catch { /* la racha se puede perder: la próxima vuelta la reconstruye desde cero */ }
}

export type Resultado = {
    deviceId: string;
    medida: boolean;
    motivo?: string;
    celdas?: EstadoCelda[];
    abiertas?: number;
    cerradas?: number;
};

type Equipo = { id: string; name: string; rtspUrl: string | null };

type Fila = {
    id: string; lugar: number; deviceId: string; plate: string | null;
    desde: Date; hasta: Date; avisado: boolean;
};

/**
 * Una vuelta sobre la franja de una cámara.
 *
 * Toma UN cuadro. Todo lo demás es aritmética sobre una imagen de 320 px de ancho: no hay
 * GPU, no hay OCR y no hay una llamada por celda. Una cámara cuesta un ffmpeg por vuelta.
 */
export async function mirarLaFranja(equipo: Equipo): Promise<Resultado> {
    const franja = await prisma.franja.findUnique({ where: { deviceId: equipo.id } });
    if (!franja || !franja.activa) return { deviceId: equipo.id, medida: false, motivo: "sin franja activa" };
    if (!equipo.rtspUrl) return { deviceId: equipo.id, medida: false, motivo: "el equipo no tiene RTSP" };

    const esquinas = leerEsquinas(franja.esquinas);
    if (!esquinas) return { deviceId: equipo.id, medida: false, motivo: "la franja está mal dibujada" };

    const vacio = leerVacio(franja.vacio);
    // Sin referencia no se mide, y se dice. Inventar una — suponer que ahora está vacía, o
    // promediar lo que haya — es exactamente cómo nacieron los fantasmas que esto viene a
    // arreglar: un criterio que siempre contesta algo aunque no sepa.
    if (!vacio || vacio.length !== franja.lugares) {
        return { deviceId: equipo.id, medida: false, motivo: "falta aprender cómo se ve la franja vacía" };
    }

    let jpeg: Buffer;
    try { jpeg = await capturarCuadro(equipo.rtspUrl, { segundos: 15, tirar: CUADROS_A_TIRAR }); }
    catch (e: any) { return { deviceId: equipo.id, medida: false, motivo: e?.message || "no llegó video" }; }

    const mirada = await enGrises(jpeg, ANCHO_MIRADA);

    /* Un cuadro sin contraste no se puede juzgar, y decirlo es lo único honesto: una imagen
       gris no se parece a nada, así que juzgarla igual daría las seis celdas ocupadas. Pasa
       con el cuadro roto del decodificador HEVC, con la cámara a oscuras y con el lente
       tapado — tres problemas distintos, la misma respuesta correcta. */
    const util = cuadroUtil(mirada);
    if (!util.ok) {
        return { deviceId: equipo.id, medida: false, motivo: `el cuadro llegó sin contraste (${util.contraste.toFixed(1)})` };
    }

    const ahora = huellasDeLaFranja(mirada, esquinas, franja.lugares);
    const celdas = ahora.map((h, i) => juzgarCelda(i, h, vacio[i]));

    const nota = await leerNota(franja.id);
    const previas: number[] = nota?.rachas?.length === franja.lugares ? nota.rachas : new Array(franja.lugares).fill(0);
    const rachas = celdas.map((c, i) => (
        c.ocupado ? Math.max(1, previas[i] + 1) : Math.min(-1, previas[i] - 1)
    ));

    const abiertas: Fila[] = await prisma.ocupacion.findMany({
        where: { franjaId: franja.id, cerrada: false },
    });
    const porLugar = new Map(abiertas.map((o: Fila) => [o.lugar, o]));
    const ahoraMismo = new Date();
    let nuevas = 0, cerradas = 0;

    for (let i = 0; i < franja.lugares; i++) {
        const viva = porLugar.get(i) || null;

        if (rachas[i] >= VUELTAS_OCUPAR && !viva) {
            const creada = await prisma.ocupacion.create({
                data: {
                    franjaId: franja.id, deviceId: equipo.id, lugar: i,
                    // Se fecha en la vuelta en que EMPEZÓ a verse ocupado, no en esta:
                    // las vueltas de confirmación son parte de la estadía, no una espera
                    // previa, y contarlas después daría un reloj que arranca tarde.
                    desde: new Date(ahoraMismo.getTime() - (rachas[i] - 1) * 60_000),
                    hasta: ahoraMismo,
                },
            }).catch(() => null);
            if (creada) nuevas++;
            continue;
        }

        if (viva && rachas[i] > 0) {
            await prisma.ocupacion.update({ where: { id: viva.id }, data: { hasta: ahoraMismo } }).catch(() => { });
            await confirmarOcupacion({ ...viva, hasta: ahoraMismo }, equipo.name).catch(() => { });
            continue;
        }

        if (viva && rachas[i] <= -VUELTAS_LIBERAR) {
            await cerrarOcupacion(viva, equipo.name).catch(() => { });
            cerradas++;
        }
    }

    // La referencia se corrige sólo donde está libre: un lugar ocupado no tiene nada que
    // decir sobre cómo se ve vacío. Con esto la franja sigue al día que pasa — el asfalto
    // al atardecer no se parece al asfalto del mediodía — sin una referencia por hora.
    const libres = celdas.map((c) => !c.ocupado);
    await prisma.franja.update({
        where: { id: franja.id },
        data: { vacio: JSON.stringify(refrescarVacio(vacio, ahora, libres)) },
    }).catch(() => { });

    await guardarNota(franja.id, { rachas, mirada: ahoraMismo.toISOString() });

    return { deviceId: equipo.id, medida: true, celdas, abiertas: nuevas, cerradas };
}

/** *Estacionó*: una sola vez por ocupación, y recién cuando lleva un rato. */
export async function confirmarOcupacion(fila: Fila, cameraName: string) {
    if (fila.avisado) return false;
    if ((fila.hasta.getTime() - fila.desde.getTime()) / 60000 < OCUPACION_MIN_MIN) return false;

    // El flag se escribe antes de avisar y sólo si seguía en false: dos vueltas que se
    // pisen no pueden mandar el aviso dos veces.
    const tomado = await prisma.ocupacion.updateMany({
        where: { id: fila.id, avisado: false }, data: { avisado: true },
    });
    if (tomado.count === 0) return false;

    await notificarEvento({
        modulo: "LPR", evento: "PARKED",
        deviceId: fila.deviceId, deviceName: cameraName,
        plate: fila.plate || "",
        extra: { desde: fila.desde, lugar: fila.lugar + 1, minutos: Math.round((fila.hasta.getTime() - fila.desde.getTime()) / 60000) },
    }).catch(() => { });

    avisarPorSocket("estadia_abierta", {
        id: fila.id, plate: fila.plate, deviceId: fila.deviceId,
        cameraName, estDesde: fila.desde, lugar: fila.lugar,
    });
    return true;
}

/** *Se retiró*: sólo si antes se avisó que estacionó. */
export async function cerrarOcupacion(fila: Fila, cameraName: string) {
    const tomado = await prisma.ocupacion.updateMany({
        where: { id: fila.id, cerrada: false }, data: { cerrada: true },
    });
    if (tomado.count === 0) return false;
    if (!fila.avisado) return false;

    await notificarEvento({
        modulo: "LPR", evento: "LEFT",
        deviceId: fila.deviceId, deviceName: cameraName,
        plate: fila.plate || "",
        extra: {
            desde: fila.desde, hasta: fila.hasta, lugar: fila.lugar + 1,
            minutos: Math.round((fila.hasta.getTime() - fila.desde.getTime()) / 60000),
        },
    }).catch(() => { });

    avisarPorSocket("estadia_cerrada", { id: fila.id, plate: fila.plate, deviceId: fila.deviceId });
    return true;
}

/**
 * Ponerle nombre al ocupante de un lugar.
 *
 * Esto es todo lo que la chapa hace ahora: nombrar. No abre la estadía, no la sostiene y
 * no la cierra — y por eso `SDM1707`, `SDH1707` y `5DH177` dejan de ser tres autos: son
 * tres lecturas del ocupante del mismo lugar, y se queda la de más confianza.
 */
export async function nombrarOcupante(
    deviceId: string, lugar: number, plate: string, confianza: number, sightingId: string,
) {
    const viva = await prisma.ocupacion.findFirst({
        where: { deviceId, lugar, cerrada: false }, orderBy: { desde: "desc" },
    });
    if (!viva) return null;
    if (viva.plate && (viva.plateConf ?? 0) >= confianza) return viva;
    return prisma.ocupacion.update({
        where: { id: viva.id },
        data: { plate, plateConf: confianza, sightingId },
    }).catch(() => null);
}


/**
 * La franja de una cámara, con la geometría ya leída. Cacheada unos segundos.
 *
 * La ruta de avistamientos es el camino caliente del seguimiento — entra una vez por
 * vehículo y por ráfaga — y no puede pagar una consulta por lectura para preguntar algo
 * que cambia cuando el operador redibuja la franja, o sea casi nunca.
 */
const CACHE_FRANJA_MS = 30_000;
let cacheFranja: { al: number; porEquipo: Map<string, { id: string; esquinas: Esquinas; lugares: number }> } | null = null;

export async function franjaDe(deviceId: string) {
    if (!cacheFranja || Date.now() - cacheFranja.al > CACHE_FRANJA_MS) {
        const filas = await prisma.franja.findMany({ where: { activa: true } }).catch(() => []);
        const porEquipo = new Map<string, { id: string; esquinas: Esquinas; lugares: number }>();
        for (const f of filas) {
            const esq = leerEsquinas(f.esquinas);
            if (esq) porEquipo.set(f.deviceId, { id: f.id, esquinas: esq, lugares: f.lugares });
        }
        cacheFranja = { al: Date.now(), porEquipo };
    }
    return cacheFranja.porEquipo.get(deviceId) || null;
}

/** Para que un redibujo se note en el acto y no dentro de medio minuto. */
export const olvidarFranjas = () => { cacheFranja = null; };
