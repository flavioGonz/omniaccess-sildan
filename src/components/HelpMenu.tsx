"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { HelpCircle, Network, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function HelpMenu() {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return (
        <div className="relative w-full" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-3 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-xl transition-all w-full justify-center group outline-none",
                    isOpen
                        ? "bg-blue-600 text-foreground shadow-lg shadow-blue-500/20 scale-[1.02]"
                        : "text-blue-400 bg-blue-500/5 border border-blue-500/10 hover:bg-blue-500/10 hover:scale-[1.02] active:scale-95"
                )}
            >
                {isOpen ? <X size={14} strokeWidth={3} /> : <HelpCircle size={14} strokeWidth={3} />}
                <span className="truncate">{isOpen ? "Cerrar" : "Centro de Ayuda"}</span>
            </button>

            {/* Context Menu / Dropdown */}
            {isOpen && (
                <div className="absolute bottom-full left-0 w-full mb-2 bg-[#1a1a1a] border border-border rounded-xl shadow-lg overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200 slide-in-from-bottom-2">
                    <div className="p-2 space-y-1">
                        <Link
                            href="/admin/help/structure"
                            onClick={() => setIsOpen(false)}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors group"
                        >
                            <div className="p-1.5 bg-purple-500/10 rounded-md text-purple-400 group-hover:bg-purple-500 group-hover:text-foreground transition-colors">
                                <Network size={14} />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold uppercase tracking-widest">Mapa del Sistema</span>
                                <span className="text-[9px] text-muted-foreground font-medium">Diagrama de funciones</span>
                            </div>
                        </Link>

                        <Link
                            href="/admin/help"
                            onClick={() => setIsOpen(false)}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors group"
                        >
                            <div className="p-1.5 bg-blue-500/10 rounded-md text-blue-400 group-hover:bg-blue-500 group-hover:text-foreground transition-colors">
                                <FileText size={14} />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold uppercase tracking-widest">Documentación</span>
                                <span className="text-[9px] text-muted-foreground font-medium">Guías y Manuales</span>
                            </div>
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
