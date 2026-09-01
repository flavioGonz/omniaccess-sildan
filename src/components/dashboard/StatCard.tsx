"use client";

import { LucideIcon } from "lucide-react";

interface StatCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    color?: string;
}

export function StatCard({ title, value, icon: Icon, color = "text-foreground" }: StatCardProps) {
    return (
        <div className="bg-card/50 p-4 rounded-xl border border-border/50 flex flex-col gap-3 min-w-[140px] relative overflow-hidden group shadow-xl backdrop-blur-xl">
            <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:scale-125 transition-transform duration-700">
                <Icon size={64} />
            </div>

            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color} bg-card border border-border shadow-inner`}>
                <Icon size={18} strokeWidth={2.5} />
            </div>

            <div className="relative">
                <p className="text-2xl font-bold text-foreground tracking-tighter leading-none mb-0.5">{value}</p>
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.2em]">{title}</p>
            </div>
        </div>
    );
}
