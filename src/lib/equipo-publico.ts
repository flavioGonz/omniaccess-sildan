/**
 * Un equipo sin sus credenciales, para todo lo que viaja al navegador.
 *
 * Una acción del servidor devuelve al navegador todo lo que retorna, y `include: { device: true }`
 * trae la fila entera del equipo: usuario, clave y la URL RTSP (que lleva usuario y clave
 * adentro). Así el historial, la bitácora, la lista negra, los vehículos, los planos y Usuarios
 * mandaban las claves de las cámaras y los NVR a cualquier pantalla que los listara (visto el
 * 16/10 al revisar Gestión de alarmas; el historial se arregló ese día, éste es el resto).
 *
 * Lo que necesita las credenciales (hablar con el equipo) las lee en el servidor con su propia
 * consulta; la edición del equipo las pide aparte con getCredencialesDispositivo, que exige el
 * permiso Dispositivos.
 */

/** Todos los campos del equipo menos `username`, `password` y `rtspUrl`. Si se agrega un campo al modelo, va acá. */
export const EQUIPO_PUBLICO = {
    id: true, name: true, deviceType: true, brand: true, deviceModel: true, modelPhoto: true, brandLogo: true,
    ip: true, mac: true, port: true, location: true, direction: true, doorStatus: true, authType: true,
    lastOnlinePull: true, lastOnlinePush: true, floorPlanId: true, mapX: true, mapY: true,
    trackScene: true, trackEnabled: true, trackRoi: true, trackTrigger: true, trackLine: true, trackMinConf: true, trackFps: true,
    trackAcceso: true, lprVerifica: true, lprAbre: true, intrusionModo: true, intrusionEnabled: true, intrusionGeometry: true,
    createdAt: true, updatedAt: true,
} as const;

/**
 * Le saca las credenciales a un equipo ya leído. `tieneRtsp` y `tieneClave` dicen si las hay,
 * que es lo único que la pantalla necesita saber de ellas.
 */
export function sinClaves<T extends Record<string, any>>(d: T): Omit<T, "username" | "password" | "rtspUrl"> & { tieneRtsp: boolean; tieneClave: boolean } {
    const { username: _u, password, rtspUrl, ...resto } = d as any;
    return { ...resto, tieneRtsp: !!rtspUrl, tieneClave: !!password };
}
