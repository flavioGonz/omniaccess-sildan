import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autorizarMonitor, inicioDelDia, SIN_CACHE } from "@/lib/monitor/servidor";
import { leerDetalleRostro, motivoDeRostro, calidadRostro } from "@/lib/monitor/rostro";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { forbiddenResponse } from "@/lib/api-auth";
import { codigoRostro, nombreCamara } from "@/lib/rostros";

export const dynamic = "force-dynamic";

/** Cuántos accesos van en la tira, además del grande. */
const EN_TIRA = 10;
/** La fila de atención: denegados y desconocidos de esta ventana. */
const ATENCION_MS = 60 * 60 * 1000;
const ATENCION_MAX = 20;

/**
 * Todo acceso por rostro: las terminales faciales Y lo que reconoce OmniVision sobre el stream
 * (decisión de Nico, 9/11, que revierte la del 23/10 «ni OmniVision»). Siguen afuera las chapas
 * y las tarjetas: eso es `accessType` FACE y nada más. El origen de cada uno se marca aparte
 * (campo `origen`) para que la pared distinga una lectura de terminal de un reconocimiento de
 * OmniVision y no las presente como lo mismo.
 */
const SOLO_ROSTRO = { accessType: "FACE" as const };
const INCLUIR = { user: { select: { name: true, role: true, cara: true, unit: { select: { name: true } } } }, device: { select: { name: true, deviceType: true } } } as const;

/**
 * La foto de OmniVision se guarda como /api/vision/imagen, que NO abre a un enlace de pantalla (a
 * propósito: esa ruta da también reglas y entrenamiento). La pared pide por /api/monitor/camaras/imagen,
 * que sirve la misma del bucket de detecciones y sí acepta el enlace. Se reencauza acá para que la
 * foto cargue tanto con sesión como en una pantalla de pared.
 */
const paraPared = (ruta: string | null): string | null =>
    ruta && ruta.startsWith("/api/vision/imagen/") ? ruta.replace("/api/vision/imagen/", "/api/monitor/camaras/imagen/") : ruta;

/** Cuántas pasadas anteriores de la misma cara se muestran junto al acceso grande. */
const ANTERIORES = 4;

/** La identidad por rostro de un acceso (lib-rostros.js), con lo que la pared necesita para mostrarla. */
type RostroDe = { id: string; codigo: string; nombre: string | null; veces: number; primeraVez: string; foto: string | null; calidad: number };

const forma = (e: any, rostros?: Map<string, RostroDe>) => {
    const d = leerDetalleRostro(e.details);
    // OmniVision deja «Source: OmniVision» en el detalle; una terminal facial, no.
    const origen = /Source:\s*OmniVision/i.test(e.details || "") || e.device?.deviceType !== "FACE_TERMINAL" ? "omnivision" : "terminal";
    return {
        id: e.id, ts: e.timestamp.toISOString(), decision: e.decision, sentido: e.direction, origen,
        persona: e.user?.name || null, unidad: e.user?.unit?.name || null, rol: e.user?.role || null,
        // La foto del padrón y la que tomó la terminal/cámara (entera y el recorte de la cara).
        // El recorte, como la foto, se reencauza para que cargue también en una pantalla de pared.
        padron: e.user?.cara || null, foto: paraPared(e.snapshotPath || e.imagePath || null), recorte: paraPared(d.recorte),
        nombreTerminal: d.nombre, similitud: d.similitud, terminal: e.device?.name || e.location || null,
        // Calidad de la captura del rostro (sólo OmniVision la trae): puntaje + sus dos componentes.
        calidad: calidadRostro(d.deteccion, d.caraFrac), deteccion: d.deteccion, caraFrac: d.caraFrac,
        motivo: motivoDeRostro({ decision: e.decision, userId: e.userId, rol: e.user?.role, detalles: e.details }),
        // Identidad por rostro (13/11): qué se decidió con esta cara, quién es para el sistema y cuántas visitas llevaba.
        identidad: d.identidad, rostro: d.rostroId ? rostros?.get(d.rostroId) || null : null, rostroId: d.rostroId, visita: d.veces,
        caraPx: d.caraPx, sinIdentidad: d.sinIdentidad, caja: d.caja, escena: paraPared(d.escena),
    };
};

