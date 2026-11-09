"use client";

// Sección "Drivers & Protocolos" de Ajustes — ahora armada desde el catálogo REAL
// (lib/drivers/catalogo.ts), no de una lista hardcodeada. Muestra TODOS los drivers con su
// estado honesto (anda / a medias / sin driver) y qué sabe hacer cada uno. Al tocar uno se
// abre un cajón (drawer) premium con el detalle: capacidades, para qué tipos de equipo
// sirve, y la nota honesta. Tooltips con Pista, iconografía por capacidad.
//
// Diseño (claude/DESIGN.md): un solo azul de acción; los tonos sólo dicen estado; jerarquía
// por superficie + línea, sin sombras en tarjetas; el cajón es la única superficie que flota.

import { useState, useEffect, useCallback, useRef } from "react";
import {
    BadgeCheck, AlertTriangle, CircleSlash, Car, ScanFace, Nfc, ScrollText,
    DoorOpen, Users as UsersIcon, Video, UserCog, Wifi, Cpu, Check, X, Blocks,
    Upload, Loader2, Trash2, ImageIcon,
} from "lucide-react";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Pista } from "@/components/ui/pista";
import { sileo as toast } from "sileo";
import { ProtocoloAnimado } from "./ProtocoloAnimado";
import { getDriverLogos, saveDriverLogo, deleteDriverLogo } from "@/app/actions/devices";
import { SOPORTE, QUE_ES, NECESITA, evaluar, type Soporte, type Capacidad } from "@/lib/drivers/catalogo";
import { cn } from "@/lib/utils";

// Logos por defecto; el usuario puede subir el suyo por driver (se guarda en Settings).
const LOGOS_DEFAULT: Record<string, string> = {
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
    const [logos, setLogos] = useState<Record<string, string>>({});
    const cargarLogos = useCallback(async () => { try { setLogos(await getDriverLogos()); } catch { /* queda el default */ } }, []);
    useEffect(() => { cargarLogos(); }, [cargarLogos]);
    const logoDe = (marca: string) => logos[marca] || LOGOS_DEFAULT[marca] || null;
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
                    const logo = logoDe(s.marca);
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

            <DriverDrawer soporte={abierta} onClose={() => setAbierta(null)} logo={abierta ? logoDe(abierta.marca) : null} onLogoChange={cargarLogos} />
        </div>
    );
}

function DriverDrawer({ soporte, onClose, logo, onLogoChange }: { soporte: Soporte | null; onClose: () => void; logo: string | null; onLogoChange: () => void }) {
    const tiposQueSirve = soporte
        ? Object.keys(NECESITA).map(t => ({ tipo: t, ...evaluar(soporte.marca, t) }))
        : [];

    return (
        <Cajon open={!!soporte} onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
            <CajonContenido ancho="intermedio" titulo={soporte ? `Driver ${soporte.rotulo}` : "Driver"}>
                {soporte && (
                    <div className="space-y-5">
                        {/* El protocolo, animado, arriba de todo y sin marco */}
                        <ProtocoloAnimado soporte={soporte} />

                        <CajonSeccion titulo="Logo del fabricante" icono={ImageIcon}>
                            <LogoUploader soporte={soporte} logo={logo} onChange={onLogoChange} />
                        </CajonSeccion>

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

function LogoUploader({ soporte, logo, onChange }: { soporte: Soporte; logo: string | null; onChange: () => void }) {
    const [subiendo, setSubiendo] = useState(false);
    const [borrando, setBorrando] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const elegir = async (f: File) => {
        setSubiendo(true);
        const fd = new FormData();
        fd.append("file", f);
        const r = await saveDriverLogo(soporte.marca, fd);
        setSubiendo(false);
        if (r.success) { toast.success({ title: "Logo actualizado" }); onChange(); }
        else toast.error({ title: "No se pudo subir", description: r.error });
        if (inputRef.current) inputRef.current.value = "";
    };
    const borrar = async () => {
        setBorrando(true);
        await deleteDriverLogo(soporte.marca);
        setBorrando(false);
        toast.success({ title: "Logo quitado" });
        onChange();
    };

    return (
        <div className="flex items-center gap-4">
            <div className={cn("w-16 h-16 rounded-[10px] flex items-center justify-center shrink-0 overflow-hidden border border-border", logo ? "bg-white p-1.5" : "bg-muted")}>
                {logo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={logo} alt={soporte.rotulo} className="w-full h-full object-contain" />
                    : <Cpu size={22} className="text-muted-foreground" />}
            </div>
            <div className="min-w-0">
                <p className="text-[12.5px] text-muted-foreground leading-[1.5]">PNG, JPG o WebP. Se muestra en la grilla de drivers y en la ficha del equipo.</p>
                <div className="mt-2 flex items-center gap-2">
                    <button onClick={() => inputRef.current?.click()} disabled={subiendo}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[6px] text-[12px] font-semibold text-[var(--accion-texto,#fff)] bg-[color:var(--accion)] hover:opacity-90 transition-opacity disabled:opacity-50">
                        {subiendo ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                        {logo ? "Cambiar logo" : "Subir logo"}
                    </button>
                    {logo && (
                        <button onClick={borrar} disabled={borrando}
                            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] text-[12px] font-semibold text-muted-foreground border border-border hover:bg-muted transition-colors disabled:opacity-50">
                            {borrando ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                    )}
                </div>
                <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                    onChange={(ev) => ev.target.files?.[0] && elegir(ev.target.files[0])} />
            </div>
        </div>
    );
}
