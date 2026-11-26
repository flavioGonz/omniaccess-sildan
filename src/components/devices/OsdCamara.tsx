"use client";

import { useEffect, useState } from "react";
import { MonitorSmartphone, Save, Check, EyeOff, Copy } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { Etiqueta } from "@/components/devices/CajonDispositivo";

/**
 * El OSD de la cámara al lado del nombre (26/11). Nico: «un campo a la derecha del nombre: OSD, que
 * lea el OSD de la cámara, con un mini botón de guardar para modificarlo».
 *
 * Son dos nombres distintos y conviene verlos juntos: el de OmniAccess lo ve el panel; el OSD queda
 * quemado en cada grabación y en cada foto que se exporta. El botón guarda SÓLO el OSD, en la
 * cámara, en el momento (no espera a «Guardar cambios»), y relee para confirmar lo que quedó.
 */
export function OsdCamara({ deviceId, nombre }: { deviceId: string; nombre: string }) {
    const [leido, setLeido] = useState<{ ok: boolean; texto?: string | null; visible?: boolean | null; max?: number; error?: string } | null>(null);
    const [texto, setTexto] = useState("");
    const [guardando, setGuardando] = useState(false);
    useEffect(() => {
        let vivo = true;
        setLeido(null);
        fetch(`/api/devices/osd?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" }).then((r) => r.json())
            .then((j) => { if (!vivo) return; setLeido(j); if (j?.ok) setTexto(j.texto || ""); })
            .catch(() => { if (vivo) setLeido({ ok: false, error: "Sin conexión con el servidor." }); });
        return () => { vivo = false; };
    }, [deviceId]);

    const max = leido?.max || 32;
    const cambio = !!leido?.ok && texto.trim() !== (leido.texto || "");
    const guardar = async () => {
        if (!cambio || guardando) return;
        setGuardando(true);
        try {
            const r = await fetch(`/api/devices/osd?deviceId=${encodeURIComponent(deviceId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: texto.trim() }) }).then((x) => x.json());
            if (r?.ok) { setLeido(r); setTexto(r.texto || ""); toast.success({ title: "OSD cambiado en la cámara", description: r.texto }); }
            else toast.error({ title: "No se cambió el OSD", description: r?.error || "Sin respuesta" });
        } catch { toast.error({ title: "No se cambió el OSD", description: "Sin conexión con el servidor." }); }
        finally { setGuardando(false); }
    };

    return (
        <div>
            <Etiqueta texto="OSD" ayuda="El texto que la cámara escribe sobre su video: queda en cada grabación y en cada foto exportada. Se lee de la cámara al abrir la ficha; el botón lo cambia en la cámara en el momento." />
            <span className="relative block">
                <MonitorSmartphone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input value={leido?.ok ? texto : ""} onChange={(e) => setTexto(e.target.value.slice(0, max))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardar(); } }}
                    disabled={!leido?.ok || guardando} placeholder={!leido ? "Leyendo la cámara…" : leido.ok ? "Sin OSD" : "No se pudo leer"}
                    title={leido && !leido.ok ? leido.error : undefined}
                    className={cn("h-10 w-full rounded-lg border border-border bg-background pl-9 pr-[4.5rem] text-[13px] outline-none transition-shadow placeholder:text-muted-foreground/60 disabled:opacity-70",
                        "focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]")} />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    {leido?.ok && texto.trim() !== nombre.trim() && nombre.trim() && nombre.trim().length <= max && (
                        <button type="button" onClick={() => setTexto(nombre.trim())} title="Usar el nombre de OmniAccess" aria-label="Usar el nombre de OmniAccess"
                            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><Copy size={13} /></button>
                    )}
                    <button type="button" onClick={guardar} disabled={!cambio || guardando} title={cambio ? "Guardar el OSD en la cámara" : "Sin cambios"} aria-label="Guardar el OSD en la cámara"
                        className={cn("grid h-7 w-7 place-items-center rounded-md transition-colors", cambio ? "bg-[var(--accion)] text-white hover:opacity-90" : "text-muted-foreground/50")}>
                        {guardando ? <Loader2 size={13} className="animate-spin" /> : cambio ? <Save size={13} /> : <Check size={13} />}
                    </button>
                </span>
            </span>
            {leido && !leido.ok && <p className="mt-1 text-[11px] tono-aviso truncate" title={leido.error}>{leido.error}</p>}
            {leido?.ok && leido.visible === false && <p className="mt-1 text-[11px] text-muted-foreground inline-flex items-center gap-1"><EyeOff size={11} /> La cámara lo tiene oculto: no se dibuja en el video.</p>}
            {leido?.ok && cambio && <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{texto.trim().length}/{max} · Enter o el botón lo guardan en la cámara</p>}
        </div>
    );
}
