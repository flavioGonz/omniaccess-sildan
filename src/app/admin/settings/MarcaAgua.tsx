"use client";

/**
 * Ajustes › Video del evento › Logo en WhatsApp: el logo de OmniAccess sobre la foto de una
 * alerta y sobre el clip que un operador manda a mano. Las descargas no lo llevan (son
 * evidencia: salen como las entrega el grabador). Se muestra cómo queda, no se describe.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { sileo as toast } from "sileo";
import { Switch } from "@/components/ui/switch";
import { getSetting, updateSetting } from "@/app/actions/settings";
import { AJUSTE_MARCA_AGUA, ARCHIVO_MARCA_AGUA } from "@/lib/clips";

export default function MarcaAgua() {
    const [on, setOn] = useState(true);
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { getSetting(AJUSTE_MARCA_AGUA).then((s: any) => setOn(s?.value !== "false")).catch(() => { }).finally(() => setCargando(false)); }, []);
    const cambiar = async (v: boolean) => {
        setOn(v); setGuardando(true);
        try { await updateSetting(AJUSTE_MARCA_AGUA, v ? "true" : "false"); toast.success({ title: v ? "Logo activado" : "Logo desactivado" }); }
        catch (e: any) { setOn(!v); toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };
    return (
        <div className="rounded-[10px] border border-border bg-card p-5 max-w-xl space-y-4">
            <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold text-foreground">Logo en lo que sale por WhatsApp</div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">La foto de cada alerta y el clip que se manda desde la grabación llevan el logo de OmniAccess abajo a la derecha. Las descargas salen sin logo, tal cual las entrega el grabador.</p>
                </div>
                {cargando ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : <Switch checked={on} onCheckedChange={cambiar} disabled={guardando} aria-label="Logo en WhatsApp" />}
            </div>
            {/* Cómo queda: el mismo archivo que usan la foto y el video, sobre un fondo claro y uno oscuro. */}
            <div className="grid grid-cols-2 gap-3">
                {["bg-[linear-gradient(135deg,#cfd8dc,#eef2f3)]", "bg-[linear-gradient(135deg,#1f2a1f,#3a4a36)]"].map((fondo) => (
                    <div key={fondo} className={`relative h-20 rounded-[6px] border border-border overflow-hidden ${fondo}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/${ARCHIVO_MARCA_AGUA}`} alt="" className={`absolute right-2 bottom-2 w-[45%] transition-opacity ${on ? "opacity-100" : "opacity-0"}`} />
                    </div>
                ))}
            </div>
        </div>
    );
}
