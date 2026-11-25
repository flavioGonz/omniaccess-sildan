import { SoloConFuncion } from "@/components/funciones/SoloConFuncion";

/* Pantalla de la característica Rastreo GPS (25/11): apagada en Ajustes › Características, no existe. */
export default function Layout({ children }: { children: React.ReactNode }) {
    return <SoloConFuncion id="FUNC_GPS">{children}</SoloConFuncion>;
}
