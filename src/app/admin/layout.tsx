"use client";

import { useFuncion } from "@/lib/funciones-cliente";
import { hayEquiposDeAcceso } from "@/app/actions/bitacora-equipos";
import React, { useState, useEffect } from "react";
import { useSessionRole } from "@/hooks/useSessionRole";
import { OnlineUsersWidget } from "@/components/OnlineUsersWidget";
import { GpuPulso } from "@/components/GpuPulso";
import { OmniLogo } from "@/components/brand/OmniLogo";
import LiveEdgeKeeper from "@/components/LiveEdgeKeeper";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, PanelLeftClose, PanelLeftOpen, Pin, PinOff, ChevronRight, LogOut } from "lucide-react";
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

import { contarListaNegra, contarListaAmarilla } from "@/app/actions/watchlist";
import { contarCensoPendiente } from "@/app/actions/censo";
import { hayRastreadoresGps } from "@/app/actions/gps";
import { activoDe, armarMenu, hojasDe } from "@/lib/menu";
import { MenuLateral } from "@/components/menu/MenuLateral";
import { Buscador } from "@/components/menu/Buscador";
import { useMenuLateral } from "@/hooks/useMenuLateral";
import { DONDE_VALE } from "@/lib/menu-estado";
import { Pista } from "@/components/ui/pista";

