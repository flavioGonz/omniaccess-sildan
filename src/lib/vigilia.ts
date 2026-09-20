import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { capturarCuadro, leerMatriculas, type Recorte } from "@/lib/cuadro";
import { leerCaja, type Caja } from "@/lib/recuadros";
import { mismaChapa } from "@/lib/matriculas";

/**
 * Ir a mirar si el auto sigue ahí, sin gastar GPU.
 *
 * El seguimiento sabe de un auto sólo cuando alguien lo lee, y a un auto quieto se lo lee
 * de rebote: cuando OTRO vehículo dispara una ráfaga y la chapa parada aparece de casualidad
 * en el mismo cuadro. En una calle con tránsito eso pasa seguido. En una calle tranquila,
 * no: una de las cámaras de acá tuvo UNA lectura en dos horas. Entonces el auto se queda sin
 * relecturas, la estadía se da por vencida, y el plano deja de mostrar un auto que está
 * estacionado enfrente de la cámara.
 *
 * La respuesta obvia —releerle la chapa cada tanto— es la cara: sacarle la matrícula a un
 * cuadro entero son dos docenas de inferencias, y de noche encima falla, que es justo cuando
 * más se necesita. Y falla de la peor manera: "no leí la chapa" se confunde con "el auto no
 * está".
 *
 * Pero para saber si un auto sigue estacionado no hace falta leerle la chapa. Alcanza con
 * mirar el pedazo de calle donde estaba y ver si sigue habiendo un auto ahí. Eso son píxeles,
 * y los píxeles no necesitan GPU.
 *
 * Así que la vigilia son dos pasos, y el segundo casi nunca corre:
 *
 *   1. HUELLA (sin GPU). Se recorta el pedazo de imagen donde estaba el auto, se lo reduce a
 *      una miniatura en grises y se lo compara con la miniatura de la última vez. Si se
 *      parecen, el auto sigue ahí. Medido contra la cámara de la Calle 22, con el auto
 *      quieto: 2,1 a 2,6 de diferencia media por píxel a lo largo de casi dos minutos. El
 *      mismo recorte movido a otro pedazo de la calle: 55,8. La separación es de veinte
 *      veces, así que el umbral no es una apuesta.
 *
 *   2. LECTURA (con GPU, sólo si la huella cambió). Algo cambió en ese pedazo: el auto se
 *      fue, o pasó un camión por delante, o alguien prendió una luz. Recién ahí se le pide
 *      al lector la matrícula — y sobre el recorte, que es una fracción del cuadro, no sobre
 *      la calle entera.
 *
 * Y hay un tercer resultado que importa tanto como los otros dos: **no se pudo mirar**. Si la
 * cámara no contesta o el lector está caído, la respuesta no es "se fue": es que no se sabe.
 * Confundir esas dos cosas es exactamente lo que haría dar por retirado a un vehículo que
 * está ahí, y sobre esa afirmación después alguien toma una decisión.
 */

/** Cuánta diferencia media por píxel separa "es lo mismo" de "algo cambió". */
export const VIGILIA_UMBRAL = Number(process.env.TRACKING_VIGILIA_UMBRAL || 12);

/**
 * Cuántas miradas seguidas sin encontrarlo hacen falta para darlo por ido.
 *
 * Una sola no alcanza: un camión estacionado delante, alguien parado, un reflejo — cualquiera
 * de esas tapa el lugar por un rato y en una sola mirada se vuelve "se fue".
 */
export const VIGILIA_FALLAS = Number(process.env.TRACKING_VIGILIA_FALLAS || 2);

/** Cuántas cámaras se miran por vuelta. Cada mirada es un ffmpeg: no pueden ser todas juntas. */
export const VIGILIA_POR_VUELTA = Number(process.env.TRACKING_VIGILIA_POR_VUELTA || 4);

/** El lado de la miniatura con la que se compara. 24×24 son 576 bytes y alcanzan de sobra. */
const LADO = Number(process.env.TRACKING_VIGILIA_LADO || 24);

/**
 * Cuánto se agranda el recuadro de la chapa para abarcar el auto.
 *
 * La caja guardada es la de la MATRÍCULA, que es un rectángulo chico en el paragolpes. Mirar
 * sólo eso sería mirar una chapa, y una chapa tapada por una sombra ya cambia. Agrandándola
 * se mira el auto entero y su pedazo de calle, que es lo que de verdad cambia cuando se va.
 */
const VECES_ANCHO = Number(process.env.TRACKING_VIGILIA_ANCHO || 4);
const VECES_ALTO = Number(process.env.TRACKING_VIGILIA_ALTO || 5);

const carpeta = () => path.join(process.env.TRACKING_SHOTS_DIR || "/datos/track", "vigilia");

