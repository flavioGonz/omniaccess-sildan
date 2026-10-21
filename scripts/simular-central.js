#!/usr/bin/env node
/**
 * Simulador de una central de alarma SIA DC-09, para probar el receptor (alarm-receiver.js) sin
 * equipo. Usa el mismo lib-dc09 que el receptor.
 *
 *   node scripts/simular-central.js --cuenta 1234 --clave <clave> [--udp] [--host 127.0.0.1] [--puerto 10010]
 *        [--sia "Nri1/BA003"] | [--cid "1130 01 003"] | [--null]   [--seq 5] [--sin-cifrar] [--repetir 2] [--hora-vieja]
 *
 * La clave también puede ir en la variable SIM_CLAVE (así no queda en el historial del shell).
 * Muestra la trama que manda y lo que contestó el receptor (ACK/NAK/DUH), descifrado si hace falta.
 */
"use strict";
const net = require("net");
const dgram = require("dgram");
const path = require("path");
const dc = require(path.join(__dirname, "..", "lib-dc09.js"));

const a = process.argv.slice(2);
const arg = (n, d = null) => { const i = a.indexOf(`--${n}`); return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : d; };
const flag = (n) => a.includes(`--${n}`);

const host = arg("host", "127.0.0.1"), puerto = Number(arg("puerto", 10010));
const cuenta = arg("cuenta", "1234");
const clave = flag("sin-cifrar") ? null : (arg("clave") || process.env.SIM_CLAVE || null);
const seq = Number(arg("seq", String(1 + Math.floor(Math.random() * 9000))));
const veces = Number(arg("repetir", "1"));
const hora = flag("hora-vieja") ? new Date(Date.now() - 5 * 60_000) : new Date();
let id = "SIA-DCS", datos = arg("sia", "Nri1/BA003");
if (arg("cid")) { id = "ADM-CID"; datos = arg("cid"); }
if (flag("null")) { id = "NULL"; datos = ""; }

const trama = dc.armar({ id, seq, receptor: "1", linea: "1", cuenta, datos, clave, hora });
const mostrar = (t) => JSON.stringify(t).slice(1, -1);
console.log(`→ ${flag("udp") ? "UDP" : "TCP"} ${host}:${puerto} · ${id}${clave ? " cifrado" : ""} · cuenta ${cuenta} · seq ${seq}${datos ? ` · ${datos}` : ""}`);
console.log(`  ${mostrar(trama)}`);

function leerRespuesta(t) {
    const r = dc.leer(t, () => clave);
    if (/"NAK"/.test(t)) return console.log(`← NAK  ${mostrar(t)}`);
    if (!r.ok) return console.log(`← ? (${r.error})  ${mostrar(t)}`);
    console.log(`← ${r.id}${r.cifrado ? " cifrado" : ""} seq ${r.seq}${r.seq === seq ? " (coincide)" : " (NO coincide)"}  ${mostrar(t)}`);
}

async function unaVez() {
    return new Promise((resolve) => {
        const fin = setTimeout(() => { console.log("← (sin respuesta en 5 s)"); resolve(); }, 5000);
        if (flag("udp")) {
            const s = dgram.createSocket("udp4");
            s.on("message", (b) => { clearTimeout(fin); leerRespuesta(b.toString("latin1")); s.close(); resolve(); });
            s.send(Buffer.from(trama, "latin1"), puerto, host);
        } else {
            const s = net.connect(puerto, host, () => s.write(trama, "latin1"));
            let buf = "";
            s.on("data", (b) => { buf += b.toString("latin1"); const { tramas } = dc.separar(buf); if (tramas.length) { clearTimeout(fin); leerRespuesta(tramas[0]); s.end(); resolve(); } });
            s.on("error", (e) => { clearTimeout(fin); console.log("← error:", e.message); resolve(); });
        }
    });
}
(async () => { for (let i = 0; i < veces; i++) await unaVez(); })();
