import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { prisma } from "@/lib/prisma";
import { esSubredPrivada, leerRango, subredesSugeridas } from "@/lib/descubrir-red";
import { barrer, barrerPing, identificarVarias, subredesPropias, type Viva } from "@/lib/descubrir-red-servidor";
import { probarVarias } from "@/lib/credenciales-equipo";
import type { DeviceBrand, DeviceType } from "@prisma/client";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };
const PERMISO = "dispositivos.editar";

/**
 * Descubrir equipos en la red (pedido 17/11, el mismo barrido que el mapa de KumaMap).
 *
 * GET  — qué subredes conviene barrer: las de los equipos que ya están dados de alta y las del
 *        propio servidor. Así no hay que acordarse del prefijo.
 * POST { rango } — el barrido. `rango` entiende «192.168.1», un CIDR o un tramo (lib/leerRango).
 * POST { accion: "probar", ips, usuario, clave } — probar esa credencial contra esos equipos.
 * POST { accion: "alta", equipos } — dar de alta varios de una.
 *
 * El descubridor inteligente (26/11), en dos pasos para que ninguna llamada pase el minuto del proxy
 * y la pantalla muestre el avance:
 * POST { accion: "ping", rango } — quién contesta, con su MAC si está en la misma red.
 * POST { accion: "identificar", vivas, credenciales, comunidad } — de a tandas: qué es cada una.
 *      Las claves viajan en cada tanda y no se guardan ni se auditan; se audita cuántas se probaron.
 *
 * Pide «Editar dispositivos» y queda en Auditoría: manda tráfico a toda una red del cliente, y
 * eso tiene que poder explicarse después.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
type Sesion = any;
async function permitido(): Promise<NextResponse | { sesion: Sesion }> {
    const s: Sesion = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes(PERMISO)) return NextResponse.json({ error: "Tu rol no puede descubrir equipos en la red." }, { status: 403 });
    return { sesion: s };
}

export async function GET() {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const equipos = await prisma.device.findMany({ select: { ip: true } }).catch(() => []);
    return NextResponse.json({ subredes: subredesSugeridas(equipos.map((e) => e.ip), subredesPropias()) }, { headers: SIN_CACHE });
}

/** Lo que se acepta al dar de alta: el resto del alta (grupos, fotos) se hace en la ficha. */
const TIPOS = new Set(["LPR_CAMERA", "LPR_INTERIOR", "CAMERA", "NVR", "FACE_TERMINAL", "ACCESS_CONTROL", "DOOR_INTERCOM", "QUEUE_COUNTER", "GPS"]);
const MARCAS = new Set(["GENERICA", "HIKVISION", "AKUVOX", "INTELBRAS", "DAHUA", "ZKTECO", "AVICAM", "MILESIGHT", "UNIFI", "UNIVIEW", "BOSCH", "AXIS", "GRANDSTREAM"]);
const ALTA_MAX = 40;
/** Direcciones por tanda de identificación: con puertos, web, SNMP y claves, seis en paralelo caben en ~20 s. */
const IDENTIFICAR_MAX = 6;
/** Claves a probar por equipo. Más es invitar a que una Hikvision bloquee al servidor por logins fallidos. */
const CREDENCIALES_MAX = 3;

