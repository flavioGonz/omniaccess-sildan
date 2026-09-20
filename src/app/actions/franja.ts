"use server";

import { prisma } from "@/lib/prisma";
import { capturarCuadro, CUADROS_A_TIRAR } from "@/lib/cuadro";
import {
    ANCHO_MIRADA, celda, cuadroUtil, enGrises, huellasDeLaFranja, juzgarCelda,
    leerEsquinas, leerVacio, type EstadoCelda, type Esquinas,
} from "@/lib/franja";
import { olvidarFranjas } from "@/lib/ocupaciones";

/**
 * La franja, desde la ficha del equipo.
 *
 * Son tres cosas y el orden importa: dibujarla, decir cuántos autos entran, y **enseñarle
 * cómo se ve vacía**. Ese último paso es el que no se puede saltear ni adivinar: sin una
 * referencia de vacío no hay con qué comparar, y un motor que igual contesta algo cuando no
 * sabe es exactamente lo que produjo los autos fantasma que esto viene a reemplazar. Por eso
 * la franja no mide nada hasta que alguien mire la calle, confirme que está vacía y lo diga.
 */

export type Medicion = {
    ok: boolean;
    error?: string;
    /** El cuadro que se midió, para dibujar la franja encima sin pedirlo aparte. */
    foto?: string;
    celdas?: EstadoCelda[];
    aprendida?: string | null;
};

async function equipoDe(deviceId: string) {
    return prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, name: true, rtspUrl: true },
    });
}

export async function leerFranja(deviceId: string) {
    const f = await prisma.franja.findUnique({ where: { deviceId } });
    if (!f) return null;
    return {
        id: f.id,
        esquinas: leerEsquinas(f.esquinas),
        lugares: f.lugares,
        activa: f.activa,
        aprendida: f.vacioAt ? f.vacioAt.toISOString() : null,
    };
}

export async function guardarFranja(
    deviceId: string,
    datos: { esquinas: Esquinas; lugares: number; activa: boolean },
) {
    const lugares = Math.max(1, Math.min(40, Math.round(datos.lugares)));
    const previa = await prisma.franja.findUnique({ where: { deviceId } });

    /*
     * Redibujar o cambiar la cantidad de lugares INVALIDA la referencia vacía.
     *
     * Y hay que hacerlo, por más que obligue a aprenderla de nuevo: la referencia son las
     * huellas de unas celdas concretas, y si las celdas se corrieron, cada una se estaría
     * comparando contra el pedazo de calle de otra. El resultado no sería "un poco peor":
     * sería todo ocupado, o todo vacío, con la misma cara de dato cierto.
     */
    const movida = !previa
        || previa.esquinas !== JSON.stringify(datos.esquinas)
        || previa.lugares !== lugares;

    const f = await prisma.franja.upsert({
        where: { deviceId },
        create: { deviceId, esquinas: JSON.stringify(datos.esquinas), lugares, activa: datos.activa },
        update: {
            esquinas: JSON.stringify(datos.esquinas),
            lugares,
            activa: datos.activa,
            ...(movida ? { vacio: null, vacioAt: null } : {}),
        },
    });
    olvidarFranjas();
    return { ok: true, aprendida: f.vacioAt?.toISOString() ?? null, reaprender: movida };
}

export async function borrarFranja(deviceId: string) {
    await prisma.franja.deleteMany({ where: { deviceId } });
    olvidarFranjas();
    return { ok: true };
}

/**
 * Aprender cómo se ve la franja vacía.
 *
 * Lo dispara una persona que está mirando la calle y sabe que no hay nadie. No se intenta
 * deducir: no hay manera de saber desde acá si ese auto que se ve estaba o no estaba, y
 * equivocarse acá se paga en cada medición futura.
 */
export async function aprenderVacio(deviceId: string): Promise<Medicion> {
    const equipo = await equipoDe(deviceId);
    if (!equipo?.rtspUrl) return { ok: false, error: "El equipo no tiene RTSP configurado." };

    const f = await prisma.franja.findUnique({ where: { deviceId } });
    const esq = f ? leerEsquinas(f.esquinas) : null;
    if (!f || !esq) return { ok: false, error: "Primero hay que dibujar la franja." };

    let jpeg: Buffer;
    try { jpeg = await capturarCuadro(equipo.rtspUrl, { segundos: 20, tirar: CUADROS_A_TIRAR }); }
    catch (e: any) { return { ok: false, error: e?.message || "No llegó video." }; }

    /* Aprender de un cuadro roto sería envenenar la referencia para todo el día, así que
       acá la guarda importa el doble. */
    const mirada = await enGrises(jpeg, ANCHO_MIRADA);
    const util = cuadroUtil(mirada);
    if (!util.ok) {
        return { ok: false, error: "El cuadro llegó sin contraste. Probá de nuevo.", foto: `data:image/jpeg;base64,${jpeg.toString("base64")}` };
    }

    const huellas = huellasDeLaFranja(mirada, esq, f.lugares);
    const guardada = await prisma.franja.update({
        where: { id: f.id },
        data: { vacio: JSON.stringify(huellas), vacioAt: new Date() },
    });
    olvidarFranjas();

    return {
        ok: true,
        foto: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
        celdas: huellas.map((h, i) => juzgarCelda(i, h, h)),
        aprendida: guardada.vacioAt?.toISOString() ?? null,
    };
}

/** Medir ahora, para ver en la ficha lo mismo que va a ver el barrido. */
export async function medirFranja(deviceId: string): Promise<Medicion> {
    const equipo = await equipoDe(deviceId);
    if (!equipo?.rtspUrl) return { ok: false, error: "El equipo no tiene RTSP configurado." };

    const f = await prisma.franja.findUnique({ where: { deviceId } });
    const esq = f ? leerEsquinas(f.esquinas) : null;
    if (!f || !esq) return { ok: false, error: "Primero hay que dibujar la franja." };

    let jpeg: Buffer;
    try { jpeg = await capturarCuadro(equipo.rtspUrl, { segundos: 20, tirar: CUADROS_A_TIRAR }); }
    catch (e: any) { return { ok: false, error: e?.message || "No llegó video." }; }

    const foto = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    const vacio = leerVacio(f.vacio);
    if (!vacio || vacio.length !== f.lugares) {
        return { ok: false, error: "Todavía no sabe cómo se ve vacía.", foto };
    }

    const huellas = huellasDeLaFranja(await enGrises(jpeg, ANCHO_MIRADA), esq, f.lugares);
    return {
        ok: true,
        foto,
        celdas: huellas.map((h, i) => juzgarCelda(i, h, vacio[i])),
        aprendida: f.vacioAt?.toISOString() ?? null,
    };
}

/** Las celdas de una franja, para dibujarlas. Se calcula en el servidor para no duplicar la fórmula. */
export async function celdasDe(esquinas: Esquinas, lugares: number) {
    return Array.from({ length: lugares }, (_, i) => celda(esquinas, i, lugares));
}
