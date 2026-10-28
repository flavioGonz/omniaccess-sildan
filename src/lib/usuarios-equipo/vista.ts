/**
 * Lo que las rutas devuelven de una cuenta y de una sesión: sin nada sensible (las claves nunca están
 * en estas tablas, y la del equipo no sale de Device). Lo comparten la ficha, el área y «Todas».
 */
import type { CuentaEquipo, SesionEquipo, Device, LecturaUsuariosEquipo } from "@prisma/client";
import { clasificar } from "@/lib/usuarios-equipo/inventario";
import { compatible } from "@/lib/usuarios-equipo/lectura";
import { esSoloLectura } from "@/lib/solo-lectura";

export type CuentaVista = {
    id: string; deviceId: string; nombre: string; idEquipo: string | null; nivel: string | null;
    clase: ReturnType<typeof clasificar>; deFabrica: boolean; conocida: boolean; conocidaMotivo: string | null; conocidaPor: string | null;
    primeraVez: string; ultimaVez: string; desaparecida: string | null;
};
export type SesionVista = {
    id: string; deviceId: string; nombre: string; ip: string; procedencia: string; origenNombre: string | null;
    desdeEquipo: string | null; vistaPrimera: string; vistaUltima: string; hasta: string | null;
};
export type LecturaVista = { cuentasAt: string | null; cuentasOk: boolean; cuentasError: string | null; sesionesAt: string | null; sesionesOk: boolean; sesionesError: string | null; maxCuentas: number | null };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const cuentaVista = (c: CuentaEquipo, servicio: string | null): CuentaVista => ({
    id: c.id, deviceId: c.deviceId, nombre: c.nombre, idEquipo: c.idEquipo, nivel: c.nivel, clase: clasificar(c, servicio), deFabrica: c.deFabrica,
    conocida: c.conocida, conocidaMotivo: c.conocidaMotivo, conocidaPor: c.conocidaPor,
    primeraVez: c.primeraVez.toISOString(), ultimaVez: c.ultimaVez.toISOString(), desaparecida: iso(c.desaparecida),
});
export const sesionVista = (s: SesionEquipo): SesionVista => ({
    id: s.id, deviceId: s.deviceId, nombre: s.nombre, ip: s.ip, procedencia: s.procedencia, origenNombre: s.origenNombre, desdeEquipo: s.desdeEquipo,
    vistaPrimera: s.vistaPrimera.toISOString(), vistaUltima: s.vistaUltima.toISOString(), hasta: iso(s.hasta),
});
export const lecturaVista = (l: LecturaUsuariosEquipo | null): LecturaVista | null => l && ({
    cuentasAt: iso(l.cuentasAt), cuentasOk: l.cuentasOk, cuentasError: l.cuentasError, sesionesAt: iso(l.sesionesAt), sesionesOk: l.sesionesOk, sesionesError: l.sesionesError, maxCuentas: l.maxCuentas,
});
export const equipoVista = (d: Device) => ({ id: d.id, name: d.name, ip: d.ip, deviceType: d.deviceType, brand: d.brand, soporte: compatible(d), soloLectura: esSoloLectura(d.ip) });
