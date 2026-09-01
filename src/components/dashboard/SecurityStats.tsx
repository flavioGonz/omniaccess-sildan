"use client";

import React from "react";
import { User, ShieldAlert, Activity, Zap } from "lucide-react";
import { motion } from "framer-motion";

export default function SecurityStats({ stats }: { stats: any }) {
    return (
        <div className="grid grid-cols-4 gap-6 p-6">
            <StatCard
                label="Tráfico Total"
                value={stats.total}
                icon={<Activity size={18} className="text-blue-500" />}
                chartColor="#3b82f6"
            />
            <StatCard
                label="Accesos Permitidos"
                value={stats.grants}
                icon={<User size={18} className="text-emerald-500" />}
                chartColor="#10b981"
                delay={0.1}
            />
            <StatCard
                label="Detecciones de Riesgo"
                value={stats.denies}
                icon={<ShieldAlert size={18} className="text-red-600" />}
                chartColor="#ef4444"
                delay={0.2}
            />
            <StatCard
                label="Carga del Sistema"
                value="99.9%"
                icon={<Zap size={18} className="text-amber-500" />}
                chartColor="#f59e0b"
                delay={0.3}
            />
        </div>
    );
}

function StatCard({ label, value, icon, chartColor, delay = 0 }: any) {
    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay }}
            className="bg-foreground/10 border border-border rounded-lg p-4 relative overflow-hidden group hover:bg-foreground/[0.04] transition-all"
        >
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-black/40 rounded-xl border border-border group-hover:scale-110 transition-transform">
                    {icon}
                </div>
                <div>
                    <h4 className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{label}</h4>
                    <p className="text-2xl font-bold text-foreground tracking-tighter">{value}</p>
                </div>
            </div>

            {/* Simulated Neon Chart Line */}
            <div className="h-8 w-full relative">
                <svg className="w-full h-full" viewBox="0 0 100 20" preserveAspectRatio="none">
                    <motion.path
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 2, delay }}
                        d="M0 15 L20 10 L40 18 L60 8 L80 12 L100 5"
                        fill="none"
                        stroke={chartColor}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                    />
                </svg>
                <div className="absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-black/20 to-transparent" />
            </div>

            {/* Glowing Accent */}
            <div className="absolute top-0 right-0 w-20 h-20 bg-foreground/10 blur-3xl rounded-full translate-x-10 -translate-y-10 group-hover:bg-accent transition-colors" />
        </motion.div>
    );
}
