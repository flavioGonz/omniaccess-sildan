import { readFile } from "fs/promises";
import path from "path";
import { ARCHIVO_APK, NOMBRE_DESCARGA_APK } from "@/lib/apk";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const buf = await readFile(path.join(process.cwd(), "public", ARCHIVO_APK));
        return new Response(new Uint8Array(buf), {
            headers: {
                "Content-Type": "application/vnd.android.package-archive",
                "Content-Disposition": `attachment; filename="${NOMBRE_DESCARGA_APK}"`,
                "Content-Length": String(buf.length),
                "Cache-Control": "no-store",
            },
        });
    } catch {
        return new Response("APK no disponible", { status: 404 });
    }
}
