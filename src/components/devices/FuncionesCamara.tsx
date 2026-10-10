"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellRing, Camera, Eye, Loader2, RefreshCw, Route, ScanEye, ShieldAlert } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Chip } from "@/components/ui/estados";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ROLES, consecuencias, type RolCamara, type TipoCamara } from "@/lib/rol-camara";

/**
 * «Qué hace OmniAccess con esta cámara», contestado con tres cosas que se pueden mirar y cambiar:
 *
 *  · El TIPO (LPR de acceso, seguimiento, cámara): decide a qué pantalla va y qué se le pide.
 *    Se puede cambiar —una cámara importada como común que era LPR—, con una confirmación que
 *    dice qué deja de pasar y qué empieza.
 *  · Si la cámara NOS AVISA (Hikvision: servidor HTTP apuntando a OmniAccess). Es lo que trae las
 *    lecturas de matrícula y los cruces de AcuSense. Se mira el estado real en la cámara, no un
 *    dato guardado.
 *  · Si OmniVision MIRA SU VIDEO (siluetas, búsqueda, reglas propias). Independiente de lo
 *    anterior: una cámara puede avisar sola y además ser analizada, o sólo una de las dos.
 *
 * Antes las tres cosas existían pero en tres lugares distintos (el tipo fijo en el alta, el
 * servidor de alarma en el monitor de intrusión, las cámaras de OmniVision en un ajuste sin
 * pantalla), y nadie podía contestar de un vistazo «¿esta cámara va a YOLO o sólo avisa?».
 */
const TIPOS: { tipo: TipoCamara; rol: RolCamara; icono: typeof Camera }[] = [
    { tipo: "LPR_CAMERA", rol: "acceso", icono: Camera },
    { tipo: "LPR_INTERIOR", rol: "seguimiento", icono: Route },
    { tipo: "CAMERA", rol: "intrusion", icono: ShieldAlert },
];

export type FuncionesAlta = { avisos: boolean; vision: boolean };