export async function POST(req: NextRequest) {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const b = await req.json().catch(() => null);

    // ── Descubridor inteligente: el ping ──
    if (b?.accion === "ping") {
        const r = leerRango(String(b?.rango || ""));
        if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
        const t0 = Date.now();
        try {
            const p = await barrerPing(r.subred, r.desde, r.hasta);
            await auditar(q.sesion, "equipos.descubrir", `${r.subred}.${r.desde}-${r.hasta}`, true, `${p.vivas.length} de ${p.total} contestaron (descubridor)`);
            return NextResponse.json({ ...p, ms: Date.now() - t0 }, { headers: SIN_CACHE });
        } catch (e) {
            return NextResponse.json({ error: e instanceof Error ? e.message : "no se pudo barrer" }, { status: 500 });
        }
    }

    // ── Descubridor inteligente: una tanda de identificación ──
    if (b?.accion === "identificar") {
        const vivas: Viva[] = (Array.isArray(b?.vivas) ? b.vivas : []).slice(0, IDENTIFICAR_MAX)
            .map((v: Partial<Viva>) => ({ ip: String(v?.ip || ""), rtt: typeof v?.rtt === "number" ? v.rtt : null, mac: typeof v?.mac === "string" ? v.mac : null, fabricanteMac: null }))
            .filter((v: Viva) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v.ip) && esSubredPrivada(v.ip.split(".").slice(0, 3).join(".")));
        if (!vivas.length) return NextResponse.json({ error: "No viene ninguna dirección." }, { status: 400 });
        const credenciales = (Array.isArray(b?.credenciales) ? b.credenciales : []).slice(0, CREDENCIALES_MAX)
            .map((c: { usuario?: unknown; clave?: unknown }) => ({ usuario: String(c?.usuario || "").trim().slice(0, 60), clave: String(c?.clave ?? "").slice(0, 120) }))
            .filter((c: { usuario: string }) => c.usuario);
        const comunidad = typeof b?.comunidad === "string" && b.comunidad.trim() ? b.comunidad.trim().slice(0, 64) : null;
        const r = await identificarVarias(vivas, { credenciales, comunidad });
        return NextResponse.json({ identificados: r }, { headers: SIN_CACHE });
    }

    // ── Probar credenciales contra lo que apareció ──
    if (b?.accion === "probar") {
        const ips = (Array.isArray(b?.ips) ? b.ips : []).slice(0, 64)
            .map((x: unknown) => (typeof x === "string" ? { ip: x } : { ip: String((x as { ip?: string })?.ip || ""), habla: (x as { habla?: string[] })?.habla, puerto: (x as { puerto?: number })?.puerto }))
            .filter((x: { ip: string }) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x.ip));
        const usuario = String(b?.usuario || "").trim();
        if (!ips.length || !usuario) return NextResponse.json({ error: "Falta el usuario o la lista de equipos." }, { status: 400 });
        const r = await probarVarias(ips, { usuario, clave: String(b?.clave ?? "") });
        const entraron = r.filter((x) => x.estado === "ok").length;
        // La clave NO se audita, obviamente; sí que se probó una, contra cuántos y con qué resultado.
        await auditar(q.sesion, "equipos.probar-credencial", `${ips.length} equipos`, true, `usuario ${usuario}: ${entraron} entraron`);
        return NextResponse.json({ verificaciones: r }, { headers: SIN_CACHE });
    }

    // ── Dar de alta varios de una ──
    if (b?.accion === "alta") {
        const lista = (Array.isArray(b?.equipos) ? b.equipos : []).slice(0, ALTA_MAX);
        if (!lista.length) return NextResponse.json({ error: "No viene ningún equipo." }, { status: 400 });
        const hechos: { ip: string; id: string; nombre: string; tipo: string }[] = [];
        /* El área de cada uno (26/11, «consultar un área para cada uno en la importación»): se juntan
           por área y se asignan al final, una escritura por área en vez de una por equipo. */
        const porArea = new Map<string, string[]>();
        const fallados: { ip: string; motivo: string }[] = [];
        for (const e of lista) {
            const ip = String(e?.ip || "").trim();
            const nombre = String(e?.nombre || "").trim().slice(0, 80);
            const tipo = String(e?.tipo || "CAMERA");
            const marca = String(e?.marca || "GENERICA");
            if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || !nombre) { fallados.push({ ip, motivo: "Falta la IP o el nombre." }); continue; }
            if (!TIPOS.has(tipo) || !MARCAS.has(marca)) { fallados.push({ ip, motivo: "Tipo o marca que no existe." }); continue; }
            // Una IP repetida no es un error del que se avise y siga: es el caso normal de darle
            // dos veces al botón, y dos equipos con la misma IP rompen el sondeo de estado.
            if (await prisma.device.findFirst({ where: { ip }, select: { id: true } })) { fallados.push({ ip, motivo: "Ya estaba dado de alta." }); continue; }
            try {
                const d = await prisma.device.create({
                    data: {
                        name: nombre, ip, brand: marca as DeviceBrand, deviceType: tipo as DeviceType,
                        deviceModel: String(e?.modelo || "").slice(0, 60) || null,
                        username: String(e?.usuario || "").slice(0, 60) || null,
                        password: String(e?.clave ?? "") || null,
                        authType: "DIGEST",
                        httpPort: Number(e?.puerto) > 0 ? Number(e.puerto) : null,
                        location: String(e?.lugar || "").slice(0, 120) || null,
                        mac: typeof e?.mac === "string" && /^[0-9a-f:.-]{12,17}$/i.test(e.mac) ? e.mac.toUpperCase() : null,
                        direction: e?.sentido === "EXIT" ? "EXIT" : "ENTRY",
                    },
                    select: { id: true, name: true },
                });
                hechos.push({ ip, id: d.id, nombre: d.name, tipo });
                if (typeof e?.areaId === "string" && e.areaId) porArea.set(e.areaId, [...(porArea.get(e.areaId) || []), d.id]);
                // Las cámaras quedan con su video en go2rtc, como al importarlas de un grabador.
                if (["CAMERA", "LPR_CAMERA", "LPR_INTERIOR", "DOOR_INTERCOM"].includes(tipo)) {
                    try { const full = await prisma.device.findUnique({ where: { id: d.id } }); const { syncLprStream } = await import("@/lib/go2rtc-sync"); if (full) await syncLprStream(full); } catch { /* el video se puede reintentar desde la ficha */ }
                }
            } catch (err) {
                fallados.push({ ip, motivo: err instanceof Error ? err.message : "No se pudo crear." });
            }
        }
        if (porArea.size) {
            const { asignarEquipos } = await import("@/app/actions/areas");
            for (const [areaId, ids] of porArea) { try { await asignarEquipos(ids, areaId); } catch (err) { fallados.push({ ip: "", motivo: `No se pudo poner en el área: ${err instanceof Error ? err.message : "error"}` }); } }
        }
        // Las cámaras de intrusión nuevas quedan avisando a OmniAccess solas (26/11, lib/preparar-avisos).
        const intr = hechos.filter((h) => h.tipo === "CAMERA").map((h) => h.id);
        if (intr.length) { const { prepararAvisosEnFondo } = await import("@/lib/preparar-avisos"); prepararAvisosEnFondo(intr, String(q.sesion?.name || q.sesion?.sub || "panel") + " (descubridor)"); }
        await auditar(q.sesion, "equipos.alta-descubrimiento", `${hechos.length} equipos`, !!hechos.length,
            [hechos.map((h) => `${h.ip} ${h.nombre}`).join(", "), fallados.map((f) => `${f.ip}: ${f.motivo}`).join(", ")].filter(Boolean).join(" · ").slice(0, 400));
        return NextResponse.json({ hechos, fallados }, { headers: SIN_CACHE });
    }

    // ── El barrido ──
    // `rango` es el campo nuevo (entiende CIDR y tramos); subred/desde/hasta sigue valiendo.
    if (typeof b?.rango === "string") {
        const r = leerRango(b.rango);
        if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
        b.subred = r.subred; b.desde = r.desde; b.hasta = r.hasta;
    }
    const subred = String(b?.subred || "").trim();
    const desde = Number(b?.desde) || 1, hasta = Number(b?.hasta) || 254;
    if (!esSubredPrivada(subred)) {
        return NextResponse.json({ error: "Sólo se pueden barrer redes privadas (10.x, 172.16–31.x, 192.168.x)." }, { status: 400 });
    }
    const t0 = Date.now();
    try {
        const r = await barrer(subred, desde, hasta);
        const nuevos = r.hallazgos.filter((h) => !h.equipo).length;
        await auditar(q.sesion, "equipos.descubrir", `${subred}.${desde}-${hasta}`, true, `${r.hallazgos.length} de ${r.total} contestaron, ${nuevos} sin dar de alta`);
        return NextResponse.json({ ...r, ms: Date.now() - t0 }, { headers: SIN_CACHE });
    } catch (e) {
        const motivo = e instanceof Error ? e.message : "no se pudo barrer";
        await auditar(q.sesion, "equipos.descubrir", `${subred}.${desde}-${hasta}`, false, motivo);
        return NextResponse.json({ error: motivo }, { status: 500 });
    }
}
