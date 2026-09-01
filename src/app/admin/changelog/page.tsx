"use client";

import React from "react";
import {
    Clock,
    CheckCircle2,
    PlusCircle,
    AlertCircle,
    TrendingUp,
    FileText,
    ChevronRight,
    Rocket,
    Zap,
    Bug
} from "lucide-react";
import { cn } from "@/lib/utils";

const changes = [
    {
        version: "v2.0.0",
        date: "2026-02-17",
        title: "Sileo Toast Conversion & UX Polish",
        description: "Migración masiva de notificaciones a protocolo Sileo, refinamiento de Dashboard y gestión avanzada de listas.",
        items: [
            { type: "performance", text: "Protocolo Sileo: Migración del 100% de notificaciones al formato de objeto único para estabilidad del motor de build." },
            { type: "improvement", text: "Dashboard Layout: Optimización de monitores en vivo con scroll horizontal y eliminación de cards obsoletas." },
            { type: "feature", text: "Gestión de Listas: Inclusión de metadatos extendidos (Observaciones, Motivo, Creador) en Listas Negras/Blancas." },
            { type: "fix", text: "Estabilidad: Corrección de errores de tipos en DriverDetailsDialog, FaceMatchModal y GuardIphoneConsole." }
        ]
    },
    {
        version: "v1.9.0",
        date: "2026-02-12",
        title: "AI OCR Engine & Rebranding",
        description: "Implementación de motor IA cliente, validación Mercosur y renovación de identidad corporativa.",
        items: [
            { type: "feature", text: "AI Engine: Integración de TensorFlow.js (COCO-SSD) y Tesseract.js para lectura de matrículas 100% local." },
            { type: "feature", text: "LPR Intelligence: Algoritmo de validación específico para matrículas Mercosur (Uruguay/Argentina/Brasil)." },
            { type: "improvement", text: "Rebranding: Transición oficial de SecureAccess a Omniaccess Guard en toda la plataforma y apps PWA." },
            { type: "performance", text: "Performance: Estrategia de carga asíncrona de modelos IA para evitar retrasos en el inicio de cámara." }
        ]
    },
    {
        version: "v1.8.2",
        date: "2026-02-10",
        title: "System Recovery & Premium UI",
        description: "Restauración crítica de base de datos, recuperación de unidades y rediseño visual del login.",
        items: [
            { type: "performance", text: "Data Recovery: Restauración completa de jerarquía de Unidades (Barrio 1 → A01-Z13) y tabla Bitacora." },
            { type: "improvement", text: "Visual: Nuevo fondo de Login 'Cyberpunk City' con efectos de cristal y animaciones." },
            { type: "fix", text: "Fix: Corrección de credenciales de administrador y scripts de inicialización." }
        ]
    },
    {
        version: "v1.8.1",
        date: "2026-02-09",
        title: "Console UI Refinements",
        description: "Rediseño de nodos de consola, optimización de espacio y alertas mejoradas.",
        items: [
            { type: "improvement", text: "Admin Console: Eliminación de panel derecho para maximizar visualización de topología." },
            { type: "feature", text: "Admin Console: Botón flotante para mapa táctico y acciones rápidas." },
            { type: "feature", text: "UI: Nodos de consola con diseño 'Tablet' y manejo de conexiones superior." },
            { type: "fix", text: "Alertas: Corregido bug de alerta 'Sistema Normalizado' al recargar." },
            { type: "improvement", text: "UX: Notificaciones de éxito ahora usan color verde esmeralda." },
            { type: "improvement", text: "Docs: Actualización de documentación de eventos Socket.io en agents.md." }
        ]
    },
    {
        version: "v1.8.0",
        date: "2026-02-06",
        title: "Build Stability & Panic Protocol v2",
        description: "Corrección de errores críticos de compilación, optimización de recursos y mejora en el protocolo de pánico.",
        items: [
            { type: "fix", text: "Build: Corregido error de variable 'isRecording' usada antes de su declaración." },
            { type: "performance", text: "Sistema: Limpieza masiva de logs (>1.4GB) para restaurar velocidad y evitar 502 Bad Gateway." },
            { type: "feature", text: "Protocolo de Pánico: Nuevo botón central 'Hold-to-Deactivate' con feedback visual." },
            { type: "improvement", text: "Seguridad: Normalización del sistema ahora protegida vía pulsación larga de 2 segundos." },
            { type: "fix", text: "Multimedia: Eliminación de estados duplicados en componentes de audio/video." }
        ]
    },
    {
        version: "v1.7.0",
        date: "2026-02-04",
        title: "Socket.IO Smart Routing & UI Refinements",
        description: "Detección inteligente de proxy para Socket.IO, optimización de Guard Console y mejoras en Admin Console.",
        items: [
            { type: "feature", text: "Socket.IO: Detección automática de puerto basada en entorno (proxy vs directo)." },
            { type: "improvement", text: "Guard Console: Solo matrícula es obligatoria, todos los demás campos opcionales." },
            { type: "improvement", text: "Guard Console: Botón de cámara reparado con canvas oculto para captura." },
            { type: "feature", text: "Admin Console: Registro Rápido convertido a botón flotante (FAB) con modal." },
            { type: "improvement", text: "Admin Console: Barra superior eliminada para maximizar espacio del flow." },
            { type: "improvement", text: "Admin Console: 'Consolas Conectadas' renombrado a 'Dispositivos Conectados'." },
            { type: "fix", text: "Storage: Confirmado almacenamiento de fotos en MinIO/S3 con bucket 'lpr'." }
        ]
    },
    {
        version: "v1.6.0",
        date: "2026-02-04",
        title: "Floating Media Experience",
        description: "Reorganización de interfaz y controles multimedia flotantes para tablets.",
        items: [
            { type: "feature", text: "Floating Media: Botones flotantes (FAB) para captura de audio y foto." },
            { type: "improvement", text: "Espacio de Trabajo: Eliminación de bloques fijos de cámara para mayor área de formulario." },
            { type: "feature", text: "Detección IP: Reporte automático de IP local de la tablet para auditoría precisa." },
            { type: "improvement", text: "Media Preview: Miniaturas integradas de capturas junto al botón de finalización." },
            { type: "feature", text: "Real-time Admin: Historial de bitácora en vivo en el panel administrativo." }
        ]
    },
    {
        version: "v1.5.0",
        date: "2026-02-02",
        title: "Experiencia GuardConsole Premium",
        description: "Transformación total de la interfaz para tablets y optimización de flujo de trabajo.",
        items: [
            { type: "feature", text: "Smart Match: Autocompletado inteligente basado en registros históricos." },
            { type: "feature", text: "Modo Kiosk PWA: Soporte para pantalla completa real sin barras." },
            { type: "improvement", text: "Tactile Matrix: Entrada de matrículas optimizada para alta velocidad." },
            { type: "performance", text: "Haptic Feedback: Sonidos táctiles de confirmación en cada acción." },
            { type: "improvement", text: "Visual: Nueva tipografía Outfit y animaciones 'Breathing' de cristal." },
            { type: "fix", text: "Resiliencia: Solución para cámaras en contextos HTTP locales." }
        ]
    },
    {
        version: "v1.2.0",
        date: "2026-01-31",
        title: "Nuevo Modo Aprendizaje LPR",
        description: "Automatización de registro de matrículas y mejoras en la gestión de accesos desconocidos.",
        items: [
            { type: "feature", text: "LPR: Nuevo Modo Aprendizaje automático." },
            { type: "improvement", text: "Ajustes: Visualización de capturas en tabla de aprendizaje." },
            { type: "feature", text: "Ajustes: Limpieza de historial en tiempo real." }
        ]
    },
    {
        version: "v1.1.0",
        date: "2026-01-31",
        title: "Optimización de Rendimiento y Reportes",
        description: "Mejoras críticas en el manejo de grandes volúmenes de datos y exportación de historial.",
        items: [
            { type: "performance", text: "Calendario: Carga optimizada omitiendo cálculos pesados de duración (N+1 queries fixed)." },
            { type: "feature", text: "Calendario: Se aumentó el límite de visualización de 2,000 a 50,000 eventos mensuales." },
            { type: "fix", text: "Exportación: Corregido error que generaba reportes Excel vacíos." },
            { type: "performance", text: "Exportación: Optimización para descarga de hasta 100k registros en segundos." },
            { type: "performance", text: "Frontend: Implementación de useMemo en componentes de alta densidad para evitar lag." },
            { type: "fix", text: "Estabilidad: Corregido error crítico de importación en el proceso de build de producción." }
        ]
    },
    {
        version: "v1.0.5",
        date: "2026-01-19",
        title: "Actualizaciones en Tiempo Real",
        description: "Implementación de sockets para el historial.",
        items: [
            { type: "feature", text: "Dashboard: Actualización de eventos en tiempo real vía Socket.io." },
            { type: "improvement", text: "Historial: Scroll infinito y filtrado dinámico mejorado." }
        ]
    }
];

