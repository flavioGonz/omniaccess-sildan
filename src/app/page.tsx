import { redirect } from "next/navigation";

/**
 * La raíz. Quien llega acá lo decide el middleware: con sesión va al panel, sin ella a entrar.
 * Esta página existe por si alguna vez se la alcanza sin pasar por ahí — antes tenía todavía la
 * plantilla de «create-next-app», con el logo de Vercel, en la puerta de entrada del dominio.
 */
export default function Raiz() {
    redirect("/login");
}
