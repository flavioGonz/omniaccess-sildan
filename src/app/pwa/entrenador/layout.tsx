import type { Metadata, Viewport } from "next";

/**
 * El Entrenador como app del celular (PWA): su propio manifiesto e ícono, para que «Agregar a la
 * pantalla de inicio» lo deje como una app aparte del panel. La sesión es la del panel: la API
 * pide la misma cookie, y sin ella la pantalla manda a entrar y vuelve acá.
 */
export const metadata: Metadata = {
    title: "Entrenador",
    manifest: "/manifest-entrenador.json",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Entrenador" },
    icons: { apple: "/iconos/entrenador-192.png", icon: "/iconos/entrenador-192.png" },
};

export const viewport: Viewport = {
    themeColor: "#0b1220",
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
};

export default function EntrenadorLayout({ children }: { children: React.ReactNode }) {
    return children;
}
