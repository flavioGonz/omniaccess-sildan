import { NavOmniVision } from "@/components/vision/NavOmniVision";

/** Todas las pantallas de OmniVision comparten la barra de arriba (ver NavOmniVision). */
export default function LayoutOmniVision({ children }: { children: React.ReactNode }) {
    return (
        <>
            <div className="px-6 lg:px-8 pt-4 max-w-[1500px] mx-auto"><NavOmniVision /></div>
            {children}
        </>
    );
}
