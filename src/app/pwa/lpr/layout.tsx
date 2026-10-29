import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
    title: "LPR en Vivo",
    manifest: "/manifest-lpr.json",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "LPR" },
    icons: { apple: "/iconos/lpr-192.png" },
};

export const viewport: Viewport = {
    // El color de la barra del sistema acompaña al tema del teléfono (antes era azul fijo).
    themeColor: [
        { media: "(prefers-color-scheme: dark)", color: "#0b0d12" },
        { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    ],
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
};

export default function LprPwaLayout({ children }: { children: React.ReactNode }) {
    return children;
}
