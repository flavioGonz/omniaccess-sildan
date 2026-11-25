import { SoloConFuncion } from "@/components/funciones/SoloConFuncion";

/* Pantalla de la característica Face (25/11): con Face apagada en Ajustes › Características, no existe. */
export default function Layout({ children }: { children: React.ReactNode }) {
    return <SoloConFuncion id="FUNC_FACE">{children}</SoloConFuncion>;
}
