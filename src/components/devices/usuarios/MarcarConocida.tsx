"use client";
/**
 * Marcar como conocida una cuenta no gestionada o una IP de origen. No toca el equipo: sólo cierra su
 * aviso y deja en Auditoría quién lo reconoció y por qué (openspec usuarios-de-equipos).
 */
import { useEffect, useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sileo as toast } from "sileo";
import { marcarConocida } from "@/components/devices/usuarios/datos";

export type QueMarcar = { tipo: "cuenta"; cuentaId: string; nombre: string; equipo: string } | { tipo: "ip"; ip: string; cuenta?: string; equipo?: string };

export function MarcarConocida({ que, onCerrar, onHecho }: { que: QueMarcar | null; onCerrar: () => void; onHecho: () => void }) {
    const [nombre, setNombre] = useState("");
    const [motivo, setMotivo] = useState("");
    const [enviando, setEnviando] = useState(false);
    useEffect(() => { setNombre(""); setMotivo(""); }, [que]);
    if (!que) return null;
    const esIp = que.tipo === "ip";
    const listo = esIp ? !!nombre.trim() : !!motivo.trim();
    const enviar = async () => {
        setEnviando(true);
        try {
            await marcarConocida(esIp ? { tipo: "ip", ip: que.ip, nombre, motivo } : { tipo: "cuenta", cuentaId: que.cuentaId, conocida: true, motivo });
            toast.success({ title: esIp ? `IP ${que.ip} marcada como conocida` : `Cuenta ${que.nombre} marcada como conocida` });
            onHecho(); onCerrar();
        } catch (e: any) { toast.error({ title: "No se pudo marcar", description: e?.message }); }
        finally { setEnviando(false); }
    };
    return (
        <Dialog open onOpenChange={(v) => { if (!v) onCerrar(); }}>
            <DialogContent className="sm:max-w-[460px]">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-full chip-bien border"><ShieldCheck size={18} /></span>
                        <div>
                            <DialogTitle>{esIp ? `Marcar ${que.ip} como conocida` : `Reconocer la cuenta ${que.nombre}`}</DialogTitle>
                            <DialogDescription>
                                {esIp
                                    ? "Las sesiones desde esta IP dejan de avisar, en todos los equipos. No se cambia nada en ningún equipo."
                                    : `La cuenta sigue en ${que.equipo} tal como está: sólo se cierra su aviso. Para borrarla, más adelante, va a haber una acción aparte.`}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>
                <div className="space-y-3">
                    {esIp && (
                        <label className="block space-y-1.5">
                            <span className="text-[12px] font-semibold">Qué es esa IP</span>
                            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="PC de la guardia" maxLength={60} autoFocus />
                        </label>
                    )}
                    <label className="block space-y-1.5">
                        <span className="text-[12px] font-semibold">Por qué {esIp ? "(opcional)" : "es conocida"}</span>
                        <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={esIp ? "La usa el técnico de turno" : "Cuenta del instalador del NVR"} maxLength={200} autoFocus={!esIp} />
                    </label>
                    <p className="text-[11.5px] text-muted-foreground">Queda en Auditoría con tu nombre.</p>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
                    <Button onClick={enviar} disabled={!listo || enviando}>{enviando && <Loader2 className="animate-spin" />}Marcar como conocida</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
