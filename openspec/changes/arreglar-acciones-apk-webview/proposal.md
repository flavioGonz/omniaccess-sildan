# Proposal

## Why

En la garita, el guardia usa dos acciones sobre una detección: **Cargar matrícula**
(corregir una lectura NO_LEIDA y re-evaluar el acceso) y **Consultar en Min. Interior**
(verificar si la matrícula está requerida, resolviendo el captcha a mano). Ambas funcionan
en navegador y PWA, pero **no funcionan dentro de la APK (WebView Android)**. Los
endurecimientos previos (forzar foco del input, pasar el link a flujo in-app) no resolvieron
el síntoma en la tablet. Son acciones críticas de operación diaria.

## What Changes

- Reproducir y **diagnosticar en la tablet real** por qué cada acción falla en el WebView
  (teclado que no sube, tap que no abre el diálogo, overlay que captura el toque, o fetch
  del captcha bloqueado).
- Asegurar que **Cargar matrícula** abra el teclado y acepte entrada dentro del WebView, y
  que al guardar re-evalúe el acceso y muestre el resultado.
- Asegurar que **Consultar en Min. Interior** cargue el captcha in-app y acepte el código
  dentro del WebView, manteniendo el captcha **humano en el medio** (no se automatiza ni se
  resuelve por software) y **sin abrir un navegador externo**.
- Documentar el **contrato de WebView/puente AndroidGuard** necesario (DOM storage, foco de
  inputs, teclado, portales de diálogo) para que la web y la APK queden alineadas.
- Sin cambios que rompan compatibilidad (no **BREAKING**).

## Capabilities

### New Capabilities
- `guardia-acciones-deteccion`: acciones que un guardia ejecuta sobre una detección (cargar/
  corregir matrícula y consultar Min. Interior), con la garantía de que funcionan igual en
  navegador, PWA y APK (WebView), y que la consulta oficial es siempre humano-en-el-medio.

### Modified Capabilities
<!-- Ninguna: no hay specs previas; es una capability nueva. -->

## Impact

- Web: `src/components/PlateManualButton.tsx`, `src/components/MinInteriorButton.tsx`,
  `src/components/MinInteriorDialog.tsx`, `src/lib/guard-native.ts`, ruta `/api/min-interior`,
  y el diálogo base `src/components/ui/dialog` (portal/focus de Radix en WebView).
- APK: el wrapper Android (proyecto externo, fuera de este repo) — settings del WebView
  (JavaScript, DOM storage, `setFocusable`, soft input mode) y, si hace falta, métodos del
  puente `AndroidGuard` para foco/teclado. Se coordina, no se edita acá.
- Operación: afecta a los guardias en las tablets de Los Olivos. Riesgo controlado: las
  acciones ya existen en web; se trata de hacerlas funcionar en el WebView.
