"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ShieldAlert, Search, UserPlus, X, Camera,
    ChevronRight, AlertCircle, Trash2, ShieldCheck, Shield,
    Loader2, CameraOff, UserCheck, AlertTriangle, RefreshCw,
    Image as ImageIcon, Fingerprint
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import Image from "next/image";
import { getBlacklist, toggleBlacklist, registerFace, searchUsers } from "@/app/actions/users";
import { searchByPhotoAction } from "@/app/actions/face-verify";
import { getImagePath } from "@/lib/image-path";

export default function FaceSecurityHub() {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<"search" | "blacklist" | "register">("blacklist");
    const [blacklist, setBlacklist] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);

    // Register Form State
    const [regName, setRegName] = useState("");
    const [regDni, setRegDni] = useState("");
    const [regIsBlacklist, setRegIsBlacklist] = useState(true);
    const [regPhoto, setRegPhoto] = useState<File | null>(null);
    const [regPreview, setRegPreview] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Image Search State
    const [isSearchingImg, setIsSearchingImg] = useState(false);
    const [searchImgPreview, setSearchImgPreview] = useState<string | null>(null);
    const [recognizedSubject, setRecognizedSubject] = useState<any>(null);

    useEffect(() => {
        if (isOpen && activeTab === "blacklist") {
            fetchBlacklist();
        }
    }, [isOpen, activeTab]);

    const fetchBlacklist = async () => {
        setLoading(true);
        try {
            const data = await getBlacklist();
            setBlacklist(data);
        } catch (e) {
            console.error(e);
            toast.error({ title: "Error al cargar lista negra" });
        } finally {
            setLoading(false);
        }
    };

    const handleTextSearch = async (val: string) => {
        setSearchQuery(val);
        if (val.length < 2) {
            setSearchResults([]);
            return;
        }
        try {
            const results = await searchUsers(val);
            setSearchResults(results);
        } catch (e) {
            console.error(e);
        }
    };

    const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setRegPhoto(file);
            const reader = new FileReader();
            reader.onloadend = () => setRegPreview(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleImageSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setSearchResults([]);
        setRecognizedSubject(null);
        setIsSearchingImg(true);

        const reader = new FileReader();
        reader.onload = async () => {
            const dataUrl = reader.result as string;
            setSearchImgPreview(dataUrl);

            try {
                // Wait a bit to show the fancy scanning animation
                await new Promise(r => setTimeout(r, 2500));

                const arrayBuffer = await file.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                // @ts-ignore
                const result = await searchByPhotoAction(bytes);

                if (result.success && result.match) {
                    setRecognizedSubject(result.match);
                    if (result.user) {
                        setSearchResults([result.user]);
                        toast.success({ title: `Identificación positiva: ${result.user.name}` });
                    } else {
                        toast.warning({ title: `Sujeto reconocido como "${result.match.subject}" pero no registrado localmente.` });
                    }
                } else {
                    toast.error({ title: "Análisis biométrico fallido: No se detectaron rostros conocidos." });
                }
            } catch (err) {
                toast.error({ title: "Error en el motor de reconocimiento" });
            } finally {
                setIsSearchingImg(false);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!regName || !regPhoto) {
            toast.error({ title: "Nombre y foto son obligatorios" });
            return;
        }

        setIsSubmitting(true);
        const formData = new FormData();
        formData.append("name", regName);
        formData.append("dni", regDni);
        formData.append("isBlacklisted", regIsBlacklist.toString());
        formData.append("photo", regPhoto);

        try {
            await registerFace(formData);
            toast.success({ title: "Rostro registrado correctamente" });
            setRegName(""); setRegDni(""); setRegPhoto(null); setRegPreview(null);
            if (regIsBlacklist) fetchBlacklist();
            setActiveTab("blacklist");
        } catch (e) {
            console.error(e);
            toast.error({ title: "Error al registrar rostro" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRemoveBlacklist = async (userId: string) => {
        try {
            await toggleBlacklist(userId, false);
            toast.success({ title: "Usuario removido de lista negra" });
            fetchBlacklist();
        } catch (e) {
            toast.error({ title: "Error al actualizar usuario" });
        }
    };

    return (
        <>
            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-8 right-8 z-50 w-16 h-16 rounded-full bg-[#B20D30] text-foreground shadow-lg flex items-center justify-center hover:scale-110 active:scale-95 transition-all group"
            >
                <Shield size={28} className="group-hover:rotate-12 transition-transform" />
                <div className="absolute -top-2 -right-2 w-6 h-6 bg-white text-[#B20D30] rounded-full text-[10px] font-bold flex items-center justify-center border-2 border-[#B20D30] animate-pulse">
                    !
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, x: 400 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 400 }}
                        className="fixed inset-y-0 right-0 w-[450px] z-[100] bg-[#0A0A0A] border-l border-border shadow-[-20px_0_50px_rgba(0,0,0,0.5)] flex flex-col"
                    >
                        {/* Header */}
                        <div className="p-8 border-b border-border bg-gradient-to-r from-[#B20D30]/10 to-transparent">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-[#B20D30]/20 flex items-center justify-center border border-[#B20D30]/30">
                                        <Shield className="text-[#B20D30]" size={24} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-foreground uppercase tracking-tighter">OmniAccess Hub</h2>
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Inteligencia Biométrica</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="w-10 h-10 rounded-xl hover:bg-accent text-muted-foreground flex items-center justify-center transition-all"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Tabs */}
                            <div className="flex gap-2 p-1.5 bg-foreground/10 rounded-2xl">
                                {(["blacklist", "search", "register"] as const).map((t) => (
                                    <button
                                        key={t}
                                        onClick={() => {
                                            setActiveTab(t);
                                            setSearchResults([]);
                                            setSearchQuery("");
                                        }}
                                        className={cn(
                                            "flex-1 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                                            activeTab === t ? "bg-[#B20D30] text-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        {t === "blacklist" ? "Lista Negra" : t === "search" ? "Buscador" : "Registrar"}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                            {activeTab === "blacklist" && (
                                <div className="space-y-6">
                                    <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-red-500 text-foreground flex items-center justify-center shrink-0">
                                            <AlertTriangle size={20} />
                                        </div>
                                        <p className="text-xs font-bold text-red-200">
                                            Los perfiles en esta lista generarán alertas críticas inmediatas en todos los puestos de guardia.
                                        </p>
                                    </div>

                                    {loading ? (
                                        <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
                                            <Loader2 className="animate-spin text-foreground" size={32} />
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-foreground">Sincronizando Base de Datos...</p>
                                        </div>
                                    ) : blacklist.length === 0 ? (
                                        <div className="text-center py-20 space-y-4">
                                            <div className="w-20 h-20 rounded-full bg-foreground/10 mx-auto flex items-center justify-center text-muted-foreground">
                                                <ShieldCheck size={40} />
                                            </div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lista Negra Limpia</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 gap-4">
                                            <UserCardList users={blacklist} onRemove={handleRemoveBlacklist} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === "register" && (
                                <form onSubmit={handleRegister} className="space-y-8">
                                    <div className="space-y-4">
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.3em]">Captura Biométrica</p>
                                        <div
                                            onClick={() => document.getElementById('face-upload')?.click()}
                                            className="w-full aspect-square rounded-2xl bg-foreground/10 border-2 border-dashed border-border flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-accent transition-all relative overflow-hidden group"
                                        >
                                            {regPreview ? (
                                                <>
                                                    <Image src={regPreview} alt="Preview" fill className="object-cover group-hover:scale-105 transition-transform" />
                                                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <RefreshCw className="text-foreground animate-spin-slow" size={40} />
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="w-20 h-20 rounded-full bg-foreground/10 flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors">
                                                        <Camera size={40} />
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs font-bold text-foreground uppercase">Cargar Rostro</p>
                                                        <p className="text-[9px] text-muted-foreground font-bold uppercase mt-1">PNG, JPG hasta 5MB</p>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        <input id="face-upload" type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                                    </div>

                                    <div className="space-y-6">
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.3em]">Datos del Perfil</p>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-[8px] font-bold text-muted-foreground uppercase mb-2 block">Nombre Completo / Alias</label>
                                                <Input
                                                    value={regName}
                                                    onChange={(e) => setRegName(e.target.value)}
                                                    placeholder="P ej: JUAN PÉREZ (SOSPECHOSO)"
                                                    className="bg-foreground/10 border-border text-foreground placeholder:text-muted-foreground h-14 rounded-2xl font-bold uppercase transition-all focus:ring-2 focus:ring-[#B20D30]"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[8px] font-bold text-muted-foreground uppercase mb-2 block">Cédula / Identificación (Opcional)</label>
                                                <Input
                                                    value={regDni}
                                                    onChange={(e) => setRegDni(e.target.value)}
                                                    placeholder="Opcional"
                                                    className="bg-foreground/10 border-border text-foreground placeholder:text-muted-foreground h-14 rounded-2xl font-bold uppercase transition-all focus:ring-2 focus:ring-[#B20D30]"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 bg-foreground/10 p-4 rounded-3xl border border-border">
                                            <div className={cn(
                                                "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                                                regIsBlacklist ? "bg-red-500 text-foreground shadow-lg shadow-red-900/40" : "bg-emerald-500 text-foreground shadow-lg shadow-emerald-900/40"
                                            )}>
                                                {regIsBlacklist ? <ShieldAlert size={20} /> : <UserCheck size={20} />}
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-[10px] font-bold text-foreground uppercase">{regIsBlacklist ? "Registrar en Lista Negra" : "Registrar como VIP/Regular"}</p>
                                                <p className="text-[8px] text-muted-foreground font-bold">Define si este rostro generará alerta.</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setRegIsBlacklist(!regIsBlacklist)}
                                                className={cn(
                                                    "w-12 h-6 rounded-full relative transition-all duration-300",
                                                    regIsBlacklist ? "bg-red-500" : "bg-emerald-500"
                                                )}
                                            >
                                                <div className={cn(
                                                    "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                                                    regIsBlacklist ? "right-1" : "left-1"
                                                )} />
                                            </button>
                                        </div>
                                    </div>

                                    <Button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className={cn(
                                            "w-full h-16 rounded-2xl font-bold text-xs uppercase tracking-[0.2em] shadow-lg transition-all active:scale-95",
                                            regIsBlacklist ? "bg-[#B20D30] hover:bg-red-700 text-foreground" : "bg-emerald-600 hover:bg-emerald-700 text-foreground"
                                        )}
                                    >
                                        {isSubmitting ? <Loader2 className="animate-spin" /> : "Finalizar Registro"}
                                    </Button>
                                </form>
                            )}

                            {activeTab === "search" && (
                                <div className="space-y-8">
                                    <div className="space-y-6">
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.3em]">Tipo de Búsqueda</p>

                                        {/* Search Actions */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div
                                                onClick={() => document.getElementById('image-search-input')?.click()}
                                                className="group p-6 rounded-2xl bg-foreground/10 border border-border hover:bg-[#B20D30]/10 hover:border-[#B20D30]/30 transition-all cursor-pointer flex flex-col items-center text-center gap-3"
                                            >
                                                {isSearchingImg ? (
                                                    <Loader2 className="text-[#B20D30] animate-spin" size={32} />
                                                ) : (
                                                    <ImageIcon className="text-muted-foreground group-hover:text-[#B20D30] transition-colors" size={32} />
                                                )}
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">Búsqueda Visual</span>
                                            </div>
                                            <input id="image-search-input" type="file" accept="image/*" className="hidden" onChange={handleImageSearch} />

                                            <div className="group p-6 rounded-2xl bg-foreground/10 border border-border hover:bg-blue-500/10 hover:border-blue-500/30 transition-all flex flex-col items-center text-center gap-3">
                                                <Fingerprint className="text-muted-foreground group-hover:text-blue-500 transition-colors" size={32} />
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">Biometría</span>
                                            </div>
                                        </div>

                                        <div className="relative">
                                            <Search className="absolute left-5 top-5 text-muted-foreground" size={20} />
                                            <Input
                                                value={searchQuery}
                                                onChange={(e) => handleTextSearch(e.target.value)}
                                                placeholder="Buscar por nombre o CI..."
                                                className="bg-foreground/10 border-border text-foreground pl-14 h-16 rounded-2xl font-bold uppercase transition-all focus:ring-2 focus:ring-[#B20D30]"
                                            />
                                        </div>
                                    </div>

                                    <AnimatePresence mode="wait">
                                        {isSearchingImg ? (
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.9 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.9 }}
                                                className="relative w-full aspect-square rounded-2xl overflow-hidden border-2 border-[#B20D30]/30 shadow-[0_0_50px_rgba(178,13,48,0.2)] bg-black"
                                            >
                                                {searchImgPreview && (
                                                    <Image src={searchImgPreview} alt="Scanning" fill className="object-cover opacity-60 grayscale" />
                                                )}

                                                {/* Scanning Animations Removed */}

                                                {/* Scanning Grid Overlay */}
                                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_0%,rgba(0,0,0,0.4)_100%)] z-20" />
                                                <div className="absolute inset-0 flex flex-col items-center justify-center z-30 pointer-events-none">
                                                    <div className="w-40 h-40 border border-[#B20D30]/50 rounded-full animate-ping opacity-20" />
                                                    <Loader2 className="animate-spin text-[#B20D30] mb-4" size={40} />
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-foreground">Neural Analysis In Progress...</p>
                                                </div>
                                            </motion.div>
                                        ) : (
                                            <div className="space-y-4">
                                                {recognizedSubject && (
                                                    <motion.div
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        className="p-4 rounded-2xl bg-[#B20D30]/10 border border-[#B20D30]/20 flex items-center justify-between"
                                                    >
                                                        <div>
                                                            <p className="text-[8px] font-bold text-[#B20D30] uppercase tracking-widest">Identidad Reconocida</p>
                                                            <p className="text-sm font-bold text-foreground uppercase">{recognizedSubject.subject}</p>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Confianza</p>
                                                            <p className="text-sm font-bold text-emerald-500">{(recognizedSubject.similarity * 100).toFixed(1)}%</p>
                                                        </div>
                                                    </motion.div>
                                                )}

                                                {searchResults.length > 0 ? (
                                                    <UserCardList users={searchResults} />
                                                ) : searchQuery.length > 1 ? (
                                                    <div className="text-center py-10 opacity-40">
                                                        <p className="text-[10px] font-bold uppercase tracking-widest">No mapping found in database</p>
                                                    </div>
                                                ) : !searchImgPreview && (
                                                    <div className="flex flex-col items-center justify-center py-10 opacity-20">
                                                        <Loader2 className="animate-spin-slow mb-4" size={40} />
                                                        <p className="text-[8px] font-bold uppercase tracking-[0.3em]">Motor de Búsqueda Inteligente</p>
                                                    </div>
                                                )}

                                                {searchImgPreview && !isSearchingImg && (
                                                    <div className="flex justify-center">
                                                        <Button
                                                            variant="ghost"
                                                            onClick={() => {
                                                                setSearchImgPreview(null);
                                                                setRecognizedSubject(null);
                                                                setSearchResults([]);
                                                                setSearchQuery("");
                                                            }}
                                                            className="text-[10px] font-bold uppercase tracking-widest text-[#B20D30] hover:text-foreground"
                                                        >
                                                            Limpiar Búsqueda Visual
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )}
                        </div>

                        {/* Footer Overlay */}
                        <div className="p-8 border-t border-border bg-black/40 backdrop-blur-md">
                            <div className="flex items-center justify-between opacity-50">
                                <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">OmniAccess Biometric Core</span>
                                <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                                    <div className="w-1 h-1 rounded-full bg-[#B20D30] animate-pulse" /> Encrypted System
                                </span>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Background Overlay */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsOpen(false)}
                        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm shadow-lg"
                    />
                )}
            </AnimatePresence>
        </>
    );
}

function UserCardList({ users, onRemove }: { users: any[], onRemove?: (id: string) => void }) {
    return (
        <div className="grid grid-cols-1 gap-4">
            {users.map((user) => (
                <div key={user.id} className="bg-foreground/10 border border-border rounded-2xl p-5 flex items-center gap-4 hover:bg-accent transition-all group">
                    <div className="w-20 h-20 rounded-[1.5rem] bg-black shrink-0 relative overflow-hidden border-2 border-border group-hover:border-[#B20D30]/50 transition-colors">
                        {user.cara ? (
                            <Image
                                src={getImagePath(user.cara) || "/placeholder.png"}
                                alt={user.name}
                                fill
                                className="object-cover grayscale group-hover:grayscale-0 transition-all"
                            />
                        ) : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Camera size={32} /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-foreground uppercase truncate tracking-tighter">{user.name}</h4>
                        <p className="text-[10px] font-bold text-muted-foreground mb-2 truncate">
                            {user.dni || "S/DNI"} • {user.unit?.name || "Visitante"}
                        </p>
                        <div className="flex items-center gap-2">
                            {user.role === 'BLACKLISTED' ? (
                                <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[8px] font-bold">CRÍTICO</Badge>
                            ) : (
                                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold uppercase">AUTORIZADO</Badge>
                            )}
                            <Badge className="bg-foreground/10 text-muted-foreground border-border text-[8px] font-bold uppercase">BIO-LINK</Badge>
                        </div>
                    </div>
                    {onRemove && (
                        <button
                            onClick={() => onRemove(user.id)}
                            className="w-12 h-12 rounded-2xl bg-foreground/10 text-muted-foreground hover:bg-red-500 hover:text-foreground transition-all flex items-center justify-center"
                        >
                            <Trash2 size={20} />
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
