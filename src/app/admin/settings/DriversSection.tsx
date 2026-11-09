"use client";

// Sección "Drivers & Protocolos" de Ajustes — ahora armada desde el catálogo REAL
// (lib/drivers/catalogo.ts), no de una lista hardcodeada. Muestra TODOS los drivers con su
// estado honesto (anda / a medias / sin driver) y qué sabe hacer cada uno. Al tocar uno se
// abre un cajón (drawer) premium con el detalle: capacidades, para qué tipos de equipo
// sirve, y la nota honesta. Tooltips con Pista, iconografía por capacidad.
//
// Diseño (claude/DESIGN.md): un solo azul de acción; los tonos sólo dicen estado; jerarquía
// por superficie + línea, sin sombras en tarjetas; el cajón es la única superficie que flota.

import { useState } from "react";
import {
    BadgeCheck, AlertTriangle, CircleSlash, Car, ScanFace, Nfc, ScrollText,
    DoorOpen, Users as UsersIcon, Video, UserCog, Wifi, Cpu, Check, X, Blocks,
} from "lucide-react";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Pista } from "@/components/ui/pista";
import { ProtocoloAnimado } from "./ProtocoloAnimado";
import { SOPORTE, QUE_ES, NECESITA, evaluar, type Soporte, type Capacidad } from "@/lib/drivers/catalogo";
import { cn } from "@/lib/utils";

const LOGOS: Record<string, string> = {
    HIKVISION: "/logos/hikvision.png",
    AKUVOX: "/logos/akuvox.png",
};

const CAP_ICONO: Record<Capacidad, React.ComponentType<{ size?: number; className?: string }>> = {
    lpr: Car, rostro: ScanFace, rfid: Nfc, bitacora: ScrollText, "relé": DoorOpen,
    conteo: UsersIcon, video: Video, usuarios: UserCog, sesiones: Wifi,
};
const CAP_CORTO: Record<Capacidad, string> = {
    lpr: "Matrículas", rostro: "Rostros", rfid: "Tarjetas", bitacora: "Bitácora", "relé": "Abrir puerta",
    conteo: "Aforo", video: "Video", usuarios: "Usuarios", sesiones: "Sesiones",
};
const TODAS_CAP = Object.keys(QUE_ES) as Capacidad[];

const ESTADO: Record<Soporte["estado"], { rotulo: string; icono: any; chip: string; punto: string }> = {
    andando: { rotulo: "Anda", icono: BadgeCheck, chip: "chip-bien", punto: "var(--bien,#16a34a)" },
    parcial: { rotulo: "A medias", icono: AlertTriangle, chip: "chip-aviso", punto: "var(--aviso,#d97706)" },
    "sin hacer": { rotulo: "Sin driver", icono: CircleSlash, chip: "chip-mal", punto: "var(--mal,#dc2626)" },
};

const TIPO_ROTULO: Record<string, string> = {
    LPR_CAMERA: "Cámara LPR", LPR_INTERIOR: "LPR interior", NVR: "Grabador (NVR)",
    FACE_TERMINAL: "Terminal de rostro", ACCESS_CONTROL: "Control de acceso",
    DOOR_INTERCOM: "Portero IP", QUEUE_COUNTER: "Contador de fila",
};

export default function DriversSection() {
    const [abierta, setAbierta] = useState<Soporte | null>(null);
    const andando = SOPORTE.filter(s => s.estado === "andando").length;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-[28px] font-bold tracking-[-0.02em] leading-[1.12] text-foreground">Drivers & protocolos</h2>
                    <p className="text-[13px] text-muted-foreground mt-0.5">Qué sabe hacer OmniAccess con cada marca. Lo que figura es lo que se probó contra equipos reales — no lo que el driver promete.</p>
                </div>
                <span className="text-[12.5px] text-muted-foreground tabular-nums">
                    <span className="font-bold text-foreground">{andando}</span> de {SOPORTE.length} andando
                </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {SOPORTE.map((s) => {
                    const e = ESTADO[s.estado];
                    const logo = LOGOS[s.marca];
                    return (
                        <button key={s.marca} type="button" onClick={() => setAbierta(s)}
                            className="text-left rounded-[10px] border border-border bg-card hover:bg-muted/40 transition-colors p-4 flex flex-col gap-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className={cn("w-10 h-10 rounded-[8px] flex items-center justify-center shrink-0 overflow-hidden border border-border",
                                        logo ? "bg-white p-1" : "bg-muted")}>
                                        {logo
                                            // eslint-disable-next-line @next/next/no-img-element
                                            ? <img src={logo} alt={s.rotulo} className="w-full h-full object-contain" />
                                            : <Cpu size={18} className="text-muted-foreground" />}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-[14px] font-semibold text-foreground truncate">{s.rotulo}</div>
                                        <div className="text-[11px] text-muted-foreground truncate">{s.hace.length ? `${s.hace.length} ${s.hace.length === 1 ? "capacidad" : "capacidades"}` : "sin capacidades"}</div>
                                    </div>
                                </div>
                                <Pista titulo={s.rotulo} texto={s.nota} lado="arriba" ancho={280}>
                                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border cursor-help flex items-center gap-1 shrink-0", e.chip)}>
                                        <e.icono size={11} /> {e.rotulo}
                                    </span>
                                </Pista>
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {s.hace.length === 0
                                    ? <span className="text-[11px] text-muted-foreground">Todavía no se le puede mandar nada</span>
                                    : s.hace.map((c) => {
                                        const I = CAP_ICONO[c];
                                        return (
                                            <span key={c} className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground bg-muted rounded-[6px] px-1.5 py-0.5">
                                                <I size={11} className="text-[color:var(--accion)]" /> {CAP_CORTO[c]}
                                            </span>
                                        );
                                    })}
                            </div>
                        </button>
                    );
                })}
            </div>

            <DriverDrawer soporte={abierta} onClose={() => setAbierta(null)} />
        </div>
    );
}

