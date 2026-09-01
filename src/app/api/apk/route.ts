import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const p = path.join(process.cwd(), "public", "GuardiaSildan.apk");
        const buf = await readFile(p);
        return new Response(new Uint8Array(buf), {
            headers: {
                "Content-Type": "application/vnd.android.package-archive",
                "Content-Disposition": 'attachment; filename="GuardiaSildan.apk"',
                "Content-Length": String(buf.length),
                "Cache-Control": "no-store",
            },
        });
    } catch {
        return new Response("APK no disponible", { status: 404 });
    }
}
