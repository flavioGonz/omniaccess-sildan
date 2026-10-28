/**
 * Las IP que alguien marcó como conocidas («PC de la guardia», «Servidor del lab por VPN»): las
 * sesiones que llegan desde ahí no avisan. Viven en un Setting, como las demás listas cortas de ajustes.
 */
import { prisma } from "@/lib/prisma";

export const CLAVE_IPS_CONOCIDAS = "EQUIPOS_IPS_CONOCIDAS";
export type IpConocida = { ip: string; nombre: string; motivo?: string | null; por?: string | null; cuando?: string };

/** Una IPv4 o IPv6 escrita a mano: se valida la forma, no que exista. */
export const IP_VALIDA = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i;

export async function leerIpsConocidas(): Promise<IpConocida[]> {
    const v = (await prisma.setting.findUnique({ where: { key: CLAVE_IPS_CONOCIDAS } }).catch(() => null))?.value;
    try { const j = v ? JSON.parse(v) : []; return Array.isArray(j) ? j.filter((x) => x && typeof x.ip === "string" && typeof x.nombre === "string") : []; }
    catch { return []; }
}

export async function guardarIpsConocidas(lista: IpConocida[]) {
    const value = JSON.stringify(lista);
    await prisma.setting.upsert({ where: { key: CLAVE_IPS_CONOCIDAS }, create: { key: CLAVE_IPS_CONOCIDAS, value }, update: { value } });
}