export type Mirada = {
    resultado: "sigue" | "se fue" | "no se pudo";
    /** Si hubo que molestar al lector. Sirve para poder afirmar cuánto cuesta esto. */
    gpu: boolean;
    detalle: string;
    distancia?: number;
    fallas: number;
};

/**
 * La nota que queda entre mirada y mirada. Un archivito por estadía abierta.
 *
 * `huella` es el lugar con el auto puesto: la última vez que se pudo afirmar que estaba.
 * `huellaNueva` es el lugar después de que algo cambió y no se encontró la chapa. Guardar
 * las dos es lo que permite distinguir un camión que pasó por delante de un auto que se
 * fue: lo primero vuelve a parecerse a `huella` en la mirada siguiente, lo segundo se queda
 * pareciéndose a `huellaNueva`.
 */
type Nota = { huella: string; huellaNueva?: string; fallas: number; mirada: string };

/**
 * El pedazo de cuadro donde estaba el auto.
 *
 * Sin caja no se inventa un encuadre: se usa la zona de interés de la cámara, que es lo que
 * esa cámara mira de todos modos. Es peor recorte —abarca toda la calle— pero es honesto, y
 * la huella sigue funcionando: si el auto se va, esa zona cambia igual.
 */
export function encuadre(bbox: string | null, zona: Recorte): Recorte {
    const caja = leerCaja(bbox) as Caja | null;
    if (!caja) return zona;
    const cx = caja.x + caja.w / 2;
    const cy = caja.y + caja.h / 2;
    const w = Math.min(1, caja.w * VECES_ANCHO);
    const h = Math.min(1, caja.h * VECES_ALTO);
    return {
        x: Math.min(1 - w, Math.max(0, cx - w / 2)),
        y: Math.min(1 - h, Math.max(0, cy - h / 2)),
        w, h,
    };
}

/** La miniatura en grises de un JPEG. Es ffmpeg otra vez, que ya está y no necesita GPU. */
function huella(jpeg: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ff = spawn("ffmpeg", [
            "-hide_banner", "-loglevel", "error",
            "-f", "image2pipe", "-i", "pipe:0",
            "-vf", `scale=${LADO}:${LADO},format=gray`,
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
        ]);
        const trozos: Buffer[] = [];
        const corte = setTimeout(() => { ff.kill("SIGKILL"); reject(new Error("ffmpeg no contestó")); }, 10000);
        ff.stdout.on("data", (d) => trozos.push(d));
        ff.on("error", (e) => { clearTimeout(corte); reject(e); });
        ff.on("close", () => {
            clearTimeout(corte);
            const b = Buffer.concat(trozos);
            if (b.length < LADO * LADO) return reject(new Error("la miniatura salió corta"));
            resolve(b.subarray(0, LADO * LADO));
        });
        ff.stdin.on("error", () => { /* si ffmpeg ya murió, el close de arriba lo cuenta */ });
        ff.stdin.end(jpeg);
    });
}

/** Diferencia media por píxel, de 0 (idénticas) a 255. */
export function distancia(a: Buffer, b: Buffer): number {
    const n = Math.min(a.length, b.length);
    if (!n) return 255;
    let suma = 0;
    for (let i = 0; i < n; i++) suma += Math.abs(a[i] - b[i]);
    return suma / n;
}

async function leerNota(id: string): Promise<Nota | null> {
    try { return JSON.parse(await fs.readFile(path.join(carpeta(), `${id}.json`), "utf8")); }
    catch { return null; }
}

async function guardarNota(id: string, nota: Nota) {
    try {
        await fs.mkdir(carpeta(), { recursive: true });
        await fs.writeFile(path.join(carpeta(), `${id}.json`), JSON.stringify(nota));
    } catch { /* sin la nota la próxima vuelta simplemente vuelve a empezar */ }
}

/** Se llama al cerrar la estadía: la nota no tiene por qué sobrevivirla. */
export async function olvidarVigilia(id: string) {
    try { await fs.unlink(path.join(carpeta(), `${id}.json`)); } catch { /* ya no estaba */ }
}

