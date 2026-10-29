"use client";
/**
 * Los avisos de salud de un equipo, en su ficha (lib/avisos-equipo.ts): un interruptor por aviso y
 * otro para Telegram. Se guarda al tocar: no hay nada que «confirmar» en prender o apagar un aviso,
 * y un botón de guardar al final de una lista de interruptores es una trampa (se tocan, se cierra la
 * ficha y no quedó nada).
 *
 * Y `AvisosArea`: el mismo cambio a todos los equipos de un área. Ahí cada aviso tiene tres
 * posiciones —no tocar, prender, apagar— porque los equipos de un área pueden estar distintos y un
 * interruptor solo no puede mostrar «algunos sí y otros no».
 */
import { useEffect, useState } from "react";
import {
    Aperture, BellRing, Clock, EyeOff, HardDrive, Hourglass, Loader2, Move, ScanLine, Send, WifiOff, type LucideIcon,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Cargando, ErrorEstado } from "@/components/ui/estados";
import { cn } from "@/lib/utils";
import { AVISOS, avisosDe, prendido, type AjusteAvisos, type ClaveAviso } from "@/lib/avisos-equipo";
import { leerAvisos, guardarAvisos, aplicarAvisosArea } from "@/app/actions/avisos";
import { useSessionRole } from "@/hooks/useSessionRole";

const ICONO: Record<ClaveAviso, LucideIcon> = {
    offline: WifiOff, tapada: EyeOff, borrosa: Aperture, movida: Move, silencio: Hourglass, drift: Clock, vca: ScanLine, disk: HardDrive,
};
const AYUDA_TELEGRAM = "Al grupo de Ajustes › Notificaciones. Los de imagen van con la foto habitual al lado de la de ahora.";

function Fila({ icono: I, rotulo, ayuda, children, apagado }: { icono: LucideIcon; rotulo: string; ayuda: string; children: React.ReactNode; apagado?: boolean }) {
    return (
        <li className="flex items-center gap-3 py-2.5">
            <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors", apagado ? "bg-muted text-muted-foreground/60" : "bg-[var(--info-suave)] tono-info")}><I size={15} /></span>
            <span className="min-w-0 flex-1">
                <span className={cn("block text-[13px] font-semibold", apagado && "text-muted-foreground")}>{rotulo}</span>
                <span className="block text-[11.5px] text-muted-foreground leading-snug">{ayuda}</span>
            </span>
            {children}
        </li>
    );
}

