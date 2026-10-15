/**
 * Cómo se dice cada rol de una persona en pantalla. Está repetido en media docena de
 * componentes (VistaLpr, SugerenciaRelectura, CajonPlaza…), cada uno con su variante; las
 * pantallas nuevas usan éste, y las viejas se pasan acá cuando se las toque.
 */
export const ROL_ETIQUETA: Record<string, string> = {
    RESIDENT: "Residente", STAFF: "Personal", PROVIDER: "Proveedor", VISITOR: "Visita", TEMPORARY_VISITOR: "Visita",
    ADMIN: "Administración", SECURITY: "Seguridad", OPERATOR: "Operador", WHITELISTED: "Residente", BLACKLISTED: "Lista negra",
};
export const rolEtiqueta = (r: string | null | undefined) => (r ? ROL_ETIQUETA[r] || r : "");
