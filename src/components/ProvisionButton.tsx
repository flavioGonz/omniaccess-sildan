"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Zap, Loader2, Check, X, Clock, Send, ScanLine, Film, Radio, Car, AlertTriangle, RotateCcw } from "lucide-react";
import { provisionLprDevice, type ClavePuesta } from "@/app/actions/provision";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";

/**
 * La puesta a punto de una cámara LPR Hikvision, en un cajón.
 *
 * Era un diálogo centrado que corría todo de una (hora, envío, ANPR, códec, video, matrículas)
 * y al final mostraba la lista. 21/10, Nico: «permití seleccionar con toggles qué quiero poner a
 * punto y qué no; estilizado; cambiá ese modal por un drawer». Ahora cada paso tiene su
 * interruptor, se corren de a uno (provisionLprDevice con `solo`) y cada tarjeta muestra su
 * estado mientras pasa; si alguno falla, «Reintentar los que fallaron» vuelve a correr sólo esos.
 */
type Paso = { clave: ClavePuesta; nombre: string; Icon: any; que: string; porDefecto: boolean };
const PASOS: Paso[] = [
    { clave: "hora", nombre: "Hora", Icon: Clock, que: "La hora del servidor: los eventos quedan con la hora correcta y el clip coincide.", porDefecto: true },
    { clave: "eventos", nombre: "Envío de eventos", Icon: Send, que: "Apunta las lecturas a OmniAccess (HTTP host). Sin esto la cámara lee y nadie se entera.", porDefecto: true },
    { clave: "anpr", nombre: "Modo ANPR", Icon: ScanLine, que: "Verifica que esté leyendo matrículas (roadDetection). No lo cambia: eso pide reiniciar la cámara.", porDefecto: true },
    { clave: "h264", nombre: "Video H.264", Icon: Film, que: "Pasa los canales 101 y 102 a H.264, para ver el vivo sin transcodificar.", porDefecto: true },
    { clave: "vivo", nombre: "Video en vivo", Icon: Radio, que: "Registra el stream de la cámara en el servidor de video.", porDefecto: true },
    { clave: "matriculas", nombre: "Matrículas", Icon: Car, que: "Sincroniza el padrón: agrega y quita sólo las que cambiaron. Con muchas puede tardar.", porDefecto: true },
];
type Estado = "espera" | "corriendo" | "ok" | "error";

/** Los errores de la cámara que se repiten, dichos en criollo (el texto crudo queda entre paréntesis). */
function explicar(detalle: string): string {
    if (/status code 403/.test(detalle)) return `La cámara no dejó (403): el usuario cargado no tiene permiso para esto, o la cámara no lo ofrece. (${detalle})`;
    if (/status code 401/.test(detalle)) return `Usuario o clave incorrectos (401). (${detalle})`;
    if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|timeout/i.test(detalle)) return `La cámara no contestó: revisá la IP y el puerto web. (${detalle})`;
    return detalle;
}
type Resultado = { estado: Estado; detalle?: string };

