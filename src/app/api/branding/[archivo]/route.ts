import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

// Sirve lo que sube Ajustes → Marca / QR (public/branding/<archivo>).
// Next en producción sólo sirve de /public lo que existía al compilar: un logo subido
// después del build daba 404 aunque el archivo estuviera en el disco, y la pantalla
// parecía "no subir". Esta ruta lee del disco en cada pedido.
const TIPOS: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".mp4": "video/mp4", ".ico": "image/x-icon" };

export async function GET(_req: NextRequest, ctx: { params: Promise<{ archivo: string }> }) {
    const { archivo } = await ctx.params;
    const nombre = path.basename(String(archivo || ""));           // sin ../ ni subcarpetas
    if (!nombre || nombre.startsWith(".")) return new Response("no", { status: 400 });
    const ruta = path.join(process.cwd(), "public", "branding", nombre);
    try {
        const buf = await fs.readFile(ruta);
        const tipo = TIPOS[path.extname(nombre).toLowerCase()] || "application/octet-stream";
        return new Response(new Uint8Array(buf), { headers: { "Content-Type": tipo, "Cache-Control": "public, max-age=3600" } });
    } catch {
        return new Response("no existe", { status: 404 });
    }
}
