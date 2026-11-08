"use client";

// SVG animado premium para la cabecera del cajón de un driver. Explica en cuatro pasos,
// simple, cómo trabaja OmniAccess con ese equipo por su protocolo:
//   Recibe (el equipo manda datos por su protocolo) → Ve (lee el cuadro) →
//   Busca (compara contra el padrón) → Describe (devuelve el resultado).
// Los paquetes fluyen por la tubería; los nodos se encienden en secuencia. Adaptado por
// marca (protocolo) y por lo que el driver sabe hacer (qué describe). Respeta
// prefers-reduced-motion. Diseño: un solo azul de acción, superficie + línea, sin sombras.

import type { Soporte } from "@/lib/drivers/catalogo";

const PROTOCOLO: Record<string, string> = {
    HIKVISION: "ISAPI", AKUVOX: "HTTP API", GRANDSTREAM: "GDS HTTP API", BOSCH: "ONVIF",
    DAHUA: "CGI", UNIFI: "Protect API", UNIVIEW: "SDK", INTELBRAS: "CGI",
    MILESIGHT: "HTTP", AVICAM: "HTTP", ZKTECO: "Push HTTP", AXIS: "VAPIX", GENERICA: "RTSP",
};
function describeDe(s: Soporte): string {
    if (s.hace.includes("lpr")) return "Matrícula";
    if (s.hace.includes("rostro")) return "Rostro";
    if (s.hace.includes("conteo")) return "Aforo";
    if (s.hace.includes("rfid")) return "Tarjeta";
    return "Evento";
}

const CSS = `
.proto-svg .flujo { animation: proto-dash 1s linear infinite; }
.proto-svg .paquete { opacity: 0; animation: proto-viaje 3.3s cubic-bezier(.45,.05,.55,.95) infinite; }
.proto-svg .anillo { opacity: 0; transform-box: fill-box; transform-origin: center; animation: proto-latido 3.2s ease-in-out infinite; }
.proto-svg .glifo { animation: proto-vivo 3.2s ease-in-out infinite; }
@keyframes proto-dash { to { stroke-dashoffset: -14; } }
@keyframes proto-viaje {
  0% { transform: translateX(0); opacity: 0; }
  6% { opacity: 1; }
  94% { opacity: 1; }
  100% { transform: translateX(378px); opacity: 0; }
}
@keyframes proto-latido {
  0%, 100% { opacity: 0; transform: scale(1); }
  8% { opacity: .95; transform: scale(1); }
  24% { opacity: 0; transform: scale(1.3); }
}
@keyframes proto-vivo {
  0%, 100% { opacity: .55; }
  12%, 20% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .proto-svg .flujo, .proto-svg .paquete, .proto-svg .anillo, .proto-svg .glifo { animation: none; }
  .proto-svg .paquete { opacity: 0; }
  .proto-svg .glifo { opacity: 1; }
}
`;

export function ProtocoloAnimado({ soporte }: { soporte: Soporte }) {
    const proto = PROTOCOLO[soporte.marca] || "HTTP";
    const salida = describeDe(soporte);
    const xs = [70, 196, 322, 448];
    const yLine = 66;

    return (
        <div className="rounded-[10px] border border-border bg-[color:var(--muted,#f5f5f5)]/50 overflow-hidden">
            <style dangerouslySetInnerHTML={{ __html: CSS }} />
            <svg viewBox="0 0 518 132" className="w-full h-auto block proto-svg" role="img"
                aria-label={`El equipo manda datos por ${proto}; OmniAccess ve el cuadro, busca en el padrón y describe: ${salida}.`}>
                {/* tubería base + flujo punteado */}
                <line x1={xs[0]} y1={yLine} x2={xs[3]} y2={yLine} stroke="var(--border,#e5e5e5)" strokeWidth="2" />
                <line x1={xs[0]} y1={yLine} x2={xs[3]} y2={yLine} stroke="var(--accion)" strokeWidth="2"
                    strokeDasharray="4 10" opacity="0.5" className="flujo" />

                {/* paquetes que viajan (translateX desde el nodo 0) */}
                {[0, 1, 2].map((i) => (
                    <circle key={i} cx={xs[0]} cy={yLine} r="3.5" fill="var(--accion)" className="paquete"
                        style={{ animationDelay: `${i * 1.1}s` }} />
                ))}

                {/* etiqueta del protocolo sobre el primer tramo */}
                <rect x={(xs[0] + xs[1]) / 2 - 42} y={yLine - 30} width="84" height="19" rx="9.5"
                    fill="var(--card,#fff)" stroke="var(--border,#e5e5e5)" />
                <text x={(xs[0] + xs[1]) / 2} y={yLine - 17} textAnchor="middle"
                    fontSize="10" fontWeight="700" fill="var(--accion)" letterSpacing="0.03em">{proto}</text>

                {/* nodos */}
                <Nodo x={xs[0]} y={yLine} i={0} label="Recibe" sub={corto(soporte.rotulo)}><GlifoEquipo /></Nodo>
                <Nodo x={xs[1]} y={yLine} i={1} label="Ve" sub="el cuadro"><GlifoOjo /></Nodo>
                <Nodo x={xs[2]} y={yLine} i={2} label="Busca" sub="en el padrón"><GlifoLupa /></Nodo>
                <Nodo x={xs[3]} y={yLine} i={3} label="Describe" sub={salida}><GlifoLineas /></Nodo>
            </svg>
        </div>
    );
}

function corto(s: string): string { return s.length > 16 ? s.slice(0, 15) + "…" : s; }

function Nodo({ x, y, i, label, sub, children }: { x: number; y: number; i: number; label: string; sub: string; children: React.ReactNode }) {
    return (
        <g>
            <circle cx={x} cy={y} r="22" fill="var(--card,#fff)" stroke="var(--border,#e5e5e5)" strokeWidth="1.5" />
            <circle cx={x} cy={y} r="22" fill="none" stroke="var(--accion)" strokeWidth="2" className="anillo"
                style={{ animationDelay: `${i * 0.8}s` }} />
            <g transform={`translate(${x - 11}, ${y - 11})`} className="glifo" style={{ color: "var(--accion)", animationDelay: `${i * 0.8}s` }}>
                {children}
            </g>
            <text x={x} y={y + 40} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--foreground,#111)">{label}</text>
            <text x={x} y={y + 54} textAnchor="middle" fontSize="9.5" fill="var(--muted-foreground,#888)">{sub}</text>
        </g>
    );
}

/* Glifos 22×22, color por currentColor (via style color en el <g className="glifo">). */
function GlifoEquipo() {
    return (<g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="5" width="17" height="12" rx="2" /><circle cx="11" cy="11" r="3.2" /></g>);
}
function GlifoOjo() {
    return (<g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 11 C4 6, 18 6, 20.5 11 C18 16, 4 16, 1.5 11 Z" /><circle cx="11" cy="11" r="2.6" /></g>);
}
function GlifoLupa() {
    return (<g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="6.2" /><line x1="13.6" y1="13.6" x2="19" y2="19" /></g>);
}
function GlifoLineas() {
    return (<g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <line x1="3" y1="6" x2="19" y2="6" /><line x1="3" y1="11" x2="19" y2="11" /><line x1="3" y1="16" x2="13" y2="16" /></g>);
}
