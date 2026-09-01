import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
    title: "Aforo en Vivo",
    manifest: "/manifest-filas.json",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Aforo" },
    icons: { apple: "/iconos/filas-192.png" },
};

export const viewport: Viewport = {
    themeColor: "#7c3aed",
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
};

export default function FilasPwaLayout({ children }: { children: React.ReactNode }) {
    return <div className="min-h-screen bg-card text-white antialiased select-none">{children}</div>;
}