export function FuncionesCamara({ deviceId, tipo, marca, alta, alCambiarAlta, alCambiarTipo }: {
    /** null mientras se da de alta: los cambios se guardan en `alta` y se aplican al crear. */
    deviceId: string | null;
    tipo: TipoCamara;
    marca: string;
    alta?: FuncionesAlta;
    alCambiarAlta?: (a: FuncionesAlta) => void;
    /** Editando: cambia el tipo en el formulario (se guarda con «Guardar»). */
    alCambiarTipo?: (t: TipoCamara) => void;
}) {
    const [avisa, setAvisa] = useState<boolean | null>(null);
    const [avisoError, setAvisoError] = useState<string | null>(null);
    const [vision, setVision] = useState<boolean | null>(null);
    const [ocupado, setOcupado] = useState<"avisos" | "vision" | null>(null);
    const [tipoPedido, setTipoPedido] = useState<TipoCamara | null>(null);
    const hik = marca === "HIKVISION";

    const leer = useCallback(async () => {
        if (!deviceId) return;
        setAvisa(null); setAvisoError(null);
        const [a, v] = await Promise.all([
            fetch(`/api/devices/alarm-host?deviceId=${deviceId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
            fetch(`/api/vision/camaras/${deviceId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        ]);
        if (a && typeof a.hasOmni === "boolean") setAvisa(a.hasOmni);
        else setAvisoError(a?.error || "No se pudo preguntarle a la cámara");
        setVision(typeof v?.analiza === "boolean" ? v.analiza : null);
    }, [deviceId]);
    useEffect(() => { leer(); }, [leer]);

    async function configurarAvisos() {
        if (!deviceId) return;
        setOcupado("avisos");
        try {
            const r = await fetch(`/api/devices/alarm-host?deviceId=${deviceId}`, { method: "POST" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.ok) throw new Error(j.error || `La cámara respondió ${r.status}`);
            toast.success({ title: "La cámara ya nos avisa", description: "Quedó apuntando a OmniAccess. La prueba real es un evento: un cruce o una lectura." });
            await leer();
        } catch (e: any) { toast.error({ title: "No se pudo configurar la cámara", description: e?.message }); }
        finally { setOcupado(null); }
    }

    async function ponerVision(v: boolean) {
        if (!deviceId) { alCambiarAlta?.({ ...(alta || { avisos: true, vision: true }), vision: v }); return; }
        setOcupado("vision");
        const antes = vision; setVision(v);
        try {
            const r = await fetch(`/api/vision/camaras/${deviceId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ analiza: v }) });
            if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `El servidor respondió ${r.status}`);
            toast.success({ title: v ? "OmniVision mira esta cámara" : "OmniVision dejó de mirar esta cámara", description: "Lo toma en menos de un minuto." });
        } catch (e: any) { setVision(antes); toast.error({ title: "No se guardó", description: e?.message }); }
        finally { setOcupado(null); }
    }

    const avisosAhora = deviceId ? avisa : alta?.avisos ?? true;
    const visionAhora = deviceId ? vision : alta?.vision ?? true;
    const resumen = avisosAhora && visionAhora ? "Avisa sola y además OmniVision mira su video."
        : avisosAhora ? "Sólo avisos de la cámara: OmniVision no mira su video."
            : visionAhora ? "La cámara no avisa nada: todo lo que se sabe sale de OmniVision."
                : "Ni avisa ni se analiza: sólo se ve en vivo.";

    return (
        <div className="space-y-3">
            {/* El tipo */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {TIPOS.map((t) => {
                    const I = t.icono, sel = tipo === t.tipo;
                    return (
                        <button key={t.tipo} type="button" disabled={!deviceId && !alCambiarTipo}
                            onClick={() => { if (!sel && alCambiarTipo) setTipoPedido(t.tipo); }}
                            className={cn("rounded-[10px] border p-3 text-left transition-colors", sel ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border hover:bg-accent", !alCambiarTipo && !sel && "opacity-50 cursor-default")}>
                            <span className="flex items-center gap-1.5 text-[13px] font-bold"><I size={14} /> {ROLES[t.rol].rotulo.replace("Intrusión", "Cámara de vigilancia")}</span>
                            <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">{t.tipo === "CAMERA" ? "Intrusión por AcuSense o sólo video para OmniVision." : ROLES[t.rol].que}</span>
                        </button>
                    );
                })}
            </div>

            {/* Avisos de la cámara */}
            <div className="rounded-[10px] border border-border px-3 py-3 flex items-start gap-3">
                <BellRing size={18} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold">Que la cámara nos avise</div>
                    <p className="text-[11.5px] text-muted-foreground leading-snug">
                        {tipo === "LPR_CAMERA" ? "Así llegan sus lecturas de matrícula." : tipo === "CAMERA" ? "Así llegan sus cruces de línea y entradas a zona (AcuSense): es lo que alimenta el monitor de intrusión." : "La de seguimiento puede avisar cuando cruza un vehículo (si su disparo es por línea o zona)."}
                    </p>
                    {deviceId ? (
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {avisa === null && !avisoError ? <span className="text-[12px] text-muted-foreground inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Preguntándole a la cámara…</span>
                                : avisoError ? <Chip tono="quieto" icono={AlertTriangle}>No sé: {avisoError}</Chip>
                                    : avisa ? <Chip tono="bien">Apunta a OmniAccess</Chip> : <Chip tono="aviso">No nos avisa</Chip>}
                            {hik && avisa === false && <Button size="sm" onClick={configurarAvisos} disabled={ocupado === "avisos"}>{ocupado === "avisos" ? <Loader2 size={13} className="animate-spin" /> : null} Configurarla</Button>}
                            <button type="button" onClick={leer} className="text-muted-foreground hover:text-foreground" title="Volver a preguntar"><RefreshCw size={13} /></button>
                        </div>
                    ) : (
                        <label className="flex items-center gap-2 mt-1.5 text-[12px]">
                            <Switch checked={alta?.avisos ?? true} onCheckedChange={(v) => alCambiarAlta?.({ ...(alta || { avisos: true, vision: true }), avisos: v })} />
                            Configurarla al guardar {hik ? "" : "(sólo Hikvision; en otras marcas se hace desde el equipo)"}
                        </label>
                    )}
                </div>
            </div>

            {/* OmniVision */}
            <div className="rounded-[10px] border border-border px-3 py-3 flex items-start gap-3">
                <ScanEye size={18} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold">Que OmniVision mire su video</div>
                    <p className="text-[11.5px] text-muted-foreground leading-snug">El detector (YOLO / RF-DETR) analiza el video: siluetas, búsqueda por texto, reglas propias de cruce e intrusión, analíticas entrenables. Cada cámara suma un poco de GPU.</p>
                </div>
                {deviceId && vision === null ? <Loader2 size={15} className="animate-spin text-muted-foreground mt-1" />
                    : <Switch checked={!!visionAhora} disabled={ocupado === "vision"} onCheckedChange={ponerVision} />}
            </div>

            <p className="text-[12px] inline-flex items-center gap-1.5 text-muted-foreground"><Eye size={13} /> {resumen}</p>

            {/* Confirmación del cambio de tipo */}
            <Dialog open={!!tipoPedido} onOpenChange={(o) => { if (!o) setTipoPedido(null); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogTitle className="text-[16px] font-bold">¿Cambiar a {tipoPedido ? ROLES[TIPOS.find((t) => t.tipo === tipoPedido)!.rol].rotulo.replace("Intrusión", "cámara de vigilancia") : ""}?</DialogTitle>
                    <DialogDescription className="text-[12.5px] text-muted-foreground">Se aplica al tocar «Guardar» en la ficha. Esto cambia:</DialogDescription>
                    <ul className="text-[13px] space-y-1.5 list-disc pl-5">
                        {tipoPedido && consecuencias(tipo, tipoPedido).map((c) => <li key={c}>{c}</li>)}
                        {tipoPedido === "LPR_CAMERA" && <li>Revisá el <b>sentido</b> (entrada o salida) y el <b>grupo</b> en «Dónde está y quién pasa».</li>}
                        {tipoPedido === "LPR_INTERIOR" && <li>Completá el <b>canal de video</b> (RTSP) y cómo avisa que pasó un auto.</li>}
                    </ul>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setTipoPedido(null)}>No</Button>
                        <Button onClick={() => { if (tipoPedido) alCambiarTipo?.(tipoPedido); setTipoPedido(null); }}>Sí, cambiar</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
