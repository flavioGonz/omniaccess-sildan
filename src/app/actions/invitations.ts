"use server";

import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import QRCode from "qrcode";
import { getWhatsAppConfig } from "@/lib/whatsapp";

// ══════════════════════════════════════════════════════════════════
//  Invitaciones y visitas temporales — F1 (núcleo + guardia)
// ══════════════════════════════════════════════════════════════════

export type GuestCard = {
    guestId: string;
    invitationId: string;
    name: string;
    doc: string | null;
    plates: string[];
    status: string;            // PENDING | APPROVED | DENIED
    kind: string;              // SINGLE | EVENT
    title: string;
    hostName: string;
    hostLabel: string;
    hostUnitId: string | null;
    validFrom: string;
    validTo: string;
    reentry: string;
    inside: boolean;           // último paso fue ENTRY
    lastEntryAt: string | null;
    lastDirection: string | null;
    qrToken: string;
    invToken: string;
    createdVia: string;
};

// ── Normalización / match tolerante de patente (LPR lee con errores) ──
function normPlate(s: string): string {
    return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
// distancia de edición acotada (<=max) — barata
function editDistLE(a: string, b: string, max: number): boolean {
    if (Math.abs(a.length - b.length) > max) return false;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
        let prev = dp[0]; dp[0] = j; let best = dp[0];
        for (let i = 1; i <= a.length; i++) {
            const tmp = dp[i];
            dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp; if (dp[i] < best) best = dp[i];
        }
        if (best > max) return false;
    }
    return dp[a.length] <= max;
}
function platesClose(a: string, b: string): boolean {
    const x = normPlate(a), y = normPlate(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const max = x.length >= 6 ? 2 : 1;
    return editDistLE(x, y, max);
}

function token(n = 6): string {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const b = crypto.randomBytes(n); let s = "";
    for (let i = 0; i < n; i++) s += abc[b[i] % abc.length];
    return s;
}
function longToken(): string { return crypto.randomBytes(18).toString("base64url"); }

// ── Allowlist WhatsApp: ¿este teléfono puede invitar? ──
// Permite si el teléfono pertenece a un User RESIDENT, o está en el Setting INVITE_WA_ALLOWLIST.
function phoneTail(p: string): string { return String(p || "").replace(/\D/g, "").slice(-8); }
export async function resolveHostByPhone(phone: string): Promise<{ userId: string; name: string; unitId: string | null; label: string } | null> {
    const tail = phoneTail(phone);
    if (!tail) return null;
    try {
        const users = await prisma.user.findMany({
            where: { role: "RESIDENT", phone: { not: null } },
            select: { id: true, name: true, unitId: true, phone: true, apartment: true },
        });
        const u = users.find((x) => phoneTail(x.phone || "") === tail);
        if (u) {
            let label = u.apartment || "";
            if (u.unitId) { const un = await prisma.unit.findUnique({ where: { id: u.unitId }, select: { name: true, lot: true, houseNumber: true } }); if (un) label = [un.name, un.lot ? `Lote ${un.lot}` : un.houseNumber].filter(Boolean).join(" · ") || label; }
            return { userId: u.id, name: u.name, unitId: u.unitId, label };
        }
    } catch { }
    // allowlist manual
    try {
        const r = await prisma.setting.findUnique({ where: { key: "INVITE_WA_ALLOWLIST" } });
        const arr = JSON.parse(r?.value || "[]");
        const hit = (arr as any[]).find((e) => phoneTail(typeof e === "string" ? e : e.phone) === tail);
        if (hit) return { userId: "", name: (hit.name || "Residente"), unitId: hit.unitId || null, label: hit.label || "" };
    } catch { }
    return null;
}

export async function getWaAllowlist(): Promise<{ phone: string; name?: string; label?: string; unitId?: string }[]> {
    try { const r = await prisma.setting.findUnique({ where: { key: "INVITE_WA_ALLOWLIST" } }); const a = JSON.parse(r?.value || "[]"); return Array.isArray(a) ? a.map((e) => typeof e === "string" ? { phone: e } : e) : []; } catch { return []; }
}
export async function setWaAllowlist(list: { phone: string; name?: string; label?: string; unitId?: string }[]): Promise<{ ok: boolean }> {
    try { await prisma.setting.upsert({ where: { key: "INVITE_WA_ALLOWLIST" }, update: { value: JSON.stringify(list) }, create: { key: "INVITE_WA_ALLOWLIST", value: JSON.stringify(list) } }); return { ok: true }; } catch { return { ok: false }; }
}

// ── Crear invitación ──
export async function createInvitation(input: {
    hostUserId?: string | null; hostUnitId?: string | null; hostName?: string; hostLabel?: string;
    kind?: "SINGLE" | "EVENT"; title?: string; validFrom: string | number | Date; validTo: string | number | Date;
    reentry?: "SINGLE_USE" | "MULTI"; maxGuests?: number | null; createdVia?: string; createdBy?: string;
    notify?: boolean;
}): Promise<{ ok: boolean; id?: string; token?: string; error?: string }> {
    try {
        const vf = new Date(input.validFrom), vt = new Date(input.validTo);
        if (isNaN(vf.getTime()) || isNaN(vt.getTime()) || vt <= vf) return { ok: false, error: "Ventana inválida" };
        const inv = await prisma.invitation.create({
            data: {
                hostUserId: input.hostUserId || null, hostUnitId: input.hostUnitId || null,
                hostName: input.hostName || "", hostLabel: input.hostLabel || "",
                kind: (input.kind || "SINGLE") as any, title: input.title || "",
                validFrom: vf, validTo: vt, reentry: (input.reentry || "MULTI") as any,
                maxGuests: input.maxGuests ?? null, createdVia: input.createdVia || "GUARD",
                createdBy: input.createdBy || null, notify: input.notify ?? true, token: token(6),
            },
        });
        return { ok: true, id: inv.id, token: inv.token };
    } catch (e: any) { return { ok: false, error: e?.message || "error" }; }
}

// ── Agregar invitado a una invitación ──
export async function addGuest(invitationId: string, g: { name?: string; doc?: string; plates?: string[]; selfRegistered?: boolean; status?: "PENDING" | "APPROVED" }): Promise<{ ok: boolean; guestId?: string; qrToken?: string; error?: string }> {
    try {
        const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
        if (!inv || inv.status !== "ACTIVE") return { ok: false, error: "Invitación no activa" };
        if (inv.maxGuests != null) {
            const n = await prisma.guest.count({ where: { invitationId, status: { not: "DENIED" } } });
            if (n >= inv.maxGuests) return { ok: false, error: "Cupo completo" };
        }
        const plates = (g.plates || []).map(normPlate).filter(Boolean);
        const guest = await prisma.guest.create({
            data: {
                invitationId, name: g.name || "", doc: g.doc || null, qrToken: longToken(),
                selfRegistered: !!g.selfRegistered, status: (g.status || "APPROVED") as any,
                plates: plates.length ? { create: plates.map((p) => ({ plate: p })) } : undefined,
            },
        });
        return { ok: true, guestId: guest.id, qrToken: guest.qrToken };
    } catch (e: any) { return { ok: false, error: e?.message || "error" }; }
}

// Atajo: invitación SINGLE con un invitado (uso del bot / alta rápida del guardia)
export async function quickInvite(input: {
    hostUserId?: string | null; hostUnitId?: string | null; hostName?: string; hostLabel?: string;
    guestName: string; plate?: string; doc?: string; validFrom: string | number | Date; validTo: string | number | Date;
    reentry?: "SINGLE_USE" | "MULTI"; createdVia?: string; createdBy?: string; title?: string;
}): Promise<{ ok: boolean; code?: string; invitationId?: string; guestId?: string; qrToken?: string; error?: string }> {
    const inv = await createInvitation({ ...input, kind: "SINGLE", title: input.title || input.guestName });
    if (!inv.ok || !inv.id) return { ok: false, error: inv.error };
    const guest = await addGuest(inv.id, { name: input.guestName, doc: input.doc, plates: input.plate ? [input.plate] : [] });
    if (!guest.ok) return { ok: false, error: guest.error };
    return { ok: true, code: inv.token, invitationId: inv.id, guestId: guest.guestId, qrToken: guest.qrToken };
}

// ── Estado "adentro" por invitado a partir de sus pasos ──
function insideFromEntries(entries: { direction: string; timestamp: Date }[]): { inside: boolean; lastAt: Date | null; lastDir: string | null } {
    if (!entries.length) return { inside: false, lastAt: null, lastDir: null };
    const last = entries[0]; // asumimos orden desc
    return { inside: last.direction === "ENTRY", lastAt: last.timestamp, lastDir: last.direction };
}

async function cardsFrom(invs: any[]): Promise<GuestCard[]> {
    const out: GuestCard[] = [];
    for (const inv of invs) {
        for (const g of inv.guests) {
            const ie = insideFromEntries(g.entries || []);
            out.push({
                guestId: g.id, invitationId: inv.id, name: g.name, doc: g.doc, plates: (g.plates || []).map((p: any) => p.plate),
                status: g.status, kind: inv.kind, title: inv.title, hostName: inv.hostName, hostLabel: inv.hostLabel, hostUnitId: inv.hostUnitId,
                validFrom: inv.validFrom.toISOString(), validTo: inv.validTo.toISOString(), reentry: inv.reentry,
                inside: ie.inside, lastEntryAt: ie.lastAt ? ie.lastAt.toISOString() : null, lastDirection: ie.lastDir,
                qrToken: g.qrToken, invToken: inv.token, createdVia: inv.createdVia,
            });
        }
    }
    return out;
}

// ── Invitados activos (vigentes ahora o que vencen hoy) ──
export async function listActiveGuests(opts: { includeInsideOnly?: boolean } = {}): Promise<GuestCard[]> {
    const now = new Date();
    const invs = await prisma.invitation.findMany({
        where: { status: "ACTIVE", validFrom: { lte: now }, validTo: { gte: now } },
        orderBy: { createdAt: "desc" },
        include: { guests: { where: { status: { not: "DENIED" } }, include: { plates: true, entries: { orderBy: { timestamp: "desc" }, take: 4 } } } },
    });
    let cards = await cardsFrom(invs);
    if (opts.includeInsideOnly) cards = cards.filter((c) => c.inside);
    return cards;
}

// ── Búsqueda por nombre o patente (invitaciones vigentes + próximas 24h) ──
export async function searchGuests(q: string): Promise<GuestCard[]> {
    const term = (q || "").trim(); if (!term) return [];
    const now = new Date(); const soon = new Date(now.getTime() + 24 * 3600 * 1000);
    const np = normPlate(term);
    const invs = await prisma.invitation.findMany({
        where: { status: "ACTIVE", validTo: { gte: new Date(now.getTime() - 12 * 3600 * 1000) }, validFrom: { lte: soon } },
        orderBy: { createdAt: "desc" },
        include: { guests: { include: { plates: true, entries: { orderBy: { timestamp: "desc" }, take: 4 } } } },
    });
    const cards = await cardsFrom(invs);
    const low = term.toLowerCase();
    return cards.filter((c) =>
        c.name.toLowerCase().includes(low) ||
        c.hostName.toLowerCase().includes(low) ||
        c.hostLabel.toLowerCase().includes(low) ||
        (np && c.plates.some((p) => platesClose(p, np)))
    );
}

// ── Registrar un paso manual (QR / búsqueda / a mano) ──
export async function markEntry(input: { guestId: string; direction?: "ENTRY" | "EXIT"; method?: "QR" | "SEARCH" | "MANUAL"; gate?: string; validatedBy?: string; plate?: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
    try {
        const g = await prisma.guest.findUnique({ where: { id: input.guestId }, include: { invitation: true } });
        if (!g) return { ok: false, error: "Invitado inexistente" };
        if (g.invitation.status !== "ACTIVE") return { ok: false, error: "Invitación no activa" };
        const now = new Date();
        if (now < g.invitation.validFrom) return { ok: false, error: "Aún no vigente" };
        if (now > g.invitation.validTo) return { ok: false, error: "Vencida" };
        const e = await prisma.guestEntry.create({
            data: { guestId: g.id, invitationId: g.invitationId, direction: input.direction || "ENTRY", method: input.method || "MANUAL", gate: input.gate || null, validatedBy: input.validatedBy || null, plate: input.plate ? normPlate(input.plate) : null },
        });
        return { ok: true, id: e.id };
    } catch (e: any) { return { ok: false, error: e?.message || "error" }; }
}

export async function revokeInvitation(invitationId: string): Promise<{ ok: boolean }> {
    try { await prisma.invitation.update({ where: { id: invitationId }, data: { status: "REVOKED" } }); return { ok: true }; } catch { return { ok: false }; }
}
export async function extendInvitation(invitationId: string, newValidTo: string | number | Date): Promise<{ ok: boolean }> {
    try { await prisma.invitation.update({ where: { id: invitationId }, data: { validTo: new Date(newValidTo), status: "ACTIVE" } }); return { ok: true }; } catch { return { ok: false }; }
}

// ── Aforo de un evento: invitados adentro ahora ──
export async function getAforo(invitationId: string): Promise<{ total: number; inside: number; insideGuests: { guestId: string; name: string; since: string | null }[] }> {
    const inv = await prisma.invitation.findUnique({ where: { id: invitationId }, include: { guests: { include: { entries: { orderBy: { timestamp: "desc" }, take: 4 } } } } });
    if (!inv) return { total: 0, inside: 0, insideGuests: [] };
    const insideGuests: { guestId: string; name: string; since: string | null }[] = [];
    for (const g of inv.guests) { const ie = insideFromEntries(g.entries || []); if (ie.inside) insideGuests.push({ guestId: g.id, name: g.name, since: ie.lastAt ? ie.lastAt.toISOString() : null }); }
    return { total: inv.guests.length, inside: insideGuests.length, insideGuests };
}

// ── Cron: vencer invitaciones pasadas ──
export async function expireStaleInvitations(): Promise<{ expired: number }> {
    try { const r = await prisma.invitation.updateMany({ where: { status: "ACTIVE", validTo: { lt: new Date() } }, data: { status: "EXPIRED" } }); return { expired: r.count }; } catch { return { expired: 0 }; }
}

// ══════════════════════════════════════════════════════════════════
//  F2 — QR del pase / invitado + validación por escaneo
// ══════════════════════════════════════════════════════════════════

/** SVG de un QR para el texto/URL dado (se renderiza con dangerouslySetInnerHTML). */
export async function getQrSvg(text: string): Promise<string> {
    try { return await QRCode.toString(String(text || ""), { type: "svg", margin: 1, errorCorrectionLevel: "M", width: 240 }); }
    catch { return ""; }
}

/** Extrae el token de un valor escaneado (acepta el token pelado o una URL .../invitado/<token>). */
function pickToken(raw: string): string {
    const s = String(raw || "").trim();
    const m = s.match(/\/invitado\/([^/?#\s]+)/i) || s.match(/[?&](?:t|token|qr)=([^&\s]+)/i);
    return (m ? m[1] : s).trim();
}

export type QrResolve = {
    ok: boolean;
    status: "valid" | "notyet" | "expired" | "revoked" | "notfound";
    reason?: string;
    card?: GuestCard;
};

/** Resuelve un QR escaneado (token de invitado o de pase) y evalúa su vigencia. */
export async function resolveByQr(raw: string): Promise<QrResolve> {
    const token = pickToken(raw);
    if (!token) return { ok: false, status: "notfound" };
    const now = new Date();
    // 1) token de invitado (qrToken)
    let guest = await prisma.guest.findUnique({ where: { qrToken: token }, include: { plates: true, entries: { orderBy: { timestamp: "desc" }, take: 4 }, invitation: true } });
    // 2) si no, token de pase (invitation.token) → primer invitado del pase
    if (!guest) {
        const inv = await prisma.invitation.findUnique({ where: { token: token.toUpperCase() }, include: { guests: { include: { plates: true, entries: { orderBy: { timestamp: "desc" }, take: 4 } }, take: 1 } } });
        if (inv && inv.guests[0]) guest = { ...inv.guests[0], invitation: inv } as any;
    }
    if (!guest || !guest.invitation) return { ok: false, status: "notfound" };
    const inv = guest.invitation as any;
    const [card] = await cardsFrom([{ ...inv, guests: [{ ...guest, invitation: undefined }] }]);
    if (inv.status === "REVOKED") return { ok: false, status: "revoked", card };
    if (inv.status === "EXPIRED" || now > inv.validTo) return { ok: false, status: "expired", card };
    if (now < inv.validFrom) return { ok: false, status: "notyet", card };
    if (guest.status === "DENIED") return { ok: false, status: "revoked", reason: "Invitado denegado", card };
    return { ok: true, status: "valid", card };
}

/** Datos públicos mínimos de un pase para la página /invitado/[token] (sin auth). */
export async function getPublicPass(token: string): Promise<{ ok: boolean; name?: string; host?: string; hostName?: string; hostLabel?: string; title?: string; plates?: string[]; validFrom?: string; validTo?: string; status?: string; qrToken?: string; geo?: { lat: number; lng: number } | null; poly?: [number, number][] | null }> {
    const r = await resolveByQr(token);
    if (!r.card) return { ok: false };
    const c = r.card;
    // ubicación del lote (si el lote tiene geo cargada en /admin/mapa)
    let geo: { lat: number; lng: number } | null = null;
    let poly: [number, number][] | null = null;
    try {
        if (c.hostUnitId) {
            const un = await prisma.unit.findUnique({ where: { id: c.hostUnitId }, select: { coordinates: true, mapPoints: true } });
            const inUy = (la: number, ln: number) => la < -30 && la > -40 && ln < -53 && ln > -59; // Uruguay aprox
            if (un?.coordinates) { const m = String(un.coordinates).split(/[,;\s]+/).map(Number).filter((x) => !isNaN(x)); if (m.length >= 2 && inUy(m[0], m[1])) geo = { lat: m[0], lng: m[1] }; }
            if (un?.mapPoints) { try { const pts = JSON.parse(un.mapPoints); if (Array.isArray(pts) && pts.length >= 3) { const pp = pts.map((p: any) => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.lat), Number(p.lng)]).filter((p: any) => !isNaN(p[0]) && !isNaN(p[1]) && inUy(p[0], p[1])); if (pp.length >= 3) { poly = pp as [number, number][]; if (!geo) { const la = pp.reduce((a: number, p: any) => a + p[0], 0) / pp.length, ln = pp.reduce((a: number, p: any) => a + p[1], 0) / pp.length; geo = { lat: la, lng: ln }; } } } } catch { } }
        }
    } catch { }
    return { ok: r.ok, name: c.name, host: c.hostLabel || c.hostName, hostName: c.hostName, hostLabel: c.hostLabel, title: c.title, plates: c.plates, validFrom: c.validFrom, validTo: c.validTo, status: r.status, qrToken: c.qrToken, geo, poly };
}

// ══════════════════════════════════════════════════════════════════
//  F3 — Portal del residente (token de portal; magic-link vía WA/mail luego)
// ══════════════════════════════════════════════════════════════════

export type MyGuest = { guestId: string; name: string; plates: string[]; qrToken: string; status: string; inside: boolean; lastEntryAt: string | null; entries: number };
export type MyInvitation = { id: string; title: string; kind: string; status: string; validFrom: string; validTo: string; reentry: string; maxGuests: number | null; token: string; guests: MyGuest[] };
export type PortalHost = { userId: string; name: string; label: string };

async function readTokenMap(): Promise<Record<string, string>> {
    try { const r = await prisma.setting.findUnique({ where: { key: "RESIDENT_PORTAL_TOKENS" } }); return JSON.parse(r?.value || "{}"); } catch { return {}; }
}
async function writeTokenMap(m: Record<string, string>): Promise<void> {
    await prisma.setting.upsert({ where: { key: "RESIDENT_PORTAL_TOKENS" }, update: { value: JSON.stringify(m) }, create: { key: "RESIDENT_PORTAL_TOKENS", value: JSON.stringify(m) } });
}

async function unitLabel(unitId: string | null, fallback = ""): Promise<string> {
    if (!unitId) return fallback;
    try { const u = await prisma.unit.findUnique({ where: { id: unitId }, select: { name: true, lot: true, houseNumber: true } }); if (u) return [u.name, u.lot ? `Lote ${u.lot}` : u.houseNumber].filter(Boolean).join(" · ") || fallback; } catch { }
    return fallback;
}

/** (Admin/guardia) Genera o recupera el token de portal de un residente. */
export async function getOrCreatePortalToken(userId: string): Promise<{ ok: boolean; token?: string; error?: string }> {
    try {
        const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
        if (!u) return { ok: false, error: "Usuario inexistente" };
        const m = await readTokenMap();
        for (const [t, uid] of Object.entries(m)) if (uid === userId) return { ok: true, token: t };
        const t = crypto.randomBytes(18).toString("base64url");
        m[t] = userId; await writeTokenMap(m);
        return { ok: true, token: t };
    } catch (e: any) { return { ok: false, error: e?.message || "error" }; }
}

async function resolvePortalToken(token: string): Promise<PortalHost | null> {
    if (!token) return null;
    const m = await readTokenMap();
    const userId = m[token]; if (!userId) return null;
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, unitId: true, apartment: true } });
    if (!u) return null;
    return { userId: u.id, name: u.name, label: await unitLabel(u.unitId, u.apartment || "") };
}

