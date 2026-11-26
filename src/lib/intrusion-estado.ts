import { prisma } from "@/lib/prisma";
import { authenticatedRequest } from "@/lib/digest-auth";
import { getSmartSupport, leerTodas, type Pt } from "@/lib/isapi-analytics";
import { readAlarmHosts, ensureAlarmHost, getEventTarget } from "@/lib/isapi-alarmhost";
import { resolveForCamera } from "@/lib/nvr-resolve";
import { readDahuaIvs } from "@/lib/dahua-ivs";
import { MODOS_INTRUSION, modoIntrusionDe, type ModoIntrusion } from "@/lib/modo-camara";
import { ultimosEventos } from "@/lib/silencio";
import { tieneCentro, agregarCentro } from "@/lib/intrusion-xml";

/**
 * Lo que la cámara de intrusión tiene HOY, contra lo que el modo elegido necesita (26/11).
 *
 * Nico: «¿distingue si tiene eventos de intrusión la propia cámara? Sabe que tiene esas
 * capacidades, pero ¿si las tiene dibujadas?» y «¿qué pasa cuando está en modo avisa pero no tiene
 * servidor de alarma? Nunca se entera OmniAccess». Hasta acá la ficha mostraba lo que la cámara
 * SABE hacer (capacidades) y el modo elegido; lo dibujado sólo se veía abriendo el calibrador, y
 * nada decía si el aviso podía llegar. Se lee en vivo (sólo lectura) y se arma la cadena entera:
 *
 *   regla dibujada → regla prendida → enlace «avisar al centro» → OmniAccess en httpHosts → eventos
 *
 * con el primer eslabón roto marcado y, cuando se puede, el arreglo a un clic.
 */

export type Eslabon = "ok" | "falta" | "no-aplica" | "sin-dato";
export type Regla = { id: number; activa: boolean; puntos: Pt[] };
export type Paso = { clave: "reglas" | "activas" | "centro" | "servidor" | "eventos"; estado: Eslabon; titulo: string; detalle: string; arreglo?: "servidor" | "centro" | "calibrar" };
export type EstadoIntrusion = {
    ok: boolean; error?: string;
    marca: "hikvision" | "dahua";
    modo: ModoIntrusion | null; avisa: boolean;
    soporta: { linea: boolean; zona: boolean };
    lineas: Regla[]; zonas: Regla[];
    /** Por tipo de regla: ¿su enlace avisa al centro? null = no se pudo leer o no aplica. */
    centro: { linea: boolean | null; zona: boolean | null };
    servidor: { ok: boolean; omni: boolean | null; otros: number; error?: string; sinDestino?: boolean };
    ultimoEvento: string | null;
    pasos: Paso[];
    /** El primer eslabón roto que importa para el modo elegido (null = la cadena está entera). */
    roto: Paso | null;
};

const TRIGGER = { linea: "/ISAPI/Event/triggers/linedetection-1", zona: "/ISAPI/Event/triggers/fielddetection-1" } as const;

async function cargar(id: string) {
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, ip: true, username: true, password: true, authType: true, httpPort: true, brand: true, deviceType: true, intrusionModo: true } });
    return d ? { ...d, authType: d.authType || "DIGEST" } : null;
}

type Dev = NonNullable<Awaited<ReturnType<typeof cargar>>>;
const msj = (e: unknown) => (e instanceof Error ? e.message : "");

async function leerTrigger(dev: Dev, tipo: "linea" | "zona"): Promise<string | null> {
    try { return String(await authenticatedRequest("GET", TRIGGER[tipo], dev, { responseType: "text", accept: "application/xml", timeout: 7000 })); }
    catch { return null; }
}

