"use client";

import { useFuncion } from "@/lib/funciones-cliente";
import { hayEquiposDeAcceso } from "@/app/actions/bitacora-equipos";
import React, { useRef, useState, useEffect } from "react";
import { useSessionRole } from "@/hooks/useSessionRole";
import { OnlineUsersWidget } from "@/components/OnlineUsersWidget";
import { GpuPulso } from "@/components/GpuPulso";
import { OmniLogo } from "@/components/brand/OmniLogo";
import LiveEdgeKeeper from "@/components/LiveEdgeKeeper";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, ChevronLeft, PanelLeftClose, Pin, ChevronRight, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { getEnabledModules, type ModuleId } from "@/app/actions/modules";
import { logout } from "@/app/actions/auth";
import AforoAlertOverlay from "@/components/AforoAlertOverlay";
import AlertaIntrusionGlobal from "@/components/intrusion/AlertaIntrusionGlobal";
import AlertaCentralGlobal from "@/components/centrales/AlertaCentralGlobal";
import { PilaAvisos } from "@/components/avisos/PilaAvisos";
import { AvisosLpr } from "@/components/avisos/AvisosLpr";
import { CargarMarcasCamara } from "@/components/CargarMarcasCamara";
import { VivoProvider } from "@/components/vivo/PanelVivo";

/** El ancho del menú desplegado (w-64) y cuánto más allá puede irse el mouse sin que se esconda. */
const MENU_ANCHO_PX = 256;
const MENU_MARGEN_PX = 28;

