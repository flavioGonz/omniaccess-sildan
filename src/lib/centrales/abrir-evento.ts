/** Abrir la ficha de un evento de central desde cualquier pantalla (la monta AlertaCentralGlobal en el layout). */
export const abrirEventoCentral = (id: string) => { try { window.dispatchEvent(new CustomEvent("omni:evento-central", { detail: { id } })); } catch { /* sin ventana */ } };