export async function getPortalHost(token: string): Promise<PortalHost | null> { return resolvePortalToken(token); }

/** (Admin) Buscar residentes para entregarles su link de portal. */
export async function listResidentsForPortal(q: string): Promise<{ id: string; name: string; label: string; phone: string | null }[]> {
    const term = (q || "").trim(); if (term.length < 2) return [];
    const users = await prisma.user.findMany({
        where: { role: "RESIDENT", OR: [{ name: { contains: term, mode: "insensitive" } }, { apartment: { contains: term, mode: "insensitive" } }] },
        select: { id: true, name: true, unitId: true, apartment: true, phone: true }, take: 20, orderBy: { name: "asc" },
    });
    const out: { id: string; name: string; label: string; phone: string | null }[] = [];
    for (const u of users) out.push({ id: u.id, name: u.name, label: await unitLabel(u.unitId, u.apartment || ""), phone: u.phone || null });
    return out;
}

/** (Residente) Mis invitaciones, con quién entró. */
export async function listMyInvitations(token: string): Promise<{ ok: boolean; host?: PortalHost; items?: MyInvitation[] }> {
    const host = await resolvePortalToken(token); if (!host) return { ok: false };
    const invs = await prisma.invitation.findMany({
        where: { hostUserId: host.userId },
        orderBy: { createdAt: "desc" }, take: 100,
        include: { guests: { include: { plates: true, entries: { orderBy: { timestamp: "desc" } } } } },
    });
    const now = Date.now();
    const items: MyInvitation[] = invs.map((inv: any) => {
        const status = inv.status === "ACTIVE" && new Date(inv.validTo).getTime() < now ? "EXPIRED" : inv.status;
        return {
            id: inv.id, title: inv.title, kind: inv.kind, status, validFrom: inv.validFrom.toISOString(), validTo: inv.validTo.toISOString(),
            reentry: inv.reentry, maxGuests: inv.maxGuests, token: inv.token,
            guests: inv.guests.map((g: any) => {
                const last = g.entries[0];
                return { guestId: g.id, name: g.name, plates: g.plates.map((p: any) => p.plate), qrToken: g.qrToken, status: g.status, inside: last ? last.direction === "ENTRY" : false, lastEntryAt: last ? last.timestamp.toISOString() : null, entries: g.entries.length };
            }),
        };
    });
    return { ok: true, host, items };
}

