import { getProjectStructure } from "@/app/actions/structure";
import { TreeDiagram } from "@/components/TreeDiagram";
import { ChevronLeft, HelpCircle } from "lucide-react";
import Link from "next/link";

export default async function ProjectStructurePage() {
    const data = await getProjectStructure();

    return (
        <div className="flex flex-col h-screen p-6 space-y-4 animate-in fade-in duration-700 overflow-hidden">
            {/* Minimal Header */}
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <Link
                        href="/admin/help"
                        className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all shadow-xl"
                    >
                        <ChevronLeft size={20} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground uppercase tracking-tighter leading-none">Arquitectura del Sistema</h1>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Mapa interactivo de módulos LPR-NODE</p>
                    </div>
                </div>

                <div className="hidden md:flex items-center gap-6 px-5 py-2.5 bg-card/50 rounded-2xl border border-border backdrop-blur-xl">
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] font-bold text-emerald-400">18</span>
                        <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">OK</span>
                    </div>
                    <div className="w-px h-4 bg-foreground/10" />
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] font-bold text-blue-400">4</span>
                        <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">DEV</span>
                    </div>
                </div>
            </div>

            {/* Tree Container - Stretching to fill remaining space */}
            <div className="flex-1 min-h-0">
                <div className="w-full h-full bg-background/40 rounded-2xl border border-border overflow-hidden relative shadow-inner">
                    <TreeDiagram data={data} />
                </div>
            </div>

            {/* Bottom Info Bar */}
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 px-5 py-2 bg-blue-500/5 border border-blue-500/10 rounded-full">
                    <HelpCircle size={12} className="text-blue-400" />
                    <p className="text-[8px] font-bold text-blue-400/80 uppercase tracking-widest leading-none">
                        Tip: Arrastra para navegar • Scroll para zoom • Hover para gestionar nodos
                    </p>
                </div>
                <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                    LPR-NODE Documentación v1.4.2
                </div>
            </div>
        </div>
    );
}
