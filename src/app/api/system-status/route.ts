import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import axios from "axios";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

export async function GET(req: NextRequest) {
    const status: any = {};

    // 1. Check Primary Database
    try {
        const startDb = performance.now();

        // Basic connectivity check
        await prisma.$queryRaw`SELECT 1`;

        // Attempt to get metadata (might fail if permissions are restricted)
        let metadata: any = {};
        try {
            const results: any[] = await prisma.$queryRaw`SELECT 
                pg_database_size(current_database()) as size,
                (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') as table_count,
                version() as version`;
            metadata = results[0] || {};
        } catch (e) {
            console.warn("DB Metadata fetch failed (permissions?), using defaults");
        }

        const dbUrl = process.env.DATABASE_URL || "";
        const dbMatch = dbUrl.match(/@([^/:]+):?(\d+)?/);
        const dbHost = dbMatch ? dbMatch[1] : '127.0.0.1';
        const dbPort = dbMatch ? (dbMatch[2] || '5432') : '5432';

        status.primaryDb = {
            status: 'connected',
            latency: Math.floor(performance.now() - startDb),
            details: {
                size: Number(metadata.size || 0),
                tableCount: Number(metadata.table_count || 0),
                version: metadata.version?.split(' ')[1] || 'PostgreSQL',
                host: dbHost,
                port: dbPort
            }
        };
    } catch (error: any) {
        console.error("Primary DB Check Failed:", error?.message);
        status.primaryDb = { status: 'error', latency: 0 };
    }

    // 2. Check MinIO (S3)
    try {
        const [endpoint, accessKey, secretKey, bucketLpr, bucketFace] = await Promise.all([
            prisma.setting.findUnique({ where: { key: "S3_ENDPOINT" } }),
            prisma.setting.findUnique({ where: { key: "S3_ACCESS_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_SECRET_KEY" } }),
            prisma.setting.findUnique({ where: { key: "S3_BUCKET_LPR" } }),
            prisma.setting.findUnique({ where: { key: "S3_BUCKET_FACE" } }),
        ]);

        const s3Endpoint = endpoint?.value || process.env.S3_ENDPOINT || "";
        const startMinio = performance.now();

        const client = new S3Client({
            endpoint: s3Endpoint,
            region: "us-east-1",
            credentials: {
                accessKeyId: accessKey?.value || "root",
                secretAccessKey: secretKey?.value || "flavio20",
            },
            forcePathStyle: true,
        });

        const bucketName = bucketLpr?.value || "lpr";
        const faceBucket = bucketFace?.value || "face";

        const [resLpr, resFace] = await Promise.all([
            client.send(new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 })).catch(() => null),
            client.send(new ListObjectsV2Command({ Bucket: faceBucket, MaxKeys: 1 })).catch(() => null)
        ]);

        if (resLpr || resFace) {
            status.minio = {
                status: 'connected',
                latency: Math.floor(performance.now() - startMinio),
                details: {
                    bucket: bucketName,
                    faceBucket: faceBucket,
                    endpoint: s3Endpoint.replace('http://', '').replace('https://', ''),
                    status: "Healthy"
                }
            };
        } else {
            status.minio = { status: 'error', latency: 0 };
        }
    } catch (error: any) {
        console.error("MinIO Check Failed:", error?.message);
        status.minio = { status: 'error', latency: 0 };
    }

    // 3. Check WAHA / OpenWA (WhatsApp)
    try {
        const claves = await prisma.setting.findMany({
            where: { key: { in: ["WAHA_URL", "OPENWA_URL", "WAHA_API_KEY", "OPENWA_API_KEY"] } },
        });
        const valor = (k: string) => claves.find((c) => c.key === k)?.value || undefined;

        // Esta instalacion puede guardar la pasarela como WAHA_* o como OPENWA_*.
        const wahaUrl = valor("WAHA_URL") || valor("OPENWA_URL") || process.env.WAHA_URL || process.env.OPENWA_URL;
        const wahaKey = valor("WAHA_API_KEY") || valor("OPENWA_API_KEY") || process.env.WAHA_API_KEY || process.env.OPENWA_API_KEY;

        if (wahaUrl) {
            const startWaha = performance.now();
            const headers: any = {};
            if (wahaKey) headers["X-Api-Key"] = wahaKey;

            const response = await axios.get(`${wahaUrl.replace(/\/$/, "")}/api/sessions`, {
                timeout: 3000,
                headers,
            });

            const sesiones = Array.isArray(response.data) ? response.data : [];
            const activa = sesiones.find((s: any) => s?.status === "WORKING") || sesiones[0];

            status.waha = {
                status: 'connected',
                latency: Math.floor(performance.now() - startWaha),
                details: {
                    sessions: sesiones.length,
                    sessionStatus: activa?.status || "SIN SESION",
                    endpoint: wahaUrl.replace('http://', '').replace('https://', '')
                }
            };
        } else {
            status.waha = { status: 'disabled', latency: 0 };
        }
    } catch (error: any) {
        console.error("WAHA Check Failed:", error?.message);
        status.waha = { status: 'error', latency: 0 };
    }

    // 4. Check Omni-LPR (lector de matriculas en contenedor)
    try {
        const lprUrl = (process.env.OMNI_LPR_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
        const start = performance.now();
        const r = await axios.get(`${lprUrl}/api/health`, { timeout: 3000 });
        const u = new URL(lprUrl);
        status.omniLpr = {
            status: r.data?.status === "ok" ? 'connected' : 'error',
            latency: Math.floor(performance.now() - start),
            details: {
                version: r.data?.version ? `v${r.data.version}` : "Omni-LPR",
                endpoint: `${u.hostname}:${u.port || "8000"}`
            }
        };
    } catch (error: any) {
        status.omniLpr = { status: 'error', latency: 0 };
    }

    // 5. Check pasarela de seguimiento (camaras comunes -> Omni-LPR)
    try {
        // Las camaras interiores son dispositivos; TRACK_CAMERAS queda de respaldo.
        let cuantas = await prisma.device.count({
            where: { deviceType: "LPR_INTERIOR" as any, trackEnabled: true, NOT: { rtspUrl: null } },
        });
        if (cuantas === 0) {
            try {
                const raw = await prisma.setting.findUnique({ where: { key: "TRACK_CAMERAS" } });
                const arr = JSON.parse(raw?.value || "[]");
                if (Array.isArray(arr)) cuantas = arr.filter((c: any) => c?.rtsp && c?.name).length;
            } catch { }
        }

        const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
        let lecturas = 0;
        let ultima: Date | null = null;
        try {
            lecturas = await prisma.plateSighting.count({ where: { source: "TRACK", timestamp: { gte: desde } } });
            const u = await prisma.plateSighting.findFirst({
                where: { source: "TRACK" },
                orderBy: { timestamp: "desc" },
                select: { timestamp: true },
            });
            ultima = u?.timestamp || null;
        } catch { }

        status.tracking = {
            status: cuantas === 0 ? 'disabled' : 'connected',
            latency: 0,
            details: {
                cameras: cuantas,
                sightings24h: lecturas,
                lastSighting: ultima ? ultima.toISOString() : null
            }
        };
    } catch (error: any) {
        status.tracking = { status: 'error', latency: 0 };
    }

    return NextResponse.json(status);
}
