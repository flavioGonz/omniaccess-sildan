import net from "net";

/**
 * El NVR que anuncia un códec y manda otro.
 *
 * Medido el 18/10 en el lab sobre NVR 6, canal 7 (MATRICULA SALIDA): la cámara graba H.264
 * (su ISAPI lo dice, y la descarga del archivo es H.264 2560×1440), pero el canal del NVR
 * quedó configurado como H.265 y el playback RTSP lo anuncia así en el SDP
 * (`a=rtpmap:96 H265/90000`). ffmpeg arma entonces el despaquetizador de HEVC, y los paquetes
 * FU-A de H.264 (primer byte 0x7C) le llegan como «NAL type 62» de HEVC: los descarta, nunca ve
 * un SPS, no sabe las dimensiones y se queda esperando. El visor mostraba «Buscando la grabación
 * en el NVR…» y después «Sin grabación en este horario», cuando la grabación estaba.
 *
 * Arreglarlo en el NVR (que el canal diga H.264, o la cámara pase a H.265) es lo correcto, y es
 * equipo de San Nicolás: desde acá no se toca. Lo que sí se puede es no creerle al SDP. Esto es
 * un pasamanos TCP de un solo uso entre ffmpeg y el NVR que, mientras dura la charla RTSP,
 * cambia `H265/90000` por `H264/90000` (mismo largo: el Content-Length no cambia). Después del
 * primer paquete RTP intercalado deja de mirar y sólo pasa bytes. El video sale H.264 tal cual
 * vino de la cámara, así que encima se copia en vez de transcodificar.
 *
 * Se usa sólo en los canales donde se APRENDIÓ que el SDP miente (ver `esSdpCambiado`): en uno
 * que de verdad graba H.265, reescribir rompería lo que hoy anda.
 */

/** Cuánto vive el pasamanos si ffmpeg nunca se conecta (falló antes de abrir el RTSP). */
const SIN_CONEXION_MS = 20_000;
/** Tope de una charla: el tramo más largo que se pide es de minutos, no de horas. */
const TOPE_CONEXION_MS = 15 * 60_000;

export function pasamanosSdpH264(ip: string, puerto: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer((cliente) => {
            clearTimeout(sinConexion);
            srv.close(); // de un solo uso: no acepta una segunda conexión
            const nvr = net.connect(puerto, ip);
            const tope = setTimeout(() => { cliente.destroy(); nvr.destroy(); }, TOPE_CONEXION_MS);
            cliente.pipe(nvr);
            let mirando = true;
            nvr.on("data", (b: Buffer) => {
                if (mirando) {
                    if (b[0] === 0x24) mirando = false; // '$': ya es RTP intercalado
                    else {
                        const t = b.toString("latin1");
                        if (t.includes("H265/90000")) { b = Buffer.from(t.replace(/H265\/90000/g, "H264/90000"), "latin1"); mirando = false; }
                    }
                }
                cliente.write(b);
            });
            const fin = () => { clearTimeout(tope); cliente.destroy(); nvr.destroy(); };
            nvr.on("error", fin); cliente.on("error", fin);
            nvr.on("close", fin); cliente.on("close", fin);
        });
        const sinConexion = setTimeout(() => { try { srv.close(); } catch { } }, SIN_CONEXION_MS);
        srv.on("error", (e) => { clearTimeout(sinConexion); reject(e); });
        srv.listen(0, "127.0.0.1", () => {
            const a = srv.address();
            if (a && typeof a === "object") resolve(a.port); else reject(new Error("sin puerto"));
        });
    });
}

/**
 * Canales donde se vio que el SDP anuncia H.265 y llega H.264. Se aprende de la salida de
 * ffmpeg y dura medio día: si alguien arregla el NVR, a las 12 h se vuelve a creerle.
 */
const DURA_MS = 12 * 3600_000;
const aprendidos: Map<string, number> = (globalThis as any).__sdpCambiado ?? new Map<string, number>();
(globalThis as any).__sdpCambiado = aprendidos;

export function sdpCambiado(ip: string, ch: string): boolean {
    const t = aprendidos.get(`${ip}:${ch}`);
    if (t && Date.now() - t < DURA_MS) return true;
    if (t) aprendidos.delete(`${ip}:${ch}`);
    return false;
}
export function marcarSdpCambiado(ip: string, ch: string) { aprendidos.set(`${ip}:${ch}`, Date.now()); }

/**
 * La firma en la salida de ffmpeg: el despaquetizador de HEVC recibiendo NAL de H.264. Un
 * FU-A (0x7C) se lee como tipo 62; un SPS (0x67), 51; un PPS (0x68), 52. Un canal H.265 de
 * verdad no produce estos tipos.
 */
export function esSdpCambiado(salida: string): boolean {
    return /Unsupported \(HEVC\) NAL type \((?:5[1-9]|6[0-3])\)/i.test(salida);
}
