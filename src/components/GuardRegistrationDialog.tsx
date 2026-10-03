"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ClipboardPlus, Home, UserPlus, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { submitRegistrationSuggestion } from "@/app/actions/registrations";

/** Botón + modal para que el guardia cree una SOLICITUD de registro (casa/lote o persona)
 * desde la tablet. Queda PENDIENTE para que un administrador la apruebe. */
export function GuardRegistrationDialog({ guardName, className, onOpen }: { guardName: string; className?: string; onOpen?: () => void }) {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<"HOUSE" | "PERSON">("PERSON");
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState("");
    // Casa/Lote
    const [houseNumber, setHouseNumber] = useState("");
    const [houseName, setHouseName] = useState("");
    const [address, setAddress] = useState("");
    // Persona
    const [name, setName] = useState("");
    const [dni, setDni] = useState("");
    const [phone, setPhone] = useState("");
    const [house, setHouse] = useState("");

    const reset = () => {
        setDone(false); setError(""); setSaving(false);
        setHouseNumber(""); setHouseName(""); setAddress("");
        setName(""); setDni(""); setPhone(""); setHouse("");
    };

    const openDialog = () => { reset(); setTab("PERSON"); setOpen(true); onOpen?.(); };

    const submit = async () => {
        setError("");
        const data = tab === "HOUSE"
            ? { houseNumber: houseNumber.trim(), name: houseName.trim() || undefined, address: address.trim() || undefined }
            : { name: name.trim(), dni: dni.trim() || undefined, phone: phone.trim() || undefined, house: house.trim() || undefined };
        if (tab === "HOUSE" && !houseNumber.trim()) { setError("Ingresá el número de casa/lote."); return; }
        if (tab === "PERSON" && !name.trim()) { setError("Ingresá el nombre de la persona."); return; }
        setSaving(true);
        try {
            const r = await submitRegistrationSuggestion(tab, data, guardName || "Guardia");
            if (!r.success) { setError((r as any).error || "No se pudo enviar."); return; }
            setDone(true);
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setSaving(false);
        }
    };

    const field = "h-12 rounded-xl text-base";

    return (
        <>
            <button
                onClick={openDialog}
                className={cn("flex items-center gap-3 p-4 hover:bg-slate-50 rounded-2xl transition-colors text-black w-full text-left", className)}
            >
                <ClipboardPlus size={20} /> <span className="text-xs font-bold uppercase tracking-wider">Solicitud de registro</span>
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ClipboardPlus size={18} className="text-indigo-500" /> Nueva solicitud de registro
                        </DialogTitle>
                        <DialogDescription>
                            Enviá una solicitud para agregar una casa/lote o una persona. Un administrador la revisa y aprueba.
                        </DialogDescription>
                    </DialogHeader>

                    {done ? (
                        <div className="flex flex-col items-center gap-3 py-6 text-center">
                            <div className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15">
                                <CheckCircle2 className="text-emerald-500" size={38} />
                            </div>
                            <div className="text-lg font-bold text-emerald-600">Solicitud enviada</div>
                            <p className="text-sm text-muted-foreground">Quedó pendiente de aprobación por un administrador.</p>
                            <div className="flex gap-2 pt-2">
                                <Button variant="outline" onClick={() => { reset(); }}>Cargar otra</Button>
                                <Button onClick={() => setOpen(false)}>Listo</Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Selector tipo */}
                            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                                <button onClick={() => setTab("PERSON")} className={cn("flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-colors", tab === "PERSON" ? "bg-white shadow text-black" : "text-slate-500")}>
                                    <UserPlus size={16} /> Persona
                                </button>
                                <button onClick={() => setTab("HOUSE")} className={cn("flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-colors", tab === "HOUSE" ? "bg-white shadow text-black" : "text-slate-500")}>
                                    <Home size={16} /> Casa / Lote
                                </button>
                            </div>

                            {tab === "PERSON" ? (
                                <div className="space-y-3">
                                    <Input className={field} placeholder="Nombre y apellido *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                                    <div className="grid grid-cols-2 gap-3">
                                        <Input className={field} placeholder="Documento" value={dni} onChange={(e) => setDni(e.target.value)} />
                                        <Input className={field} placeholder="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
                                    </div>
                                    <Input className={field} placeholder="Casa / Lote (referencia)" value={house} onChange={(e) => setHouse(e.target.value)} />
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <Input className={field} placeholder="Número de casa / lote *" value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} autoFocus />
                                    <Input className={field} placeholder="Nombre (opcional)" value={houseName} onChange={(e) => setHouseName(e.target.value)} />
                                    <Input className={field} placeholder="Dirección (opcional)" value={address} onChange={(e) => setAddress(e.target.value)} />
                                </div>
                            )}

                            {error && <p className="text-sm text-red-500">{error}</p>}

                            <div className="flex justify-end gap-2 pt-1">
                                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                                <Button onClick={submit} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700">
                                    {saving ? <Loader2 className="mr-1 animate-spin" size={16} /> : <ClipboardPlus className="mr-1" size={16} />}
                                    Enviar solicitud
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
