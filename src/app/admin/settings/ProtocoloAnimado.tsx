"use client";

// Diagrama de secuencia ANIMADO del protocolo de cada driver, para la cabecera del cajón.
// Muestra el diálogo real entre OmniAccess y el equipo según su protocolo, con COLOR E
// ICONO POR INTERLOCUTOR: lo que manda OmniAccess va en azul (acción); lo que manda el
// equipo, en violeta. Cada carril lleva su ícono (OmniAccess = lente/cerebro; el equipo =
// portero o cámara según el protocolo). Los mensajes disparan en secuencia y el ciclo se
// repite. Respeta prefers-reduced-motion.

import type { Soporte } from "@/lib/drivers/catalogo";

type Lado = "oa" | "eq";
type Msg = { de: Lado; txt: string };
type Dialogo = { protocolo: string; pasos: Msg[] };

const FAMILIA: Record<string, string> = {
    HIKVISION: "isapi", GRANDSTREAM: "gds", BOSCH: "onvif", GENERICA: "rtsp",
    DAHUA: "cgi", INTELBRAS: "cgi", UNIFI: "protect", AXIS: "vapix", UNIVIEW: "sdk",
    MILESIGHT: "http", AVICAM: "push", AKUVOX: "push", ZKTECO: "push",
};
// El equipo es un portero (door) en estos protocolos; cámara en el resto.
const PORTERO = new Set(["gds", "push"]);

const DIALOGOS: Record<string, Dialogo> = {
    isapi: { protocolo: "ISAPI · alertStream (conexión persistente)", pasos: [
        { de: "oa", txt: "GET /ISAPI/…/alertStream" }, { de: "eq", txt: "401 · nonce digest" },
        { de: "oa", txt: "GET + Authorization" }, { de: "eq", txt: "stream abierto ↔ (queda vivo)" },
        { de: "eq", txt: "⚡ evento (matrícula / rostro)" }, { de: "eq", txt: "⚡ evento… (en vivo)" }] },
    gds: { protocolo: "GDS HTTP API · challenge/response", pasos: [
        { de: "oa", txt: "login (cmd=login)" }, { de: "eq", txt: "ChallengeCode" },
        { de: "oa", txt: "md5(challenge·sal·clave)" }, { de: "eq", txt: "ResCode 0 · cookie" },
        { de: "oa", txt: "config / abrir puerta" }, { de: "eq", txt: "datos · OK" }] },
    onvif: { protocolo: "ONVIF · SOAP/WS", pasos: [
        { de: "oa", txt: "GetProfiles (SOAP)" }, { de: "eq", txt: "perfiles de media" },
        { de: "oa", txt: "Subscribe (PullPoint)" }, { de: "eq", txt: "PullMessages · eventos" }] },
    rtsp: { protocolo: "RTSP · streaming", pasos: [
        { de: "oa", txt: "DESCRIBE" }, { de: "eq", txt: "SDP (códec, pistas)" },
        { de: "oa", txt: "SETUP · PLAY" }, { de: "eq", txt: "RTP · video →→→" }] },
    push: { protocolo: "HTTP push · el equipo avisa", pasos: [
        { de: "eq", txt: "POST /webhook · evento" }, { de: "oa", txt: "200 OK" },
        { de: "oa", txt: "pide la foto" }, { de: "eq", txt: "JPEG · snapshot" }] },
    cgi: { protocolo: "CGI · HTTP", pasos: [{ de: "oa", txt: "GET /cgi-bin/…" }, { de: "eq", txt: "200 · texto" }] },
    protect: { protocolo: "UniFi Protect API", pasos: [{ de: "oa", txt: "GET /proxy/protect" }, { de: "eq", txt: "JSON · eventos" }] },
    vapix: { protocolo: "VAPIX · HTTP", pasos: [{ de: "oa", txt: "GET /axis-cgi/…" }, { de: "eq", txt: "200 · datos" }] },
    sdk: { protocolo: "SDK (proxy)", pasos: [{ de: "oa", txt: "consulta SDK" }, { de: "eq", txt: "respuesta" }] },
    http: { protocolo: "HTTP", pasos: [{ de: "oa", txt: "GET /api" }, { de: "eq", txt: "200 · JSON" }] },
};

const OA_X = 72, EQ_X = 300, TOP = 64, ROW = 30;
const HEAD_Y = 28, LIFE_TOP = 52;
const COLOR_OA = "var(--accion)";
const COLOR_EQ = "var(--quieto,#7c3aed)";

