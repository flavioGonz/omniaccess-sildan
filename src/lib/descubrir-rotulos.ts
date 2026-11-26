/**
 * Los nombres del descubridor (26/11): fabricantes y categorías, sin la tabla de MAC. Va aparte para
 * que la pantalla no cargue los 38 KB de prefijos OUI sólo para saber cómo se dice «Switch».
 */

export type Rubro = "seguridad" | "red" | "telefonia" | "computo" | "iot";
/** Cada fabricante: cómo se llama, a qué se dedica y con qué marca de OmniAccess se da de alta (si existe). */
export const FABRICANTES: Record<string, { rotulo: string; rubro: Rubro; marca: string | null }> = {
    HIKVISION: { rotulo: "Hikvision", rubro: "seguridad", marca: "HIKVISION" },
    DAHUA: { rotulo: "Dahua", rubro: "seguridad", marca: "DAHUA" },
    AKUVOX: { rotulo: "Akuvox", rubro: "seguridad", marca: "AKUVOX" },
    GRANDSTREAM: { rotulo: "Grandstream", rubro: "telefonia", marca: "GRANDSTREAM" },
    ZKTECO: { rotulo: "ZKTeco", rubro: "seguridad", marca: "ZKTECO" },
    AXIS: { rotulo: "Axis", rubro: "seguridad", marca: "AXIS" },
    UNIVIEW: { rotulo: "Uniview", rubro: "seguridad", marca: "UNIVIEW" },
    INTELBRAS: { rotulo: "Intelbras", rubro: "seguridad", marca: "INTELBRAS" },
    MILESIGHT: { rotulo: "Milesight", rubro: "seguridad", marca: "MILESIGHT" },
    HANWHA: { rotulo: "Hanwha", rubro: "seguridad", marca: null },
    BOSCH: { rotulo: "Bosch", rubro: "seguridad", marca: "BOSCH" },
    HONEYWELL: { rotulo: "Honeywell", rubro: "seguridad", marca: null },
    TIANDY: { rotulo: "Tiandy", rubro: "seguridad", marca: null },
    UBIQUITI: { rotulo: "Ubiquiti", rubro: "red", marca: "UNIFI" },
    MIKROTIK: { rotulo: "MikroTik", rubro: "red", marca: null },
    TPLINK: { rotulo: "TP-Link", rubro: "red", marca: null },
    CISCO: { rotulo: "Cisco", rubro: "red", marca: null },
    ARUBA: { rotulo: "Aruba", rubro: "red", marca: null },
    FORTINET: { rotulo: "Fortinet", rubro: "red", marca: null },
    RUIJIE: { rotulo: "Ruijie", rubro: "red", marca: null },
    NETGEAR: { rotulo: "Netgear", rubro: "red", marca: null },
    DLINK: { rotulo: "D-Link", rubro: "red", marca: null },
    HUAWEI: { rotulo: "Huawei", rubro: "red", marca: null },
    JUNIPER: { rotulo: "Juniper", rubro: "red", marca: null },
    ZYXEL: { rotulo: "Zyxel", rubro: "red", marca: null },
    RUCKUS: { rotulo: "Ruckus", rubro: "red", marca: null },
    HP: { rotulo: "HP", rubro: "computo", marca: null },
    YEALINK: { rotulo: "Yealink", rubro: "telefonia", marca: null },
    FANVIL: { rotulo: "Fanvil", rubro: "telefonia", marca: null },
    SYNOLOGY: { rotulo: "Synology", rubro: "computo", marca: null },
    QNAP: { rotulo: "QNAP", rubro: "computo", marca: null },
    RASPBERRY: { rotulo: "Raspberry Pi", rubro: "computo", marca: null },
    APPLE: { rotulo: "Apple", rubro: "computo", marca: null },
    MICROSOFT: { rotulo: "Microsoft", rubro: "computo", marca: null },
    LINUX: { rotulo: "Linux", rubro: "computo", marca: null },
    ESPRESSIF: { rotulo: "Espressif (IoT)", rubro: "iot", marca: null },
    PROXMOX: { rotulo: "Proxmox (máquina virtual)", rubro: "computo", marca: null },
    VMWARE: { rotulo: "VMware (máquina virtual)", rubro: "computo", marca: null },
    DELL: { rotulo: "Dell", rubro: "computo", marca: null },
    LENOVO: { rotulo: "Lenovo", rubro: "computo", marca: null },
    SUPERMICRO: { rotulo: "Supermicro", rubro: "computo", marca: null },
    INTEL: { rotulo: "Intel", rubro: "computo", marca: null },
};

export type Categoria = "camara-lpr" | "camara" | "nvr" | "portero" | "monitor" | "control-acceso" | "terminal-facial"
    | "router" | "switch" | "ap" | "telefono" | "almacenamiento" | "computadora" | "impresora" | "otro";

/** Cada categoría: cómo se dice, y con qué tipo de OmniAccess se da de alta (null = no es para OmniAccess). */
export const CATEGORIAS: Record<Categoria, { rotulo: string; plural: string; tipo: string | null }> = {
    "camara-lpr": { rotulo: "Cámara LPR", plural: "Cámaras LPR", tipo: "LPR_CAMERA" },
    camara: { rotulo: "Cámara", plural: "Cámaras", tipo: "CAMERA" },
    nvr: { rotulo: "Grabador (NVR/DVR)", plural: "Grabadores", tipo: "NVR" },
    portero: { rotulo: "Portero / frente de calle", plural: "Porteros", tipo: "DOOR_INTERCOM" },
    monitor: { rotulo: "Monitor interior", plural: "Monitores interiores", tipo: null },
    "control-acceso": { rotulo: "Control de acceso", plural: "Controles de acceso", tipo: "ACCESS_CONTROL" },
    "terminal-facial": { rotulo: "Terminal facial", plural: "Terminales faciales", tipo: "FACE_TERMINAL" },
    router: { rotulo: "Router", plural: "Routers", tipo: null },
    switch: { rotulo: "Switch", plural: "Switches", tipo: null },
    ap: { rotulo: "Punto de acceso WiFi", plural: "Puntos de acceso", tipo: null },
    telefono: { rotulo: "Teléfono IP", plural: "Teléfonos IP", tipo: null },
    almacenamiento: { rotulo: "Almacenamiento (NAS)", plural: "Almacenamiento", tipo: null },
    computadora: { rotulo: "Computadora o servidor", plural: "Computadoras y servidores", tipo: null },
    impresora: { rotulo: "Impresora", plural: "Impresoras", tipo: null },
    otro: { rotulo: "No se sabe", plural: "Sin identificar", tipo: null },
};

export type Clasificacion = {
    categoria: Categoria;
    /** Fabricante (clave de FABRICANTES), o null. */
    fabricante: string | null;
    /** La marca de OmniAccess con la que se da de alta, o null. */
    marca: string | null;
    tipo: string | null;
    confianza: "alta" | "media" | "baja";
    /** De dónde sale, en palabras: «la ficha dice NVR», «MAC de Hikvision». */
    por: string[];
};