export async function mirarSiSigue(
    estadia: { id: string; plate: string; bbox: string | null },
    camara: { rtspUrl: string | null; trackRoi: string | null },
): Promise<Mirada> {
    const previa = await leerNota(estadia.id);
    const fallas = previa?.fallas ?? 0;

    if (!camara.rtspUrl) {
        return { resultado: "no se pudo", gpu: false, detalle: "la cámara no tiene RTSP cargado", fallas };
    }

    let zona: Recorte = null;
    try { zona = camara.trackRoi ? JSON.parse(camara.trackRoi) : null; } catch { zona = null; }
    const recorte = encuadre(estadia.bbox, zona);

    let jpeg: Buffer;
    try {
        jpeg = await capturarCuadro(camara.rtspUrl, { roi: recorte, segundos: 15 });
    } catch (e: any) {
        return { resultado: "no se pudo", gpu: false, detalle: `no se pudo tomar el cuadro: ${e?.message || e}`, fallas };
    }

    let ahora: Buffer;
    try {
        ahora = await huella(jpeg);
    } catch (e: any) {
        return { resultado: "no se pudo", gpu: false, detalle: `no se pudo sacar la huella: ${e?.message || e}`, fallas };
    }

    /*
     * La primera mirada no puede decidir nada: no hay con qué comparar. Se guarda la huella
     * y se contesta que sigue — que es lo que se venía creyendo hasta recién. Decidir con la
     * primera sería cerrar una estadía por no tener antecedentes.
     */
    if (!previa?.huella) {
        await guardarNota(estadia.id, { huella: ahora.toString("base64"), fallas: 0, mirada: new Date().toISOString() });
        return { resultado: "sigue", gpu: false, detalle: "primera mirada: queda la huella para comparar", fallas: 0 };
    }

    const ahoraB64 = ahora.toString("base64");
    const sello = new Date().toISOString();

    const d = distancia(ahora, Buffer.from(previa.huella, "base64"));
    if (d < VIGILIA_UMBRAL) {
        /* Se actualiza la huella aunque sean casi iguales: así la luz que cambia de a poco a
           lo largo de la tarde no se acumula hasta parecer que el auto se fue. Y se olvida
           el cambio anterior, si lo había: volvió a ser el lugar de siempre. */
        await guardarNota(estadia.id, { huella: ahoraB64, fallas: 0, mirada: sello });
        return { resultado: "sigue", gpu: false, detalle: `el lugar está igual (${d.toFixed(1)})`, distancia: d, fallas: 0 };
    }

    /**
     * El lugar cambió. ¿Pero se quedó cambiado?
     *
     * Acá está el ahorro de verdad. Si la vuelta pasada ya había cambiado y no se encontró
     * la chapa, esta mirada no necesita al lector para nada: alcanza con ver si el lugar
     * sigue igual a como quedó. Un camión que pasó por delante deja de estar y el lugar
     * vuelve a parecerse al de antes; un auto que se fue no vuelve.
     *
     * Y de paso es más confiable que preguntarle al lector. De noche una chapa no se lee
     * aunque el auto esté ahí — medido: sobre este mismo recorte el lector no encontró una
     * matrícula que estaba puesta a cuatro metros. Confirmar una partida con el lector sería
     * confirmarla con el sentido que peor ve justo cuando peor ve.
     */
    if (previa.huellaNueva) {
        const d2 = distancia(ahora, Buffer.from(previa.huellaNueva, "base64"));
        if (d2 < VIGILIA_UMBRAL) {
            const cuantas = fallas + 1;
            await guardarNota(estadia.id, { huella: previa.huella, huellaNueva: ahoraB64, fallas: cuantas, mirada: sello });
            if (cuantas >= VIGILIA_FALLAS) {
                return { resultado: "se fue", gpu: false, detalle: `el lugar cambió y se quedó cambiado (${cuantas} miradas)`, distancia: d, fallas: cuantas };
            }
            return { resultado: "no se pudo", gpu: false, detalle: `el lugar sigue cambiado (${cuantas} de ${VIGILIA_FALLAS})`, distancia: d, fallas: cuantas };
        }
    }

    /* Cambio nuevo. Recién acá se gasta GPU, y sobre el recorte, no sobre la calle entera. */
    const { lecturas, error } = await leerMatriculas(jpeg);
    if (error) {
        return { resultado: "no se pudo", gpu: true, detalle: `el lector no contestó: ${error}`, distancia: d, fallas };
    }
    if (lecturas.some((l) => mismaChapa(l.plate, estadia.plate))) {
        await guardarNota(estadia.id, { huella: ahoraB64, fallas: 0, mirada: sello });
        return { resultado: "sigue", gpu: true, detalle: `cambió el lugar (${d.toFixed(1)}) pero la chapa está`, distancia: d, fallas: 0 };
    }

    /*
     * No se lo ve. La huella buena NO se pisa: si se guardara la del lugar cambiado, la
     * vuelta siguiente daría "igual" contra ella y el auto quedaría estacionado para siempre
     * en una calle donde ya no hay nadie. El lugar cambiado se guarda aparte, que es lo que
     * la próxima mirada usa para saber si el cambio se sostuvo.
     */
    const cuantas = fallas + 1;
    await guardarNota(estadia.id, { huella: previa.huella, huellaNueva: ahoraB64, fallas: cuantas, mirada: sello });
    if (cuantas < VIGILIA_FALLAS) {
        return { resultado: "no se pudo", gpu: true, detalle: `cambió y no se lo ve (${cuantas} de ${VIGILIA_FALLAS})`, distancia: d, fallas: cuantas };
    }
    return { resultado: "se fue", gpu: true, detalle: `${cuantas} miradas sin encontrarlo`, distancia: d, fallas: cuantas };
}
