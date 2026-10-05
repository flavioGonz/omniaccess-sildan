"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const BarrioMap = dynamic(() => import("@/components/BarrioMap"), {
    ssr: false,
    loading: () => (
        <div className="h-full w-full flex items-center justify-center text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={18} /> Cargando mapa…
        </div>
    ),
});

export default function MapaPage() {
    return (
        <div className="h-[calc(100vh-0px)] w-full">
            <BarrioMap />
        </div>
    );
}
