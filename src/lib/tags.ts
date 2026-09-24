import { prisma } from "@/lib/prisma";
import { AkuvoxDriver } from "@/lib/drivers/AkuvoxDriver";
import { soporteDe } from "@/lib/drivers/catalogo";
import type { Credential, Device } from "@prisma/client";

/**
 * Cargarle una tarjeta a los lectores.
 *
 * ## Lo que pasaba antes
 *
 * Nada. Dar de alta un tag escribía una fila en la base y revalidaba la ruta; no le llegaba
 * a ningún equipo. El `AkuvoxDriver` tiene `syncRfKey` escrito desde siempre y **nadie lo
 * llamaba nunca**. O sea que la pantalla de tags era una lista de tarjetas que no abrían
 * ninguna puerta, y no había forma de darse cuenta mirándola.
 *
 * ## Qué equipo puede recibir una tarjeta
 *
 * Lo decide `catalogo.ts`, que dice lo que cada driver hace **de verdad**, no lo que su
 * interfaz promete. Hoy la única marca con `rfid` es Akuvox. Las demás tienen los métodos
 * vacíos: no fallan, devuelven sin hacer nada, y esa es la peor forma de fallar.
 *
 * Por eso acá no hay un `default` que intente algo: un equipo cuya marca no figura con
 * `rfid` se reporta como **"no soporta"**, con nombre y apellido. Es información, no un
 * error — y es lo que le permite a quien instala saber que tiene que abrir la otra app.
 *
 * ## Por qué el estado se guarda en `HardwareMirror`
 *
 * Porque ya existe y es exactamente eso: qué cree OmniAccess que tiene cargado cada equipo.
 * Una tabla nueva habría sido una segunda versión de la misma idea, y dos versiones de la
 * misma idea se separan sin que nadie lo decida.
 */

/** Cómo le fue a una tarjeta en un equipo. */
export type EstadoCarga = "cargado" | "error" | "no soporta" | "sin intentar";

export type Destino = {
    deviceId: string;
    nombre: string;
    marca: string;
    estado: EstadoCarga;
    detalle: string;
    al: string | null;
};

/** ¿Esta marca sabe recibir tarjetas? Sale del catálogo, no de si el driver existe. */
export const marcaCargaTags = (marca: string) => !!soporteDe(marca)?.hace.includes("rfid");

/**
 * Los equipos a los que tiene sentido mandarles una tarjeta.
 *
 * Se devuelven TODOS los que podrían tenerla —incluidos los de marca que no la soporta—
 * porque el panel tiene que poder decir "este lector no la va a recibir". Esconderlos
 * dejaría la pantalla llena de tarjetas cargadas y una puerta que no abre, sin pista de
 * por qué.
 */
export async function lectoresDeTags() {
    return prisma.device.findMany({
        where: { deviceType: { in: ["ACCESS_CONTROL", "DOOR_INTERCOM", "FACE_TERMINAL"] } },
        orderBy: { name: "asc" },
    });
}

function driverDe(device: Device) {
    // Sin `default`: ver el comentario de arriba. Agregar una marca acá sin agregarla en
    // `catalogo.ts` no la habilita, y es a propósito — el catálogo es el que manda.
    if (device.brand === "AKUVOX") return new AkuvoxDriver();
    return null;
}

/** Cargar la tarjeta en un equipo y dejar anotado cómo salió. */
export async function cargarTagEn(device: Device, credential: Credential): Promise<Destino> {
    const base = { deviceId: device.id, nombre: device.name, marca: String(device.brand) };

    if (!marcaCargaTags(String(device.brand))) {
        return { ...base, estado: "no soporta", al: null, detalle: soporteDe(String(device.brand))?.nota || "Esta marca todavía no sabe recibir tarjetas." };
    }
    const driver: any = driverDe(device);
    if (!driver?.syncRfKey) {
        return { ...base, estado: "no soporta", al: null, detalle: "No hay driver que sepa cargarle tarjetas a este equipo." };
    }

    try {
        await driver.syncRfKey(credential, device);
        const al = new Date();
        await prisma.hardwareMirror.upsert({
            where: { deviceId_hardwareId: { deviceId: device.id, hardwareId: credential.id } },
            create: {
                deviceId: device.id, hardwareId: credential.id,
                cardCode: credential.value, syncStatus: "IN_SYNC", lastUpdated: al,
            },
            update: { cardCode: credential.value, syncStatus: "IN_SYNC", lastUpdated: al },
        });
        return { ...base, estado: "cargado", detalle: "La tarjeta quedó en el equipo.", al: al.toISOString() };
    } catch (e: any) {
        const al = new Date();
        await prisma.hardwareMirror.upsert({
            where: { deviceId_hardwareId: { deviceId: device.id, hardwareId: credential.id } },
            create: {
                deviceId: device.id, hardwareId: credential.id,
                cardCode: credential.value, syncStatus: "ERROR", lastUpdated: al,
            },
            update: { cardCode: credential.value, syncStatus: "ERROR", lastUpdated: al },
        }).catch(() => { });
        /* El error se devuelve, no se traga: una tarjeta que no entró y una que entró se
           ven igual desde la pantalla si nadie lo dice, y ese fue el problema original. */
        return { ...base, estado: "error", detalle: e?.message || "El equipo no aceptó la tarjeta.", al: al.toISOString() };
    }
}

