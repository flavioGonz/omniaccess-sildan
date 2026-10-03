import { prisma } from "@/lib/prisma";
import { stat } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * Versión del APK para OTA. Manejada por Settings para poder publicar una nueva
 * versión sin re-desplegar código:
 *   guard_apk_version_code (entero, para comparar y decidir el update)
 *   guard_apk_version_name (texto visible, ej "1.6")
 * El cliente nativo compara versionCode contra su BuildConfig.VERSION_CODE.
 */
export async function GET() {
    let versionCode = 6;
    let versionName = "1.5";
    let updatedAt: string | null = null;
    try {
        const rows = await prisma.setting.findMany({ where: { key: { in: ["guard_apk_version_code", "guard_apk_version_name"] } } });
        for (const r of rows) {
            if (r.key.endsWith("code")) { const n = parseInt(r.value); if (!isNaN(n)) versionCode = n; }
            else if (r.value) versionName = r.value;
        }
    } catch { }
    try { const st = await stat(path.join(process.cwd(), "public", "GuardiaSildan.apk")); updatedAt = st.mtime.toISOString(); } catch { }
    return Response.json({ versionCode, versionName, url: "/api/apk", updatedAt }, { headers: { "Cache-Control": "no-store" } });
}