export async function leerEstadoIntrusion(id: string): Promise<EstadoIntrusion> {
    const d = await cargar(id);
    const vacio: EstadoIntrusion = { ok: false, marca: "hikvision", modo: null, avisa: false, soporta: { linea: false, zona: false }, lineas: [], zonas: [], centro: { linea: null, zona: null }, servidor: { ok: false, omni: null, otros: 0 }, ultimoEvento: null, pasos: [], roto: null };
    if (!d) return { ...vacio, error: "El equipo no existe." };
    if (String(d.deviceType) !== "CAMERA") return { ...vacio, error: "Sólo una cámara de intrusión tiene este estado." };

    // El modo: si no lo eligió nadie, se deduce de si avisa (como la ficha).
    const avisanFila = await prisma.setting.findUnique({ where: { key: "ALARM_CONFIGURED_IPS" } });
    let avisanIps: string[] = []; try { avisanIps = JSON.parse(avisanFila?.value || "[]"); } catch { }
    const modo = modoIntrusionDe({ deviceType: String(d.deviceType), intrusionModo: d.intrusionModo }, d.ip ? avisanIps.includes(d.ip) : null);
    const avisa = !!(modo && MODOS_INTRUSION[modo].avisos);
    const ult = (await ultimosEventos([id]).catch(() => new Map())).get(id);
    const out: EstadoIntrusion = { ...vacio, ok: true, modo, avisa, ultimoEvento: ult ? ult.ts.toISOString() : null };

    const camNvr = await resolveForCamera(id);
    if (camNvr && String((camNvr.nvr as { brand?: string }).brand).toUpperCase() === "DAHUA") {
        // Canal de un NVR Dahua: las reglas viven en el NVR y los eventos llegan por la suscripción
        // al NVR (no hay servidor de alarma ni «centro» por cámara).
        out.marca = "dahua";
        try {
            const r = await readDahuaIvs({ ip: camNvr.nvr.ip, user: camNvr.nvr.user, pass: camNvr.nvr.pass }, camNvr.ch);
            out.soporta = { linea: r.support.line, zona: r.support.field };
            if (r.line.length >= 2) out.lineas = [{ id: 1, activa: true, puntos: r.line }];
            if (r.field.length >= 3) out.zonas = [{ id: 1, activa: true, puntos: r.field }];
        } catch (e) { out.ok = false; out.error = msj(e) || "No contestó el NVR Dahua."; }
        out.servidor = { ok: true, omni: null, otros: 0 };
    } else {
        const dev = d;
        try {
            const sop = await getSmartSupport(dev);
            const [l, z] = await Promise.all([sop.line ? leerTodas(dev, "linea").catch(() => null) : null, sop.field ? leerTodas(dev, "zona").catch(() => null) : null]);
            out.soporta = { linea: !!l, zona: !!z };
            const reglas = (x: typeof l) => (x?.reglas || []).filter((r) => !r.vacia).map((r) => ({ id: r.id, activa: !!r.enabled, puntos: r.points }));
            out.lineas = reglas(l); out.zonas = reglas(z);
        } catch (e) { out.ok = false; out.error = msj(e) || "La cámara no contestó."; }
        if (out.ok) {
            const [tl, tz, hosts] = await Promise.all([
                out.lineas.length ? leerTrigger(dev, "linea") : null,
                out.zonas.length ? leerTrigger(dev, "zona") : null,
                readAlarmHosts(dev),
            ]);
            out.centro = { linea: tl == null ? null : tieneCentro(tl), zona: tz == null ? null : tieneCentro(tz) };
            const destino = await getEventTarget();
            out.servidor = hosts.ok
                ? { ok: true, omni: hosts.hasOmni, otros: hosts.hosts.filter((h) => h.ip && h.ip !== "0.0.0.0" && !(destino && h.ip === destino.ip && String(h.port) === String(destino.port))).length, sinDestino: !destino }
                : { ok: false, omni: null, otros: 0, error: hosts.error, sinDestino: !destino };
        }
    }

    out.pasos = armarPasos(out);
    out.roto = out.avisa ? out.pasos.find((p) => p.estado === "falta") || null : null;
    return out;
}

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** La cadena, en el orden en que un aviso la recorre. Puro: lo usan la pantalla y las pruebas. */
export function armarPasos(e: Pick<EstadoIntrusion, "marca" | "avisa" | "soporta" | "lineas" | "zonas" | "centro" | "servidor" | "ultimoEvento">): Paso[] {
    const dibujadas = e.lineas.length + e.zonas.length;
    const activas = [...e.lineas, ...e.zonas].filter((r) => r.activa).length;
    const nada = !e.soporta.linea && !e.soporta.zona;
    const pasos: Paso[] = [];
    pasos.push(nada
        ? { clave: "reglas", estado: "no-aplica", titulo: "La cámara no tiene analítica de línea ni de zona", detalle: "No puede avisar sola. Para detectar, la mira OmniVision con reglas dibujadas en OmniAccess." }
        : dibujadas
            ? { clave: "reglas", estado: "ok", titulo: `${e.lineas.length} ${e.lineas.length === 1 ? "línea" : "líneas"} · ${e.zonas.length} ${e.zonas.length === 1 ? "zona" : "zonas"} dibujadas`, detalle: "Lo que hay dibujado en la cámara hoy, leído recién." }
            : { clave: "reglas", estado: "falta", titulo: "Sabe detectar, pero no tiene nada dibujado", detalle: "Tiene cruce de línea o zona, y ninguna regla dibujada: así no va a avisar nunca.", arreglo: "calibrar" });
    if (!nada && dibujadas) pasos.push(activas
        ? { clave: "activas", estado: "ok", titulo: activas === dibujadas ? "Todas prendidas" : `${activas} de ${dibujadas} prendidas`, detalle: "Una regla dibujada y apagada no detecta." }
        : { clave: "activas", estado: "falta", titulo: "Dibujadas pero apagadas", detalle: "Las reglas están, pero la analítica está apagada en la cámara.", arreglo: "calibrar" });
    if (e.marca === "dahua") {
        pasos.push({ clave: "servidor", estado: "no-aplica", titulo: "Llega por el NVR Dahua", detalle: "OmniAccess se suscribe al NVR: no hace falta servidor de alarma en la cámara." });
    } else if (!nada && dibujadas) {
        const tipos = [e.lineas.length && e.centro.linea === false ? "la línea" : null, e.zonas.length && e.centro.zona === false ? "la zona" : null].filter(Boolean);
        const sinLeer = (e.lineas.length && e.centro.linea == null) || (e.zonas.length && e.centro.zona == null);
        pasos.push(tipos.length
            ? { clave: "centro", estado: "falta", titulo: mayuscula(`${tipos.join(" y ")} no ${tipos.length > 1 ? "avisan" : "avisa"} al centro`), detalle: "En el enlace de la regla falta «Avisar al centro de vigilancia»: la cámara detecta y no se lo manda a nadie.", arreglo: "centro" }
            : sinLeer
                ? { clave: "centro", estado: "sin-dato", titulo: "No se pudo leer el enlace de las reglas", detalle: "La cámara no contestó el pedido del enlace (algunos firmwares no lo exponen)." }
                : { clave: "centro", estado: "ok", titulo: "Las reglas avisan al centro", detalle: "El enlace de cada regla incluye «Avisar al centro de vigilancia»." });
    }
    if (e.marca !== "dahua") {
        const s = e.servidor;
        pasos.push(s.sinDestino
            ? { clave: "servidor", estado: "falta", titulo: "Falta el destino de eventos del servidor", detalle: "OmniAccess todavía no sabe a qué IP le tienen que mandar los eventos las cámaras (Ajustes)." }
            : !s.ok
                ? { clave: "servidor", estado: "sin-dato", titulo: "No se pudo leer el servidor de alarmas", detalle: s.error || "La cámara no contestó." }
                : s.omni
                    ? { clave: "servidor", estado: "ok", titulo: "OmniAccess es servidor de alarmas", detalle: s.otros ? `Y ${s.otros} servidor${s.otros === 1 ? "" : "es"} más, que no se tocan.` : "Es el único destino configurado." }
                    : { clave: "servidor", estado: "falta", titulo: "OmniAccess no es servidor de alarmas", detalle: "La cámara puede detectar y avisar al centro, pero no tiene a OmniAccess como destino: los avisos no llegan nunca.", arreglo: "servidor" });
    }
    const dias = e.ultimoEvento ? (Date.now() - +new Date(e.ultimoEvento)) / 86_400_000 : null;
    pasos.push(dias == null
        ? { clave: "eventos", estado: e.avisa ? "falta" : "no-aplica", titulo: "Sin eventos en 30 días", detalle: e.avisa ? "Con la cadena entera debería haber llegado alguno: probá con «Mandar un aviso de prueba» en el calibrador." : "En este modo la cámara no tiene por qué avisar." }
        : { clave: "eventos", estado: dias > 3 && e.avisa ? "falta" : "ok", titulo: `Último evento ${dias < 1 ? "hoy" : `hace ${Math.round(dias)} días`}`, detalle: "El último aviso que llegó de esta cámara." });
    return pasos;
}

