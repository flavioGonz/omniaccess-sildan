import type { Prisma } from "@prisma/client";

/**
 * La auditoría del panel: quién cambió qué. Se anota en AccionSistema, la misma tabla que ya usaba
 * Procesos y tareas, y se lee en Configuración › Sistema › Auditoría.
 *
 * Por qué así (21/10, Nico: «auditoría no anda, no se llena la tabla»): la tabla sólo recibía lo que
 * se hacía desde Procesos y tareas (reiniciar un servicio, correr o pausar una tarea), que casi nadie
 * toca; en el lab tenía cero filas. La pantalla prometía «quién tocó qué» y no lo anotaba nadie.
 * Instrumentar a mano cada acción del panel son decenas de archivos, y la que se olvide queda fuera
 * sin que nadie lo note. Acá se mira en un solo lugar, el cliente de Prisma: toda escritura sobre un
 * modelo de configuración hecha DENTRO de un pedido con sesión queda anotada con el nombre de esa
 * sesión. Lo que escriben los workers, el receptor de eventos o las tareas programadas no tiene
 * sesión y no se anota: eso no lo «tocó» nadie.
 *
 * Nunca se guardan valores, sólo qué campos cambiaron: en estas tablas hay claves de dispositivos,
 * tokens y ajustes con secretos.
 */

/** Los modelos que se auditan y cómo se nombran. Los de eventos, muestras y registros quedan fuera: son lo que pasa, no lo que alguien cambió. */
const MODELOS: Record<string, string> = {
    User: "persona",
    Vehicle: "vehículo",
    Unit: "unidad",
    AppRole: "rol",
    Credential: "credencial",
    AccessGroup: "grupo de acceso",
    Schedule: "horario de acceso",
    FloorPlan: "plano",
    Device: "dispositivo",
    Setting: "ajuste",
    ParkingSlot: "plaza",
    NotificationChannel: "canal de aviso",
    NotificationRule: "regla de aviso",
    QueueSchedule: "horario de fila",
    ReportSchedule: "reporte programado",
    PlateWatch: "matrícula vigilada",
    Franja: "estacionamiento",
    Invitation: "invitación",
    ZonaEntrenable: "analítica entrenable",
    ClasePropia: "clase propia",
    EnlacePantalla: "enlace de pantalla",
};

/**
 * Campos que cambia el sistema solo aunque el pedido venga del panel (el panel pregunta el estado de
 * una puerta y eso actualiza `doorStatus`). Si un cambio toca sólo éstos, no lo hizo una persona.
 */
const CAMPOS_DEL_SISTEMA = new Set([
    "updatedAt", "lastOnlinePull", "lastOnlinePush", "doorStatus", "lastFiredAt", "lastRunAt", "lastResetAt",
    "isOccupied", "vacio", "vacioAt", "ultimoUsoEn", "ultimoUsoIp", "estado",
]);

/** Lo mismo, de la misma persona, dentro de esta ventana se anota una vez (una pantalla que guarda al tipear no llena la tabla). */
const REPETIDO_MS = 60_000;
const recientes = new Map<string, number>();

const VERBO: Record<string, string> = {
    create: "Creó", createMany: "Creó", update: "Modificó", updateMany: "Modificó",
    upsert: "Guardó", delete: "Borró", deleteMany: "Borró",
};

/** El nombre legible de lo que se tocó: lo que tenga a mano el registro, si no el id. */
function nombreDe(r: any, args: any): string {
    const x = r && typeof r === "object" ? r : {};
    const w = args?.where || {};
    return String(x.name ?? x.nombre ?? x.plate ?? x.key ?? x.title ?? x.label ?? x.username ?? w.key ?? w.plate ?? x.id ?? w.id ?? "—").slice(0, 120);
}

async function quienEs(): Promise<string | null> {
    try {
        // Importado acá y no arriba: auth usa este mismo cliente de Prisma.
        const { getSession } = await import("@/app/actions/auth");
        const s: any = await getSession();
        return s ? String(s.name || s.username || s.sub || "panel") : null;
    } catch {
        // Fuera de un pedido (worker, tarea programada) no hay cookies: no lo tocó una persona.
        return null;
    }
}

async function anotar(cliente: any, params: Prisma.MiddlewareParams, resultado: any) {
    const rotulo = params.model && MODELOS[params.model];
    const verbo = VERBO[params.action];
    if (!rotulo || !verbo) return;
    const args: any = params.args || {};
    const datos = params.action === "upsert" ? { ...(args.create || {}), ...(args.update || {}) } : args.data;
    const campos = datos && !Array.isArray(datos) ? Object.keys(datos).filter((c) => !CAMPOS_DEL_SISTEMA.has(c) && c !== "id" && !(params.model === "Setting" && c === "key")) : [];
    if ((params.action === "update" || params.action === "updateMany" || params.action === "upsert") && campos.length === 0) return;
    if ((params.action === "updateMany" || params.action === "deleteMany") && !resultado?.count) return;

    const quien = await quienEs();
    if (!quien) return;

    const muchos = params.action.endsWith("Many");
    const accion = `${verbo} ${rotulo}`;
    const objetivo = muchos ? `${resultado?.count ?? (Array.isArray(datos) ? datos.length : "")} registros` : nombreDe(resultado, args);
    const detalle = params.action === "delete" || params.action === "deleteMany" ? null
        : campos.length ? `Campos: ${campos.slice(0, 12).join(", ")}${campos.length > 12 ? "…" : ""}` : null;

    const clave = `${quien}|${accion}|${objetivo}|${detalle}`;
    const ahora = Date.now();
    if ((recientes.get(clave) || 0) > ahora - REPETIDO_MS) return;
    recientes.set(clave, ahora);
    if (recientes.size > 500) for (const [k, t] of recientes) if (t < ahora - REPETIDO_MS) recientes.delete(k);

    // La fila se escribe sin esperarla: la escritura de la persona no se demora por anotarla.
    cliente.accionSistema.create({ data: { quien, accion, objetivo, ok: true, detalle } }).catch(() => { });
}

/**
 * El middleware: deja pasar la escritura y, ya hecha, la anota. Quién la hizo se lee ANTES de
 * devolver (las cookies sólo existen mientras dura el pedido); la fila se escribe después, sin
 * esperarla. Si anotar falla, la escritura ya salió bien: la auditoría nunca rompe lo que audita.
 */
export function middlewareAuditoria(cliente: any): Prisma.Middleware {
    return async (params, next) => {
        const r = await next(params);
        if (params.model && MODELOS[params.model] && VERBO[params.action]) {
            try { await anotar(cliente, params, r); } catch { /* la auditoría es un extra: nunca rompe la escritura */ }
        }
        return r;
    };
}