/** Los botones que mueven el menú, en el pie: 36 px, sin fondo hasta que se les pasa por encima. */
const BOTON_MENU = "grid h-9 w-9 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--accion)]";
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
    /* El menú lateral: a la vista, sólo íconos u oculto, según la pantalla y lo que la persona haya
       elegido (lib/menu-estado.ts tiene la regla; hooks/useMenuLateral, el ir y venir cuando flota). */
    const { estado: estadoMenu, clase: claseMenu, celular, sinMenu, asomado, plegado: collapsed, elegir: elegirMenu, asomar, cerrar: cerrarMenu, animar } = useMenuLateral(pathname || "", searchParams?.toString() || "");
    // El menú se arma por permiso del rol de aplicación (lib/permisos), no por "es admin":
    // cada entrada pregunta si el rol puede abrir su pantalla (lib/menu.ts).
    const { loaded: roleLoaded, tiene, puede, name: quien, rolApp } = useSessionRole();
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
    /* Hasta saber el modo y los permisos no hay menú que mostrar, ni pantallas que buscar. */
    const listoMenu = modulosListos && roleLoaded;

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
            {sinMenu && asomado && <div aria-hidden="true" onClick={cerrarMenu} className="fixed inset-0 z-[39]" />}
            <aside
                data-menu={estadoMenu}
                className={cn(
                    "border-border flex flex-col fixed h-full bg-card/80 backdrop-blur-xl",
                    animar ? "transition-[width,translate] duration-300 ease-in-out" : "transition-none",
                    collapsed ? "w-[70px]" : "w-64",
                    // Oculto: fuera de la pantalla, sin borde; asomado, flota sobre lo que haya.
                    sinMenu ? cn("z-40 border-r-0", asomado ? "translate-x-0 shadow-[var(--sombra-flotante)]" : "-translate-x-full pointer-events-none")
                        /* `max-sm:`: lo que el servidor manda no sabe si es un celular, y hasta que el navegador
                           toma la página el menú salía fijo, ocupando dos tercios de la pantalla del teléfono. */
                        : "z-20 border-r max-sm:-translate-x-full max-sm:pointer-events-none"
                )}
            >
                {/* Arriba, sólo de quién es esto. Los botones que mueven el menú bajaron al pie (23/11): acá
                    arriba quedaban pegados al nombre, y en la columna de íconos el de achicar ocupaba el
                    lugar del logo —el menú angosto no decía de qué programa era—. */}
                <div className={cn("flex h-[60px] shrink-0 items-center gap-2 border-b border-border px-4", collapsed && "justify-center px-0")}>
                    <OmniLogo size={24} className="shrink-0" />
                    {!collapsed && (
                        <div className="min-w-0 whitespace-nowrap">
                            {/* El nombre escrito normal y la bajada en gris: sin mayúsculas espaciadas ni un color por modo. */}
                            <h2 className="text-[14px] font-semibold leading-tight text-foreground">OmniAccess</h2>
                            <p className="text-[11.5px] leading-tight text-muted-foreground">{modules.MODULE_QUEUE ? "Control de filas" : "Control y acceso"}</p>
                        </div>
                    )}
                </div>

                <nav className="flex-1 overflow-y-auto px-2 pb-3 pt-2 custom-scrollbar" aria-label="Menú de OmniAccess">
                    {!listoMenu ? <EsqueletoMenu collapsed={collapsed} /> : (
                        /* Qué entradas hay lo dice lib/menu.ts; cómo se ven, components/menu/MenuLateral. */
                        <MenuLateral menu={arbol} activo={activoMenu} plegado={collapsed} />
                    )}
                </nav>

                <div className="shrink-0 space-y-2 border-t border-border p-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))]">
                    {/* Quien esta mirando y cuanto esta trabajando la placa, en la misma
                        linea: son las dos cosas que se miran de reojo sin entrar a ningun lado. */}
                    <div className={cn("flex items-center gap-2", collapsed && "flex-col gap-1.5")}>
                        <div className="flex-1 min-w-0"><OnlineUsersWidget collapsed={collapsed} /></div>
                        <GpuPulso collapsed={collapsed} />
                    </div>
                    {/* Quién entró. Decía «Admin User · Super Admin» escrito a mano, para cualquiera que
                        entrara: un operador veía que era súper administrador. Ahora es el nombre y el rol
                        de la sesión, y mientras no se sabe no dice nada. */}
                    <div className={cn("flex items-center gap-2.5 px-1", collapsed && "flex-col gap-1.5 px-0")}>
                        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-[12px] font-semibold uppercase text-foreground">{(quien || "").trim().charAt(0) || "·"}</span>
                        {!collapsed && (
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium leading-tight text-foreground">{quien || " "}</p>
                                <p className="truncate text-[11.5px] leading-tight text-muted-foreground">{rolApp || " "}</p>
                            </div>
                        )}
                        <button onClick={handleLogout} disabled={loggingOut} title="Cerrar sesión" aria-label="Cerrar sesión" className={cn(BOTON_MENU, "shrink-0 disabled:opacity-50")}>
                            <LogOut size={15} />
                        </button>
                    </div>
                    {/*
                      * Los dos botones que mueven el menú, abajo y en las puntas como en el de Cloudflare:
                      * a la izquierda, achicarlo a íconos; a la derecha, soltarlo (se oculta y aparece al
                      * acercar el mouse) o clavarlo. Lo que se elige vale para la clase de pantalla en la
                      * que se está, y el cartel lo dice: sin eso, ocultarlo en un monitor y encontrarlo
                      * a la vista en Residentes parecería que «no lo guardó».
                      * En un celular no están: ahí el menú siempre flota. Entre los dos, el tema claro u oscuro.
                      */}
                    {/* En la columna de íconos van al revés, así el de achicar queda en el mismo lugar —abajo de todo—
                        y se lo puede volver a tocar sin mover el mouse. */}
                    <div className={cn("flex items-center gap-0.5", collapsed && "flex-col-reverse")}>
                        {/* Achicarlo a íconos sólo tiene sentido cuando está fijo. */}
                        {!sinMenu && (
                            <Pista lado={collapsed ? "derecha" : "arriba"} texto={collapsed ? "Mostrar los nombres" : `Achicar a íconos ${DONDE_VALE[claseMenu]}`}>
                                <button type="button" onClick={() => elegirMenu(collapsed ? "vista" : "iconos")} aria-label={collapsed ? "Mostrar los nombres del menú" : "Achicar el menú a íconos"} className={BOTON_MENU}>
                                    {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                                </button>
                            </Pista>
                        )}
                        {/* Sin campana: contaba alertas de equipos y llevaba a Notificaciones, que no
                            las muestra. Las notificaciones viven en Configuración → Notificaciones. */}
                        <span className={cn(!collapsed && "ml-auto")}><ThemeToggle discreto /></span>
                        {!collapsed && !celular && (
                            <Pista lado="arriba"
                                titulo={sinMenu ? "Dejarlo a la vista" : "Ocultarlo"}
                                texto={sinMenu ? `El menú queda fijo ${DONDE_VALE[claseMenu]}.` : `El menú se va ${DONDE_VALE[claseMenu]} y la pantalla ocupa todo el ancho. Vuelve al acercar el mouse al borde izquierdo.`}>
                                <button type="button" onClick={() => elegirMenu(sinMenu ? "vista" : "oculto")} aria-label={sinMenu ? "Dejar el menú a la vista" : "Ocultar el menú"} className={BOTON_MENU}>
                                    {sinMenu ? <Pin size={15} /> : <PinOff size={15} />}
                                </button>
                            </Pista>
                        )}
                    </div>
                </div>
            </aside>

            <main
                className={cn(
                    /* `dvh` donde exista: en un celular, 100vh incluye la barra del navegador y el final de la página queda tapado. */
                    "flex-1 overflow-y-auto custom-scrollbar font-sans h-screen supports-[height:100dvh]:h-dvh",
                    animar ? "transition-[margin] duration-300 ease-in-out" : "transition-none",
                    sinMenu ? "ml-0" : collapsed ? "sm:ml-[70px]" : "sm:ml-64"
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
            {/* El buscador de pantallas (Ctrl K): sale del mismo árbol que el menú, así que no ofrece nada que el rol no
                vea ahí. No tiene botón en el menú: Nico lo sacó de ahí el mismo día (23/11). */}
            {listoMenu && <Buscador hojas={hojasDe(arbol)} />}
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