export function ProvisionButton({ deviceId, deviceName, onDone }: { deviceId: string; deviceName?: string; onDone?: () => void }) {
    const [abierto, setAbierto] = useState(false);
    const [elegidos, setElegidos] = useState<Set<ClavePuesta>>(() => new Set(PASOS.filter((p) => p.porDefecto).map((p) => p.clave)));
    const [res, setRes] = useState<Partial<Record<ClavePuesta, Resultado>>>({});
    const [corriendo, setCorriendo] = useState(false);

    const corridos = PASOS.filter((p) => res[p.clave]);
    const terminado = !corriendo && corridos.length > 0;
    const fallidos = PASOS.filter((p) => res[p.clave]?.estado === "error").map((p) => p.clave);
    const bien = PASOS.filter((p) => res[p.clave]?.estado === "ok").length;

    const correr = async (claves: ClavePuesta[]) => {
        if (!claves.length || corriendo) return;
        setCorriendo(true);
        setRes((r) => ({ ...r, ...Object.fromEntries(claves.map((k) => [k, { estado: "espera" as Estado }])) }));
        let ok = 0;
        for (const k of claves) {
            setRes((r) => ({ ...r, [k]: { estado: "corriendo" } }));
            try {
                const r: any = await provisionLprDevice(deviceId, k === "matriculas", [k]);
                const s = r?.steps?.[0];
                const estado: Estado = s?.ok ? "ok" : "error";
                if (s?.ok) ok++;
                setRes((x) => ({ ...x, [k]: { estado, detalle: explicar(s?.detail || r?.error || "sin respuesta") } }));
            } catch (e: any) {
                setRes((x) => ({ ...x, [k]: { estado: "error", detalle: e?.message || "No se pudo contactar la cámara." } }));
            }
        }
        setCorriendo(false);
        onDone?.();
        if (ok === claves.length) toast.success({ title: "Puesta a punto lista", description: `${ok} de ${claves.length} pasos aplicados` });
        else toast.error({ title: "Puesta a punto con avisos", description: `${ok} de ${claves.length} pasos aplicados` });
    };

    const alternar = (k: ClavePuesta, v: boolean) => setElegidos((s) => { const n = new Set(s); if (v) n.add(k); else n.delete(k); return n; });
    const abrir = () => { setRes({}); setAbierto(true); };
    const aCorrer = PASOS.filter((p) => elegidos.has(p.clave)).map((p) => p.clave);

    return (
        <>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={abrir}
                            className="h-8 w-8 rounded-md bg-card/50 text-muted-foreground hover:text-foreground hover:bg-accent border border-border/50 transition-all">
                            <Zap size={15} />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Poner a punto (hora · envío · códec · matrículas)</p></TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <Cajon open={abierto} onOpenChange={(o) => { if (!corriendo) setAbierto(o); }}>
                <CajonContenido ancho="angosto" titulo="Puesta a punto" descripcion={deviceName || "Cámara LPR"}
                    onInteractOutside={(e) => { if (corriendo) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (corriendo) e.preventDefault(); }}
                    pie={
                        <>
                            <span className={cn("mr-auto text-[12px] tabular-nums", terminado ? (fallidos.length ? "text-[var(--aviso)] font-semibold" : "text-[var(--bien)] font-semibold") : "text-muted-foreground")}>
                                {corriendo ? `Configurando… ${PASOS.filter((p) => res[p.clave] && res[p.clave]!.estado !== "espera" && res[p.clave]!.estado !== "corriendo").length} de ${corridos.length}`
                                    : terminado ? (fallidos.length ? `${bien} de ${corridos.length} aplicados` : "Todo aplicado")
                                        : `${aCorrer.length} de ${PASOS.length} elegidos`}
                            </span>
                            {terminado && fallidos.length > 0 && (
                                <Button variant="outline" size="sm" onClick={() => correr(fallidos)} className="gap-1.5"><RotateCcw size={14} /> Reintentar {fallidos.length === 1 ? "el que falló" : `los ${fallidos.length} que fallaron`}</Button>
                            )}
                            {terminado ? (
                                <Button size="sm" onClick={() => setAbierto(false)}>Listo</Button>
                            ) : (
                                <Button size="sm" onClick={() => correr(aCorrer)} disabled={!aCorrer.length || corriendo} className="gap-1.5">
                                    {corriendo ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Poner a punto
                                </Button>
                            )}
                        </>
                    }>
                    <div className="px-6 py-5 space-y-4">
                        <div className="flex items-start gap-2.5 rounded-[10px] bg-[color-mix(in_oklab,var(--aviso)_10%,transparent)] px-3 py-2.5 text-[12.5px] leading-snug">
                            <AlertTriangle size={15} className="tono-aviso shrink-0 mt-0.5" />
                            <span>Se configura la cámara por su API. Elegí qué pasos correr; los apagados no se tocan.</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                            <span className="mr-auto">Pasos</span>
                            <button type="button" disabled={corriendo} onClick={() => setElegidos(new Set(PASOS.map((p) => p.clave)))} className="h-7 px-2 rounded-md font-semibold hover:bg-accent hover:text-foreground disabled:opacity-40">Todos</button>
                            <button type="button" disabled={corriendo} onClick={() => setElegidos(new Set())} className="h-7 px-2 rounded-md font-semibold hover:bg-accent hover:text-foreground disabled:opacity-40">Ninguno</button>
                        </div>
                        <div className="space-y-2">
                            {PASOS.map((p) => {
                                const on = elegidos.has(p.clave);
                                const r = res[p.clave];
                                return (
                                    <div key={p.clave} className={cn("rounded-[10px] border px-3.5 py-3 flex items-start gap-3 transition-colors",
                                        r?.estado === "error" ? "border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[color-mix(in_oklab,var(--mal)_6%,transparent)]"
                                            : r?.estado === "ok" ? "border-[color-mix(in_oklab,var(--bien)_35%,transparent)]"
                                                : r?.estado === "corriendo" ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]"
                                                    : on ? "border-border bg-card" : "border-border/60 bg-transparent")}>
                                        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[8px]", on ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground/60")}>
                                            <p.Icon size={15} />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className={cn("text-[13px] font-semibold leading-tight", !on && !r && "text-muted-foreground")}>{p.nombre}</div>
                                            <div className="text-[11.5px] text-muted-foreground leading-snug mt-0.5">{p.que}</div>
                                            {r?.detalle && <div className={cn("text-[11.5px] mt-1 break-words", r.estado === "error" ? "tono-mal" : "text-foreground/80")}>{r.detalle}</div>}
                                        </div>
                                        <span className="shrink-0 mt-0.5">
                                            {r ? <EstadoPaso e={r.estado} /> : <Switch checked={on} onCheckedChange={(v) => alternar(p.clave, v)} disabled={corriendo} aria-label={`Correr «${p.nombre}»`} />}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        {terminado && (
                            <button type="button" onClick={() => setRes({})} className="text-[12px] font-semibold text-[var(--accion)] hover:underline">Elegir otros pasos</button>
                        )}
                    </div>
                </CajonContenido>
            </Cajon>
        </>
    );
}

function EstadoPaso({ e }: { e: Estado }) {
    if (e === "corriendo") return <Loader2 size={18} className="animate-spin text-[var(--accion)]" />;
    if (e === "ok") return <span className="grid h-5 w-5 place-items-center rounded-full pleno-bien"><Check size={12} /></span>;
    if (e === "error") return <span className="grid h-5 w-5 place-items-center rounded-full pleno-mal"><X size={12} /></span>;
    return <span className="block h-5 w-5 rounded-full border-2 border-dashed border-border" />;
}
