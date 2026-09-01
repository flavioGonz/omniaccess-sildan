"use client";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Copy, ExternalLink, Info, Zap, ShieldCheck, Activity } from "lucide-react";
import { useState, useEffect } from "react";
import { sileo as toast } from "sileo";
import { Badge } from "./ui/badge";

interface AkuvoxActionUrlDialogProps {
    device: any;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AkuvoxActionUrlDialog({ device, open, onOpenChange }: AkuvoxActionUrlDialogProps) {
    const [copied, setCopied] = useState<string | null>(null);
    const [serverIp, setServerIp] = useState("");

    useEffect(() => {
        if (typeof window !== "undefined") {
            setServerIp(window.location.hostname);
        }
    }, []);

    const baseUrl = `http://${serverIp}:10000/api/webhooks/akuvox`;

    const RECOMMENDATIONS = [
        {
            event: "Valid Face",
            desc: "Se dispara cuando un rostro es reconocido correctamente.",
            url: `${baseUrl}?event=face_valid&mac=$mac&user=$user_name&userid=$userid&FaceUrl=$FaceUrl&PicUrl=$pic_url&time=$time`,
            variable: "$user_name, $userid, $FaceUrl, $pic_url"
        },
        {
            event: "Invalid Face",
            desc: "Se dispara al fallar el reconocimiento facial.",
            url: `${baseUrl}?event=face_invalid&mac=$mac&FaceUrl=$FaceUrl&PicUrl=$pic_url&time=$time`,
            variable: "$FaceUrl, $pic_url"
        },
        {
            event: "Valid Card",
            desc: "Se dispara al pasar una tarjeta RFID válida.",
            url: `${baseUrl}?event=card_valid&mac=$mac&card=$card_sn&userid=$userid&user=$user_name&time=$time`,
            variable: "$card_sn, $userid"
        },
        {
            event: "Invalid Card",
            desc: "Se dispara al pasar una tarjeta RFID no registrada.",
            url: `${baseUrl}?event=card_invalid&mac=$mac&card=$card_sn&time=$time`,
            variable: "$card_sn"
        },
        {
            event: "Valid PIN",
            desc: "Se dispara al ingresar un código PIN válido.",
            url: `${baseUrl}?event=code_valid&mac=$mac&code=$code&userid=$userid&time=$time`,
            variable: "$code, $userid"
        },
        {
            event: "QR Code",
            desc: "Se dispara al escanear un código QR válido (A02/R29/X91x).",
            url: `${baseUrl}?event=qr_valid&mac=$mac&qrcode=$qrcode&time=$time`,
            variable: "$qrcode"
        },
        {
            event: "Relay Output",
            desc: "Feedback de apertura (Relé activado). Útil para estado en tiempo real.",
            url: `${baseUrl}?event=relay_open&mac=$mac&relay=$relay_id&time=$time`,
            variable: "$relay_id"
        },
        {
            event: "Sensor Input",
            desc: "Monitoreo de sensores magnéticos o botones persistentes.",
            url: `${baseUrl}?event=input_open&mac=$mac&input=$input_id&time=$time`,
            variable: "$input_id"
        },
        {
            event: "Call Events",
            desc: "Reporta cuando alguien presiona el botón de llamada.",
            url: `${baseUrl}?event=call_start&mac=$mac&remote=$remote&time=$time`,
            variable: "$remote"
        },
        {
            event: "System Boot",
            desc: "Reporta cuando el equipo se reinicia o completa su carga.",
            url: `${baseUrl}?event=boot&mac=$mac&model=$model&firmware=$firmware&time=$time`,
            variable: "$model, $firmware"
        }
    ];

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopied(id);
        toast.success({ title: "URL copiada al portapapeles" });
        setTimeout(() => setCopied(null), 2000);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl bg-card border-border p-0 overflow-hidden shadow-lg">
                <div className="flex flex-col h-[700px]">
                    {/* Header */}
                    <div className="p-8 border-b border-border bg-gradient-to-r from-blue-600/10 to-indigo-600/10">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center text-foreground shadow-xl shadow-blue-500/20">
                                <Zap size={24} />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-bold text-foreground uppercase tracking-tighter">
                                    Configurador de Action URLs
                                </DialogTitle>
                                <DialogDescription className="text-blue-400 font-bold text-[10px] uppercase tracking-widest mt-1">
                                    Akuvox Universal Webhook Logic
                                </DialogDescription>
                            </div>
                        </div>
                        <div className="bg-card/50 p-4 rounded-xl border border-border flex items-start gap-4">
                            <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400">
                                <Activity size={20} className="animate-pulse" />
                            </div>
                            <div>
                                <p className="text-xs text-foreground font-bold uppercase tracking-widest mb-1">Reporte en Tiempo Real</p>
                                <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                                    Al configurar estas URLs, los eventos se reportarán <span className="text-emerald-400 font-bold">EN VIVO</span>
                                    dentro del apartado de <span className="text-foreground font-bold italic">Arquitectura de Hardware</span>.
                                    Podrás ver las aperturas y los nombres de las personas al instante en la lista de dispositivos.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-hidden">
                        <ScrollArea className="h-full p-8 px-10">
                            <div className="space-y-6 pb-8">
                                {RECOMMENDATIONS.map((item, idx) => (
                                    <div key={idx} className="group bg-card/30 border border-border hover:border-blue-500/30 rounded-2xl p-6 transition-all duration-300">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                <Badge className="bg-blue-600/20 text-blue-400 border-none font-bold px-3 py-1 text-[10px] uppercase">
                                                    {item.event}
                                                </Badge>
                                                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider italic">
                                                    Variable: {item.variable}
                                                </span>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => copyToClipboard(item.url, item.event)}
                                                className="h-8 rounded-lg bg-muted hover:bg-blue-600 hover:text-foreground text-muted-foreground transition-all gap-2"
                                            >
                                                {copied === item.event ? <Check size={14} /> : <Copy size={14} />}
                                                <span className="text-[9px] font-bold uppercase">Copiar URL</span>
                                            </Button>
                                        </div>
                                        <p className="text-sm text-foreground font-bold mb-4">{item.desc}</p>
                                        <div className="bg-black/50 p-4 rounded-xl border border-border font-mono text-[11px] text-blue-300/80 break-all leading-relaxed relative group-hover:bg-black/80 transition-all">
                                            {item.url}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Footer */}
                    <div className="p-6 bg-card border-t border-border flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                <ShieldCheck size={18} />
                            </div>
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                Servidor Webhook listo en puerto 10000
                            </span>
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            className="h-10 rounded-xl border-border text-muted-foreground hover:bg-muted hover:text-foreground font-bold uppercase text-[10px] tracking-widest"
                        >
                            Finalizar Configuración
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