import { contarListaNegra, contarListaAmarilla } from "@/app/actions/watchlist";
import { contarCensoPendiente } from "@/app/actions/censo";
import { hayRastreadoresGps } from "@/app/actions/gps";
import { activoDe, armarMenu } from "@/lib/menu";
import { MenuLateral } from "@/components/menu/MenuLateral";
import { SECCIONES_OMNIVISION } from "@/components/vision/NavOmniVision";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    // «Plazas de parking» es una función de LPR que se apaga (20/10: San Nicolás no la usa).
    const plazasOn = useFuncion("LPR_PLAZAS");
    // Intrusión y alarmas son funciones de la instalación, no del modo (openspec alarmas-como-funciones):
    // valen igual en Matrículas, Rostro y Filas. `null` (todavía no se sabe) cuenta como apagada.
    const intrusionOn = useFuncion("FUNC_INTRUSION") === true;
    const recepcionOn = useFuncion("FUNC_ALARMAS_RECEPCION") === true;
    const gestionOn = useFuncion("FUNC_ALARMAS_GESTION") === true;
    const searchParams = useSearchParams();
    // Y la Lista Amarilla la suya (12/11, Nico), sólo con la función de LPR prendida.
    const amarillaOn = useFuncion("LPR_BUSQUEDA") === true;
    const censoOn = useFuncion("PADRON_CENSO") === true;
    /* La bitácora de equipos sólo si hay alguno: una sección vacía en un barrio sin porteros es
       una promesa que no se cumple. Se pregunta una vez al entrar. */
    const [hayAccesos, setHayAccesos] = useState(false);
    useEffect(() => { hayEquiposDeAcceso().then(setHayAccesos).catch(() => { }); }, []);
    /* Gestión GPS, lo mismo: aparece donde hay algún rastreador (23/11). Se vuelve a preguntar al
       cambiar de pantalla, así aparece sola después de dar de alta el primero en Dispositivos. */
    const [hayGps, setHayGps] = useState(false);
    useEffect(() => { hayRastreadoresGps().then(setHayGps).catch(() => { }); }, [pathname]);
    const router = useRouter();
    const [angosto, setCollapsed] = useState(false);
    /*
     * El menú lateral, oculto (13/11). Nació para Monitor CCTV («el sidebar debe ocultarse sin
     * bordes para poder usarlo como VMS más cómodo; algo flotante que lo llame, oculto y premium»)
     * y esa misma tarde Nico lo pidió para todo: «me encantó el sidebar que se oculta, debe ser así
     * para todo OmniAccess».
     *
     * El menú sale del todo —sin la columna de 70 px ni su borde— y la pantalla ocupa el ancho
     * entero. Se lo llama acercando el mouse al borde izquierdo (o tocando la pestaña): aparece
     * FLOTANDO sobre la pantalla, sin empujarla (una pared de cámaras no se reacomoda ni
     * reconecta), y se va al sacarle el mouse, al elegir adónde ir, con Esc o tocando afuera.
     * Quien lo prefiera a la vista lo clava con el alfiler; se recuerda en este navegador.
     */
    const [menu, setMenu] = useState<"oculto" | "fijo">("oculto");
    const [asomado, setAsomado] = useState(false);
    // `oa.cctv.menu` era la clave cuando valía sólo para Monitor CCTV: quien lo había clavado ahí lo conserva.
    useEffect(() => { try { if ((localStorage.getItem("oa.menu") ?? localStorage.getItem("oa.cctv.menu")) === "fijo") setMenu("fijo"); } catch { /* sin almacenamiento: oculto */ } }, []);
    const fijarMenu = (m: "oculto" | "fijo") => { setMenu(m); setAsomado(false); try { localStorage.setItem("oa.menu", m); } catch { /* idem */ } };
    /* En un celular el menú es SIEMPRE el que flota (23/11): fijo ocupa 256 px de los 390 que hay, y
       lo que queda no es una pantalla. Quien lo tenía clavado en el escritorio lo sigue teniendo ahí. */
    const [celular, setCelular] = useState(false);
    useEffect(() => {
        const m = window.matchMedia("(max-width: 639px)");
        const leer = () => setCelular(m.matches);
        leer(); m.addEventListener("change", leer);
        return () => m.removeEventListener("change", leer);
    }, []);
    const sinMenu = menu === "oculto" || celular;
    // Oculto se muestra siempre entero: la versión de íconos solos es para cuando queda fijo.
    const collapsed = angosto && !sinMenu;
    /* Sacar el mouse lo esconde con una pausa: al rozar el borde de la ventana el navegador avisa
       «salió», y sin pausa el menú se cerraba en la cara. Volver a entrar la cancela. */
    const irse = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quedarse = () => { if (irse.current) { clearTimeout(irse.current); irse.current = null; } };
    const asomar = () => { quedarse(); setAsomado(true); };
    const esconder = (ms = 260) => { quedarse(); irse.current = setTimeout(() => setAsomado(false), ms); };
    useEffect(() => () => quedarse(), []);
    /* Una pantalla puede pedir el menú con su propio botón (Gestión GPS lo hace en el celular, donde
       la pestaña del borde es fina para un pulgar): avisa con `oa:menu` y acá se lo asoma. */
    useEffect(() => {
        const abrir = () => { quedarse(); setAsomado(true); };
        window.addEventListener("oa:menu", abrir);
        return () => window.removeEventListener("oa:menu", abrir);
    }, []);
    useEffect(() => { if (!sinMenu) setAsomado(false); }, [sinMenu]);
    // Se eligió adónde ir: el menú ya cumplió.
    useEffect(() => { quedarse(); setAsomado(false); }, [pathname, searchParams]);
    /*
     * Cuándo se va: por DÓNDE está el mouse, no por «entró / salió» del menú. El menú llega
     * deslizándose debajo de un puntero que quizá está quieto, y el navegador no avisa «entró»
     * hasta que el puntero se mueve; con entradas y salidas quedaba abierto para siempre si el
     * mouse se iba antes de que el menú llegara (visto al probarlo). Lejos del menú, se va.
     */
    useEffect(() => {
        if (!asomado) return;
        const k = (e: KeyboardEvent) => { if (e.key === "Escape") setAsomado(false); };
        const m = (e: MouseEvent) => { if (e.clientX > MENU_ANCHO_PX + MENU_MARGEN_PX) { if (!irse.current) esconder(); } else quedarse(); };
        window.addEventListener("keydown", k); window.addEventListener("mousemove", m);
        return () => { window.removeEventListener("keydown", k); window.removeEventListener("mousemove", m); };
    }, [asomado]); // eslint-disable-line react-hooks/exhaustive-deps
    // El menú se arma por permiso del rol de aplicación (lib/permisos), no por "es admin":
    // cada entrada pregunta si el rol puede abrir su pantalla (lib/menu.ts).
    const { loaded: roleLoaded, tiene, puede } = useSessionRole();
    const [loggingOut, setLoggingOut] = useState(false);
    const [modules, setModules] = useState<Record<ModuleId, boolean>>({
        MODULE_LPR: true,
        MODULE_FACE: false,
        MODULE_QUEUE: false,
        MODULE_GUARD: false,
    });
    /**
     * Hasta saber qué modo corre y qué ve este rol, el menú no se dibuja: se dibujaba con un modo
     * supuesto (Matrículas Y Rostro) y sin permisos, así que al recargar aparecían los rótulos
     * «Gestión · LPR · FACE» solos, sin nada abajo, y FACE en una instalación de Matrículas.
     */
    const [modulosListos, setModulosListos] = useState(false);

    // La insignia de Lista negra: se relee al cambiar de pantalla (marcar o sacar una matrícula
    // pasa en Usuarios, y al volver al menú ya se ve) y cada minuto.
    const [enListaNegraN, setEnListaNegraN] = useState(0);
    const [enListaAmarillaN, setEnListaAmarillaN] = useState(0);
    const [censoPendienteN, setCensoPendienteN] = useState(0);
    useEffect(() => {
        const leer = () => {
            contarListaNegra().then(setEnListaNegraN).catch(() => { });
            contarListaAmarilla().then(setEnListaAmarillaN).catch(() => { });
            contarCensoPendiente().then(setCensoPendienteN).catch(() => { });
        };
        leer();
        const iv = setInterval(leer, 60_000);
        return () => clearInterval(iv);
    }, [pathname]);
    useEffect(() => {
        getEnabledModules().then(setModules).catch(() => { }).finally(() => setModulosListos(true));
    }, []);

    /* El menú de esta instalación para este rol (lib/menu.ts tiene el árbol y el porqué de su orden).
       Se arma en cada dibujo: son cincuenta renglones, y memorizarlo pediría que `puede` no cambiara. */
    const arbol = armarMenu({
        modos: { lpr: modules.MODULE_LPR, rostro: modules.MODULE_FACE, filas: modules.MODULE_QUEUE, guardia: modules.MODULE_GUARD },
        func: { intrusion: intrusionOn, recepcion: recepcionOn, amarilla: amarillaOn, censo: censoOn, plazas: plazasOn === true },
        hay: { accesos: hayAccesos, gps: hayGps },
        cuentas: { negra: enListaNegraN, amarilla: enListaAmarillaN, censo: censoPendienteN },
        puede, tiene,
        omnivision: SECCIONES_OMNIVISION.map((x) => ({ href: x.href, rotulo: x.rotulo })),
    });
    const activoMenu = activoDe(arbol, pathname || "", searchParams?.toString() || "");

    const handleLogout = async () => {
        setLoggingOut(true);
        try {
            // Limpiar estado local para no arrastrar config/identidad de la sesion anterior
            try {
                Object.keys(localStorage).forEach((k) => {
                    if (/^(dashboard_|guard|bitacora_|oa_|omni_)/i.test(k)) localStorage.removeItem(k);
                });
            } catch {}
            await logout();
            router.push('/login');
        } catch {
            setLoggingOut(false);
        }
    };

    return (
        /*
         * Las cámaras fijadas cuelgan del ARMAZÓN, no de la pantalla.
         *
         * El `layout` de Next no se desmonta al cambiar de ruta: el mismo elemento
         * `<video>` sigue vivo, con su RTSP abierto, mientras abajo cambia la página. Eso
         * es todo el punto — un puesto de guardia deja una cámara puesta y sigue
         * trabajando en otra pantalla, y cortar el flujo al navegar cuesta unos segundos
         * de negro al volver, que es justo cuando el momento que se quería ver ya pasó.
         * Montar esto dentro de una pantalla, o en un portal que la pantalla crea, no
         * alcanza: el portal muere con quien lo creó.
         */
        <VivoProvider>
        <div className="flex min-h-screen bg-background text-foreground font-sans">
            {/* Sidebar */}
            {/* El menú oculto: una franja invisible en el borde izquierdo lo llama al acercar el mouse, y una
                pestaña fina a media altura dice que está (y sirve para el dedo, que no «pasa por encima»). */}
            {sinMenu && !asomado && (
                <>
                    <div aria-hidden="true" onMouseEnter={asomar} className="fixed left-0 top-0 z-30 h-full w-1.5" />
                    <button type="button" onMouseEnter={asomar} onClick={asomar} aria-label="Mostrar el menú" title="Menú"
                        className="group fixed left-0 top-1/2 -translate-y-1/2 z-30 h-20 w-3.5 hover:w-6 rounded-r-[10px] grid place-items-center bg-card/70 backdrop-blur-md border border-l-0 border-border text-muted-foreground hover:text-foreground transition-[width,color] duration-200">
                        <ChevronRight size={13} className="opacity-60 group-hover:opacity-100 transition-opacity" />
                    </button>
                </>
            )}
            {/* Con el dedo no hay «sacar el mouse»: tocar afuera lo cierra. */}
            {sinMenu && asomado && <div aria-hidden="true" onClick={() => setAsomado(false)} className="fixed inset-0 z-[39]" />}
            <aside
                className={cn(
                    "border-border flex flex-col fixed h-full bg-card/80 backdrop-blur-xl transition-all duration-300 ease-in-out",
                    collapsed ? "w-[70px]" : "w-64",
                    // Oculto: fuera de la pantalla, sin borde; asomado, flota sobre lo que haya.
                    sinMenu ? cn("z-40 border-r-0", asomado ? "translate-x-0 shadow-[var(--sombra-flotante)]" : "-translate-x-full pointer-events-none") : "z-20 border-r"
                )}
            >
                <div className="p-4 border-b border-border bg-foreground/[0.02] flex items-center justify-between h-[60px]">
                    <div className={cn("flex items-center gap-2 overflow-hidden transition-all", collapsed ? "w-0 opacity-0" : "w-auto opacity-100")}>
                        <OmniLogo size={24} className="shrink-0" />
                        <div className="whitespace-nowrap">
                            {/* El nombre escrito normal y la bajada en gris: sin mayúsculas espaciadas ni un color por modo. */}
                            <h2 className="text-[14px] font-semibold leading-tight text-foreground">OmniAccess</h2>
                            <p className="text-[11.5px] leading-tight text-muted-foreground">{modules.MODULE_QUEUE ? "Control de filas" : "Control y acceso"}</p>
                        </div>
                    </div>

                    {/* Clavarlo a la vista, o volver a esconderlo para que la pantalla ocupe todo. */}
                    {!collapsed && (
                        <button onClick={() => fijarMenu(sinMenu ? "fijo" : "oculto")} title={sinMenu ? "Dejar el menú fijo, a la vista" : "Ocultar el menú: la pantalla a todo el ancho"} aria-label={sinMenu ? "Dejar el menú fijo" : "Ocultar el menú"}
                            className="ml-auto mr-1 p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
                            {sinMenu ? <Pin size={15} /> : <PanelLeftClose size={16} />}
                        </button>
                    )}
                    {/* Achicarlo a íconos sólo tiene sentido cuando está fijo. */}
                    {!sinMenu && (
                        <button
                            onClick={() => setCollapsed(!angosto)}
                            title={collapsed ? "Mostrar los nombres" : "Dejar sólo los íconos"}
                            className={cn(
                                "p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors",
                                collapsed && "mx-auto"
                            )}
                        >
                            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                        </button>
                    )}
                </div>

                <nav className="flex-1 overflow-y-auto px-2 pb-3 pt-2 custom-scrollbar" aria-label="Menú de OmniAccess">
                    {!(modulosListos && roleLoaded) ? <EsqueletoMenu collapsed={collapsed} /> : (<>
                    {/* Qué entradas hay lo dice lib/menu.ts; cómo se ven, components/menu/MenuLateral. */}
                    <MenuLateral menu={arbol} activo={activoMenu} plegado={collapsed} />
                                    </>)}
                </nav>

                <div className="p-3 border-t border-border space-y-2">
                    {/* Quien esta mirando y cuanto esta trabajando la placa, en la misma
                        linea: son las dos cosas que se miran de reojo sin entrar a ningun lado. */}
                    <div className={cn("flex items-center gap-2", collapsed && "flex-col gap-1.5")}>
                        <div className="flex-1 min-w-0"><OnlineUsersWidget collapsed={collapsed} /></div>
                        <GpuPulso collapsed={collapsed} />
                    </div>
                    <div className={cn("flex items-center gap-3 group p-2 rounded-2xl hover:bg-accent/50 transition-colors", collapsed && "justify-center p-0 hover:bg-transparent")}>
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white font-bold text-xs shadow-lg shadow-blue-500/20 shrink-0">
                            A
                        </div>
                        {!collapsed && (
                            <div className="overflow-hidden">
                                <p className="text-sm font-bold text-foreground leading-tight truncate">Admin User</p>
                                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter truncate">Super Admin</p>
                            </div>
                        )}
                        {!collapsed && (
                            <div className="ml-auto flex items-center gap-1.5">
                                {/* Sin campana: contaba alertas de equipos y llevaba a Notificaciones, que no
                                    las muestra. Las notificaciones viven en Configuración → Notificaciones. */}
                                <ThemeToggle />
                                <button
                                    onClick={handleLogout}
                                    disabled={loggingOut}
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    title="Cerrar sesión"
                                >
                                    <LogOut size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                    {collapsed && (
                        <div className="w-full flex justify-center mb-1"><ThemeToggle /></div>
                    )}
                    {collapsed && (
                        <button
                            onClick={handleLogout}
                            disabled={loggingOut}
                            className="w-full flex justify-center p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Cerrar sesión"
                        >
                            <LogOut size={16} />
                        </button>
                    )}
                </div>
            </aside>

            <main
                className={cn(
                    /* `dvh` donde exista: en un celular, 100vh incluye la barra del navegador y el final de la página queda tapado. */
                    "flex-1 overflow-y-auto custom-scrollbar transition-all duration-300 ease-in-out font-sans h-screen supports-[height:100dvh]:h-dvh",
                    sinMenu ? "ml-0" : collapsed ? "ml-[70px]" : "ml-64"
                )}
            >
                {/* El corte real lo hace el middleware (redirige a /admin/sin-permiso); esto es
                    el respaldo para la navegación del lado del cliente, con el mismo mensaje. */}
                {roleLoaded && pathname && !puede(pathname) ? (
                    <div className="flex flex-col items-center justify-center h-[70vh] text-center gap-3 text-muted-foreground p-8">
                        <ShieldCheck size={40} className="text-[var(--aviso)]" />
                        <h2 className="text-lg font-bold text-foreground">Esta pantalla no está en tu rol</h2>
                        <p className="text-sm max-w-sm">Un administrador puede agregar el permiso en Ajustes → Accesos al panel; después hay que volver a iniciar sesión.</p>
                    </div>
                ) : children}
            </main>

            {/* Sólo con el módulo de Filas: sin él consultaba tres acciones cada 20 s y abría un socket
                en cada pantalla del panel, en barrios que no tienen ninguna cámara de aforo (15/10). */}
            {modulosListos && modules.MODULE_QUEUE && <AforoAlertOverlay />}
            {/* Intrusión confirmada por una cámara: respira en rojo en TODA la aplicación hasta que alguien decida real / falsa. */}
            {intrusionOn && <AlertaIntrusionGlobal />}
            {/* Los eventos de las centrales de alarma: su propia ficha, que se trata (22/10). */}
            {gestionOn && <AlertaCentralGlobal />}
            {/* Los avisos de toda la app, en una sola pila abajo al centro (20/10): intrusión, lista negra, merodeo, patrones y OmniVision. */}
            <AvisosLpr />
            <PilaAvisos />
            <CargarMarcasCamara />
            <LiveEdgeKeeper />

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: var(--border);
                    border-radius: 10px;
                }
            `}</style>
        </div>
        </VivoProvider>
    );
}

/** El lugar del menú mientras se sabe el modo y los permisos: renglones grises, sin rótulos sueltos. */
function EsqueletoMenu({ collapsed }: { collapsed: boolean }) {
    return (
        <div aria-hidden="true" className="space-y-1 pt-1">
            {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className={cn("flex items-center gap-3 px-3 py-2.5", collapsed && "justify-center px-0")}>
                    <span className="w-[18px] h-[18px] rounded-[5px] bg-muted animate-pulse shrink-0" />
                    {!collapsed && <span className="h-3 rounded bg-muted animate-pulse" style={{ width: `${55 + ((i * 37) % 35)}%` }} />}
                </div>
            ))}
        </div>
    );
}
