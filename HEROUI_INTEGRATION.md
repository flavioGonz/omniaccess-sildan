# Integración de HeroUI en OmniAccess

## 📦 Estado de Instalación

✅ **HeroUI instalado** - El paquete `@heroui/react` y `framer-motion` están instalados.

⚠️ **Configuración pendiente** - Debido a que el proyecto usa **Tailwind CSS v4** (`@tailwindcss/postcss`), la configuración de HeroUI requiere pasos adicionales.

## 🔧 Configuración con Tailwind CSS v4

Tailwind CSS v4 usa un sistema de configuración diferente. Para usar HeroUI necesitas:

### Opción 1: Uso Directo (Recomendado)

Puedes usar los componentes de HeroUI directamente sin configuración adicional, pero necesitarás aplicar estilos manualmente:

```tsx
import { Button } from "@heroui/react";

// Usa className para aplicar estilos de Tailwind
<Button className="bg-blue-600 text-white px-4 py-2 rounded-md">
  Mi Botón
</Button>
```

### Opción 2: Configuración Completa

Si quieres usar el sistema de temas de HeroUI, necesitarás:

1. Crear un wrapper de HeroUI Provider en tu layout
2. Importar los estilos de HeroUI manualmente



### 2. Ejemplo de Uso Combinado

```tsx
import { Card as HeroCard, CardBody, CardHeader } from "@heroui/react";
import { Button } from "@/components/ui/button";

export default function MyComponent() {
  return (
    <div className="flex gap-4">
      {/* Componente de HeroUI */}
      <HeroCard className="w-full">
        <CardHeader>
          <h4 className="text-lg font-bold">HeroUI Card</h4>
        </CardHeader>
        <CardBody>
          <p>Este es un card de HeroUI</p>
        </CardBody>
      </HeroCard>

      {/* Tu componente actual de shadcn */}
      <Button variant="default">
        Botón de shadcn
      </Button>
    </div>
  );
}
```

### 3. Ejemplo con Tabla de HeroUI

```tsx
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@heroui/react";

export default function UsersTable() {
  return (
    <Table aria-label="Tabla de usuarios">
      <TableHeader>
        <TableColumn>NOMBRE</TableColumn>
        <TableColumn>ROL</TableColumn>
        <TableColumn>ESTADO</TableColumn>
      </TableHeader>
      <TableBody>
        <TableRow key="1">
          <TableCell>Juan Pérez</TableCell>
          <TableCell>Admin</TableCell>
          <TableCell>Activo</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
```

### 4. Ejemplo con Modal de HeroUI

```tsx
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, useDisclosure } from "@heroui/react";

export default function MyModal() {
  const {isOpen, onOpen, onClose} = useDisclosure();

  return (
    <>
      <Button onPress={onOpen}>Abrir Modal</Button>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>Título del Modal</ModalHeader>
          <ModalBody>
            <p>Contenido del modal aquí</p>
          </ModalBody>
          <ModalFooter>
            <Button color="danger" variant="light" onPress={onClose}>
              Cerrar
            </Button>
            <Button color="primary" onPress={onClose}>
              Aceptar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
```

## 🎯 Cuándo Usar Cada Librería

### Usa HeroUI para:
- ✅ Tablas complejas con paginación y ordenamiento
- ✅ Componentes con animaciones suaves
- ✅ Interfaces más modernas y coloridas
- ✅ Componentes que necesiten temas personalizados

### Usa shadcn/ui (actual) para:
- ✅ Formularios complejos
- ✅ Componentes que ya tienes implementados
- ✅ Cuando necesites más control sobre el código
- ✅ Integración con React Hook Form

## 🔧 Configuración Aplicada

### tailwind.config.ts
```typescript
import { heroui } from "@heroui/react";

export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  plugins: [heroui()],
};
```

### postcss.config.mjs
```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

## 📚 Recursos

- **Documentación HeroUI**: https://www.heroui.com/docs
- **Componentes**: https://www.heroui.com/docs/components
- **Temas**: https://www.heroui.com/docs/customization/theme

## ⚠️ Notas Importantes

1. **Nombres de Componentes**: Algunos componentes tienen el mismo nombre en ambas librerías (Button, Card, etc.). Usa alias al importar:
   ```tsx
   import { Button as HeroButton } from "@heroui/react";
   import { Button as ShadcnButton } from "@/components/ui/button";
   ```

2. **Estilos**: HeroUI usa su propio sistema de temas. Los componentes de HeroUI respetarán el modo oscuro automáticamente.

3. **Compatibilidad**: Ambas librerías funcionan perfectamente juntas. Puedes mezclarlas en el mismo componente sin problemas.

## 🚀 Próximos Pasos

1. Explora la documentación de HeroUI
2. Prueba algunos componentes en tu aplicación
3. Decide qué componentes quieres migrar a HeroUI (si alguno)
4. Mantén tus componentes actuales funcionando como están

¡Ahora tienes lo mejor de ambos mundos! 🎉
