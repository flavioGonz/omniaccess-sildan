"use client";

// Diagrama de secuencia ANIMADO del protocolo de cada driver, para la cabecera del cajón.
// Muestra el diálogo real entre OmniAccess y el equipo según su protocolo:
//   ISAPI (digest), GDS HTTP API (challenge/response), ONVIF (SOAP), RTSP (DESCRIBE/PLAY),
//   webhook/push (el equipo avisa), CGI, etc. Los mensajes "disparan" en secuencia y el
//   ciclo se repite. Respeta prefers-reduced-motion.
// Diseño (claude/DESIGN.md): un solo azul de acción, superficie + línea, sin sombras.

import type { Soporte } from "@/lib/drivers/catalogo";

type Lado = "oa" | "eq";
type Msg = { de: Lado; txt: string };
type Dialogo = { protocolo: string; pasos: Msg[] };

// Familia de protocolo por marca.
const FAMILIA: Record<string, string> = {
    HIKVISION: "isapi", GRANDSTREAM: "gds", BOSCH: "onvif", GENERICA: "rtsp",
    DAHUA: "cgi", INTELBRAS: "cgi", UNIFI: "protect", AXIS: "vapix", UNIVIEW: "sdk",
    MILESIGHT: "http", AVICAM: "push", AKUVOX: "push", ZKTECO: "push",
};

// El diálogo real de cada protocolo (de = quién manda el mensaje).
const DIALOGOS: Record<string, Dialogo> = {
    isapi: {
        protocolo: "ISAPI · HTTP digest",
        pasos: [
            { de: "oa", txt: "GET /ISAPI/Event…" },
            { de: "eq", txt: "401 · nonce digest" },
            { de: "oa", txt: "GET + Authorization" },
            { de: "eq", txt: "200 · XML (evento)" },
        ],
    },
    gds: {
        protocolo: "GDS HTTP API · challenge/response",
        pasos: [
            { de: "oa", txt: "login (cmd=login)" },
            { de: "eq", txt: "ChallengeCode" },
            { de: "oa", txt: "md5(challenge·sal·clave)" },
            { de: "eq", txt: "ResCode 0 · cookie" },
            { de: "oa", txt: "config / abrir puerta" },
            { de: "eq", txt: "datos · OK" },
        ],
    },
    onvif: {
        protocolo: "ONVIF · SOAP/WS",
        pasos: [
            { de: "oa", txt: "GetProfiles (SOAP)" },
            { de: "eq", txt: "perfiles de media" },
            { de: "oa", txt: "Subscribe (PullPoint)" },
            { de: "eq", txt: "PullMessages · eventos" },
        ],
    },
    rtsp: {
        protocolo: "RTSP · streaming",
        pasos: [
            { de: "oa", txt: "DESCRIBE" },
            { de: "eq", txt: "SDP (códec, pistas)" },
            { de: "oa", txt: "SETUP · PLAY" },
            { de: "eq", txt: "RTP · video →→→" },
        ],
    },
    push: {
        protocolo: "HTTP push · el equipo avisa",
        pasos: [
            { de: "eq", txt: "POST /webhook · evento" },
            { de: "oa", txt: "200 OK" },
            { de: "oa", txt: "pide la foto" },
            { de: "eq", txt: "JPEG · snapshot" },
        ],
    },
    cgi: {
        protocolo: "CGI · HTTP",
        pasos: [
            { de: "oa", txt: "GET /cgi-bin/…" },
            { de: "eq", txt: "200 · texto" },
        ],
    },
    protect: {
        protocolo: "UniFi Protect API",
        pasos: [
            { de: "oa", txt: "GET /proxy/protect" },
            { de: "eq", txt: "JSON · eventos" },
        ],
    },
    vapix: {
        protocolo: "VAPIX · HTTP",
        pasos: [
            { de: "oa", txt: "GET /axis-cgi/…" },
            { de: "eq", txt: "200 · datos" },
        ],
    },
    sdk: {
        protocolo: "SDK (proxy)",
        pasos: [
            { de: "oa", txt: "consulta SDK" },
            { de: "eq", txt: "respuesta" },
        ],
    },
    http: {
        protocolo: "HTTP",
        pasos: [
            { de: "oa", txt: "GET /api" },
            { de: "eq", txt: "200 · JSON" },
        ],
    },
};

const OA_X = 66, EQ_X = 300, TOP = 62, ROW = 30;
const HEAD_Y = 26, LIFE_TOP = 50;

