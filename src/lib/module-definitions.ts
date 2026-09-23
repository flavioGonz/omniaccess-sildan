// Module definitions - NOT a server file, can export constants and types

export type ModuleId = 'MODULE_LPR' | 'MODULE_FACE' | 'MODULE_QUEUE' | 'MODULE_GUARD';

export interface ModuleInfo {
  id: ModuleId;
  name: string;
  description: string;
  /**
   * El nombre del ícono de `lucide`, no un emoji.
   *
   * QUÉ ESTABA MAL: acá había un emoji ('\u{1F697}', el autito) y la pantalla hacía
   * `iconMap[mod.icon]`, con un mapa cuyas claves son 'Car', 'ScanFace', 'Users'. Un
   * emoji no es ninguna de esas tres, así que la búsqueda fallaba SIEMPRE y los cuatro
   * módulos caían en el mismo `|| Cpu` de respaldo.
   *
   * O sea: cuatro módulos distintos, cuatro veces el mismo chip genérico, y nadie lo
   * notó porque un ícono equivocado no rompe nada — sólo deja de informar. Es el mismo
   * error que el `cam?.id` del contador por cámara: un respaldo que tapa el fallo en vez
   * de dejarlo salir.
   */
  icon: string;
  /**
   * Imagen ilustrativa del módulo, bajo `public/`. Opcional a propósito.
   *
   * Sin imagen la tarjeta NO deja un rectángulo gris: dibuja un esquema del módulo en
   * SVG. Un hueco vacío se lee como algo que falta cargar; un esquema se lee como una
   * decisión. El día que haya fotos de las instalaciones, se agrega la ruta acá y la
   * tarjeta la usa sin tocar la pantalla.
   */
  ilustracion?: string;
  defaultEnabled: boolean;
  exclusive?: boolean; // false = modulo transversal (capa), no un modo exclusivo
}

export const MODULE_DEFINITIONS: ModuleInfo[] = [
  {
    id: 'MODULE_LPR',
    name: 'Matrículas',
    description: 'Lee las chapas en las barreras y en las cámaras de calle: quién entró, quién salió y qué vehículos están adentro del barrio.',
    icon: 'Car',
    defaultEnabled: true,
  },
  {
    id: 'MODULE_FACE',
    name: 'Rostro',
    description: 'Reconocimiento facial en los accesos peatonales, con el mismo padrón de usuarios y permisos que el resto del sistema.',
    icon: 'ScanFace',
    defaultEnabled: true,
  },
  {
    id: 'MODULE_QUEUE',
    name: 'Filas',
    description: 'Mide cuánta gente espera en cada acceso y cuánto tarda en pasar, para saber cuándo hace falta abrir otro puesto.',
    icon: 'Users',
    defaultEnabled: false,
  },
  {
    id: 'MODULE_GUARD',
    name: 'Guardia',
    description: 'La consola del puesto: bitácora del turno, botón de pánico y la vista en vivo que mira el guardia.',
    icon: 'ShieldCheck',
    defaultEnabled: false,
    exclusive: false,
  },
];