/** Los Rostros de esos accesos, de una sola consulta. */
async function rostrosDe(eventos: { details: string | null }[]): Promise<Map<string, RostroDe>> {
    const ids = [...new Set(eventos.map((e) => leerDetalleRostro(e.details).rostroId).filter(Boolean) as string[])];
    if (!ids.length) return new Map();
    const filas = await prisma.rostro.findMany({ where: { id: { in: ids } }, select: { id: true, numero: true, apodo: true, veces: true, primeraVez: true, foto: true, calidad: true } }).catch(() => []);
    return new Map(filas.map((r) => [r.id, { id: r.id, codigo: codigoRostro(r.numero), nombre: r.apodo, veces: r.veces, primeraVez: r.primeraVez.toISOString(), foto: paraPared(r.foto ? `/api/vision/imagen/${r.foto}` : null), calidad: r.calidad }]));
}

/**
 * GET /api/monitor/face → el Monitor Face (openspec pared-vms): el último acceso, la tira, los
 * contadores del día y la atención de la última hora. Con sesión pide `rostros` (la página lo pide
 * en el middleware); con enlace de pantalla, sólo el de la vista Face o la rotación.
 */
export async function GET() {
    const p = await autorizarMonitor("/api/monitor/face");
    if (p.error) return p.error;
    // Con sesión, el mismo permiso que la página (las rutas de /api/monitor pasan con cualquier sesión).
    // Registrar una cara desde el monitor (13/11): sólo con sesión y el permiso de las acciones de
    // rostros. Una pantalla de pared mira y no toca: ahí los botones ni se dibujan.
    let puedeRegistrar = false;
    if (!p.auth.pantalla) {
        const s: any = await getSession().catch(() => null);
        const permisos = permisosDeSesion(s);
        if (!permisos.includes("rostros")) return forbiddenResponse("Hace falta el permiso Monitor facial.");
        puedeRegistrar = permisos.includes("vision.config") || permisos.includes("rostros.listas");
    }
    const hoy = inicioDelDia();
    const [ultimas, permitidos, denegados, desconocidos, atencion, terminales, conRostro] = await Promise.all([
        prisma.accessEvent.findMany({ where: SOLO_ROSTRO, orderBy: { timestamp: "desc" }, take: EN_TIRA + 1, include: INCLUIR }),
        prisma.accessEvent.count({ where: { ...SOLO_ROSTRO, timestamp: { gte: hoy }, decision: "GRANT" } }),
        prisma.accessEvent.count({ where: { ...SOLO_ROSTRO, timestamp: { gte: hoy }, decision: "DENY" } }),
        prisma.accessEvent.count({ where: { ...SOLO_ROSTRO, timestamp: { gte: hoy }, decision: "DENY", userId: null } }),
        prisma.accessEvent.findMany({ where: { ...SOLO_ROSTRO, timestamp: { gte: new Date(Date.now() - ATENCION_MS) }, decision: "DENY" }, orderBy: { timestamp: "desc" }, take: ATENCION_MAX, include: INCLUIR }),
        prisma.device.count({ where: { deviceType: "FACE_TERMINAL" } }),
        // Cámaras/porteros que ya produjeron rostro por OmniVision — cuentan como fuente aunque no
        // sean terminales faciales, así la pared no dice «no hay fuentes» teniendo capturas que mostrar.
        prisma.accessEvent.findMany({ where: SOLO_ROSTRO, distinct: ["deviceId"], select: { deviceId: true } }),
    ]);
    // Fuentes de rostro = terminales faciales + dispositivos distintos que produjeron rostro. Sólo se
    // usa como «¿hay algo que mostrar?»: si es 0, la pared muestra el estado vacío.
    const fuentes = terminales + new Set(conRostro.map((r) => r.deviceId).filter(Boolean)).size;
    const rostros = await rostrosDe([...ultimas, ...atencion]);
    // Del acceso grande, cuándo se vio antes a esa misma cara: es lo que contesta «¿viene seguido?».
    const idGrande = ultimas[0] ? leerDetalleRostro(ultimas[0].details).rostroId : null;
    const anteriores = idGrande ? await prisma.rostroPasada.findMany({
        where: { rostroId: idGrande, cuando: { lt: ultimas[0].timestamp }, NOT: { eventoId: ultimas[0].id } }, orderBy: { cuando: "desc" }, take: ANTERIORES,
        select: { id: true, cuando: true, camara: true, cara: true, similitud: true },
    }).catch(() => []) : [];
    return NextResponse.json({
        ultimas: ultimas.map((e) => forma(e, rostros)), atencion: atencion.map((e) => forma(e, rostros)),
        anteriores: { de: ultimas[0]?.id || null, pasadas: anteriores.map((p) => ({ id: p.id, ts: p.cuando.toISOString(), camara: nombreCamara(p.camara), cara: paraPared(p.cara ? `/api/vision/imagen/${p.cara}` : null), similitud: p.similitud })) },
        hoy: { permitidos, denegados, desconocidos }, fuentes, ahora: new Date().toISOString(), puedeRegistrar,
    }, { headers: SIN_CACHE });
}
