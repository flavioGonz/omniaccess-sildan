"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { leerDestinoEventos, guardarDestinoEventos } from "@/app/actions/destino-eventos";

/**
 * Decir a qué IP y puerto le mandan sus eventos las cámaras (el destino que se les escribe como
 * servidor de alarmas). Lo usan la importación de un NVR y el cajón «Servidor de alarma» del
 * monitor de intrusión: en los dos casos, si falta, se dice ahí mismo y se sigue.
 */
export function DestinoEventos({ alGuardar, textoBoton = "Guardar", ocupado }: { alGuardar?: (destino: string) => void; textoBoton?: string; ocupado?: boolean }) {
    const [ip, setIp] = useState("");
    const [puerto, setPuerto] = useState("10000");
    const [sugeridas, setSugeridas] = useState<string[]>([]);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => {
        leerDestinoEventos().then((d) => { setSugeridas(d.sugeridas); setPuerto(d.puerto); setIp((v) => v || d.ip || d.sugeridas[0] || ""); }).catch(() => { });
    }, []);
    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await guardarDestinoEventos(ip, puerto);
            if (!r.ok) { toast.error({ title: "No se pudo guardar", description: r.error }); return; }
            alGuardar?.(`${ip.trim()}:${puerto}`);
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };
    const campo = "h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] font-mono outline-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]";
    return (
        <div className="flex flex-wrap items-end gap-2">
            <label className="block flex-1 min-w-[170px]">
                <span className="block text-[12px] font-semibold mb-1" title="La dirección de este servidor vista desde la red de las cámaras. Si están en otra red (VPN, otro barrio), la que enruta hasta acá.">IP de OmniAccess para las cámaras</span>
                <input value={ip} onChange={(e) => setIp(e.target.value)} list="ips-servidor-omni" placeholder="172.26.20.200" className={campo} />
                <datalist id="ips-servidor-omni">{sugeridas.map((x) => <option key={x} value={x} />)}</datalist>
            </label>
            <label className="block w-[92px]">
                <span className="block text-[12px] font-semibold mb-1" title="El del receptor de eventos. Por defecto 10000.">Puerto</span>
                <input value={puerto} onChange={(e) => setPuerto(e.target.value.replace(/\D/g, "").slice(0, 5))} className={campo} />
            </label>
            <Button onClick={guardar} disabled={!ip.trim() || guardando || ocupado} className="h-10 gap-1.5">
                {guardando || ocupado ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {textoBoton}
            </Button>
        </div>
    );
}
