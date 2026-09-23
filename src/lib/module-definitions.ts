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
  /**
   * La clave del Setting que guarda el nombre de su bucket, si el módulo guarda imágenes.
   *
   * Está acá y no suelta en la pantalla de almacenamiento porque es lo que permite mostrar
   * ÚNICAMENTE el bucket del modo que está puesto. Antes esa pantalla listaba el bucket
   * LPR y el bucket FACE siempre, en las dos instalaciones: un barrio que corre en modo
   * matrículas veía —y podía reconfigurar— el bucket de un módulo que no tiene prendido.
   */
  bucket?: {
    /** La clave del Setting donde vive el nombre del bucket. */
    key: string;
    /** El identificador que usan las acciones de S3 para elegir la configuración. */
    tipo: "lpr" | "face";
  };
  defaultEnabled: boolean;
  /**
   * `true` = es un MODO: sólo puede haber uno prendido, y cambiarlo apaga a los otros.
   * `false` = es una CAPA: convive con cualquier modo.
   *
   * Estaba como `exclusive?: boolean` y se leía en todos lados como `exclusive !== false`,
   * o sea que la regla más importante del archivo —cuáles se excluyen entre sí— vivía en
   * la AUSENCIA de un campo. Eso es lo que dejó pasar el control duplicado: la pantalla
   * nueva ofrecía prender dos modos a la vez y nada en el tipo decía que no se podía.
   */
  exclusive: boolean;
}

export const MODULE_DEFINITIONS: ModuleInfo[] = [
  {
    id: 'MODULE_LPR',
    name: 'Matrículas',
    description: 'Lee las chapas en las barreras y en las cámaras de calle: quién entró, quién salió y qué vehículos están adentro del barrio.',
    icon: 'Car',
    bucket: { key: 'S3_BUCKET_LPR', tipo: 'lpr' },
    defaultEnabled: true,
    exclusive: true,
  },
  {
    id: 'MODULE_FACE',
    name: 'Rostro',
    description: 'Reconocimiento facial en los accesos peatonales, con el mismo padrón de usuarios y permisos que el resto del sistema.',
    icon: 'ScanFace',
    bucket: { key: 'S3_BUCKET_FACE', tipo: 'face' },
    defaultEnabled: true,
    exclusive: true,
  },
  {
    id: 'MODULE_QUEUE',
    name: 'Filas',
    description: 'Mide cuánta gente espera en cada acceso y cuánto tarda en pasar, para saber cuándo hace falta abrir otro puesto.',
    icon: 'Users',
    defaultEnabled: false,
    exclusive: true,
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
