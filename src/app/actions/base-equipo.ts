"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { TIPOS_CARA } from "@/lib/caras-vivo";
import { contarBase, listarPersonas, type PersonaEquipo } from "@/lib/rostros-equipo";

/**
 * La base local de un lector: qué tiene guardado adentro y cuánto de eso coincide con OmniAccess.
 *
 * Pedido de Nico (19/11): «tema lectura de rostros, base de datos locales de cada lector, logs,
 * registros, rostros».
 *
 * Lo que hace valiosa esta pantalla no es listar: es **el cruce**. Un lector con 417 personas
 * cargadas y un padrón con otras tantas son dos listas que nadie comparó nunca, y la pregunta que
 * importa —¿quién puede abrir esta puerta y no está en el sistema?— no se podía contestar sin
 * sentarse con las dos pantallas al lado. Acá cada persona del equipo dice si la conocemos.
 *
 * El cruce se hace por LEGAJO contra las credenciales del padrón, y si no, por nombre exacto. No
 * se adivina nada más: dos personas distintas con el mismo nombre existen, y marcar a una como la
 * otra sería peor que no marcar ninguna.
 */

export type PersonaDeBase = PersonaEquipo & {
    /** El usuario del padrón que le corresponde, si lo hay. */
    padron: { id: string; nombre: string; unidad: string | null } | null;
    /** Cómo se encontró: por su legajo o por el nombre exacto. */
    porQue: "legajo" | "nombre" | null;
};

export type BaseEquipo = {
    equipo: { id: string; nombre: string; ip: string; tipo: string; marca: string };
    cuenta: Awaited<ReturnType<typeof contarBase>>;
    personas: PersonaDeBase[];
    total: number;
    desde: number;
    /** De la página traída: cuántas están en el padrón. */
    enPadron: number;
    error?: string;
};

export async function baseDelEquipo(deviceId: string, desde = 0): Promise<BaseEquipo> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes("dispositivos")) throw new Error("Tu rol no puede ver los equipos.");

    const d = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, name: true, ip: true, deviceType: true, brand: true, username: true, password: true, authType: true, httpPort: true },
    });
    if (!d) throw new Error("Ese equipo no existe.");
    if (!TIPOS_CARA.includes(String(d.deviceType) as never)) throw new Error("Ese equipo no es un portero ni un control de acceso.");

    const cabecera = { id: d.id, nombre: d.name, ip: d.ip, tipo: String(d.deviceType), marca: String(d.brand) };
    if (String(d.brand) !== "HIKVISION") {
        return { equipo: cabecera, cuenta: { personas: null, tarjetas: null, rostros: null, bitacora: false, huellas: false }, personas: [], total: 0, desde: 0, enPadron: 0, error: "Por ahora sólo se lee la base de los equipos Hikvision." };
    }

    try {
        const [cuenta, pagina] = await Promise.all([contarBase(d), listarPersonas(d, desde)]);

        /* El cruce con el padrón: primero por legajo contra las credenciales (es lo que el equipo
           usa para identificar), y si no hay, por nombre exacto. */
        const legajos = pagina.personas.map((x) => x.legajo).filter(Boolean);
        const nombres = pagina.personas.map((x) => (x.nombre || "").trim()).filter((x) => x.length > 1);
        const [porCred, porNombre] = await Promise.all([
            legajos.length
                ? prisma.credential.findMany({ where: { value: { in: legajos } }, select: { value: true, user: { select: { id: true, name: true, apartment: true } } } }).catch(() => [])
                : Promise.resolve([]),
            nombres.length
                ? prisma.user.findMany({ where: { name: { in: nombres } }, select: { id: true, name: true, apartment: true } }).catch(() => [])
                : Promise.resolve([]),
        ]);
        const mapaCred = new Map(porCred.filter((c) => c.user).map((c) => [c.value, c.user!]));
        const mapaNombre = new Map(porNombre.map((u) => [u.name, u]));

        const personas: PersonaDeBase[] = pagina.personas.map((x) => {
            const porLegajo = mapaCred.get(x.legajo);
            const porNom = !porLegajo && x.nombre ? mapaNombre.get(x.nombre.trim()) : undefined;
            const u = porLegajo || porNom;
            return {
                ...x,
                padron: u ? { id: u.id, nombre: u.name, unidad: u.apartment || null } : null,
                porQue: porLegajo ? "legajo" : porNom ? "nombre" : null,
            };
        });

        return {
            equipo: cabecera, cuenta, personas, total: pagina.total, desde,
            enPadron: personas.filter((x) => x.padron).length,
        };
    } catch (e) {
        return {
            equipo: cabecera, cuenta: { personas: null, tarjetas: null, rostros: null, bitacora: false, huellas: false },
            personas: [], total: 0, desde: 0, enPadron: 0,
            error: e instanceof Error ? e.message.slice(0, 200) : "No se pudo leer la base del equipo",
        };
    }
}
