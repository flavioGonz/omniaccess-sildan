export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEC = new Set(["GRANT", "DENY"]);
const DIR = new Set(["ENTRY", "EXIT"]);
const CRED = new Set(["PLATE", "FACE", "TAG", "PIN", "QR", "FINGERPRINT"]);

// POST /api/history/import  body: { events: [...] }
// Inserta eventos de otra instancia. deviceId/userId se anulan (FK distintas); el nombre
// de la terminal original se preserva en location. Dedup por id (skipDuplicates).
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const arr: any[] = Array.isArray(body) ? body : (body?.events || []);
        if (!Array.isArray(arr) || arr.length === 0) return NextResponse.json({ inserted: 0, skipped: 0, error: "Sin eventos" }, { status: 400 });

        const rows: any[] = [];
        for (const e of arr) {
            const ts = e?.timestamp ? new Date(e.timestamp) : null;
            if (!ts || isNaN(ts.getTime())) continue;
            const decision = DEC.has(e?.decision) ? e.decision : "DENY";
            const direction = DIR.has(e?.direction) ? e.direction : "ENTRY";
            const accessType = CRED.has(e?.accessType) ? e.accessType : null;
            rows.push({
                id: typeof e?.id === "string" && e.id.length > 0 ? e.id : undefined,
                timestamp: ts,
                createdAt: e?.createdAt ? new Date(e.createdAt) : ts,
                accessType,
                credentialId: e?.credentialId ?? null,
                decision,
                direction,
                plateDetected: e?.plateDetected ?? null,
                plateNumber: e?.plateNumber ?? null,
                location: e?.location ?? e?.deviceName ?? null,
                snapshotPath: e?.snapshotPath ?? null,
                imagePath: e?.imagePath ?? null,
                details: e?.details ?? null,
                deviceId: null,
                userId: null,
            });
        }
        if (rows.length === 0) return NextResponse.json({ inserted: 0, skipped: 0, error: "Nada válido" }, { status: 400 });

        let inserted = 0;
        const chunk = 500;
        for (let i = 0; i < rows.length; i += chunk) {
            const res = await prisma.accessEvent.createMany({ data: rows.slice(i, i + chunk), skipDuplicates: true });
            inserted += res.count;
        }
        return NextResponse.json({ inserted, skipped: rows.length - inserted, total: arr.length });
    } catch (e: any) {
        return NextResponse.json({ inserted: 0, error: e?.message || "Error" }, { status: 500 });
    }
}