export function AvisosEquipo({ deviceId, deviceType }: { deviceId: string; deviceType: string }) {
    const { tiene } = useSessionRole();
    const puede = tiene("dispositivos.editar");
    const [aj, setAj] = useState<AjusteAvisos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState<string | null>(null);
    const traer = () => { setError(null); leerAvisos(deviceId).then(setAj).catch((e) => setError(e?.message || "No se pudo leer")); };
    useEffect(traer, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

    const lista = avisosDe(deviceType);
    if (!lista.length) return null;
    if (error && !aj) return <ErrorEstado mensaje={error} alReintentar={traer} />;
    if (!aj) return <Cargando texto="Leyendo los avisos…" />;

    const cambiar = async (clave: ClaveAviso | "telegram", v: boolean) => {
        const antes = aj;
        setAj({ ...aj, [clave]: v }); setGuardando(clave);
        try { setAj(await guardarAvisos(deviceId, { [clave]: v })); }
        catch (e: any) { setAj(antes); toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(null); }
    };
    const interruptor = (clave: ClaveAviso | "telegram", aria: string) => (
        <span className="flex items-center gap-2">
            {guardando === clave && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
            <Switch checked={prendido(aj, clave)} onCheckedChange={(v) => cambiar(clave, v)} disabled={!puede || !!guardando} aria-label={aria} />
        </span>
    );
    const alguno = lista.some((a) => prendido(aj, a.clave));

    return (
        <div>
            <ul className="divide-y divide-border">
                {lista.map((a) => (
                    <Fila key={a.clave} icono={ICONO[a.clave]} rotulo={a.rotulo} ayuda={a.ayuda} apagado={!prendido(aj, a.clave)}>
                        {interruptor(a.clave, a.rotulo)}
                    </Fila>
                ))}
            </ul>
            <div className="mt-3 rounded-[10px] border border-border bg-muted/30 px-3">
                <ul>
                    <Fila icono={Send} rotulo="Mandar a Telegram" ayuda={AYUDA_TELEGRAM} apagado={!prendido(aj, "telegram") || !alguno}>
                        {interruptor("telegram", "Mandar a Telegram")}
                    </Fila>
                </ul>
            </div>
            {!puede && <p className="mt-2 text-[11.5px] text-muted-foreground">Para cambiarlos hace falta el permiso «Editar dispositivos».</p>}
        </div>
    );
}

type Posicion = "igual" | "si" | "no";

export function AvisosArea({ areaId, nombre, abierto, onCerrar }: { areaId: string; nombre: string; abierto: boolean; onCerrar: () => void }) {
    const [pos, setPos] = useState<Partial<Record<ClaveAviso | "telegram", Posicion>>>({});
    const [aplicando, setAplicando] = useState(false);
    useEffect(() => { if (abierto) setPos({}); }, [abierto]);
    const cambio: AjusteAvisos = Object.fromEntries(Object.entries(pos).filter(([, p]) => p && p !== "igual").map(([k, p]) => [k, p === "si"]));
    const n = Object.keys(cambio).length;

    const aplicar = async () => {
        setAplicando(true);
        try {
            const r = await aplicarAvisosArea(areaId, cambio);
            toast.success({ title: `Avisos aplicados a ${r.equipos} ${r.equipos === 1 ? "equipo" : "equipos"}`, description: `«${nombre}» y sus sub-áreas.` });
            onCerrar();
        } catch (e: any) { toast.error({ title: "No se pudo aplicar", description: e?.message }); }
        finally { setAplicando(false); }
    };
    const selector = (clave: ClaveAviso | "telegram") => {
        const v = pos[clave] || "igual";
        return (
            <div role="radiogroup" className="flex h-8 rounded-[8px] bg-muted/60 p-[3px] text-[11.5px] font-semibold shrink-0">
                {(["igual", "si", "no"] as Posicion[]).map((p) => (
                    <button key={p} type="button" role="radio" aria-checked={v === p} onClick={() => setPos({ ...pos, [clave]: p })}
                        className={cn("px-2.5 rounded-[6px] transition-colors", v === p ? "bg-background ring-1 ring-border/60 text-foreground" : "text-muted-foreground hover:text-foreground",
                            v === p && p === "si" && "tono-bien", v === p && p === "no" && "tono-mal")}>
                        {p === "igual" ? "No tocar" : p === "si" ? "Prender" : "Apagar"}
                    </button>
                ))}
            </div>
        );
    };

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o && !aplicando) onCerrar(); }}>
            <CajonContenido ancho="intermedio" titulo="Avisos del área" descripcion={`«${nombre}» y sus sub-áreas: cada equipo toma sólo los avisos que le corresponden por tipo.`}
                pie={<>
                    <Button variant="ghost" onClick={onCerrar} disabled={aplicando}>Cancelar</Button>
                    <Button onClick={aplicar} disabled={!n || aplicando}>{aplicando ? <Loader2 className="animate-spin" /> : <BellRing />}{n ? `Aplicar ${n} ${n === 1 ? "cambio" : "cambios"}` : "Elegí qué cambiar"}</Button>
                </>}>
                <div className="px-6 py-4">
                    <ul className="divide-y divide-border">
                        {AVISOS.map((a) => (
                            <Fila key={a.clave} icono={ICONO[a.clave]} rotulo={a.rotulo} ayuda={a.ayuda} apagado={pos[a.clave] === "no"}>{selector(a.clave)}</Fila>
                        ))}
                    </ul>
                    <div className="mt-3 rounded-[10px] border border-border bg-muted/30 px-3">
                        <ul><Fila icono={Send} rotulo="Mandar a Telegram" ayuda={AYUDA_TELEGRAM} apagado={pos.telegram === "no"}>{selector("telegram")}</Fila></ul>
                    </div>
                    <p className="mt-3 text-[11.5px] text-muted-foreground">Apagar un aviso cierra la alerta que esté abierta de ese tipo. Nada se cambia en los equipos: es lo que OmniAccess vigila y avisa.</p>
                </div>
            </CajonContenido>
        </Cajon>
    );
}
