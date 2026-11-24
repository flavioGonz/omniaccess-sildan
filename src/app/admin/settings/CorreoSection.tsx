"use client";

import { useEffect, useState } from "react";
import { Mail, Send } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { getSetting, updateSetting } from "@/app/actions/settings";

/**
 * El servidor de correo.
 *
 * No existía: `nodemailer` estaba instalado y nadie lo usaba. Hizo falta para el censo con clave
 * por lote (18/11), que manda un correo por lote con copia a la administración.
 *
 * `SMTP_PASSWORD` lleva esa palabra a propósito: `lib/ajustes-secretos` marca como secreta toda
 * clave que la tenga, así que sólo la lee quien tiene permiso de Ajustes.
 */
const CAMPOS = [
    { k: "SMTP_HOST", r: "Servidor", ph: "smtp.gmail.com", ayuda: "El SMTP del proveedor de correo del barrio." },
    { k: "SMTP_PORT", r: "Puerto", ph: "587", ayuda: "587 con STARTTLS, 465 con TLS desde el saludo." },
    { k: "SMTP_USUARIO", r: "Usuario", ph: "censo@barrio.com", ayuda: "" },
    { k: "SMTP_PASSWORD", r: "Clave", ph: "", ayuda: "Queda guardada y sólo la lee quien tiene Ajustes.", clave: true },
    { k: "SMTP_DESDE", r: "Remitente", ph: "Censo del barrio <censo@barrio.com>", ayuda: "Lo que ve quien recibe." },
    { k: "SMTP_COPIA", r: "Copia a la administración", ph: "administracion@barrio.com", ayuda: "Va en copia de TODO lo que manda el sistema. Es la prueba de que el correo salió." },
] as const;

export default function CorreoSection() {
    const [v, setV] = useState<Record<string, string>>({});
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [probando, setProbando] = useState(false);

    useEffect(() => {
        Promise.all(CAMPOS.map(async (c) => [c.k, (await getSetting(c.k).catch(() => null))?.value || ""] as const))
            .then((pares) => setV(Object.fromEntries(pares)))
            .finally(() => setCargando(false));
    }, []);

    async function guardar() {
        setGuardando(true);
        try {
            for (const c of CAMPOS) await updateSetting(c.k, v[c.k] ?? "");
            toast.success({ title: "Guardado" });
        } catch { toast.error({ title: "No se pudo guardar" }); }
        finally { setGuardando(false); }
    }

    async function probar() {
        setProbando(true);
        try {
            const r = await fetch("/api/censo/invitaciones", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "probar" }) });
            const j = await r.json();
            if (r.ok) toast.success({ title: "El servidor de correo contesta", description: "Saludó y aceptó la credencial." });
            else toast.error({ title: "No contestó", description: j?.error });
        } catch { toast.error({ title: "No se pudo probar" }); }
        finally { setProbando(false); }
    }

    if (cargando) return <div className="h-40 grid place-items-center text-muted-foreground"><Loader2 size={18} className="animate-spin" /></div>;

    return (
        <div className="space-y-5 max-w-2xl">
            <section className="space-y-2.5">
                <h3 className="flex items-center gap-2 text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-muted-foreground">
                    <Mail size={12} /> Servidor de correo
                </h3>
                <p className="text-[11px] leading-[1.45] text-muted-foreground">
                    Por acá salen los correos del sistema: hoy, las invitaciones del censo con la clave de cada
                    lote. Lo que se ponga en «copia» va en copia de todos, y es la constancia de que se mandó.
                </p>
            </section>

            <div className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
                {CAMPOS.map((c) => (
                    <label key={c.k} className="flex items-start gap-4 px-4 py-3">
                        <span className="w-[180px] shrink-0 pt-2">
                            <span className="block text-[13px] font-semibold">{c.r}</span>
                            {c.ayuda && <span className="mt-0.5 block text-[11px] leading-[1.4] text-muted-foreground">{c.ayuda}</span>}
                        </span>
                        <input
                            type={"clave" in c && c.clave ? "password" : "text"}
                            autoComplete={"clave" in c && c.clave ? "new-password" : "off"}
                            value={v[c.k] ?? ""} onChange={(e) => setV((p) => ({ ...p, [c.k]: e.target.value }))} placeholder={c.ph}
                            className="h-9 flex-1 min-w-0 rounded-[6px] border border-border bg-background px-2.5 text-[13px] outline-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[var(--accion)]/30" />
                    </label>
                ))}
            </div>

            <div className="flex items-center gap-2">
                <Button onClick={guardar} disabled={guardando}>{guardando ? <Loader2 size={14} className="animate-spin" /> : null} Guardar</Button>
                <Button variant="outline" onClick={probar} disabled={probando || !v.SMTP_HOST}>
                    {probando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Probar la conexión
                </Button>
            </div>
        </div>
    );
}
