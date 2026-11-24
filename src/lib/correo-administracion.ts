import { prisma } from "@/lib/prisma";
import type { CuentaCorreo } from "@/lib/correo";

/**
 * Desde qué cuenta se le escribe a un lote (25/11).
 *
 * Nico: «tenemos 4 administraciones del barrio; cada administración tiene sus lotes y sus correos
 * para enviar a sus inquilinos o propietarios… el objetivo es que cada administración envíe correos
 * del sistema a sus lotes».
 *
 * La regla: un lote que pertenece a una administración se escribe desde la cuenta de ESA
 * administración, y si no tiene cuenta no se le escribe — salir desde otra casilla (la general, la de
 * otra comisión) es justo lo que no se quiere. Un lote sin administración (o una instalación sin
 * administraciones) sigue con el servidor general de Ajustes › Correo.
 *
 * Quien tiene lotes en dos administraciones recibe desde la del primero de sus lotes: es el que
 * el padrón nombra primero, y una persona recibe UNA invitación.
 */
export type Remitente =
    | { tipo: "administracion"; administracionId: string; nombre: string; cuenta: CuentaCorreo }
    | { tipo: "general" }
    | { tipo: "sin-cuenta"; administracionId: string; nombre: string };

type AdmCorreo = { id: string; nombre: string; correoCuenta: string | null; correoClave: string | null; correoNombre: string | null };

/** La cuenta de una administración, si está cargada entera. La clave sale descifrada (lib/prisma lo hace al leer). */
export function cuentaDe(a: AdmCorreo): CuentaCorreo | null {
    return a.correoCuenta && a.correoClave ? { cuenta: a.correoCuenta, clave: a.correoClave, nombre: a.correoNombre || a.nombre } : null;
}

/** Las administraciones con lo que hace falta para mandar, de una vez (el envío de a poco mira cientos de invitaciones). */
export async function administracionesParaCorreo(): Promise<Map<string, AdmCorreo>> {
    const a = await prisma.administracion.findMany({ select: { id: true, nombre: true, correoCuenta: true, correoClave: true, correoNombre: true } });
    return new Map(a.map((x) => [x.id, x]));
}

/** El remitente para unos lotes (los de una invitación, los de una persona), con lo ya leído. */
export function remitenteDeLotes(unitIds: string[], adminDeUnidad: Map<string, string | null>, admins: Map<string, AdmCorreo>): Remitente {
    const id = unitIds.map((u) => adminDeUnidad.get(u)).find((x): x is string => !!x);
    if (!id) return { tipo: "general" };
    const a = admins.get(id);
    if (!a) return { tipo: "general" };
    const cuenta = cuentaDe(a);
    return cuenta ? { tipo: "administracion", administracionId: a.id, nombre: a.nombre, cuenta } : { tipo: "sin-cuenta", administracionId: a.id, nombre: a.nombre };
}

/** Los lotes de una invitación (su JSON `lotes`). */
export const lotesDeInvitacion = (lotes: unknown): string[] =>
    (Array.isArray(lotes) ? lotes : []).map((l) => String((l as { unitId?: unknown })?.unitId || "")).filter(Boolean);

/** Lo mismo, leyendo la base: para mandar UNA. */
export async function remitenteDe(unitIds: string[]): Promise<Remitente> {
    if (!unitIds.length) return { tipo: "general" };
    const [unidades, admins] = await Promise.all([
        prisma.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, administracionId: true } }),
        administracionesParaCorreo(),
    ]);
    const m = new Map(unidades.map((u) => [u.id, u.administracionId]));
    return remitenteDeLotes(unitIds, m, admins);
}

/**
 * ¿Hay desde dónde mandar? El servidor general o alguna administración con su cuenta. Las puertas que
 * antes pedían el servidor general (enviar, poner en marcha el envío de a poco) preguntan esto: con
 * cuentas por administración el general puede no existir.
 */
export async function hayDesdeDondeMandar(): Promise<boolean> {
    const general = await prisma.setting.findUnique({ where: { key: "SMTP_HOST" } }).catch(() => null);
    if (general?.value?.trim()) return true;
    return (await prisma.administracion.count({ where: { correoCuenta: { not: null }, correoClave: { not: null } } }).catch(() => 0)) > 0;
}
