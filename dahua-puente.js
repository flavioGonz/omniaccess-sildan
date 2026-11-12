/**
 * Puente RTSP ↔ WebSocket para grabadores Dahua (change nvr-dahua-wizsense, 2.2).
 *
 * Hay instalaciones donde el NVR sólo tiene abierto el puerto 80 (sin 554). El web V5 de Dahua
 * mira el vivo por `ws://<nvr>/rtspoverwebsocket`: es RTSP común (DESCRIBE/SETUP/PLAY con Digest)
 * dentro de un WebSocket, y el video vuelve intercalado (`$` + canal + largo) en mensajes binarios.
 *
 * Este proceso le ofrece a go2rtc un RTSP local normal y lo traslada a ese WebSocket, así go2rtc
 * recibe el H.265/H.264 original y lo pasa al navegador SIN convertir (sin ffmpeg, sin CPU).
 *
 *   rtsp://127.0.0.1:8556/<idDelNvr>/cam/realmonitor?channel=N&subtype=S
 *
 * Las credenciales no viajan en la URL: las escribe lib/go2rtc-sync en data/dahua-puente.json
 * (permiso 600) y acá se leen en cada conexión nueva. La autenticación Digest la hace el puente.
 */
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WS = require("ws");

const PUERTO = Number(process.env.DAHUA_PUENTE_PUERTO || 8556);
const ARCHIVO = path.join(__dirname, "data", "dahua-puente.json");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

