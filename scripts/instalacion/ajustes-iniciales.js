#!/usr/bin/env node
/**
 * Los ajustes mínimos de una instalación nueva, en la base, sin usuarios ni claves en el código.
 *
 *   cd /opt/OmniAccess && node scripts/instalacion/ajustes-iniciales.js
 *
 * Por qué existe: en el laboratorio (12/10) la app arrancó con la base vacía y tres cosas salieron
 * mal a la vista, aunque los servicios estaban bien:
 *   - Modos mostraba DOS modos «en uso» (Matrículas y Rostro venían prendidos de fábrica).
 *   - MinIO salía caído: el chequeo lee el endpoint y las claves de la tabla Setting, y no había.
 *   - WhatsApp salía caído por lo mismo: la URL de la pasarela vive en Setting.
 * seed.js hace parte de esto, pero además crea un admin con clave por entorno; éste sólo escribe
 * ajustes, y el primer usuario se crea aparte con scripts/crear-admin.js.
 *
 * Nunca pisa un ajuste que ya existe (correrlo en una instalación andando no cambia nada), salvo
 * los modos cuando hay más de uno prendido, que es un estado que la app no sabe correr.
 * Las claves salen del .env (S3_*) y del archivo de la pasarela (WAHA_ENV, por defecto
 * /root/waha.env); no se imprimen.
 */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

/** Lee un archivo KEY=valor (con o sin comillas). Ausente = vacío. */
function leerEnv(archivo) {
    const out = {};
    let texto = "";
    try { texto = fs.readFileSync(archivo, "utf8"); } catch { return out; }
    for (const linea of texto.split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
}

/** El modo de fábrica de una instalación nueva. */
const MODO_INICIAL = "MODULE_LPR";
const MODOS = ["MODULE_LPR", "MODULE_FACE", "MODULE_QUEUE"];

async function main() {
    const env = { ...leerEnv(path.join(process.cwd(), ".env")), ...process.env };
    const waha = leerEnv(process.env.WAHA_ENV || "/root/waha.env");
    const p = new PrismaClient();
    const hechos = [];
    try {
        const existentes = new Map((await p.setting.findMany()).map((s) => [s.key, s.value]));
        const poner = async (key, value, motivo) => {
            if (existentes.has(key) || value == null || value === "") return;
            await p.setting.create({ data: { key, value: String(value) } });
            hechos.push(`${key}${motivo ? ` (${motivo})` : ""}`);
        };

        // Modos: exactamente uno.
        const prendidos = MODOS.filter((m) => existentes.get(m) === "true");
        if (prendidos.length > 1) {
            const queda = prendidos[0];
            for (const m of MODOS) await p.setting.upsert({ where: { key: m }, update: { value: String(m === queda) }, create: { key: m, value: String(m === queda) } });
            hechos.push(`modos: había ${prendidos.length} prendidos, queda ${queda}`);
        } else if (prendidos.length === 0 && !MODOS.some((m) => existentes.has(m))) {
            for (const m of MODOS) await poner(m, String(m === MODO_INICIAL));
        }
        await poner("MODE_LPR", "WHITELIST");

        // Almacenamiento (MinIO) — lo que el chequeo y las subidas leen de Setting.
        await poner("S3_ENDPOINT", env.S3_ENDPOINT);
        await poner("S3_ACCESS_KEY", env.S3_ACCESS_KEY);
        await poner("S3_SECRET_KEY", env.S3_SECRET_KEY, "del .env");
        await poner("S3_BUCKET_LPR", env.S3_BUCKET);
        await poner("S3_BUCKET_FACE", env.S3_BUCKET_FACE);
        await poner("S3_BUCKET_QUEUE", env.S3_BUCKET_QUEUE);

        // Pasarela de WhatsApp (WAHA), si está instalada en este CT.
        if (waha.WAHA_API_KEY) {
            await poner("OPENWA_URL", process.env.WAHA_URL || "http://127.0.0.1:3000");
            await poner("OPENWA_API_KEY", waha.WAHA_API_KEY, "de " + (process.env.WAHA_ENV || "/root/waha.env"));
        }
        // Los buckets: el chequeo de salud lista el de matrículas o el de rostros, y con el MinIO
        // recién instalado no existe ninguno (lib-s3 los crea recién en la primera subida).
        if (env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY) {
            const { S3Client, CreateBucketCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");
            const s3 = new S3Client({ endpoint: env.S3_ENDPOINT, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });
            for (const b of [env.S3_BUCKET, env.S3_BUCKET_FACE, env.S3_BUCKET_QUEUE].filter(Boolean)) {
                const hay = await s3.send(new HeadBucketCommand({ Bucket: b })).then(() => true).catch(() => false);
                if (!hay) { await s3.send(new CreateBucketCommand({ Bucket: b })); hechos.push(`bucket ${b} creado`); }
            }
        }
    } finally {
        await p.$disconnect();
    }
    console.log(hechos.length ? `Ajustes escritos:\n  - ${hechos.join("\n  - ")}` : "Nada que escribir: los ajustes ya estaban.");
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
