/** Constructor de manuales — API.
 *
 *  GET  /api/manuals                     → lista de manuales, con estado de capturas
 *  GET  /api/manuals?id=operador         → { md, toc, faltantes, shots }
 *  POST /api/manuals  {id, md}           → guarda el Markdown
 *  POST /api/manuals  {action:"build"}   → compila HTML + PDF
 *  POST /api/manuals  {action:"capture", only?} → dispara el capturador
 *  POST /api/manuals  (multipart: id, file, name?) → sube una imagen y devuelve el marcador
 *
 *  Los manuales viven como archivos en docs/manual/ (fuente de verdad, versionada en git).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { spawn } from "child_process";

const ROOT = process.cwd();
const MDIR = path.join(ROOT, "docs", "manual");
const IMGDIR = path.join(MDIR, "img");
const OUT = path.join(ROOT, "public", "manuales");

const readMeta = async () => JSON.parse(await fs.readFile(path.join(MDIR, "00-meta.json"), "utf8"));
const readShots = async () => { try { return JSON.parse(await fs.readFile(path.join(MDIR, "shots.json"), "utf8")).shots || []; } catch { return []; } };

/** Corre un script del proyecto y devuelve su salida (con tope de tiempo). */
function run(args: string[], ms = 600000): Promise<{ ok: boolean; out: string }> {
    return new Promise((resolve) => {
        const p = spawn("node", args, { cwd: ROOT });
        let out = "";
        const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { } resolve({ ok: false, out: out + "\n[tiempo agotado]" }); }, ms);
        p.stdout.on("data", (d) => (out += d.toString()));
        p.stderr.on("data", (d) => (out += d.toString()));
        p.on("close", (code) => { clearTimeout(t); resolve({ ok: code === 0, out }); });
    });
}

/** Marcadores de imagen usados en un Markdown, con cuáles faltan. */
function imagenes(md: string) {
    const usadas = [...md.matchAll(/!\[([^\]]*)\]\(img\/([^)]+)\)/g)].map((m) => ({ alt: m[1], file: m[2] }));
    const vistos = new Set<string>();
    const unicas = usadas.filter((x) => (vistos.has(x.file) ? false : vistos.add(x.file)));
    return unicas.map((x) => ({ ...x, existe: fsSync.existsSync(path.join(IMGDIR, x.file)) }));
}

export async function GET(req: NextRequest) {
    try {
        const id = req.nextUrl.searchParams.get("id");
        const meta = await readMeta();

        if (!id) {
            const manuales = await Promise.all(meta.manuales.map(async (m: any) => {
                const f = path.join(MDIR, m.id + ".md");
                let md = ""; try { md = await fs.readFile(f, "utf8"); } catch { }
                const imgs = imagenes(md);
                const pdf = path.join(OUT, m.id + ".pdf");
                return {
                    ...m, existe: !!md, bytes: md.length,
                    capitulos: (md.match(/^# /gm) || []).length,
                    capturas: { total: imgs.length, listas: imgs.filter((x) => x.existe).length },
                    pdf: fsSync.existsSync(pdf) ? { url: `/manuales/${m.id}.pdf`, kb: Math.round(fsSync.statSync(pdf).size / 1024), fecha: fsSync.statSync(pdf).mtime } : null,
                    html: fsSync.existsSync(path.join(OUT, m.id + ".html")) ? `/manuales/${m.id}.html` : null,
                };
            }));
            return NextResponse.json({ ok: true, producto: meta.producto, manuales });
        }

        const f = path.join(MDIR, id + ".md");
        const md = fsSync.existsSync(f) ? await fs.readFile(f, "utf8") : "";
        const man = meta.manuales.find((m: any) => m.id === id) || null;
        const shots = (await readShots()).filter((s: any) => man && s.file.startsWith(man.prefijo + "-"));
        return NextResponse.json({ ok: true, man, md, imagenes: imagenes(md), shots });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const ct = req.headers.get("content-type") || "";

        // ── subir imagen (pegada con Ctrl+V o elegida) ──
        if (ct.includes("multipart/form-data")) {
            const fd = await req.formData();
            const id = String(fd.get("id") || "");
            const file = fd.get("file");
            if (!file || typeof file === "string") return NextResponse.json({ ok: false, error: "Falta el archivo" }, { status: 400 });

            const meta = await readMeta();
            const man = meta.manuales.find((m: any) => m.id === id);
            if (!man) return NextResponse.json({ ok: false, error: "Manual desconocido" }, { status: 404 });

            await fs.mkdir(IMGDIR, { recursive: true });
            // nombre: prefijo + siguiente número libre + descripción en kebab-case
            let nombre = String(fd.get("name") || "").trim();
            if (!nombre) {
                const usados = (await fs.readdir(IMGDIR)).filter((x) => x.startsWith(man.prefijo + "-"));
                const nums = usados.map((x) => parseInt(x.split("-")[1] || "0", 10)).filter((n) => !isNaN(n));
                const n = String(Math.max(0, ...nums) + 1).padStart(2, "0");
                const slug = String(fd.get("desc") || "captura").toLowerCase().normalize("NFD")
                    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 34) || "captura";
                nombre = `${man.prefijo}-${n}-${slug}.png`;
            }
            if (!/\.(png|jpe?g|webp)$/i.test(nombre)) nombre += ".png";

            let buf = Buffer.from(await (file as File).arrayBuffer());
            try {   // normalizar: máx 2400 px de ancho y PNG recomprimido
                const sharp = (await import("sharp")).default;
                const img = sharp(buf); const meta2 = await img.metadata();
                buf = await (meta2.width && meta2.width > 2400 ? img.resize({ width: 2400 }) : img).png({ compressionLevel: 9 }).toBuffer();
            } catch { /* sin sharp, se guarda tal cual */ }

            await fs.writeFile(path.join(IMGDIR, nombre), buf);
            return NextResponse.json({ ok: true, file: nombre, markdown: `![${fd.get("desc") || "Captura"}](img/${nombre})`, kb: Math.round(buf.length / 1024) });
        }

        const body = await req.json();

        // ── compilar ──
        if (body.action === "build") {
            const args = ["scripts/build-manuals.js"];
            if (body.id) args.push("--only", body.id);
            if (body.pdf !== false) args.push("--pdf");
            const r = await run(args);
            return NextResponse.json({ ok: r.ok, salida: r.out });
        }

        // ── capturar pantallas ──
        if (body.action === "capture") {
            const args = ["scripts/capture-manual.js"];
            if (body.only) args.push("--only", body.only);
            if (body.all) args.push("--all");
            const r = await run(args);
            return NextResponse.json({ ok: r.ok, salida: r.out });
        }

        // ── borrar imagen ──
        if (body.action === "deleteImage" && body.file) {
            const p = path.join(IMGDIR, path.basename(body.file));
            if (fsSync.existsSync(p)) await fs.unlink(p);
            return NextResponse.json({ ok: true });
        }

        // ── guardar markdown ──
        if (body.id && typeof body.md === "string") {
            const meta = await readMeta();
            if (!meta.manuales.some((m: any) => m.id === body.id)) return NextResponse.json({ ok: false, error: "Manual desconocido" }, { status: 404 });
            const f = path.join(MDIR, body.id + ".md");
            if (fsSync.existsSync(f)) await fs.copyFile(f, f + ".bak");   // una copia de seguridad simple
            await fs.writeFile(f, body.md, "utf8");
            return NextResponse.json({ ok: true, bytes: body.md.length });
        }

        return NextResponse.json({ ok: false, error: "Pedido no reconocido" }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
    }
}