function leerEquipos() {
    try { return JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch { return {}; }
}

/*
 * La firma Digest de cada NVR, recordada entre conexiones: el primer pedido de un canal nuevo ya
 * va firmado y se ahorra la ida y vuelta del 401. Con 16 canales abriéndose a la vez por internet
 * esa vuelta de más alargaba el primer cuadro. Si el NVR cambió el nonce, contesta 401 y se firma
 * de nuevo como siempre.
 */
const firmas = new Map();

function atender(sock) {
    sock.setNoDelay(true);
    let buf = Buffer.alloc(0);
    const t0 = Date.now(); let tAbre = 0, tDato = 0, bytes = 0, canalLog = '';
    let ws = null, abierto = false, cerrado = false;
    let equipo = null, base = "", prefijoLocal = "";
    let auth = null;                 // { realm, nonce } (arranca con la recordada del NVR)
    const pendientes = [];           // pedidos hechos antes de que abra el WebSocket
    const enVuelo = new Map();       // CSeq → pedido original (para reintentar con Digest)
    const pedidoDe = new Map();

    const cerrar = (quien = '?') => {
        if (cerrado) return; cerrado = true;
        if (process.env.DAHUA_PUENTE_DEBUG) console.log(`[dahua-puente] cierre[${quien}] ${canalLog} ws=${tAbre}ms dato=${tDato}ms vida=${Date.now() - t0}ms ${Math.round(bytes / 1024)}KB`);
        try { sock.destroy(); } catch { }
        try { ws && ws.terminate(); } catch { }
    };

    const firmar = (metodo, uri) => {
        if (!auth) return "";
        const ha1 = md5(`${equipo.user}:${auth.realm}:${equipo.pass}`), ha2 = md5(`${metodo}:${uri}`);
        return `Authorization: Digest username="${equipo.user}", realm="${auth.realm}", nonce="${auth.nonce}", uri="${uri}", response="${md5(`${ha1}:${auth.nonce}:${ha2}`)}"\r\n`;
    };

    // Un pedido del cliente (go2rtc) → al NVR, con la URL del NVR y la firma del puente.
    const enviar = (p) => {
        if (!abierto) { pendientes.push(p); return; }
        const cab = p.cabeceras.filter((l) => !/^authorization:/i.test(l)).map((l) => l.split(prefijoLocal).join(base));
        const texto = `${p.metodo} ${p.uri} RTSP/1.0\r\n${cab.join("\r\n")}\r\n${firmar(p.metodo, p.uri)}\r\n`;
        ws.send(Buffer.concat([Buffer.from(texto, "latin1"), p.cuerpo]));
    };

    const pedido = (texto, cuerpo) => {
        const lineas = texto.split("\r\n");
        const [metodo, uriLocal] = lineas[0].split(" ");
        if (!equipo) {
            const m = /^rtsp:\/\/[^/]+\/([^/]+)\//.exec(uriLocal || "");
            const eq = m && leerEquipos()[m[1]];
            if (!eq) { sock.end("RTSP/1.0 404 Not Found\r\nCSeq: 0\r\n\r\n"); return; }
            equipo = eq;
            auth = firmas.get(eq.host) || null;
            prefijoLocal = uriLocal.slice(0, uriLocal.indexOf("/", 7) + 1) + m[1] + "/";
            const hp = `${eq.host}${eq.port && eq.port !== 80 ? `:${eq.port}` : ""}`;
            base = `rtsp://${eq.host}:${eq.port || 80}/`;
            ws = new WS(`ws://${hp}/rtspoverwebsocket`, { perMessageDeflate: false, handshakeTimeout: 8000 });
            ws.on("open", () => { tAbre = Date.now() - t0; abierto = true; pendientes.splice(0).forEach(enviar); });
            ws.on("message", (d) => recibir(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            ws.on("close", (c, r) => cerrar(`nvr ${c} ${r || ""}`));
            ws.on("error", (e) => { console.error(`[dahua-puente] ${eq.host}: ${e.message}`); cerrar(); });
        }
        const cseq = (lineas.find((l) => /^cseq:/i.test(l)) || "").split(":")[1]?.trim();
        if (!canalLog) canalLog = ((/channel=(\d+)&subtype=(\d)/.exec(uriLocal) || []).slice(1).join('/'));
        const p = { metodo, uri: uriLocal.split(prefijoLocal).join(base), cabeceras: lineas.slice(1).filter(Boolean), cuerpo, intentos: 0 };
        if (cseq) { enVuelo.set(cseq, p); pedidoDe.set(cseq, p); }
        enviar(p);
    };

    // Lo que manda el NVR: respuestas RTSP (texto) y video intercalado ($).
    let resto = Buffer.alloc(0);
    const recibir = (d) => {
        let b = resto.length ? Buffer.concat([resto, d]) : d; resto = Buffer.alloc(0);
        while (b.length) {
            if (b[0] === 0x24) { if (!tDato) tDato = Date.now() - t0; bytes += b.length; sock.write(b); return; }          // video/RTCP: va derecho
            const fin = b.indexOf("\r\n\r\n");
            if (fin < 0) { resto = b; return; }
            const cab = b.slice(0, fin).toString("latin1");
            const largo = Number((/content-length:\s*(\d+)/i.exec(cab) || [])[1] || 0);
            if (b.length < fin + 4 + largo) { resto = b; return; }
            let cuerpo = b.slice(fin + 4, fin + 4 + largo).toString("latin1");
            b = b.slice(fin + 4 + largo);
            const estado = cab.split("\r\n")[0];
            const cseq = ((/cseq:\s*(\S+)/i.exec(cab) || [])[1]) || "";
            if (/ 401 /.test(estado)) {
                const m = /realm="([^"]+)",\s*nonce="([^"]+)"/i.exec(cab);
                const p = enVuelo.get(cseq);
                if (m && p && p.intentos++ < 3) { auth = { realm: m[1], nonce: m[2] }; firmas.set(equipo.host, auth); enviar(p); continue; }
            }
            enVuelo.delete(cseq);
            if (process.env.DAHUA_PUENTE_DEBUG && !/ 200 /.test(estado)) console.log(`[dahua-puente] ${estado} cseq ${cseq} ${(p0 => p0 ? p0.metodo + ' ' + p0.uri : '')(pedidoDe.get(cseq))}`);
            // La URL del NVR vuelve a ser la local (Content-Base, controles del SDP).
            let cabLocal = cab.split(base).join(prefijoLocal);
            cuerpo = cuerpo.split(base).join(prefijoLocal);
            const cuerpoBuf = Buffer.from(cuerpo, "latin1");
            cabLocal = cabLocal.replace(/content-length:\s*\d+/i, `Content-Length: ${cuerpoBuf.length}`);
            sock.write(Buffer.concat([Buffer.from(cabLocal + "\r\n\r\n", "latin1"), cuerpoBuf]));
        }
    };

    sock.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length) {
            if (buf[0] === 0x24) {                                   // RTCP del cliente
                if (buf.length < 4) return;
                const n = buf.readUInt16BE(2);
                if (buf.length < 4 + n) return;
                if (abierto) ws.send(buf.slice(0, 4 + n));
                buf = buf.slice(4 + n); continue;
            }
            const fin = buf.indexOf("\r\n\r\n");
            if (fin < 0) return;
            const texto = buf.slice(0, fin).toString("latin1");
            const largo = Number((/content-length:\s*(\d+)/i.exec(texto) || [])[1] || 0);
            if (buf.length < fin + 4 + largo) return;
            const cuerpo = buf.slice(fin + 4, fin + 4 + largo);
            buf = buf.slice(fin + 4 + largo);
            try { pedido(texto, cuerpo); } catch (e) { console.error("[dahua-puente]", e.message); cerrar(); return; }
        }
    });
    sock.on("close", () => cerrar("go2rtc"));
    sock.on("error", cerrar);
}

net.createServer(atender).listen(PUERTO, "127.0.0.1", () => console.log(`[dahua-puente] escuchando en 127.0.0.1:${PUERTO}`));
