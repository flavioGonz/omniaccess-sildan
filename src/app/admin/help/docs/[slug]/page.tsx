import {
    BookOpen, Book, AlertCircle, Server, Code, FileCode, Workflow,
    ShieldCheck, Zap, Car, LayoutDashboard, Calendar, History,
    Users, Cpu, Key, LayoutGrid, Settings, Activity, Home,
    ChevronLeft, ExternalLink, Shield, Lock, Bell, CheckCircle2, CreditCard
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";

type Params = Promise<{ slug: string }>;

const MODULE_DOCS: Record<string, any> = {
    dashboard: {
        title: "Panel de Monitoreo en Vivo",
        header: "Centro de Operaciones Tácticas",
        icon: LayoutDashboard,
        color: "text-blue-400",
        description: "Supervisión total en tiempo real de todos los puntos de acceso perimetrales.",
        guide: [
            {
                title: "Visualización en Vivo",
                text: "El panel principal muestra una cascada de eventos en tiempo real. Cada vez que una cámara LPR detecta un vehículo o una terminal facial reconoce a un sujeto, el evento aparece instantáneamente con su foto de evidencia.",
                image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=800"
            },
            {
                title: "Acciones de Emergencia",
                text: "Desde el dashboard, los operadores pueden ejecutar comandos directos sobre el hardware: apertura de barreras, bloqueo de puertas o reinicio de terminales.",
                image: "https://images.unsplash.com/photo-1517077304055-6e89abbf09b0?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "Protocolo Webhook: Recepción de eventos vía HTTP POST (JSON/XML).",
            "Latencia: Procesamiento de imagen y decisión de acceso en <200ms.",
            "Visualización: Websockets para actualización ultra-rápida sin recarga."
        ]
    },
    users: {
        title: "Gestión de Residentes & Staff",
        header: "Administración de Identidades",
        icon: Users,
        color: "text-emerald-400",
        description: "Control centralizado de todas las personas vinculadas al complejo.",
        guide: [
            {
                title: "Perfiles de Usuario",
                text: "Cada usuario puede tener múltiples credenciales: desde su rostro registrado en una terminal Akuvox hasta el TAG de su vehículo y tarjetas RFID de proximidad.",
                image: "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&q=80&w=800"
            },
            {
                title: "Jerarquía de Roles",
                text: "Administradores, Guardias, Residentes y Visitas. El sistema aplica reglas de auditoría diferentes según el nivel de privilegio del usuario.",
                image: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "Biometría: Almacenamiento de templates faciales en base de datos cifrada.",
            "Middleware de Acceso: Validación cruzada entre Usuario -> Grupo -> Zona.",
            "Auditoría: Cada cambio en un perfil de usuario es registrado con timestamp."
        ]
    },
    vehicles: {
        title: "Control de Flota Vehicular",
        header: "Reconocimiento de Matrículas (LPR)",
        icon: Car,
        color: "text-rose-400",
        description: "Administración de vehículos permitidos y detección automática de marcas/modelos.",
        guide: [
            {
                title: "Registro de Matrículas",
                text: "Vincula las patentes a los propietarios de forma sencilla. El sistema admite múltiples vehículos por unidad habitacional.",
                image: "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&q=80&w=800"
            },
            {
                title: "Listas Negras y Bloqueos",
                text: "Configura alertas especiales para vehículos identificados como sospechosos o visitantes no autorizados.",
                image: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "OCR: Motor de reconocimiento Hikvision integrado vía ISAPI.",
            "Normalización: Algoritmos de limpieza de caracteres para evitar falsos negativos.",
            "Matching: Búsqueda indexada en base de datos para tiempos de respuesta críticos."
        ]
    },
    devices: {
        title: "Infraestructura de Red",
        header: "Gestión de Hardware IP",
        icon: Cpu,
        color: "text-cyan-400",
        description: "Configuración y diagnóstico de cámaras, terminales faciales y controladores de relé.",
        guide: [
            {
                title: "Estado de Conexión",
                text: "Monitorea en tiempo real si tus dispositivos están online. Si un nodo pierde conexión, el sistema dispara una alerta crítica.",
                image: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=800"
            },
            {
                title: "Configuración de Red",
                text: "Ajusta IPs, puertos y credenciales de acceso para cámaras Hikvision y terminales Akuvox directamente desde el panel.",
                image: "https://images.unsplash.com/photo-1558494949-ef010cbdcc51?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "Drivers: Soporte nativo para protocolos Hikvision ISAPI y Akuvox HTTP API.",
            "Watchdog: Pings periódicos para verificación de disponibilidad de red.",
            "Seguridad: Túneles cifrados para gestión remota de dispositivos."
        ]
    },
    history: {
        title: "Auditoría Forense",
        header: "Historial Maestro de Eventos",
        icon: History,
        color: "text-emerald-400",
        description: "Registro inmutable de cada interacción en los puntos de acceso.",
        guide: [
            {
                title: "Búsqueda Avanzada",
                text: "Filtra millones de registros por fecha, nombre de usuario, número de placa o tipo de acceso.",
                image: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&q=80&w=800"
            },
            {
                title: "Evidencia Visual",
                text: "Cada registro incluye la fotografía capturada al momento del evento, ideal para resolución de conflictos.",
                image: "https://images.unsplash.com/photo-1557597774-9d2739f85a94?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "Base de Datos: Histórico optimizado con particionado por fechas.",
            "Imágenes: Almacenamiento local o en nube con firmas de integridad.",
            "Exportación: Reportes dinámicos en formatos PDF, CSV y Excel."
        ]
    },
    groups: {
        title: "Motor de Reglas y Acceso",
        header: "Grupos y Jerarquías",
        icon: ShieldCheck,
        color: "text-sky-400",
        description: "Configuración de permisos granulares por zonas y horarios.",
        guide: [
            {
                title: "Zonas de Acceso",
                text: "Agrupa dispositivos para crear zonas lógicas como 'Garaje Principal', 'Oficinas', o 'Gimnasio'.",
                image: "https://images.unsplash.com/photo-1507925921958-8a62f3d1a50d?auto=format&fit=crop&q=80&w=800"
            },
            {
                title: "Horarios Permitidos",
                text: "Asocia franjas horarias a los grupos. Por ejemplo: el personal de limpieza solo tiene acceso de 09:00 a 18:00 hs.",
                image: "https://images.unsplash.com/photo-1516733725897-1aa73b87c8e8?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "Algoritmo de Decisión: Evaluación en cascada de reglas de acceso.",
            "Sincronización: Actualización automática de reglas en los dispositivos físicos.",
            "Conflictos: Resolución inteligente de permisos solapados."
        ]
    },
    calendar: {
        title: "Agenda de Operaciones",
        header: "Gestión de Eventos Programados",
        icon: Calendar,
        color: "text-indigo-400",
        description: "Coordinación de visitas, mantenimientos y turnos de vigilancia.",
        guide: [
            {
                title: "Reservas de Visitas",
                text: "Los residentes pueden pre-registrar visitas a través de la plataforma, generando accesos temporales automáticos.",
                image: "https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&q=80&w=800"
            },
            {
                title: "Turnos y Mantenimiento",
                text: "Visualiza cortes programados o mantenimientos de cámaras para no generar falsas alarmas de desconexión.",
                image: "https://images.unsplash.com/photo-1435527173128-983b87201f4d?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "Motor: Soporte nativo para recurrencias complejas (iCal compatible).",
            "Integración: Activación/desactivación automática de credenciales por fecha.",
            "Notificaciones: Alertas a propietarios cuando su visita ingresa al complejo."
        ]
    },
    debug: {
        title: "Consola de Diagnóstico",
        header: "Herramientas de Bajo Nivel",
        icon: Activity,
        color: "text-red-400",
        description: "Monitorización técnica para administradores de sistemas y desarrolladores.",
        guide: [
            {
                title: "Monitor de Webhooks",
                text: "Visualiza los datos crudos (Raw Data) que envían los dispositivos. Ideal para depurar configuraciones de red.",
                image: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=800"
            },
            {
                title: "Logs del Servidor",
                text: "Revisa errores de base de datos, latencia de red y respuestas de las APIs externas en tiempo real.",
                image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "Logging: Almacenamiento rotativo de logs del sistema.",
            "Red: Pruebas de loopback y ping integradas.",
            "Seguridad: Acceso restringido a la consola de debug por perfil superadmin."
        ]
    },
    units: {
        title: "Gestión de Unidades Habitacionales",
        header: "Estructura Catastral del Complejo",
        icon: Home,
        color: "text-amber-400",
        description: "Organización física y lógica de edificios, departamentos y parcelas.",
        guide: [
            {
                title: "Organización por Niveles",
                text: "Crea una jerarquía clara: desde el bloque o torre hasta la unidad individual, permitiendo una gestión granular.",
                image: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "Esquema: Soporte para multi-propiedad y vinculación de múltiples residentes.",
            "Metadatos: Capacidad de añadir campos personalizados por tipo de unidad."
        ]
    },
    plazas: {
        title: "Control de Estacionamiento",
        header: "Gestión de Plazas y Ocupación",
        icon: LayoutGrid,
        color: "text-purple-400",
        description: "Monitoreo inteligente de espacios de parqueo y asignaciones.",
        guide: [
            {
                title: "Mapa de Ocupación",
                text: "Visualiza en tiempo real qué plazas están libres, ocupadas o reservadas mediante la integración con cámaras LPR.",
                image: "https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "Lógica: Algoritmo de detección de ocupación promedia por entrada/salida.",
            "Alertas: Detección automática de vehículos en plazas no asignadas."
        ]
    },
    rfid: {
        title: "Control via RFID / TAG",
        header: "Credenciales de Proximidad",
        icon: CreditCard,
        color: "text-orange-400",
        description: "Gestión de tarjetas, llaveros y TAGs vehiculares UHF.",
        guide: [
            {
                title: "Lectores de Larga Distancia",
                text: "Configura antenas UHF para apertura de barreras sin necesidad de detener el vehículo, complementando el LPR.",
                image: "https://images.unsplash.com/photo-1614064641938-3bbee52942c7?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "Hardware: Protocolo Wiegand y OSDP para comunicación con lectores.",
            "Cifrado: Soporte para tarjetas MIFARE y HID de alta seguridad."
        ]
    },
    settings: {
        title: "Configuración del Sistema",
        header: "Panel de Ajustes Globales",
        icon: Settings,
        color: "text-slate-400",
        description: "Personalización y mantenimiento del core del servidor LPR-NODE.",
        guide: [
            {
                title: "Backups y Mantenimiento",
                text: "Configura la frecuencia de los respaldos de base de datos y la purga automática de logs de imágenes.",
                image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: [
            "API: Gestión de JWT tokens y secretos de integración.",
            "Webhooks: URL de destino para eventos críticos de seguridad."
        ]
    }
};

export default async function DocumentationPage({ params }: { params: Params }) {
    const { slug } = await params;
    const doc = MODULE_DOCS[slug] || {
        title: `Módulo: ${slug}`,
        header: "Documentación en curso",
        icon: Book,
        color: "text-muted-foreground",
        description: "Este módulo está siendo documentado actualmente. Por favor revisa más tarde.",
        guide: [
            {
                title: "Próximamente",
                text: "Estamos expandiendo la guía técnica para este componente del sistema.",
                image: "https://images.unsplash.com/photo-1586769852044-692d6e3703a0?auto=format&fit=crop&q=80&w=800"
            }
        ],
        technical: ["No hay especificaciones técnicas disponibles aún."]
    };

    const Icon = doc.icon;

    return (
        <div className="max-w-6xl mx-auto space-y-12 pb-24 animate-in fade-in duration-700">
            {/* Nav Header */}
            <div className="flex items-center justify-between">
                <Link
                    href="/admin/help"
                    className="group flex items-center gap-3 text-muted-foreground hover:text-foreground transition-all"
                >
                    <div className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center group-hover:bg-muted">
                        <ChevronLeft size={20} />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-widest">Volver al Centro de Soporte</span>
                </Link>

                <div className="flex items-center gap-2 px-4 py-1.5 bg-card border border-border rounded-full">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-bold text-foreground uppercase tracking-widest">Documento v1.4.2</span>
                </div>
            </div>

            {/* Hero Section */}
            <section className="relative p-12 bg-card border border-border rounded-2xl overflow-hidden shadow-lg">
                <div className={`absolute top-0 right-0 p-8 opacity-5 ${doc.color}`}>
                    <Icon size={300} />
                </div>

                <div className="relative z-10 flex flex-col md:flex-row items-center gap-10">
                    <div className={`w-20 h-20 rounded-3xl bg-muted border-2 border-border flex items-center justify-center shadow-lg ${doc.color}`}>
                        <Icon size={40} />
                    </div>
                    <div className="text-center md:text-left flex-1">
                        <p className={`text-xs font-bold uppercase tracking-[0.3em] mb-3 ${doc.color}`}>{doc.header}</p>
                        <h1 className="text-4xl md:text-5xl font-bold text-foreground uppercase tracking-tighter leading-none mb-4">
                            {doc.title}
                        </h1>
                        <p className="text-muted-foreground text-lg font-medium max-w-2xl leading-relaxed">
                            {doc.description}
                        </p>
                    </div>
                </div>
            </section>

            {/* Content Body */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                <div className="lg:col-span-8 space-y-16">
                    {doc.guide.map((item: any, i: number) => (
                        <article key={i} className="space-y-8 animate-in slide-in-from-bottom-6 duration-700" style={{ animationDelay: `${i * 150}ms` }}>
                            <div className="relative h-96 overflow-hidden rounded-2xl border border-border group shadow-lg">
                                <Image
                                    src={item.image}
                                    alt={item.title}
                                    fill
                                    className="object-cover transition-transform duration-1000 group-hover:scale-105"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-transparent to-transparent opacity-60" />
                                <div className="absolute bottom-8 left-8 right-8 p-6 bg-black/40 backdrop-blur-xl border border-border rounded-2xl">
                                    <h3 className="text-xl font-bold text-foreground uppercase tracking-tight">{item.title}</h3>
                                </div>
                            </div>
                            <div className="flex gap-6 px-4">
                                <div className="w-1.5 h-auto bg-blue-600 rounded-full shrink-0" />
                                <p className="text-lg text-muted-foreground leading-relaxed font-medium italic">
                                    "{item.text}"
                                </p>
                            </div>
                        </article>
                    ))}
                </div>

                {/* Sidebar Specs */}
                <aside className="lg:col-span-4 space-y-8">
                    <div className="p-8 bg-card border border-border rounded-2xl shadow-xl sticky top-8">
                        <h4 className="text-xs font-bold text-foreground uppercase tracking-widest mb-8 flex items-center gap-3">
                            <Code size={16} className="text-blue-400" /> Especificaciones Técnicas
                        </h4>

                        <div className="space-y-6">
                            {doc.technical.map((tech: string, i: number) => (
                                <div key={i} className="flex gap-4 group">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500/40 mt-1.5 shrink-0 group-hover:bg-blue-500 transition-colors" />
                                    <p className="text-sm text-muted-foreground font-medium leading-normal group-hover:text-muted-foreground transition-colors">
                                        {tech}
                                    </p>
                                </div>
                            ))}
                        </div>

                        <div className="mt-10 pt-8 border-t border-border space-y-4">
                            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                <span>Criticidad de Módulo</span>
                                <span className="text-orange-500">Alta</span>
                            </div>
                            <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                                <div className="w-[85%] h-full bg-gradient-to-r from-blue-600 to-indigo-600" />
                            </div>
                        </div>

                        <button className="w-full mt-10 h-14 bg-white text-black font-bold text-[10px] uppercase tracking-[0.2em] rounded-2xl hover:bg-muted transition-all flex items-center justify-center gap-2">
                            Ver Repositorio <ExternalLink size={14} />
                        </button>
                    </div>
                </aside>
            </div>

            {/* Quick Tips Footer */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { icon: Shield, title: "Seguridad", text: "Toda la data viaja por canales cifrados AES-256." },
                    { icon: Bell, title: "Alertas", text: "Configura notificaciones Push para este módulo." },
                    { icon: CheckCircle2, title: "Validado", text: "Cumple con normativas de protección de datos." }
                ].map((tip, i) => (
                    <div key={i} className="p-6 bg-card border border-border rounded-[1.5rem] flex items-start gap-4">
                        <div className="p-3 bg-foreground/10 rounded-xl text-muted-foreground">
                            <tip.icon size={18} />
                        </div>
                        <div>
                            <h5 className="text-[10px] font-bold text-foreground uppercase tracking-widest mb-1">{tip.title}</h5>
                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter leading-normal">{tip.text}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
