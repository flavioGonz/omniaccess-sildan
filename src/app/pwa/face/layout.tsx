import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
    title: "Facial en Vivo",
    manifest: "/manifest-face.json",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Facial" },
    icons: { apple: "/iconos/face-192.png" },
};

export const viewport: Viewport = {
    themeColor: "#22c55e",
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
};

export default function FacePwaLayout({ children }: { children: React.ReactNode }) {
    return children;
}
