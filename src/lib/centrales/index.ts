import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { cifrarDato, descifrarDato, hayClaveDatos } from "@/lib/cifrado-datos";
import { generica } from "./generica";
import { axPro, axHybrid } from "./hikvision-ax";
import type { DestinoReceptor, DriverCentral, EquipoCentral, ModeloCentral } from "./tipos";

/**
 * Las centrales de alarma (Alarm Hub): el registro de drivers, el alta y la dirección del receptor.
 * El receptor es alarm-receiver.js; acá vive lo que hace la app con ellas.
 */
export const DRIVERS: Record<ModeloCentral, DriverCentral> = { generica, "ax-pro": axPro, "ax-hybrid": axHybrid };
export const driverDe = (m: string | null | undefined): DriverCentral => DRIVERS[(m as ModeloCentral) || "generica"] || generica;
export const MODELOS = Object.values(DRIVERS).map((d) => ({ modelo: d.modelo, nombre: d.nombre, probado: d.probado, ayuda: d.ayudaAlta, vincula: !!d.vincular, controla: !!d.armar }));

/** La dirección pública del receptor (ajuste ALARMAS_DESTINO): lo que se escribe en la central. */
export type DestinoAjuste = { direccion: string; puerto: number; transporte: "udp" | "tcp" };
export const PUERTO_RECEPTOR = Number(process.env.ALARMAS_PUERTO || 10010);
export async function leerDestino(): Promise<DestinoAjuste | null> {
    try {
        const v = JSON.parse((await prisma.setting.findUnique({ where: { key: "ALARMAS_DESTINO" } }))?.value || "null");
        if (v?.direccion) return { direccion: String(v.direccion), puerto: Number(v.puerto) || PUERTO_RECEPTOR, transporte: v.transporte === "tcp" ? "tcp" : "udp" };
    } catch { }
    return null;
}
export async function guardarDestino(d: DestinoAjuste) {
    const value = JSON.stringify({ direccion: d.direccion.trim(), puerto: Number(d.puerto) || PUERTO_RECEPTOR, transporte: d.transporte === "tcp" ? "tcp" : "udp" });
    await prisma.setting.upsert({ where: { key: "ALARMAS_DESTINO" }, update: { value }, create: { key: "ALARMAS_DESTINO", value } });
}

/** Una cuenta DC-09 libre: 4 a 6 dígitos (hex válido, y lo que entra en el teclado de cualquier central). */
export async function cuentaLibre(pedida?: string | null): Promise<string> {
    if (pedida) {
        const c = pedida.trim().toUpperCase();
        if (!/^[0-9A-F]{3,16}$/.test(c)) throw new Error("La cuenta va de 3 a 16 dígitos (0-9, A-F).");
        if (await prisma.centralAlarma.findUnique({ where: { cuenta: c } })) throw new Error(`La cuenta ${c} ya la tiene otra central.`);
        return c;
    }
    for (let i = 0; i < 50; i++) {
        const c = String(1000 + crypto.randomInt(9000));
        if (!(await prisma.centralAlarma.findUnique({ where: { cuenta: c } }))) return c;
    }
    throw new Error("No se encontró una cuenta libre.");
}
/** Clave AES-128 en hex (32 dígitos): la aceptan como hex las que piden hex y como texto (AES-256) las que piden texto. */
export const claveNueva = () => crypto.randomBytes(16).toString("hex").toUpperCase();

export function guardarClave(clave: string | null): string | null {
    if (!clave) return null;
    if (!hayClaveDatos()) throw new Error("Falta OMNI_CLAVE_DATOS en el .env del servidor: sin eso la clave de la central quedaría en claro.");
    return cifrarDato(clave);
}
export const leerClave = (c: { claveCifrada: string | null }) => (c.claveCifrada ? descifrarDato(c.claveCifrada) : null);

export function equipoDe(d: { id: string; name: string; ip: string; httpPort?: number | null; username: string | null; password: string | null; authType?: string | null }): EquipoCentral {
    return { id: d.id, name: d.name, ip: d.ip, httpPort: d.httpPort ?? null, username: d.username, password: d.password, authType: d.authType || "DIGEST" };
}

export async function destinoPara(c: { cuenta: string; protocolo: string; supervisionSeg: number; claveCifrada: string | null }): Promise<DestinoReceptor | null> {
    const d = await leerDestino();
    if (!d) return null;
    return { direccion: d.direccion, puerto: d.puerto, transporte: d.transporte, cuenta: c.cuenta, clave: leerClave(c), protocolo: c.protocolo === "ADM-CID" ? "ADM-CID" : "SIA-DCS", supervisionSeg: c.supervisionSeg };
}
