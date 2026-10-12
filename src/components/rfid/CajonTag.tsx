"use client";

import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import { CreditCard, Hash, UserRound, Home, Loader2, Save, UserMinus, Search, Check, Nfc, Cpu } from "lucide-react";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Campo, Etiqueta, Bloque, Heroe, chipHeroe } from "@/components/ui/cajon-campos";
import { createTag, assignTag, unassignTag } from "@/app/actions/tags";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/**
 * Tag RFID en un cajón: alta (UID + titular opcional) o asignar/cambiar titular de uno
 * existente. Arriba la tarjeta dibujada con su UID; abajo el buscador de personas.
 */
const TT = "tt-tag";

export function CajonTag({ open, onOpenChange, tag, users, onListo }: {
    open: boolean; onOpenChange: (v: boolean) => void; tag?: any | null; users: any[]; onListo: () => void;
}) {
    const esNuevo = !tag;
    const [uid, setUid] = useState("");
    const [userId, setUserId] = useState<string>("");
    const [q, setQ] = useState("");
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (open) { setUid(tag?.value || ""); setUserId(tag?.userId || ""); setQ(""); } }, [open, tag]);

    const titular = users.find((u) => u.id === userId);
    const lista = useMemo(() => {
        const t = q.trim().toLowerCase();
        return [...users].filter((u) => !t || String(u.name).toLowerCase().includes(t) || String(u.unit?.name || "").toLowerCase().includes(t) || String(u.phone || "").includes(t))
            .sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, 200);
    }, [users, q]);

    const guardar = async () => {
        setGuardando(true);
        try {
            if (esNuevo) {
                if (!uid.trim()) { toast.error({ title: "Falta el número del tag" }); return; }
                const r: any = await createTag({ value: uid.trim(), userId: userId || undefined });
                if (r?.success === false) { toast.error({ title: "No se pudo crear", description: r?.error }); return; }
                toast.success({ title: "Tag creado", description: uid.trim() });
            } else if (userId && userId !== tag.userId) {
                const r: any = await assignTag(tag.id, userId);
                if (r?.success === false) { toast.error({ title: "No se pudo asignar", description: r?.error }); return; }
                toast.success({ title: "Tag asignado", description: titular?.name });
            } else if (!userId && tag.userId) {
                await unassignTag(tag.id);
                toast.success({ title: "Tag liberado" });
            }
            onOpenChange(false); onListo();
        } finally { setGuardando(false); }
    };

    return (
        <Cajon open={open} onOpenChange={(v) => !guardando && onOpenChange(v)}>
            <CajonContenido ancho="intermedio" tituloOculto titulo={esNuevo ? "Nuevo tag RFID" : `Tag ${tag?.value}`} descripcion="Tarjeta o llavero RFID y a quién pertenece"
                pie={<div className="flex items-center gap-2 w-full">
                    {!esNuevo && tag?.userId && <Button variant="ghost" onClick={() => setUserId("")} className="gap-1.5 text-red-500"><UserMinus size={15} /> Liberar</Button>}
                    <span className="flex-1" />
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
                    <Button onClick={guardar} disabled={guardando || (esNuevo && !uid.trim())} className="gap-1.5">{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {esNuevo ? "Crear tag" : "Guardar"}</Button>
                </div>}>
                <Heroe titulo={esNuevo ? "Nuevo tag RFID" : "Tag RFID"} subtitulo={titular ? `Asignado a ${titular.name}` : "Sin asignar"}
                    chips={<>{titular?.unit?.name && <span className={chipHeroe}><Home size={11} /> {titular.unit.name}</span>}<span className={cn(chipHeroe, titular ? "!bg-emerald-600/80" : "!bg-sky-600/70")}>{titular ? "Asignado" : "Disponible"}</span></>}>
                    {/* La tarjeta */}
                    <div className="flex justify-center mt-1">
                        <div className="relative w-[300px] h-[120px] rounded-2xl overflow-hidden shadow-[0_14px_34px_rgba(0,0,0,0.55)] bg-[linear-gradient(135deg,#10b981_0%,#047857_45%,#064e3b_100%)] ring-1 ring-white/20">
                            <span className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/10" />
                            <span className="absolute left-4 top-4 w-10 h-8 rounded-md bg-gradient-to-br from-amber-200 to-amber-500 ring-1 ring-black/10 grid place-items-center"><Cpu size={16} className="text-amber-900/60" /></span>
                            <Nfc size={22} className="absolute right-4 top-4 text-white/80" />
                            <div className="absolute left-4 bottom-3 right-4">
                                <div className="text-[9px] uppercase tracking-[0.25em] text-white/70">UID</div>
                                <div className="font-mono text-[20px] font-bold tracking-[0.12em] text-white truncate">{uid || "— — — —"}</div>
                            </div>
                        </div>
                    </div>
                </Heroe>

                {esNuevo && (
                    <Bloque titulo="Tag" icono={CreditCard} tt={TT} ayuda="El número que lee la lectora al acercar la tarjeta.">
                        <Campo etiqueta="Número de tag / UID" icono={Hash} value={uid} onChange={(v) => setUid(v.replace(/\s/g, ""))} placeholder="1234567890" mono autoFocus tt={TT}
                            ayuda="Tal como lo informa la lectora o está impreso en la tarjeta. Ej.: 1234567890 (decimal) o 0A1B2C3D (hexa). Acercá la tarjeta a una lectora y copiá el número del evento." />
                    </Bloque>
                )}

                <Bloque titulo="Titular" icono={UserRound} tt={TT} ayuda="A quién pertenece. Pasa por las lectoras con los permisos y grupos de esa persona.">
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, lote o teléfono. Ej.: Pérez, G18"
                            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] outline-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]" />
                    </div>
                    <div className="rounded-xl border border-border overflow-hidden max-h-[42vh] overflow-y-auto divide-y divide-border/50">
                        <button type="button" onClick={() => setUserId("")} className={cn("w-full flex items-center gap-3 px-3 py-2.5 text-left", !userId ? "bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "hover:bg-accent/50")}>
                            <span className="h-8 w-8 rounded-full bg-muted grid place-items-center text-muted-foreground"><CreditCard size={14} /></span>
                            <span className="flex-1 text-[12.5px] text-muted-foreground">Sin asignar (queda disponible)</span>
                            {!userId && <Check size={15} className="text-[var(--accion)]" />}
                        </button>
                        {lista.map((u) => (
                            <button key={u.id} type="button" onClick={() => setUserId(u.id)} className={cn("w-full flex items-center gap-3 px-3 py-2 text-left transition-colors", userId === u.id ? "bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "hover:bg-accent/50")}>
                                <span className="h-8 w-8 rounded-full bg-indigo-500/10 text-indigo-500 grid place-items-center text-[12px] font-bold">{String(u.name || "?").split(/\s+/).slice(0, 2).map((p: string) => p[0]).join("").toUpperCase()}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[13px] font-semibold truncate">{u.name}</span>
                                    <span className="block text-[11px] text-muted-foreground truncate">{[u.unit?.name, u.phone, u.email].filter(Boolean).join(" · ") || "—"}</span>
                                </span>
                                {userId === u.id && <Check size={15} className="text-[var(--accion)]" />}
                            </button>
                        ))}
                    </div>
                    <Etiqueta texto={`${lista.length} personas${q ? " coinciden" : ""}`} tt={TT} />
                </Bloque>
                <Tooltip id={TT} place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}
