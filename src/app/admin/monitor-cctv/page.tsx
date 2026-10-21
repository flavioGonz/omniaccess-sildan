"use client";

import { MarcoMonitor } from "@/components/monitor/MarcoMonitor";
import { VistaCamaras } from "@/components/monitor/vistas/VistaCamaras";

/**
 * Monitor CCTV (21/10, Nico: «tenemos que crear el Monitor CCTV, como elemento del menú», junto a
 * Monitor LPR y Monitor Intrusión).
 *
 * No es una pantalla nueva: es la pared de cámaras que ya existía como vista de pantalla
 * (/monitor/camaras: disposiciones, vistas guardadas, seguimiento, PTZ, grabación, OmniVision),
 * que sólo se abría desde Monitores, fuera del panel. Acá va dentro del panel, en el marco
 * `embebido`: ocupa el lugar de la página y la pantalla completa agranda sólo las cámaras.
 * Las alertas globales (intrusión, lista negra) ya las monta el layout del panel.
 */
export default function MonitorCctv() {
    return (
        <div className="h-screen">
            <MarcoMonitor embebido>
                <VistaCamaras />
            </MarcoMonitor>
        </div>
    );
}