/** (Residente) Crear invitación (visita o fiesta) con uno o varios invitados. */
export async function createMyInvitation(token: string, input: {
    kind?: "SINGLE" | "EVENT"; title?: string; validFrom: string | number | Date; validTo: string | number | Date;
    reentry?: "SINGLE_USE" | "MULTI"; maxGuests?: number | null; guests?: { name: string; plate?: string }[];
}): Promise<{ ok: boolean; id?: string; token?: string; error?: string }> {
    const host = await resolvePortalToken(token); if (!host) return { ok: false, error: "Sesión inválida" };
    const vf = new Date(input.validFrom), vt = new Date(input.validTo);
    if (isNaN(vf.getTime()) || isNaN(vt.getTime()) || vt <= vf) return { ok: false, error: "Ventana inválida" };
    try {
        const inv = await prisma.invitation.create({ data: {
            hostUserId: host.userId, hostName: host.name, hostLabel: host.label,
            kind: (input.kind || "SINGLE") as any, title: input.title || "", validFrom: vf, validTo: vt,
            reentry: (input.reentry || "MULTI") as any, maxGuests: input.maxGuests ?? null, createdVia: "PORTAL",
            createdBy: host.userId, notify: true, token: tokenShort(),
        }});
        for (const g of (input.guests || [])) {
            if (!g || !g.name) continue;
            const plates = g.plate ? [normPlate(g.plate)].filter(Boolean) : [];
            await prisma.guest.create({ data: { invitationId: inv.id, name: g.name, qrToken: longToken(), status: "APPROVED", plates: plates.length ? { create: plates.map((p) => ({ plate: p })) } : undefined } });
        }
        // Auto-enviar el QR al WhatsApp del residente (sólo visita simple)
        if ((input.kind || "SINGLE") === "SINGLE") {
            try {
                const g0 = await prisma.guest.findFirst({ where: { invitationId: inv.id }, include: { plates: true }, orderBy: { createdAt: "asc" } });
                if (g0) await sendGuestQrToHostInternal(host.userId!, g0 as any, inv as any);
            } catch (e) { }
        }
        return { ok: true, id: inv.id, token: inv.token };
    } catch (e: any) { return { ok: false, error: e?.message || "error" }; }
}