const typeStyles: Record<string, { icon: any, color: string, bg: string }> = {
    feature: { icon: PlusCircle, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    fix: { icon: Bug, color: "text-red-400", bg: "bg-red-500/10" },
    performance: { icon: Zap, color: "text-blue-400", bg: "bg-blue-500/10" },
    improvement: { icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10" }
};

export default function ChangelogPage() {
    return (
        <div className="p-8 max-w-5xl mx-auto animate-in fade-in duration-700">
            <header className="mb-12">
                <div className="flex items-center gap-4 mb-4">
                    <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 shadow-xl">
                        <FileText size={32} className="text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Changelog</h1>
                        <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs">Historial de actualizaciones y mejoras</p>
                    </div>
                </div>
                <div className="h-px w-full bg-gradient-to-r from-neutral-800 via-neutral-800 to-transparent" />
            </header>

            <div className="space-y-12 relative before:absolute before:left-[17px] before:top-2 before:bottom-2 before:w-px before:bg-muted">
                {/* NEW RELEASE v2.1.1 */}
                <div className="relative pl-12 group">
                    <div className="absolute left-0 top-1.5 w-[35px] h-[35px] rounded-full bg-card border-2 border-border flex items-center justify-center z-10 group-hover:border-blue-500/50 transition-colors">
                        <Rocket size={16} className="text-blue-400" />
                    </div>
                    <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
                        <h2 className="text-2xl font-bold text-foreground">v2.1.1</h2>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest h-5 px-2 flex items-center rounded-full bg-muted border border-border">
                                2026-03-12
                            </span>
                            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest h-5 px-2 flex items-center rounded-full bg-blue-500/10 border border-blue-500/20">
                                LATEST
                            </span>
                        </div>
                    </div>
                    <div className="bg-card/50 border border-border rounded-3xl p-6 shadow-lg backdrop-blur-xl mb-6">
                        <h3 className="text-xl font-bold text-foreground mb-2">Avicam Driver & Real-time Persistence</h3>
                        <p className="text-muted-foreground text-sm mb-6">Integración oficial de terminales Avicam, corrección de sincronización horaria y mejoras en persistencia del dashboard.</p>
                        <div className="grid gap-4">
                            <div className="flex items-start gap-4 p-3 rounded-xl bg-background/50 border border-border/50 hover:bg-card transition-colors group/item">
                                <div className="mt-0.5 p-1.5 rounded-lg shrink-0 bg-emerald-500/10"><PlusCircle size={14} className="text-emerald-400" /></div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-muted-foreground leading-relaxed">Avicam Integration: Driver nativo para terminales faciales con soporte de eventos Push y fotos en alta resolución.</p>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400">feature</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-4 p-3 rounded-xl bg-background/50 border border-border/50 hover:bg-card transition-colors group/item">
                                <div className="mt-0.5 p-1.5 rounded-lg shrink-0 bg-blue-400/10"><Zap size={14} className="text-blue-400" /></div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-muted-foreground leading-relaxed">Timezone Sync: Corrección automática de timestamps para dispositivos en UTC-3 (Montevideo), garantizando orden cronológico exacto.</p>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400">improvement</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-4 p-3 rounded-xl bg-background/50 border border-border/50 hover:bg-card transition-colors group/item">
                                <div className="mt-0.5 p-1.5 rounded-lg shrink-0 bg-amber-500/10"><TrendingUp size={14} className="text-amber-400" /></div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-muted-foreground leading-relaxed">Dashboard Retention: Ventana de visión extendida a 24 horas continuas, eliminando el corte abrupto de medianoche.</p>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400">improvement</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-4 p-3 rounded-xl bg-background/50 border border-border/50 hover:bg-card transition-colors group/item">
                                <div className="mt-0.5 p-1.5 rounded-lg shrink-0 bg-red-400/10"><Bug size={14} className="text-red-400" /></div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-muted-foreground leading-relaxed">S3 Fix: Limpieza estricta de payloads Base64 para asegurar compatibilidad con el almacenamiento en la nube.</p>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-red-400">fix</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RELEASE v2.1.0 */}
                <div className="relative pl-12 group">
                    <div className="absolute left-0 top-1.5 w-[35px] h-[35px] rounded-full bg-card border-2 border-border flex items-center justify-center z-10 group-hover:border-blue-500/50 transition-colors">
                        <Rocket size={16} className="text-muted-foreground" />
                    </div>
                    <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
                        <h2 className="text-2xl font-bold text-muted-foreground">v2.1.0</h2>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest h-5 px-2 flex items-center rounded-full bg-muted border border-border">
                                2026-02-24
                            </span>
                        </div>
                    </div>
                    <div className="bg-card/30 border border-border/50 rounded-3xl p-6 mb-6 opacity-60">
                        <h3 className="text-lg font-bold text-muted-foreground mb-2">Native Face Engine & Data Optimization</h3>
                        <p className="text-muted-foreground text-xs">Optimización del reconocimiento facial delegando validación a hardware nativo.</p>
                    </div>
                </div>


                {changes.map((release, idx) => (
                    <div key={release.version} className="relative pl-12 group">
                        {/* Timeline node */}
                        <div className="absolute left-0 top-1.5 w-[35px] h-[35px] rounded-full bg-card border-2 border-border flex items-center justify-center z-10 group-hover:border-blue-500/50 transition-colors">
                            {idx === 0 ? <Rocket size={16} className="text-blue-400" /> : <Clock size={16} className="text-muted-foreground" />}
                        </div>

                        <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
                            <h2 className="text-2xl font-bold text-foreground">{release.version}</h2>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest h-5 px-2 flex items-center rounded-full bg-muted border border-border">
                                    {release.date}
                                </span>
                                {idx === 0 && (
                                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest h-5 px-2 flex items-center rounded-full bg-blue-500/10 border border-blue-500/20">
                                        LATEST
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="bg-card/50 border border-border rounded-3xl p-6 shadow-lg backdrop-blur-xl mb-6">
                            <h3 className="text-xl font-bold text-foreground mb-2">{release.title}</h3>
                            <p className="text-muted-foreground text-sm mb-6">{release.description}</p>

                            <div className="grid gap-4">
                                {release.items.map((item, i) => {
                                    const style = typeStyles[item.type] || typeStyles.improvement;
                                    const Icon = style.icon;
                                    return (
                                        <div key={i} className="flex items-start gap-4 p-3 rounded-xl bg-background/50 border border-border/50 hover:bg-card transition-colors group/item">
                                            <div className={cn("mt-0.5 p-1.5 rounded-lg shrink-0", style.bg)}>
                                                <Icon size={14} className={style.color} />
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-sm font-medium text-muted-foreground leading-relaxed">
                                                    {item.text}
                                                </p>
                                                <span className={cn("text-[9px] font-bold uppercase tracking-widest", style.color)}>
                                                    {item.type}
                                                </span>
                                            </div>
                                            <ChevronRight size={14} className="mt-1 text-muted-foreground group-hover/item:text-muted-foreground transition-colors" />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <footer className="mt-20 pt-8 border-t border-border text-center">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-[0.2em]">
                    OmniAccess Software Foundation &copy; 2026
                </p>
            </footer>
        </div>
    );
}
