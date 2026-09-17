import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function parseUrl(raw: string | undefined, fallbackPort: string) {
    if (!raw) return { ip: "-", port: fallbackPort };
    try {
        const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
        return { ip: u.hostname, port: u.port || fallbackPort };
    } catch {
        return { ip: raw, port: fallbackPort };
    }
}

async function setting(key: string) {
    try {
        const s = await prisma.setting.findUnique({ where: { key } });
        return s?.value || undefined;
    } catch {
        return undefined;
    }
}

export async function GET() {
    const [s3Endpoint, wahaUrl] = await Promise.all([setting("S3_ENDPOINT"), setting("OPENWA_URL")]);

    let pgVersion = "PostgreSQL";
    let tables = 0;
    try {
        const v: any = await prisma.$queryRawUnsafe(`select current_setting('server_version') as v`);
        pgVersion = `PostgreSQL ${String(v?.[0]?.v || "").split(".")[0]}`;
        const t: any = await prisma.$queryRawUnsafe(
            `select count(*)::int as c from pg_tables where schemaname = current_schema()`
        );
        tables = t?.[0]?.c ?? 0;
    } catch { }

    const db = parseUrl(process.env.DATABASE_URL, "5432");
    const redis = parseUrl(process.env.REDIS_URL, "6379");
    const minio = parseUrl(s3Endpoint || process.env.S3_ENDPOINT, "9000");
    const waha = parseUrl(wahaUrl || process.env.OPENWA_URL, "3000");
    const appPort = process.env.PORT || "10001";
    const hookPort = process.env.WEBHOOK_PORT || "10000";

    return NextResponse.json({
        frontend: { ip: "localhost", port: appPort, sub: "Next.js App" },
        "lpr-node": { ip: "localhost", port: hookPort, sub: "Backend API" },
        postgres: { ip: db.ip, port: db.port, sub: pgVersion, tables },
        minio: { ip: minio.ip, port: minio.port, sub: "MinIO / S3" },
        waha: { ip: waha.ip, port: waha.port, sub: "WhatsApp Gateway" },
        "webhook-api": { ip: "localhost", port: hookPort, sub: "Event Gateway" },
        redis: { ip: redis.ip, port: redis.port, sub: "Redis + BullMQ" },
        media: { ip: "127.0.0.1", port: "1984", sub: "ffmpeg + go2rtc" },
    });
}
