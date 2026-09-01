"use client";

import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldAlert, Camera, Loader2, UserPlus, CheckCircle2 } from "lucide-react";
import { registerFace } from "@/app/actions/users";
import { syncFaceToAllDevicesAction } from "@/app/actions/face-sync";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import Image from "next/image";

interface AddBlacklistModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function AddBlacklistModal({ isOpen, onClose, onSuccess }: AddBlacklistModalProps) {
    const [loading, setLoading] = useState(false);
    const [syncStatus, setSyncStatus] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [dni, setDni] = useState("");
    const [reason, setReason] = useState("");
    const [photo, setPhoto] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setPhoto(file);
            const reader = new FileReader();
            reader.onloadend = () => setPreview(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !photo) {
            toast.error({ title: "Nombre y Foto son requeridos" });
            return;
        }

        setLoading(true);
        setSyncStatus("GUARDANDO REGISTRO...");

        try {
            const formData = new FormData();
            formData.set("name", name);
            formData.set("dni", dni || `MAN-${Date.now()}`);
            formData.set("isBlacklisted", "true");
            formData.set("reason", reason);
            formData.set("photo", photo);
            formData.set("creator", "Panel Administrativo");

            const user = await registerFace(formData);

            setSyncStatus("SINCRONIZANDO CAMARAS...");
            const syncRes = await syncFaceToAllDevicesAction(user.id);

            if (syncRes.success) {
                toast.success({
                    title: "AGREGADO Y SINCRONIZADO",
                    description: `${name} ahora está en Lista Negra y cámaras actualizadas.`
                });
                onSuccess();
                onClose();
            } else {
                toast.show({
                    title: "REGISTRADO CON ERRORES",
                    description: "Usuario creado pero falló la sincronización con algunas cámaras."
                });
                onSuccess();
                onClose();
            }
        } catch (err: any) {
            toast.error({ title: "Error al registrar: " + err.message });
        } finally {
            setLoading(false);
            setSyncStatus(null);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="bg-card border border-border rounded-2xl w-full max-w-xl overflow-hidden shadow-lg"
                    >
                        {/* Header */}
                        <div className="p-6 border-b border-border flex items-center justify-between bg-gradient-to-r from-red-600/10 to-transparent">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-red-600/20 flex items-center justify-center text-red-500">
                                    <ShieldAlert size={20} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold uppercase tracking-tight">Agregar a Lista Negra</h2>
                                    <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest">Protocolo de Restricción Biométrica</p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="p-8 space-y-6">
                            <div className="flex gap-8">
                                {/* Photo Upload */}
                                <div className="space-y-4">
                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-40 h-40 rounded-2xl border-2 border-dashed border-border hover:border-red-600/50 bg-foreground/10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all overflow-hidden relative group"
                                    >
                                        {preview ? (
                                            <Image src={preview} alt="Preview" fill className="object-cover" />
                                        ) : (
                                            <>
                                                <Camera className="text-muted-foreground group-hover:text-red-500 transition-colors" size={32} />
                                                <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">Subir Rostro</span>
                                            </>
                                        )}
                                    </div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleFileChange}
                                    />
                                </div>

                                {/* Inputs */}
                                <div className="flex-1 space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Nombre Completo</label>
                                        <input
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            className="w-full h-11 bg-foreground/10 border border-border rounded-xl px-4 text-sm outline-none focus:border-red-600/50 transition-all font-bold"
                                            placeholder="EJ: JUAN PEREZ"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">DNI / ID Interno (Opcional)</label>
                                        <input
                                            value={dni}
                                            onChange={(e) => setDni(e.target.value)}
                                            className="w-full h-11 bg-foreground/10 border border-border rounded-xl px-4 text-sm outline-none focus:border-red-600/50 transition-all font-bold"
                                            placeholder="EJ: 12345678"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Motivo de la Restricción</label>
                                <textarea
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    className="w-full h-24 bg-foreground/10 border border-border rounded-xl p-4 text-sm outline-none focus:border-red-600/50 transition-all font-medium resize-none"
                                    placeholder="Describa el motivo por el cual este sujeto debe ser restringido..."
                                />
                            </div>

                            <div className="pt-4 flex gap-4">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 h-14 rounded-xl border border-border text-[10px] font-bold uppercase tracking-widest hover:bg-accent transition-all"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="flex-[2] h-14 bg-red-600 hover:bg-red-700 text-foreground rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all shadow-xl shadow-red-600/20 flex items-center justify-center gap-3 disabled:opacity-50"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="animate-spin" size={16} />
                                            {syncStatus}
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 size={16} />
                                            Confirmar e Identificar
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