function DriverDrawer({ soporte, onClose }: { soporte: Soporte | null; onClose: () => void }) {
    const e = soporte ? ESTADO[soporte.estado] : null;
    const logo = soporte ? LOGOS[soporte.marca] : null;
    const tiposQueSirve = soporte
        ? Object.keys(NECESITA).map(t => ({ tipo: t, ...evaluar(soporte.marca, t) }))
        : [];

    return (
        <Cajon open={!!soporte} onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
            <CajonContenido ancho="intermedio" titulo={soporte ? `Driver ${soporte.rotulo}` : "Driver"}
                encabezado={soporte && e ? (
                    <div className="flex items-center gap-3">
                        <div className={cn("w-11 h-11 rounded-[8px] flex items-center justify-center shrink-0 overflow-hidden border border-border", logo ? "bg-white p-1" : "bg-muted")}>
                            {logo
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={logo} alt={soporte.rotulo} className="w-full h-full object-contain" />
                                : <Cpu size={20} className="text-muted-foreground" />}
                        </div>
                        <div className="min-w-0">
                            <div className="text-[18px] font-bold text-foreground truncate">{soporte.rotulo}</div>
                            <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border mt-0.5", e.chip)}>
                                <e.icono size={11} /> {e.rotulo}
                            </span>
                        </div>
                    </div>
                ) : undefined}>
                {soporte && (
                    <div className="space-y-5">
                        {/* Cómo trabaja OmniAccess con este equipo, animado y simple */}
                        <ProtocoloAnimado soporte={soporte} />

                        <CajonSeccion titulo="En qué está" icono={AlertTriangle}>
                            <p className="text-[13px] text-foreground leading-[1.55]">{soporte.nota}</p>
                        </CajonSeccion>

                        <CajonSeccion titulo="Qué sabe hacer" icono={Blocks}>
                            <ul className="space-y-1.5">
                                {TODAS_CAP.map((c) => {
                                    const hace = soporte.hace.includes(c);
                                    const I = CAP_ICONO[c];
                                    return (
                                        <li key={c} className={cn("flex items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 border",
                                            hace ? "border-border bg-card" : "border-transparent opacity-45")}>
                                            <I size={14} className={hace ? "text-[color:var(--accion)]" : "text-muted-foreground"} />
                                            <span className="text-[13px] text-foreground flex-1">{QUE_ES[c]}</span>
                                            {hace
                                                ? <Check size={15} style={{ color: "var(--bien-texto,#15803d)" }} />
                                                : <X size={14} className="text-muted-foreground" />}
                                        </li>
                                    );
                                })}
                            </ul>
                        </CajonSeccion>

                        <CajonSeccion titulo="Para qué tipo de equipo sirve" icono={Blocks}>
                            <ul className="space-y-1.5">
                                {tiposQueSirve.map(({ tipo, sirve, faltan }) => (
                                    <li key={tipo} className="flex items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 border border-border bg-card">
                                        <span className="text-[13px] text-foreground flex-1">{TIPO_ROTULO[tipo] || tipo}</span>
                                        {sirve
                                            ? <span className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: "var(--bien-texto,#15803d)" }}><Check size={13} /> sirve</span>
                                            : <Pista titulo="Qué le falta" texto={`No hace: ${faltan.map(f => CAP_CORTO[f]).join(", ")}`} lado="izquierda" ancho={220}>
                                                <span className="text-[11px] font-semibold inline-flex items-center gap-1 cursor-help" style={{ color: "var(--aviso-texto,#b45309)" }}><AlertTriangle size={12} /> le falta</span>
                                            </Pista>}
                                    </li>
                                ))}
                            </ul>
                        </CajonSeccion>
                    </div>
                )}
            </CajonContenido>
        </Cajon>
    );
}