/** Cargar la tarjeta en todos los lectores. Devuelve cómo le fue en cada uno. */
export async function sincronizarTag(credentialId: string): Promise<Destino[]> {
    const cred = await prisma.credential.findUnique({ where: { id: credentialId } });
    if (!cred || cred.type !== "TAG") return [];
    /* Una tarjeta sin dueño no se manda a ningún lado: cargarla abriría la puerta a quien
       la tenga en la mano, que es justamente lo que el dueño sirve para evitar. */
    if (!cred.userId) return [];

    const equipos = await lectoresDeTags();
    const salidas: Destino[] = [];
    // En serie y no en paralelo: son porteros con un CPU chico y una sesión HTTP por vez.
    for (const d of equipos) salidas.push(await cargarTagEn(d, cred));
    return salidas;
}

/** Dónde está cargada esta tarjeta, según lo último que se intentó. */
export async function estadoDelTag(credentialId: string): Promise<Destino[]> {
    const [equipos, espejos] = await Promise.all([
        lectoresDeTags(),
        prisma.hardwareMirror.findMany({ where: { hardwareId: credentialId } }),
    ]);
    const porEquipo = new Map(espejos.map((m) => [m.deviceId, m]));
    return equipos.map((d) => {
        const m = porEquipo.get(d.id);
        const base = { deviceId: d.id, nombre: d.name, marca: String(d.brand) };
        if (!marcaCargaTags(String(d.brand))) {
            return { ...base, estado: "no soporta" as const, al: null, detalle: soporteDe(String(d.brand))?.nota || "Esta marca todavía no sabe recibir tarjetas." };
        }
        if (!m) return { ...base, estado: "sin intentar" as const, al: null, detalle: "Todavía no se le mandó." };
        return {
            ...base,
            estado: (m.syncStatus === "IN_SYNC" ? "cargado" : "error") as EstadoCarga,
            al: m.lastUpdated.toISOString(),
            detalle: m.syncStatus === "IN_SYNC" ? "La tarjeta está en el equipo." : "El último intento falló.",
        };
    });
}

/**
 * Sacar la tarjeta de los equipos. Se usa al desasignar y al borrar.
 *
 * ── EL ORDEN ES LA MITAD DEL ARREGLO ────────────────────────────────────────────────
 *
 * Antes esto sólo borraba el espejo, porque ningún driver tenía `deleteRfKey`. Dos daños,
 * y el segundo es el que no se ve:
 *
 * 1. La tarjeta seguía cargada en el portero y **seguía abriendo**.
 * 2. El espejo es el ÚNICO lugar que sabe en qué lectores quedó. Borrarlo primero deja al
 *    operador sin saber a dónde ir a sacarla a mano.
 *
 * Por eso ahora: **primero se saca del equipo, después se olvida** — y sólo se olvida el
 * espejo de los equipos donde el borrado se pudo confirmar. El de un equipo que falló se
 * conserva, que es lo que permite reintentar y lo que permite decir dónde quedó.
 *
 * Nunca se borra el espejo de un equipo que no contestó. Un espejo vacío significa "no
 * está en ningún lado", y afirmar eso sin saberlo es exactamente el defecto original.
 */
export type QuitadaDe = {
    deviceId: string;
    nombre: string;
    quitada: boolean;
    detalle: string;
};

export async function quitarTagDeLosLectores(credentialId: string): Promise<QuitadaDe[]> {
    const cred = await prisma.credential.findUnique({ where: { id: credentialId } });

    /* El espejo dice dónde está cargada. Se lee ANTES de tocar nada. */
    const espejos = await prisma.hardwareMirror.findMany({ where: { hardwareId: credentialId } });
    if (!espejos.length) return [];

    /* Una credencial ya borrada de la base no se puede quitar del equipo: el driver
       necesita su `value` para identificarla. Se dice, no se calla. */
    if (!cred) {
        return espejos.map((m) => ({
            deviceId: m.deviceId, nombre: m.deviceId, quitada: false,
            detalle: "La tarjeta ya no está en la base, así que no se pudo identificar en el equipo.",
        }));
    }

    const equipos = await prisma.device.findMany({
        where: { id: { in: espejos.map((m) => m.deviceId) } },
    });
    const porId = new Map(equipos.map((d) => [d.id, d]));

    const salidas: QuitadaDe[] = [];
    for (const m of espejos) {
        const device = porId.get(m.deviceId);
        if (!device) {
            /* El equipo ya no existe en la base. No hay a quién pedirle el borrado, y
               conservar el espejo de un equipo fantasma no ayuda a nadie. */
            await prisma.hardwareMirror.deleteMany({
                where: { hardwareId: credentialId, deviceId: m.deviceId },
            }).catch(() => { });
            salidas.push({ deviceId: m.deviceId, nombre: m.deviceId, quitada: true, detalle: "El equipo ya no está dado de alta." });
            continue;
        }

        const base = { deviceId: device.id, nombre: device.name };
        const driver: any = driverDe(device);
        if (!driver?.deleteRfKey) {
            salidas.push({ ...base, quitada: false, detalle: "Este equipo no sabe quitar tarjetas: hay que sacarla desde la app del fabricante." });
            continue;
        }

        try {
            await driver.deleteRfKey(cred, device);
            await prisma.hardwareMirror.deleteMany({
                where: { hardwareId: credentialId, deviceId: device.id },
            });
            salidas.push({ ...base, quitada: true, detalle: "La tarjeta ya no está en el equipo." });
        } catch (e: any) {
            /* El espejo SE CONSERVA. Es lo único que sabe que la tarjeta sigue ahí. */
            await prisma.hardwareMirror.updateMany({
                where: { hardwareId: credentialId, deviceId: device.id },
                data: { syncStatus: "ERROR", lastUpdated: new Date() },
            }).catch(() => { });
            salidas.push({ ...base, quitada: false, detalle: e?.message || "El equipo no pudo quitarla." });
        }
    }
    return salidas;
}
