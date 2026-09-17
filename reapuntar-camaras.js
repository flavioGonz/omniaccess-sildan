#!/usr/bin/env node
/**
 * OmniAccess · reapuntar las cámaras al servidor después de mudarlo de red.
 *
 * Las cámaras Hikvision mandan cada lectura de matrícula por HTTP a una IP fija
 * que tienen grabada adentro (Configuración → Red → Servicios → HTTP Listening).
 * Si el servidor cambia de dirección, dejan de llegar eventos y el sistema queda
 * mudo, sin ningún error visible. Esto las actualiza a todas por ISAPI.
 *
 *   node reapuntar-camaras.js 172.16.2.11              # solo muestra qué haría
 *   node reapuntar-camaras.js 172.16.2.11 --aplicar    # las escribe
 *
 * Correr desde /opt/OmniAccess (usa el Prisma del proyecto para leer las cámaras).
 * Si una cámara no está en la base, agregala con --extra ip1,ip2
 */
const crypto = require("node:crypto");

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** fetch con autenticación Digest, que es la que exigen estas cámaras. */
async function pedir(url, { method = "GET", body, user, pass, timeout = 12000 } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const cab = body ? { "Content-Type": "application/xml" } : {};
    try {
        const r1 = await fetch(url, { method, headers: cab, body, signal: ctl.signal });
        if (r1.status !== 401) return r1;

        const wa = r1.headers.get("www-authenticate") || "";
        const dato = (k) => (wa.match(new RegExp(k + '="([^"]+)"')) || [])[1];
        const realm = dato("realm"), nonce = dato("nonce"), opaque = dato("opaque");
        const qop = ((wa.match(/qop="?([^",]+)"?/) || [])[1] || "").split(",")[0].trim();
        const u = new URL(url);
        const uri = u.pathname + u.search;
        const nc = "00000001", cnonce = crypto.randomBytes(8).toString("hex");
        const ha1 = md5(`${user}:${realm}:${pass}`);
        const ha2 = md5(`${method}:${uri}`);
        const resp = qop
            ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
            : md5(`${ha1}:${nonce}:${ha2}`);
        let auth = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${resp}", algorithm=MD5`;
        if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
        if (opaque) auth += `, opaque="${opaque}"`;
        return await fetch(url, { method, headers: { Authorization: auth, ...cab }, body, signal: ctl.signal });
    } finally { clearTimeout(t); }
}

const RUTA = "/ISAPI/Event/notification/httpHosts";
/** Puerto donde escucha el receptor de eventos de OmniAccess. */
const PUERTO = Number(process.env.PUERTO_WEBHOOK || 10000);

async function main() {
    const args = process.argv.slice(2);
    const nuevaIp = args.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
    const aplicar = args.includes("--aplicar");
    const extra = (() => { const i = args.indexOf("--extra"); return i >= 0 ? (args[i + 1] || "").split(",").filter(Boolean) : []; })();
    if (!nuevaIp) {
        console.error("Falta la IP nueva del servidor.\n  node reapuntar-camaras.js 172.16.2.11 [--aplicar]");
        process.exit(2);
    }

    // ── las cámaras salen de la base del sistema ──
    let camaras = [];
    try {
        const { PrismaClient } = require("@prisma/client");
        const prisma = new PrismaClient();
        const devs = await prisma.device.findMany({
            where: { deviceType: "LPR_CAMERA" },
            select: { name: true, ip: true, username: true, password: true },
            orderBy: { name: "asc" },
        });
        camaras = devs.filter((d) => d.ip);
        await prisma.$disconnect();
    } catch (e) {
        console.log("No pude leer la base (" + e.message + "). Uso solo las de --extra.");
    }
    for (const ip of extra) camaras.push({ name: ip, ip, username: null, password: null });

    if (!camaras.length) { console.error("No hay cámaras para tocar."); process.exit(1); }

    const USER = process.env.CAM_USER || "admin";
    const PASS = process.env.CAM_PASS;

    console.log(`\n${camaras.length} cámara(s) · destino nuevo: ${nuevaIp}` + (aplicar ? "" : "  (simulación, no escribe nada)"));
    console.log("─".repeat(72));

    let ok = 0, sinCambio = 0, error = 0;
    for (const c of camaras) {
        const url = `http://${c.ip}${RUTA}`;
        const cred = { user: c.username || USER, pass: c.password || PASS };
        try {
            const r = await pedir(url, cred);
            if (!r.ok) { console.log(`  ✗ ${c.name.padEnd(22)} ${c.ip}  HTTP ${r.status} al leer`); error++; continue; }
            const xml = await r.text();

            // Cada cámara tiene varios destinos. Se toca SOLO el que alimenta a
            // OmniAccess (puerto 10000 y ruta del webhook). Los demás —una copia a
            // otro puerto, y una entrada vacía en 0.0.0.0— se dejan como están.
            const bloques = [...xml.matchAll(/<HttpHostNotification\b[\s\S]*?<\/HttpHostNotification>/g)].map((m) => m[0]);
            const leer = (b, t) => (b.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1] || "";
            const objetivo = bloques.find((b) => leer(b, "portNo") === String(PUERTO) && /webhook/i.test(leer(b, "url")));

            if (!objetivo) {
                console.log(`  ? ${c.name.padEnd(22)} ${c.ip}  no tiene destino al puerto ${PUERTO}; entradas: ` +
                    bloques.map((b) => `${leer(b, "ipAddress")}:${leer(b, "portNo")}`).join(" · "));
                error++; continue;
            }
            const actual = leer(objetivo, "ipAddress");
            const otros = bloques.filter((b) => b !== objetivo)
                .map((b) => `${leer(b, "ipAddress")}:${leer(b, "portNo")}${leer(b, "url")}`)
                .filter((s) => !s.startsWith("0.0.0.0"));

            if (actual === nuevaIp) {
                console.log(`  = ${c.name.padEnd(22)} ${c.ip}  ya apunta a ${nuevaIp}:${PUERTO}`);
                sinCambio++; continue;
            }

            console.log(`  → ${c.name.padEnd(22)} ${c.ip}  ${actual} → ${nuevaIp}  (puerto ${PUERTO})` +
                (otros.length ? `   [sin tocar: ${otros.join(", ")}]` : ""));
            if (!aplicar) { ok++; continue; }

            const nuevo = xml.replace(objetivo, objetivo.replace(/<ipAddress>[^<]*<\/ipAddress>/, `<ipAddress>${nuevaIp}</ipAddress>`));
            const w = await pedir(url, { ...cred, method: "PUT", body: nuevo });
            const txt = await w.text();
            if (!w.ok || /<statusCode>[^1]/.test(txt)) {
                console.log(`      ✗ no aceptó el cambio: HTTP ${w.status} ${txt.slice(0, 120).replace(/\s+/g, " ")}`);
                error++; continue;
            }
            // releer para confirmar que quedó en el destino correcto
            const v = await pedir(url, cred);
            const vx = await v.text();
            const quedo = [...vx.matchAll(/<HttpHostNotification\b[\s\S]*?<\/HttpHostNotification>/g)]
                .some((m) => leer(m[0], "portNo") === String(PUERTO) && leer(m[0], "ipAddress") === nuevaIp);
            console.log(quedo ? "      ✓ confirmado" : "      ! escribió pero al releer no figura; revisar a mano");
            quedo ? ok++ : error++;
        } catch (e) {
            console.log(`  ✗ ${c.name.padEnd(22)} ${c.ip}  ${String(e.message).slice(0, 60)}`);
            error++;
        }
    }

    console.log("─".repeat(72));
    console.log(`${ok} ${aplicar ? "cambiada(s)" : "a cambiar"} · ${sinCambio} ya estaban · ${error} con problema`);
    if (!aplicar && ok) console.log("\nSi la lista se ve bien, repetí con --aplicar.");
    if (aplicar && ok) console.log("\nAhora esperá a que pase un auto y mirá Configuración → Monitor de webhooks.");
}

main().catch((e) => { console.error(e); process.exit(1); });