// Envía el QR de un invitado al WhatsApp del residente (imagen, sin link ni código en el texto)
async function sendGuestQrToHostInternal(hostUserId: string, g: any, inv: any): Promise<void> {
    if (!hostUserId) return;
    const u = await prisma.user.findUnique({ where: { id: hostUserId }, select: { phone: true } });
    const digits = normPhoneUy(u?.phone || "");
    if (!digits || digits.length < 10) return;
    const baseRow = await prisma.setting.findUnique({ where: { key: "BASE_URL" } });
    const base = (baseRow?.value || "https://olivos.sildan.com.uy").replace(/\/+$/, "");
    const link = `${base}/invitado/${g.qrToken}`;
    const dataUrl = await QRCode.toDataURL(link, { width: 512, margin: 1, errorCorrectionLevel: "M" });
    const b64 = dataUrl.split(",")[1] || "";
    const fmt = (x: Date) => new Date(x).toLocaleString("es-UY", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const plates = (g.plates || []).map((p: any) => p.plate);
    const caption = `✅ *Pase creado*\n👤 ${g.name || "Invitado"}${plates.length ? ` (${plates.join(", ")})` : " (a pie)"}\n🕒 ${fmt(inv.validFrom)} → ${fmt(inv.validTo)}\n🏠 Invita: ${inv.hostName||""}${inv.hostLabel?(" · "+inv.hostLabel):""}\n\nReenviá este QR a tu invitado para que lo muestre en la garita.`;
    const cfg = await getWhatsAppConfig();
    const headers: any = { "Content-Type": "application/json" };
    if (cfg.apiKey) headers["X-Api-Key"] = cfg.apiKey;
    await fetch(`${cfg.url}/api/sendImage`, { method: "POST", headers, body: JSON.stringify({ session: cfg.session, chatId: `${digits}@c.us`, file: { mimetype: "image/png", filename: "pase.png", data: b64 }, caption }) }).catch(() => { });
}

function tokenShort(): string { const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const b = crypto.randomBytes(6); let s = ""; for (let i = 0; i < 6; i++) s += abc[b[i] % abc.length]; return s; }

/** (Residente) Agregar un invitado a una invitación propia. */
export async function addMyGuest(token: string, invitationId: string, g: { name: string; plate?: string }): Promise<{ ok: boolean; error?: string }> {
    const host = await resolvePortalToken(token); if (!host) return { ok: false, error: "Sesión inválida" };
    const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!inv || inv.hostUserId !== host.userId) return { ok: false, error: "No autorizado" };
    if (inv.status !== "ACTIVE") return { ok: false, error: "Invitación no activa" };
    if (inv.maxGuests != null) { const n = await prisma.guest.count({ where: { invitationId, status: { not: "DENIED" } } }); if (n >= inv.maxGuests) return { ok: false, error: "Cupo completo" }; }
    const plates = g.plate ? [normPlate(g.plate)].filter(Boolean) : [];
    await prisma.guest.create({ data: { invitationId, name: g.name || "", qrToken: longToken(), status: "APPROVED", plates: plates.length ? { create: plates.map((p) => ({ plate: p })) } : undefined } });
    return { ok: true };
}