export function ProtocoloAnimado({ soporte }: { soporte: Soporte }) {
    const fam = FAMILIA[soporte.marca] || "http";
    const d = DIALOGOS[fam];
    const N = d.pasos.length;
    const H = TOP + N * ROW + 14;
    const slotPct = 100 / N; // fracción del ciclo por mensaje
    const DUR = (N * 0.95).toFixed(2); // ~0.95s por mensaje

    const css = `
.seq { --dur: ${DUR}s; }
.seq .msg { opacity: .22; animation: seqMsg var(--dur) linear infinite; }
.seq .pkt { opacity: 0; animation: seqPkt var(--dur) cubic-bezier(.4,0,.6,1) infinite; }
.seq .vida { stroke-dasharray: 3 5; animation: seqVida 1s linear infinite; }
@keyframes seqVida { to { stroke-dashoffset: -8; } }
@keyframes seqMsg {
  0% { opacity: .22; } 2% { opacity: 1; }
  ${slotPct.toFixed(2)}% { opacity: 1; }
  ${(slotPct + 6).toFixed(2)}% { opacity: .22; } 100% { opacity: .22; }
}
@keyframes seqPkt {
  0% { transform: translateX(0); opacity: 0; }
  1% { opacity: 1; }
  ${slotPct.toFixed(2)}% { transform: translateX(var(--dx)); opacity: 1; }
  ${(slotPct + 0.5).toFixed(2)}% { opacity: 0; }
  100% { transform: translateX(var(--dx)); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .seq .msg { opacity: 1; animation: none; }
  .seq .pkt { display: none; }
  .seq .vida { animation: none; }
}`;

    return (
        <div className="rounded-[10px] border border-border bg-[color:var(--muted,#f5f5f5)]/50 overflow-hidden">
            <style dangerouslySetInnerHTML={{ __html: css }} />
            <svg viewBox={`0 0 366 ${H}`} className="w-full h-auto block seq" role="img"
                aria-label={`Protocolo ${d.protocolo}. Diálogo entre OmniAccess y el equipo: ${d.pasos.map(p => p.txt).join("; ")}.`}>
                {/* protocolo (arriba de todo) */}
                <text x={183} y={15} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--accion)" letterSpacing="0.02em">{d.protocolo}</text>

                {/* cabeceras de carril */}
                <LaneHead x={OA_X} label="OmniAccess" />
                <LaneHead x={EQ_X} label="Equipo" />
                {/* líneas de vida */}
                <line x1={OA_X} y1={LIFE_TOP} x2={OA_X} y2={H - 6} stroke="var(--border,#e5e5e5)" strokeWidth="1.5" className="vida" />
                <line x1={EQ_X} y1={LIFE_TOP} x2={EQ_X} y2={H - 6} stroke="var(--border,#e5e5e5)" strokeWidth="1.5" className="vida" />

                {/* mensajes */}
                {d.pasos.map((p, i) => {
                    const y = TOP + i * ROW + 14;
                    const sx = p.de === "oa" ? OA_X : EQ_X;
                    const rx = p.de === "oa" ? EQ_X : OA_X;
                    const dir = p.de === "oa" ? 1 : -1;
                    const delay = `calc(var(--dur) / ${N} * ${i})`;
                    return (
                        <g key={i} className="msg" style={{ animationDelay: delay }}>
                            <text x={183} y={y - 5} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--foreground,#111)">{p.txt}</text>
                            <line x1={sx + 6 * dir} y1={y} x2={rx - 7 * dir} y2={y} stroke="var(--accion)" strokeWidth="1.6" />
                            {/* punta de flecha */}
                            <path d={`M ${rx - 7 * dir} ${y} l ${-7 * dir} -3.5 l 0 7 z`} fill="var(--accion)" />
                            {/* paquete que viaja */}
                            <circle cx={sx + 6 * dir} cy={y} r="3" fill="var(--accion)" className="pkt"
                                style={{ animationDelay: delay, ["--dx" as any]: `${(rx - sx) - 13 * dir}px` }} />
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

function LaneHead({ x, label }: { x: number; label: string }) {
    return (
        <g>
            <rect x={x - 46} y={HEAD_Y} width="92" height="22" rx="7" fill="var(--card,#fff)" stroke="var(--border,#e5e5e5)" />
            <text x={x} y={HEAD_Y + 15} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--foreground,#111)">{label}</text>
        </g>
    );
}
