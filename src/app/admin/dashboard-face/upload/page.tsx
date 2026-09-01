"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Camera, UserPlus, ShieldAlert, UserCheck, Loader2,
    ChevronLeft, RefreshCw, Upload, Database,
    MessageSquare, Tag, Fingerprint, Star,
    AlertTriangle, ShieldCheck, Zap
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { sileo as toast } from "sileo";
import { registerFace } from "@/app/actions/users";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

export default function UploadFacePage() {
    const router = useRouter();
    const [name, setName] = useState("");
    const [dni, setDni] = useState("");
    const [role, setRole] = useState<'VISITOR' | 'BLACKLISTED' | 'WHITELISTED'>('VISITOR');
    const [reason, setReason] = useState("");
    const [observations, setObservations] = useState("");
    const [photo, setPhoto] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [creator, setCreator] = useState("Admin Sentinel");

    const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setPhoto(file);
            const reader = new FileReader();
            reader.onloadend = () => setPreview(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !photo) {
            toast.error({ title: "Nombre y foto son obligatorios" });
            return;
        }

        setIsSubmitting(true);
        const formData = new FormData();
        formData.append("name", name);
        formData.append("dni", dni);
        formData.append("isBlacklisted", (role === 'BLACKLISTED').toString());
        formData.append("isWhitelisted", (role === 'WHITELISTED').toString());
        formData.append("reason", reason);
        formData.append("observations", observations);
        formData.append("creator", creator);
        formData.append("photo", photo);

        try {
            await registerFace(formData);
            toast.success({ title: "Rostro inscrito correctamente" });
            setName(""); setDni(""); setPhoto(null); setPreview(null); setObservations(""); setReason("");
            router.push('/admin/dashboard-face');
        } catch (e) {
            toast.error({ title: "Fallo crítico en la inscripción" });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white p-8 space-y-8 animate-in fade-in duration-700">
            {/* Tactical Header */}
            <header className="flex items-center gap-6 pb-8 border-b border-border">
                <Link
                    href="/admin/dashboard-face"
                    className="w-12 h-12 rounded-2xl bg-foreground/10 border border-border flex items-center justify-center hover:bg-muted transition-all group shadow-xl"
                >
                    <ChevronLeft className="group-hover:-translate-x-1 transition-transform" />
                </Link>
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-4xl font-bold uppercase tracking-tight leading-none italic">Inscripción Biométrica</h1>
                        <Badge className="bg-blue-600/20 text-blue-500 border-blue-600/30 font-bold">NUEVO EXPEDIENTE</Badge>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-muted-foreground mt-2 flex items-center gap-2">
                        <Database size={12} className="text-[#B20D30]" />
                        Módulo de Registro Centralizado v2.4
                    </p>
                </div>
            </header>

            <form onSubmit={handleRegister} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left: Capture HUD (Lg 5) */}
                <div className="lg:col-span-5 space-y-6">
                    <div className="bg-[#0A0A0A] border border-border rounded-2xl p-8 space-y-8 shadow-lg relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-[#B20D30]/5 blur-[50px] -z-10" />

                        <div className="flex items-center justify-between">
                            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.3em] flex items-center gap-2">
                                <Fingerprint size={14} className="text-[#B20D30]" />
                                Captura Facial Activa
                            </h3>
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                                <span className="text-[8px] font-bold uppercase text-red-500 tracking-widest">Neural Link</span>
                            </div>
                        </div>

                        <div
                            onClick={() => document.getElementById('face-upload')?.click()}
                            className={cn(
                                "w-full aspect-square rounded-2xl bg-black border-2 border-dashed transition-all relative overflow-hidden group/box cursor-pointer",
                                preview ? (role === 'BLACKLISTED' ? "border-red-600/50" : role === 'WHITELISTED' ? "border-emerald-600/50" : "border-border") : "border-border hover:bg-foreground/[0.04]"
                            )}
                        >
                            {preview ? (
                                <>
                                    <Image src={preview} alt="Preview" fill className="object-cover group-hover/box:scale-105 transition-transform duration-[2000ms]" />
                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/box:opacity-100 flex flex-col items-center justify-center transition-all backdrop-blur-sm gap-3">
                                        <RefreshCw className="text-foreground animate-spin-slow" size={32} />
                                        <span className="text-[10px] font-bold uppercase text-foreground tracking-widest">Reemplazar Captura</span>
                                    </div>
                                    {/* Scanning Animation */}
                                    <div className="absolute inset-x-0 h-[2px] bg-red-600/50 top-0 shadow-[0_0_15px_rgba(220,38,38,0.5)] animate-scan-y pointer-events-none" />
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center gap-6">
                                    <div className="w-20 h-20 rounded-3xl bg-foreground/10 flex items-center justify-center text-muted-foreground group-hover/box:text-foreground group-hover/box:scale-110 transition-all border border-border">
                                        <Camera size={38} />
                                    </div>
                                    <div className="text-center px-8">
                                        <p className="text-sm font-bold text-foreground uppercase tracking-widest">Cargar Rostro</p>
                                        <p className="text-[9px] text-muted-foreground font-bold uppercase mt-2 tracking-widest italic leading-relaxed">Arrastra una imagen de alta resolución para un match neural preciso</p>
                                    </div>
                                </div>
                            )}
                        </div>
                        <input id="face-upload" type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />

                        <div className="bg-foreground/[0.04] rounded-3xl p-6 border border-border">
                            <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Requisitos de Calidad</h4>
                            <ul className="space-y-2">
                                <QualityRow label="Iluminación Frontal" checked={!!preview} />
                                <QualityRow label="Rostro Despejado" checked={!!preview} />
                                <QualityRow label="Resolución Min. 480px" checked={!!preview} />
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Right: Metadata Form (Lg 7) */}
                <div className="lg:col-span-7 space-y-6">
                    <div className="bg-[#0A0A0A] border border-border rounded-2xl p-8 space-y-8 shadow-lg h-full flex flex-col">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.3em] flex items-center gap-2">
                                <Tag size={14} className="text-[#B20D30]" />
                                Metadatos del Sujeto
                            </h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Nombre Completo</label>
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Nombre del Sujeto..."
                                    className="h-14 bg-foreground/[0.04] border-border text-foreground rounded-xl px-6 text-sm font-bold uppercase focus:border-[#B20D30]/50 transition-all shadow-inner"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Identificación / DNI</label>
                                <Input
                                    value={dni}
                                    onChange={(e) => setDni(e.target.value)}
                                    placeholder="Nro de Documento..."
                                    className="h-14 bg-foreground/[0.04] border-border text-foreground rounded-xl px-6 text-sm font-bold uppercase focus:border-blue-600/50 transition-all shadow-inner"
                                />
                            </div>
                        </div>

                        {/* Category Selector */}
                        <div className="space-y-4">
                            <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest ml-1 block">Nivel de Seguridad / Categoría</label>
                            <div className="grid grid-cols-3 gap-3">
                                <RoleOption
                                    active={role === 'VISITOR'}
                                    onClick={() => setRole('VISITOR')}
                                    icon={<UserCheck size={18} />}
                                    label="Estándar"
                                    color="emerald"
                                />
                                <RoleOption
                                    active={role === 'WHITELISTED'}
                                    onClick={() => setRole('WHITELISTED')}
                                    icon={<Star size={18} />}
                                    label="Especial"
                                    color="blue"
                                />
                                <RoleOption
                                    active={role === 'BLACKLISTED'}
                                    onClick={() => setRole('BLACKLISTED')}
                                    icon={<ShieldAlert size={18} />}
                                    label="Restringido"
                                    color="red"
                                />
                            </div>
                        </div>

                        {/* Reason Field */}
                        <div className="space-y-2">
                            <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Motivo de Registro</label>
                            <Input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Ej: Historial delictivo, Contratista VIP, etc..."
                                className="h-14 bg-foreground/[0.04] border-border text-foreground rounded-xl px-6 text-xs font-bold uppercase focus:border-red-600/50 transition-all shadow-inner"
                            />
                        </div>

                        {/* Observations */}
                        <div className="space-y-2 flex-1">
                            <div className="flex items-center justify-between ml-1">
                                <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Observaciones Adicionales</label>
                                <MessageSquare size={12} className="text-muted-foreground" />
                            </div>
                            <textarea
                                value={observations}
                                onChange={(e) => setObservations(e.target.value)}
                                placeholder="Detalles técnicos o de comportamiento observados durante el registro..."
                                className="w-full bg-foreground/[0.04] border border-border text-foreground rounded-xl p-6 text-xs font-medium uppercase focus:border-[#B20D30]/50 focus:ring-0 outline-none transition-all resize-none h-40 shadow-inner"
                            />
                        </div>

                        {/* Creator Footer Info */}
                        <div className="flex items-center justify-between p-6 bg-foreground/[0.04] rounded-[1.5rem] border border-border">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neutral-700 to-black flex items-center justify-center text-[10px] font-bold border border-border">A</div>
                                <div>
                                    <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Operador Responsable</p>
                                    <p className="text-[11px] font-bold text-foreground hover:text-[#B20D30] cursor-pointer transition-colors uppercase">{creator}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Hash de Registro</p>
                                <p className="text-[9px] font-mono text-muted-foreground uppercase">SYS-FAC-{(Math.random() * 10000).toFixed(0)}-AX</p>
                            </div>
                        </div>

                        <Button
                            type="submit"
                            disabled={isSubmitting}
                            className={cn(
                                "w-full h-16 rounded-[1.5rem] font-bold uppercase tracking-[0.3em] text-[11px] transition-all flex gap-4 shadow-lg active:scale-95",
                                isSubmitting ? "bg-muted" : (role === 'BLACKLISTED' ? "bg-red-600 hover:bg-red-700" : role === 'WHITELISTED' ? "bg-blue-600 hover:bg-blue-700" : "bg-emerald-600 hover:bg-emerald-700")
                            )}
                        >
                            {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : (
                                <>
                                    <Upload size={20} />
                                    Confirmar y Serializar Rostro
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </form>

            <style jsx global>{`
                @keyframes scan-y {
                    0% { top: 0; opacity: 0.2; }
                    50% { top: 100%; opacity: 0.8; }
                    100% { top: 0; opacity: 0.2; }
                }
                .animate-scan-y {
                    animation: scan-y 4s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}

function RoleOption({ active, onClick, icon, label, color }: { active: boolean, onClick: () => void, icon: any, label: string, color: string }) {
    const colors: any = {
        red: active ? "border-red-600 bg-red-600/20 text-red-500" : "border-border bg-foreground/[0.04] text-muted-foreground hover:border-border hover:text-foreground",
        blue: active ? "border-blue-600 bg-blue-600/20 text-blue-500" : "border-border bg-foreground/[0.04] text-muted-foreground hover:border-border hover:text-foreground",
        emerald: active ? "border-emerald-600 bg-emerald-600/20 text-emerald-500" : "border-border bg-foreground/[0.04] text-muted-foreground hover:border-border hover:text-foreground"
    };

    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "flex-1 p-5 rounded-3xl border transition-all flex flex-col items-center gap-3",
                colors[color]
            )}
        >
            {icon}
            <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
        </button>
    );
}

function QualityRow({ label, checked }: { label: string, checked: boolean }) {
    return (
        <li className="flex items-center justify-between">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
            {checked ? (
                <div className="w-4 h-4 rounded-full bg-emerald-600/20 flex items-center justify-center text-emerald-500">
                    <ShieldCheck size={10} />
                </div>
            ) : (
                <div className="w-1.5 h-1.5 rounded-full bg-muted" />
            )}
        </li>
    );
}

function Badge({ children, className }: { children: React.ReactNode, className?: string }) {
    return (
        <span className={cn("px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest border", className)}>
            {children}
        </span>
    );
}
