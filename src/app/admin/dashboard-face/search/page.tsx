"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Image as ImageIcon, Loader2, Fingerprint, ChevronLeft, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { sileo as toast } from "sileo";
import { searchUsers } from "@/app/actions/users";
import { searchByPhotoAction } from "@/app/actions/face-verify";
import { getImagePath } from "@/lib/image-path";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function SearchFacePage() {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [isSearchingImg, setIsSearchingImg] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [match, setMatch] = useState<any>(null);

    const handleTextSearch = async (val: string) => {
        setQuery(val);
        if (val.length < 2) {
            setResults([]);
            return;
        }
        try {
            const res = await searchUsers(val);
            setResults(res);
        } catch (e) {
            console.error(e);
        }
    };

    const handleImageSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setResults([]);
        setMatch(null);
        setIsSearchingImg(true);

        const reader = new FileReader();
        reader.onload = async () => {
            setPreview(reader.result as string);
            try {
                // Mimic fancy scanning
                await new Promise(r => setTimeout(r, 2000));

                const bytes = new Uint8Array(await file.arrayBuffer());
                // @ts-ignore
                const result = await searchByPhotoAction(bytes);

                if (result.success && result.match) {
                    setMatch(result.match);
                    if (result.user) {
                        setResults([result.user]);
                        toast.success({ title: `Identificación positiva: ${result.user.name}` });
                    }
                } else {
                    toast.error({ title: "No se detectaron rostros conocidos." });
                }
            } catch (err) {
                toast.error({ title: "Error en el motor biométrico" });
            } finally {
                setIsSearchingImg(false);
            }
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className="min-h-screen bg-black text-white p-12">
            <div className="max-w-4xl mx-auto space-y-12">
                <header className="flex items-center gap-6">
                    <Link href="/admin/dashboard-face" className="w-12 h-12 rounded-full bg-foreground/10 flex items-center justify-center hover:bg-accent transition-all">
                        <ChevronLeft size={24} />
                    </Link>
                    <div>
                        <h1 className="text-4xl font-bold uppercase tracking-tighter">Buscador Inteligente</h1>
                        <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest mt-1">Motor de Interrogación Biométrica OmniAccess</p>
                    </div>
                </header>

                <div className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div
                            onClick={() => document.getElementById('img-search')?.click()}
                            className="p-8 rounded-2xl bg-card/30 border border-border hover:bg-[#B20D30]/10 hover:border-[#B20D30]/30 transition-all cursor-pointer flex flex-col items-center gap-4 text-center group"
                        >
                            {isSearchingImg ? <Loader2 className="animate-spin text-[#B20D30]" size={40} /> : <ImageIcon className="text-muted-foreground group-hover:text-[#B20D30] transition-colors" size={40} />}
                            <div>
                                <h4 className="text-sm font-bold uppercase text-foreground">Búsqueda Visual</h4>
                                <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">Comparación por Fotografía</p>
                            </div>
                        </div>
                        <input id="img-search" type="file" accept="image/*" className="hidden" onChange={handleImageSearch} />

                        <div className="p-8 rounded-2xl bg-card/30 border border-border hover:bg-blue-500/10 hover:border-blue-500/30 transition-all flex flex-col items-center gap-4 text-center group">
                            <Fingerprint className="text-muted-foreground group-hover:text-blue-500 transition-colors" size={40} />
                            <div>
                                <h4 className="text-sm font-bold uppercase text-foreground">Huella Digital</h4>
                                <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">Próximamente</p>
                            </div>
                        </div>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-muted-foreground" size={24} />
                        <Input
                            value={query}
                            onChange={(e) => handleTextSearch(e.target.value)}
                            placeholder="Buscar por Nombre, DNI o Unidad..."
                            className="h-20 bg-card/50 border-border pl-16 rounded-2xl text-xl font-bold uppercase focus:ring-2 focus:ring-[#B20D30] transition-all"
                        />
                    </div>
                </div>

                <AnimatePresence mode="wait">
                    {isSearchingImg ? (
                        <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-[#B20D30]/30 bg-black flex items-center justify-center">
                            {preview && <Image src={preview} alt="Scanning" fill className="object-cover opacity-40 grayscale" />}
                            <motion.div
                                animate={{ top: ["0%", "100%", "0%"] }}
                                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                className="absolute inset-x-0 h-1 bg-white shadow-[0_0_20px_white] z-10"
                            />
                            <div className="z-20 flex flex-col items-center gap-4">
                                <Loader2 className="animate-spin text-foreground" size={48} />
                                <p className="text-xs font-bold uppercase tracking-[0.5em] text-foreground animate-pulse">Scanning Neural Database...</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {match && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="bg-[#B20D30]/10 border border-[#B20D30]/20 p-6 rounded-3xl flex items-center justify-between"
                                >
                                    <div>
                                        <p className="text-[10px] font-bold text-[#B20D30] uppercase tracking-widest">Coincidencia Biométrica</p>
                                        <h4 className="text-2xl font-bold text-foreground uppercase italic">{match.subject}</h4>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Confianza</p>
                                        <h4 className="text-2xl font-bold text-emerald-500">{(match.similarity * 100).toFixed(1)}%</h4>
                                    </div>
                                </motion.div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {results.map(user => (
                                    <div key={user.id} className="bg-card/50 border border-border p-6 rounded-2xl flex items-center gap-6 hover:bg-muted transition-all group">
                                        <div className="w-20 h-20 rounded-2xl overflow-hidden relative border border-border shrink-0">
                                            <Image src={getImagePath(user.cara) || "/placeholder-face.jpg"} alt="" fill className="object-cover grayscale group-hover:grayscale-0 transition-all" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-lg font-bold uppercase truncate text-foreground tracking-tighter">{user.name}</h4>
                                            <p className="text-xs text-muted-foreground font-bold uppercase truncate">{user.dni || "---"} • {user.unit?.name || "Visitante"}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </AnimatePresence>
            </div>

            <style jsx global>{`
                body { background: black; }
                * { border-radius: 1.5rem !important; }
            `}</style>
        </div>
    );
}
