import { redirect } from "next/navigation";

/**
 * Los tableros viejos (/dashboard-lpr, /dashboard-acceso, /dashboard-mixto) se reemplazaron
 * por las vistas de pantalla de Monitores (/monitor/*). Quedaban sin mantener, fuera del
 * diseño y con datos de otra época; quien tenga la URL guardada llega a Monitores.
 */
export default function TableroViejo() { redirect("/admin/monitores"); }
