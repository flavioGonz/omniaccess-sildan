"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { TIPOS_CARA } from "@/lib/caras-vivo";
import { contarBase, daFotos, listarPersonas, listarRostros, tarjetasDePagina, type PersonaEquipo, type RostroEquipo } from "@/lib/rostros-equipo";

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
    /**
     * El `FPID` de su cara en el equipo, cuando se pudo atar. Medido el 19/11: en el portero de
     * lab el FPID ES el legajo, pero en los dos equipos de producción las caras están cargadas con
     * identificadores propios (`414ad2`, `arquitecto1`) y sin nombre, así que **la mayoría de los
     * rostros no corresponde a ninguna persona de la lista**. Por eso esto es `null` y no una
     * suposición: pedir la foto de un FPID inventado devuelve 404 y la fila quedaría con un hueco
     * sin explicación.
     */
    fpid: string | null;
    /** El usuario del padrón que le corresponde, si lo hay. */
    padron: { id: string; nombre: string; unidad: string | null } | null;
    /** Cómo se encontró: por su legajo o por el nombre exacto. */
    porQue: "sincronizada" | "legajo" | "nombre" | null;
    /**
     * Los números de sus tarjetas, y de quién es cada una en el padrón (24/11). Una tarjeta cargada
     * en la puerta que en el padrón es de OTRA persona —o de nadie— es lo que hay que poder ver.
     */
    numeros: { numero: string; padron: { id: string; nombre: string } | null }[];
};

export type BaseEquipo = {
    equipo: { id: string; nombre: string; ip: string; tipo: string; marca: string };
    cuenta: Awaited<ReturnType<typeof contarBase>>;
    personas: PersonaDeBase[];
    total: number;
    desde: number;
    /** De la página traída: cuántas están en el padrón. */
    enPadron: number;
    /** Cuántas caras tiene la biblioteca del equipo, y cuántas se pudieron atar a esta página. */
    rostrosBiblioteca: number;
    rostrosAtados: number;
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
        return { equipo: cabecera, cuenta: { personas: null, tarjetas: null, rostros: null, bitacora: false, huellas: false }, personas: [], total: 0, desde: 0, enPadron: 0, rostrosBiblioteca: 0, rostrosAtados: 0, error: "Por ahora sólo se lee la base de los equipos Hikvision." };
    }

    try {
        /* Las caras del equipo se piden una vez por carga para poder atarlas a su persona: el
           vínculo es FPID = legajo, y cuando no lo es (producción) no se ata nada. */
        const [cuenta, pagina, caras] = await Promise.all([
            contarBase(d), listarPersonas(d, desde),
            listarRostros(d, 300).catch(() => ({ rostros: [] as RostroEquipo[], total: 0 })),
        ]);
        const numeros = await tarjetasDePagina(d, pagina.personas).catch(() => new Map<string, string[]>());
        const todas = [...numeros.values()].flat();
        const duenos = todas.length
            ? await prisma.credential.findMany({ where: { value: { in: todas } }, select: { value: true, user: { select: { id: true, name: true } } } }).catch(() => [])
            : [];
        const duenoDe = new Map(duenos.filter((c) => c.user).map((c) => [c.value, c.user!]));
        /* Y además hay que PODER bajar la foto: el terminal declara una URL por cara que después
           contesta 404, y algunos de sus FPID son números que coinciden con un legajo. Sin esta
           medición la fila mostraba una imagen rota por cada coincidencia casual. */
        const conFoto = caras.rostros.length ? await daFotos(d, caras.rostros) : false;
        const fpids = new Set(conFoto ? caras.rostros.map((r) => r.fpid) : []);

        /* El cruce con el padrón: primero por legajo contra las credenciales (es lo que el equipo
           usa para identificar), y si no hay, por nombre exacto. */
        const legajos = pagina.personas.map((x) => x.legajo).filter(Boolean);
        const nombres = pagina.personas.map((x) => (x.nombre || "").trim()).filter((x) => x.length > 1);
        const [porLegajo, porCred, porNombre] = await Promise.all([
            legajos.length
                ? prisma.user.findMany({ where: { legajoEquipos: { in: legajos } }, select: { id: true, name: true, apartment: true, legajoEquipos: true } }).catch(() => [])
                : Promise.resolve([]),
            legajos.length
                ? prisma.credential.findMany({ where: { value: { in: legajos } }, select: { value: true, user: { select: { id: true, name: true, apartment: true } } } }).catch(() => [])
                : Promise.resolve([]),
            nombres.length
                ? prisma.user.findMany({ where: { name: { in: nombres } }, select: { id: true, name: true, apartment: true } }).catch(() => [])
                : Promise.resolve([]),
        ]);
        const mapaLegajo = new Map(porLegajo.map((u) => [u.legajoEquipos!, u]));
        const mapaCred = new Map(porCred.filter((c) => c.user).map((c) => [c.value, c.user!]));
        const mapaNombre = new Map(porNombre.map((u) => [u.name, u]));

        const personas: PersonaDeBase[] = pagina.personas.map((x) => {
            /* En orden de confianza: el número con el que NOSOTROS la cargamos, después una
               credencial del padrón con ese valor, y recién al final el nombre exacto. */
            const porNuestro = mapaLegajo.get(x.legajo);
            const porCredencial = !porNuestro ? mapaCred.get(x.legajo) : undefined;
            const porNom = !porNuestro && !porCredencial && x.nombre ? mapaNombre.get(x.nombre.trim()) : undefined;
            const u = porNuestro || porCredencial || porNom;
            return {
                ...x,
                fpid: fpids.has(x.legajo) ? x.legajo : null,
                padron: u ? { id: u.id, nombre: u.name, unidad: u.apartment || null } : null,
                porQue: porNuestro ? "sincronizada" : porCredencial ? "legajo" : porNom ? "nombre" : null,
                numeros: (numeros.get(x.legajo) || []).map((n) => ({ numero: n, padron: duenoDe.get(n) ? { id: duenoDe.get(n)!.id, nombre: duenoDe.get(n)!.name } : null })),
            };
        });

        return {
            equipo: cabecera, cuenta, personas, total: pagina.total, desde,
            enPadron: personas.filter((x) => x.padron).length,
            rostrosBiblioteca: caras.total || caras.rostros.length,
            rostrosAtados: personas.filter((x) => x.fpid).length,
        };
    } catch (e) {
        return {
            equipo: cabecera, cuenta: { personas: null, tarjetas: null, rostros: null, bitacora: false, huellas: false },
            personas: [], total: 0, desde: 0, enPadron: 0, rostrosBiblioteca: 0, rostrosAtados: 0,
            error: e instanceof Error ? e.message.slice(0, 200) : "No se pudo leer la base del equipo",
        };
    }
}
