// Module definitions - NOT a server file, can export constants and types

export type ModuleId = 'MODULE_LPR' | 'MODULE_FACE' | 'MODULE_QUEUE' | 'MODULE_GUARD';

export interface ModuleInfo {
  id: ModuleId;
  name: string;
  description: string;
  icon: string;
  defaultEnabled: boolean;
  exclusive?: boolean; // false = modulo transversal (capa), no un modo exclusivo
}

export const MODULE_DEFINITIONS: ModuleInfo[] = [
  {
    id: 'MODULE_LPR',
    name: 'OmniAccess LPR',
    description: 'License Plate Recognition',
    icon: '\u{1F697}',
    defaultEnabled: true,
  },
  {
    id: 'MODULE_FACE',
    name: 'OmniAccess Face',
    description: 'Reconocimiento facial y control de acceso',
    icon: '\u{1F9D1}',
    defaultEnabled: true,
  },
  {
    id: 'MODULE_QUEUE',
    name: 'Control de Filas',
    description: 'Monitoreo de filas y tiempos de espera',
    icon: '\u{1F465}',
    defaultEnabled: false,
  },
  {
    id: 'MODULE_GUARD',
    name: 'M\u00f3dulo Guardias',
    description: 'Consola de guardia, bit\u00e1cora y bot\u00f3n de p\u00e1nico',
    icon: '\u{1F6E1}',
    defaultEnabled: false,
    exclusive: false,
  },
];