/** (Residente) Revocar / extender una invitación propia. */
export async function revokeMyInvitation(token: string, invitationId: string): Promise<{ ok: boolean }> {
    const host = await resolvePortalToken(token); if (!host) return { ok: false };
    const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!inv || inv.hostUserId !== host.userId) return { ok: false };
    await prisma.invitation.update({ where: { id: invitationId }, data: { status: "REVOKED" } });
    return { ok: true };
}
export async function extendMyInvitation(token: string, invitationId: string, newValidTo: string | number | Date): Promise<{ ok: boolean }> {
    const host = await resolvePortalToken(token); if (!host) return { ok: false };
    const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!inv || inv.hostUserId !== host.userId) return { ok: false };
    await prisma.invitation.update({ where: { id: invitationId }, data: { validTo: new Date(newValidTo), status: "ACTIVE" } });
    return { ok: true };
}


// ── Enviar el QR del pase por WhatsApp al PROPIO residente (para que lo reenvíe a su invitado) ──
function normPhoneUy(raw: string): string {
    let d = String(raw || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("598")) return d;
    if (d.startsWith("0")) d = d.slice(1);
    if (d.length >= 8 && d.length <= 10) return "598" + d;
    return d;
}
export async function sendPassToHost(token: string, qrToken: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const host = await resolvePortalToken(token);
        if (!host || !host.userId) return { ok: false, error: "Sesión inválida" };
        const g = await prisma.guest.findUnique({ where: { qrToken }, include: { plates: true, invitation: true } });
        if (!g || !g.invitation || (g.invitation as any).hostUserId !== host.userId) return { ok: false, error: "No autorizado" };
        const u = await prisma.user.findUnique({ where: { id: host.userId }, select: { phone: true } });
        const digits = normPhoneUy(u?.phone || "");
        if (!digits || digits.length < 10) return { ok: false, error: "Tu usuario no tiene un celular válido cargado" };
        const inv: any = g.invitation;
        const baseRow = await prisma.setting.findUnique({ where: { key: "BASE_URL" } });
        const base = (baseRow?.value || "https://olivos.sildan.com.uy").replace(/\/+$/, "");
        const link = `${base}/invitado/${qrToken}`;
        const dataUrl = await QRCode.toDataURL(link, { width: 512, margin: 1, errorCorrectionLevel: "M" });
        const b64 = dataUrl.split(",")[1] || "";
        const fmt = (x: Date) => new Date(x).toLocaleString("es-UY", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const plates = (g.plates || []).map((p: any) => p.plate);
        const caption = `🎟️ *Pase de visita — Los Olivos*\n\n👤 ${g.name || "Invitado"}${plates.length ? ` (${plates.join(", ")})` : ""}\n🕒 ${fmt(inv.validFrom)} → ${fmt(inv.validTo)}\n\nReenviale este QR a tu invitado para que lo muestre en la garita.\n${link}`;
        const cfg = await getWhatsAppConfig();
        const headers: any = { "Content-Type": "application/json" };
        if (cfg.apiKey) headers["X-Api-Key"] = cfg.apiKey;
        const r = await fetch(`${cfg.url}/api/sendImage`, { method: "POST", headers, body: JSON.stringify({ session: cfg.session, chatId: `${digits}@c.us`, file: { mimetype: "image/png", filename: "pase.png", data: b64 }, caption }) });
        if (!r.ok) return { ok: false, error: `WhatsApp no disponible (${r.status})` };
        return { ok: true };
    } catch (e: any) { return { ok: false, error: e?.message || "error" }; }
}