/**
 * Arreglar a un clic lo que se puede arreglar desde acá: el servidor de alarmas y el aviso al
 * centro de cada regla dibujada. Escribe en la cámara (pasa por lib/solo-lectura: en una red de
 * sólo lectura no sale) y no borra nada: agrega.
 */
export async function arreglarIntrusion(id: string, que: ("servidor" | "centro")[]): Promise<{ ok: boolean; hechos: string[]; errores: string[] }> {
    const d = await cargar(id);
    if (!d) return { ok: false, hechos: [], errores: ["El equipo no existe."] };
    const dev = d, hechos: string[] = [], errores: string[] = [];
    if (que.includes("servidor")) {
        const r = await ensureAlarmHost(dev);
        if (r.ok) { hechos.push(r.already ? "OmniAccess ya era servidor de alarmas" : "OmniAccess quedó como servidor de alarmas"); await marcarAvisa(d.ip, true); }
        else errores.push(r.error || "La cámara no aceptó el servidor de alarmas.");
    }
    if (que.includes("centro")) {
        for (const tipo of ["linea", "zona"] as const) {
            const xml = await leerTrigger(dev, tipo);
            if (xml == null || tieneCentro(xml)) continue;
            try {
                await authenticatedRequest("PUT", TRIGGER[tipo], dev, { data: agregarCentro(xml), contentType: "application/xml", responseType: "text", timeout: 9000 });
                const otra = await leerTrigger(dev, tipo);
                if (otra && tieneCentro(otra)) hechos.push(`${tipo === "linea" ? "La línea" : "La zona"} ahora avisa al centro`);
                else errores.push(`${tipo === "linea" ? "La línea" : "La zona"}: la cámara aceptó pero no quedó el aviso al centro.`);
            } catch (e: any) { errores.push(`${tipo === "linea" ? "La línea" : "La zona"}: ${e?.response?.status ? `la cámara contestó ${e.response.status}` : e?.message || "no se pudo escribir"}.`); }
        }
    }
    return { ok: errores.length === 0, hechos, errores };
}

/** El mismo registro que lleva /api/devices/alarm-host (el ícono de alarma de la tabla). */
async function marcarAvisa(ip: string | null, on: boolean) {
    if (!ip) return;
    try {
        const fila = await prisma.setting.findUnique({ where: { key: "ALARM_CONFIGURED_IPS" } });
        let s: Set<string>; try { s = new Set(JSON.parse(fila?.value || "[]")); } catch { s = new Set(); }
        if (on) s.add(ip); else s.delete(ip);
        const value = JSON.stringify([...s]);
        await prisma.setting.upsert({ where: { key: "ALARM_CONFIGURED_IPS" }, update: { value }, create: { key: "ALARM_CONFIGURED_IPS", value } });
    } catch { }
}
