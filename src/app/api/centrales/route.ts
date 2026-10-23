/**
 * /api/centrales — las centrales de alarma (Alarm Hub, SIA DC-09).
 *   GET                 → { centrales, destino, modelos, puerto }
 *   POST { nombre, modelo, ip?, httpPort?, usuario?, clave?, cuenta?, protocolo?, lanVpn?, prueba?, supervisionSeg? }
 *                       → { ok, id, cuenta }   (alta: cuenta única y clave AES generadas)
 *   PUT  { destino: { direccion, puerto, transporte } }  → la dirección pública del receptor
 * Alta y ajustes piden el permiso Dispositivos. La clave AES nunca viaja en el listado.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { POR_RECEPTOR, SUPERVISION_MAX } from "@/lib/centrales/limites";
import { prisma } from "@/lib/prisma";
import { MODELOS, PUERTO_RECEPTOR, claveNueva, cuentaLibre, guardarClave, guardarDestino, leerDestino } from "@/lib/centrales";
import { auditar, sesionCon } from "@/lib/centrales/sesion";
import type { ModeloCentral } from "@/lib/centrales/tipos";
import { exigirFuncion } from "@/lib/funcion-servidor";

const sinCache = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { no } = await sesionCon(); if (no) return no;
    const [filas, destino] = await Promise.all([
        prisma.centralAlarma.findMany({ include: { device: { select: { id: true, name: true, ip: true } }, _count: { select: { zonas: true } } }, orderBy: { createdAt: "asc" } }),
        leerDestino(),
    ]);
    const centrales = filas.map((c) => ({
        id: c.id, deviceId: c.deviceId, nombre: c.device.name, ip: c.device.ip || null, modelo: c.modelo, cuenta: c.cuenta, protocolo: c.protocolo,
        cifrado: !!c.claveCifrada, lanVpn: c.lanVpn, prueba: c.prueba, supervisionSeg: c.supervisionSeg, estado: c.estado,
        ultimoMensajeAt: c.ultimoMensajeAt, ipOrigen: c.ipOrigen, transporte: c.transporte, zonas: c._count.zonas,
    }));
    return NextResponse.json({ ok: true, centrales, destino, modelos: MODELOS, puerto: PUERTO_RECEPTOR }, sinCache);
}

export async function POST(req: NextRequest) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { s, no } = await sesionCon("hub.config"); if (no) return no;
    const b = await req.json().catch(() => ({}));
    const nombre = String(b?.nombre || "").trim().slice(0, 80);
    if (!nombre) return NextResponse.json({ ok: false, error: "Poné un nombre (p. ej. «Central Club House»)." }, { status: 400 });
    const modelo: ModeloCentral = ["ax-pro", "ax-hybrid"].includes(b?.modelo) ? b.modelo : "generica";
    const ip = String(b?.ip || "").trim();
    if (modelo !== "generica" && !ip) return NextResponse.json({ ok: false, error: "Una AX necesita su IP para que OmniAccess le escriba el receptor." }, { status: 400 });
    try {
        // Por un receptor (IPC10 de Paradox, Sur-Gard): la cuenta es la que la central ya tiene en el
        // receptor —no se inventa una—, llega en Contact ID sin cifrar por la salida a CMS (TCP 10011,
        // sólo red local), y la única señal de vida es la prueba periódica del panel (una por día).
        const porReceptor = !!b?.porReceptor;
        if (porReceptor && !b?.cuenta) return NextResponse.json({ ok: false, error: "Poné la cuenta con la que la central figura en el receptor (columna Account#)." }, { status: 400 });
        const cuenta = await cuentaLibre(b?.cuenta || null);
        const lanVpn = porReceptor || !!b?.lanVpn;
        // Por internet el cifrado es obligatorio; en LAN/VPN se puede elegir sin clave.
        const clave = porReceptor || (lanVpn && b?.sinCifrar) ? null : claveNueva();
        const claveCifrada = guardarClave(clave);
        const sup = Math.min(SUPERVISION_MAX, Math.max(30, Number(b?.supervisionSeg) || 600));
        const creada = await prisma.$transaction(async (tx) => {
            const dev = await tx.device.create({ data: {
                name: nombre, deviceType: "ALARM_HUB" as any, brand: modelo === "generica" ? "GENERICA" : "HIKVISION", deviceModel: modelo === "ax-pro" ? "AX PRO" : modelo === "ax-hybrid" ? "AX Hybrid PRO" : porReceptor ? POR_RECEPTOR : "DC-09",
                ip, httpPort: b?.httpPort ? Number(b.httpPort) : null, username: b?.usuario || null, password: b?.clave || null, authType: "DIGEST",
            } });
            return tx.centralAlarma.create({ data: { deviceId: dev.id, modelo, cuenta, protocolo: porReceptor || b?.protocolo === "ADM-CID" ? "ADM-CID" : "SIA-DCS", claveCifrada, lanVpn, prueba: !!b?.prueba, supervisionSeg: sup } });
        });
        // El área de Dispositivos, si se eligió (DEVICE_AREAS: { equipos: { deviceId: areaId } }).
        if (b?.areaId) {
            const fila = await prisma.setting.findUnique({ where: { key: "DEVICE_AREAS" } });
            let est: any = {}; try { est = JSON.parse(fila?.value || "{}"); } catch { }
            est.equipos = { ...(est.equipos || {}), [creada.deviceId]: String(b.areaId) };
            await prisma.setting.upsert({ where: { key: "DEVICE_AREAS" }, update: { value: JSON.stringify(est) }, create: { key: "DEVICE_AREAS", value: JSON.stringify(est) } });
        }
        await auditar(s, "Dio de alta una central de alarma", nombre, true, `${modelo} · cuenta ${cuenta}${b?.prueba ? " · de prueba" : ""}`);
        return NextResponse.json({ ok: true, id: creada.id, deviceId: creada.deviceId, cuenta });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "No se pudo dar de alta" }, { status: 400 });
    }
}

export async function PUT(req: NextRequest) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { s, no } = await sesionCon("hub.config"); if (no) return no;
    const b = await req.json().catch(() => ({}));
    const d = b?.destino;
    if (!d?.direccion || !/^[a-z0-9.-]{3,253}$/i.test(String(d.direccion).trim())) return NextResponse.json({ ok: false, error: "La dirección es un dominio o una IP pública (p. ej. alarmas.ies.com.uy)." }, { status: 400 });
    const puerto = Number(d.puerto) || PUERTO_RECEPTOR;
    if (puerto < 1 || puerto > 65535) return NextResponse.json({ ok: false, error: "Puerto inválido." }, { status: 400 });
    await guardarDestino({ direccion: String(d.direccion), puerto, transporte: d.transporte === "tcp" ? "tcp" : "udp" });
    await auditar(s, "Cambió la dirección del receptor de centrales", `${d.direccion}:${puerto}`, true);
    return NextResponse.json({ ok: true });
}