export function ProtocoloAnimado({ soporte }: { soporte: Soporte }) {
    const fam = FAMILIA[soporte.marca] || "http";
    const d = DIALOGOS[fam];
    const esPortero = PORTERO.has(fam);
    const N = d.pasos.length;
    const H = TOP + N * ROW + 14;
    const slotPct = 100 / N;

    const DUR = (N * 0.95).toFixed(2);
    const css = `
.seq { --dur: ${DUR}s; }
.seq .msg { opacity: .22; animation: seqMsg var(--dur) linear infinite; }
.seq .pkt { opacity: 0; animation: seqPkt var(--dur) cubic-bezier(.4,0,.6,1) infinite; }
.seq .vida { stroke-dasharray: 3 5; animation: seqVida 1s linear infinite; }
@keyframes seqVida { to { stroke-dashoffset: -8; } }
@keyframes seqMsg { 0%{opacity:.22} 2%{opacity:1} ${slotPct.toFixed(2)}%{opacity:1} ${(slotPct + 6).toFixed(2)}%{opacity:.22} 100%{opacity:.22} }
@keyframes seqPkt { 0%{transform:translateX(0);opacity:0} 1%{opacity:1} ${slotPct.toFixed(2)}%{transform:translateX(var(--dx));opacity:1} ${(slotPct + 0.5).toFixed(2)}%{opacity:0} 100%{transform:translateX(var(--dx));opacity:0} }
@media (prefers-reduced-motion: reduce){ .seq .msg{opacity:1;animation:none} .seq .pkt{display:none} .seq .vida{animation:none} }`;

    return (
        <div className="-mt-1">
            <style dangerouslySetInnerHTML={{ __html: css }} />
            <svg viewBox={`0 0 366 ${H}`} className="w-full h-auto block seq" role="img"
                aria-label={`Protocolo ${d.protocolo}. Diálogo entre OmniAccess (azul) y el equipo (violeta): ${d.pasos.map(p => p.txt).join("; ")}.`}>
                {/* protocolo */}
                <text x={183} y={15} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--foreground,#111)" letterSpacing="0.02em">{d.protocolo}</text>

                {/* carriles con ícono y color por interlocutor */}
                <LaneHead x={OA_X} label="OmniAccess" color={COLOR_OA} glifo="oa" />
                <LaneHead x={EQ_X} label="Equipo" color={COLOR_EQ} glifo={esPortero ? "portero" : "camara"} />
                <line x1={OA_X} y1={LIFE_TOP} x2={OA_X} y2={H - 6} stroke={COLOR_OA} strokeWidth="1.5" opacity="0.35" className="vida" />
                <line x1={EQ_X} y1={LIFE_TOP} x2={EQ_X} y2={H - 6} stroke={COLOR_EQ} strokeWidth="1.5" opacity="0.35" className="vida" />

                {/* mensajes, coloreados por quién los manda */}
                {d.pasos.map((p, i) => {
                    const y = TOP + i * ROW + 14;
                    const sx = p.de === "oa" ? OA_X : EQ_X;
                    const rx = p.de === "oa" ? EQ_X : OA_X;
                    const dir = p.de === "oa" ? 1 : -1;
                    const col = p.de === "oa" ? COLOR_OA : COLOR_EQ;
                    const delay = `calc(var(--dur) / ${N} * ${i})`;
                    return (
                        <g key={i} className="msg" style={{ animationDelay: delay }}>
                            <text x={183} y={y - 5} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--foreground,#111)">{p.txt}</text>
                            <line x1={sx + 6 * dir} y1={y} x2={rx - 7 * dir} y2={y} stroke={col} strokeWidth="1.6" />
                            <path d={`M ${rx - 7 * dir} ${y} l ${-7 * dir} -3.5 l 0 7 z`} fill={col} />
                            <circle cx={sx + 6 * dir} cy={y} r="3" fill={col} className="pkt"
                                style={{ animationDelay: delay, ["--dx" as any]: `${(rx - sx) - 13 * dir}px` }} />
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

function LaneHead({ x, label, color, glifo }: { x: number; label: string; color: string; glifo: "oa" | "portero" | "camara" }) {
    const bw = 112;
    return (
        <g>
            <rect x={x - bw / 2} y={HEAD_Y} width={bw} height="22" rx="7" fill="var(--card,#fff)" stroke={color} strokeOpacity="0.4" />
            <g transform={`translate(${x - bw / 2 + 10}, ${HEAD_Y + 4})`} style={{ color }}><Glifo tipo={glifo} /></g>
            <text x={x + 8} y={HEAD_Y + 15} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={color}>{label}</text>
        </g>
    );
}

// Glifos 14×14, color por currentColor.
function Glifo({ tipo }: { tipo: "oa" | "portero" | "camara" }) {
    if (tipo === "oa") // OmniVision: lente que ve
        return (<g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7" cy="7" r="6" /><circle cx="7" cy="7" r="2.3" fill="currentColor" stroke="none" /></g>);
    if (tipo === "portero") // portero: panel con timbre
        return (<g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2.5" y="1.5" width="9" height="11" rx="1.5" /><circle cx="7" cy="5.5" r="1.4" /><line x1="5" y1="9.5" x2="9" y2="9.5" /></g>);
    return (<g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"> {/* cámara */}
        <rect x="1.5" y="4" width="11" height="7.5" rx="1.5" /><circle cx="7" cy="7.75" r="2" /><path d="M4 4 l1.2 -2 h3.6 L10 4" /></g>);
}
