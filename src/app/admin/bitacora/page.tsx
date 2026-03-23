"use client";

import React, { useState, useEffect } from "react";
import { 
    History, 
    PlusCircle, 
    ShieldAlert, 
    Users, 
    Map as MapIcon, 
    Grid, 
    List, 
    Search, 
    RefreshCcw, 
    FileSpreadsheet,
} from "lucide-react";
import { 
    Tabs, 
    TabsContent, 
    TabsList, 
    TabsTrigger 
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getBitacoraPage } from "@/app/actions/bitacora";
import BitacoraCard from "@/components/bitacora/BitacoraCard";
import BitacoraTable from "@/components/bitacora/BitacoraTable";
import ManualRegisterForm from "@/components/bitacora/ManualRegisterForm";
import GuardManagement from "@/components/bitacora/GuardManagement";
import PanicButtonTab from "@/components/bitacora/PanicButtonTab";
import GuardMapTab from "@/components/bitacora/GuardMapTab";
import { ExportBitacoraDialog } from "@/components/bitacora/ExportBitacoraDialog";

export default function BitacoraPage() {
    const [viewMode, setViewMode] = useState<"grid" | "table">("table");
    const [entries, setEntries] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);

    const loadEntries = async () => {
        setLoading(true);
        try {
            const data = await getBitacoraPage(0, 50, searchQuery);
            setEntries(data);
        } catch (error) {
            console.error("Error loading bitacora:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadEntries();
    }, [searchQuery]);

    return (
        <div className="p-4 md:p-8 space-y-8 max-w-[1600px] mx-auto animate-in fade-in duration-700">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-red-600/10 rounded-2xl border border-red-600/20">
                            <History size={24} className="text-red-600" />
                        </div>
                        <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-tighter">Consola del Guardia</h1>
                    </div>
                    <p className="text-[10px] md:text-xs text-neutral-500 font-bold uppercase tracking-[0.3em] pl-1">Centro de Control y Bitácora Operativa</p>
                </div>

                <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 p-1.5 rounded-2xl shadow-xl">
                    <button
                        onClick={() => setViewMode("grid")}
                        className={cn(
                            "p-2.5 rounded-xl transition-all",
                            viewMode === "grid" ? "bg-white text-black shadow-lg" : "text-neutral-500 hover:text-white"
                        )}
                    >
                        <Grid size={18} />
                    </button>
                    <button
                        onClick={() => setViewMode("table")}
                        className={cn(
                            "p-2.5 rounded-xl transition-all",
                            viewMode === "table" ? "bg-white text-black shadow-lg" : "text-neutral-500 hover:text-white"
                        )}
                    >
                        <List size={18} />
                    </button>
                </div>
            </div>

            <Tabs defaultValue="historial" className="space-y-8">
                <TabsList className="bg-black/20 border-b border-neutral-800 w-full flex justify-start gap-4 md:gap-8 h-auto p-0 mb-8 rounded-none sticky top-[calc(var(--header-height,0px))] z-10 backdrop-blur-xl">
                    <TabsTrigger 
                        value="historial" 
                        className="pb-4 pt-2 px-1 md:px-4 rounded-none border-b-2 border-transparent data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:border-red-600 text-neutral-500 text-[9px] md:text-[10px] font-black uppercase tracking-widest gap-2 transition-all hover:text-neutral-300 shadow-none!"
                    >
                        <History size={16} /> <span className="hidden md:inline">Historial</span>
                    </TabsTrigger>
                    <TabsTrigger 
                        value="manual" 
                        className="pb-4 pt-2 px-1 md:px-4 rounded-none border-b-2 border-transparent data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:border-blue-600 text-neutral-500 text-[9px] md:text-[10px] font-black uppercase tracking-widest gap-2 transition-all hover:text-neutral-300 shadow-none!"
                    >
                        <PlusCircle size={16} /> <span className="hidden md:inline">Registro Manual</span>
                    </TabsTrigger>
                    <TabsTrigger 
                        value="guards" 
                        className="pb-4 pt-2 px-1 md:px-4 rounded-none border-b-2 border-transparent data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:border-emerald-600 text-neutral-500 text-[9px] md:text-[10px] font-black uppercase tracking-widest gap-2 transition-all hover:text-neutral-300 shadow-none!"
                    >
                        <Users size={16} /> <span className="hidden md:inline">Gestión Guardias</span>
                    </TabsTrigger>
                    <TabsTrigger 
                        value="panic" 
                        className="pb-4 pt-2 px-1 md:px-4 rounded-none border-b-2 border-transparent data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:border-amber-600 text-neutral-500 text-[9px] md:text-[10px] font-black uppercase tracking-widest gap-2 transition-all hover:text-neutral-300 shadow-none!"
                    >
                        <ShieldAlert size={16} /> <span className="hidden md:inline">Botón Pánico</span>
                    </TabsTrigger>
                    <TabsTrigger 
                        value="map" 
                        className="pb-4 pt-2 px-1 md:px-4 rounded-none border-b-2 border-transparent data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:border-indigo-600 text-neutral-500 text-[9px] md:text-[10px] font-black uppercase tracking-widest gap-2 transition-all hover:text-neutral-300 shadow-none!"
                    >
                        <MapIcon size={16} /> <span className="hidden md:inline">Mapa Tactical</span>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="historial" className="space-y-6 focus-visible:outline-none focus-visible:ring-0">
                    {/* Filters & Search */}
                    <div className="flex flex-col md:flex-row items-center gap-4 bg-black/40 border border-neutral-800 p-4 rounded-3xl backdrop-blur-sm">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600" size={18} />
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Buscar por matrícula, nombre o destino..."
                                className="w-full bg-neutral-950 border-neutral-800 h-12 pl-12 rounded-2xl text-sm font-medium focus:ring-red-600/20"
                            />
                        </div>
                        <div className="flex gap-2 w-full md:w-auto">
                            <Button
                                onClick={loadEntries}
                                variant="outline"
                                className="h-12 border-neutral-800 bg-neutral-900 rounded-2xl px-6 text-[10px] font-bold uppercase tracking-widest gap-2 hover:bg-neutral-800 text-neutral-400 hover:text-white"
                            >
                                <RefreshCcw size={16} /> {loading ? "..." : "Refrescar"}
                            </Button>
                            <Button
                                onClick={() => setIsExportDialogOpen(true)}
                                className="h-12 bg-red-600 hover:bg-red-500 text-white rounded-2xl px-6 text-[10px] font-black uppercase tracking-widest gap-2 shadow-lg shadow-red-900/20"
                            >
                                <FileSpreadsheet size={16} /> Exportar Reporte
                            </Button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                                <div key={i} className="h-64 bg-neutral-900/50 rounded-3xl animate-pulse" />
                            ))}
                        </div>
                    ) : (
                        <div className="animate-in fade-in slide-in-from-bottom-5 duration-700">
                            {viewMode === "grid" ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                    {entries.map((entry) => (
                                        <BitacoraCard key={entry.id} entry={entry} />
                                    ))}
                                </div>
                            ) : (
                                <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl">
                                    <BitacoraTable entries={entries} />
                                </div>
                            )}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="manual" className="focus-visible:outline-none focus-visible:ring-0">
                    <ManualRegisterForm />
                </TabsContent>

                <TabsContent value="guards" className="focus-visible:outline-none focus-visible:ring-0">
                    <GuardManagement />
                </TabsContent>

                <TabsContent value="panic" className="focus-visible:outline-none focus-visible:ring-0">
                    <PanicButtonTab />
                </TabsContent>

                <TabsContent value="map" className="focus-visible:outline-none focus-visible:ring-0">
                    <GuardMapTab />
                </TabsContent>
            </Tabs>

            <ExportBitacoraDialog 
                open={isExportDialogOpen} 
                onOpenChange={setIsExportDialogOpen} 
                searchQuery={searchQuery}
            />
        </div>
    );
}
