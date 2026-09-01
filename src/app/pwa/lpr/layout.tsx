import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
    title: "LPR en Vivo",
    manifest: "/manifest-lpr.json",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "LPR" },
    icons: { apple: "/iconos/lpr-192.png" },
};

export const viewport: Viewport = {
    themeColor: "#3b82f6",
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
};

export default function LprPwaLayout({ children }: { children: React.ReactNode }) {
    return children;
}
