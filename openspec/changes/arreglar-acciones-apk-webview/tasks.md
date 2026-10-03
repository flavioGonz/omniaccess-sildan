# Tasks

## 1. Reproducir y diagnosticar en la tablet

- [ ] 1.1 Conectar el WebView de la tablet a remote debugging y reproducir ambos fallos;
      capturar errores de consola/red (verificación: log con la causa de cada acción).
- [ ] 1.2 Clasificar la causa de cada acción entre: tap no abre, teclado no sube, overlay
      captura el toque, o captcha/API no carga (verificación: causa confirmada por los logs).

## 2. Cargar matrícula en WebView

- [ ] 2.1 Según el diagnóstico, corregir la apertura del teclado del input de matrícula en el
      WebView (foco web y/o método del puente) (verificación: en la tablet aparece el teclado
      y se puede escribir).
- [ ] 2.2 Confirmar que al guardar se re-evalúa el acceso y se muestra el resultado
      (verificación: cargar una matrícula de residente conocida muestra residente + decisión).
- [ ] 2.3 Verificar que no hubo regresión en navegador y PWA (verificación: la acción sigue
      funcionando en ambos).

## 3. Consulta Min. Interior en WebView

- [ ] 3.1 Asegurar que el captcha de `/api/min-interior` cargue dentro del diálogo en el
      WebView (verificación: en la tablet se ve la imagen del captcha).
- [ ] 3.2 Confirmar que ingresar el código devuelve el estado de la matrícula
      (verificación: una consulta real muestra REQUERIDA/NO).
- [ ] 3.3 Confirmar que la acción nunca abre un navegador externo ni automatiza el captcha
      (verificación: revisión de código + prueba en tablet).

## 4. Contrato WebView / puente

- [x] 4.1 Documentar en `src/lib/guard-native.ts` y en la skill `omniaccess-deploy` el contrato
      mínimo del WebView (JavaScript, DOM storage, foco de inputs, teclado) y, si se agregó,
      el método del puente usado (verificación: la nota existe y describe el requisito).
- [x] 4.2 Si el fix requiere cambios en el wrapper Android, emitir la tarea para el proyecto
      Android con el contrato exacto (verificación: tarea creada con los settings requeridos).

## 5. Verificación integral

- [ ] 5.1 Probar las dos acciones en los tres clientes (navegador, PWA, APK) y dejar
      registro del resultado (verificación: checklist de los 6 casos en verde).


## Notas de apply (2026-10-03)

**Código desplegado** (CT200, build DONE_0, `/guard` → 200, sin regresión en navegador/PWA):
- `src/lib/guard-native.ts`: contrato WebView — `showKeyboard()`, `hideKeyboard()`, `openUrl(url)`, `canOpenUrl()`.
- `PlateManualButton` y `MinInteriorDialog`: llaman `native.showKeyboard()` al enfocar los inputs;
  "Abrir sitio oficial" usa `native.openUrl()` en APK con fallback `window.open`/clipboard en web.
- Causa raíz confirmada por revisión de código: el WebView de Android no levanta el IME con
  `.focus()` diferido, y `window.open`/`clipboard` están bloqueados en el WebView (de ahí #180/#181).

**Pendiente — requiere un release de la APK + prueba en tablet** (1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 5.1):
la web ya llama al contrato, pero no surte efecto hasta que el wrapper Android implemente en
`window.AndroidGuard`:
- `showKeyboard()` / `hideKeyboard()` → `InputMethodManager.showSoftInput(...)` / `hideSoftInputFromWindow(...)`.
- `openUrl(String url)` → `startActivity(Intent.ACTION_VIEW, Uri.parse(url))` o Chrome Custom Tab.
- WebSettings recomendados: `javaScriptEnabled`, `domStorageEnabled`, `setFocusable(true)`,
  y `windowSoftInputMode=adjustResize` en la Activity.
Tras el build de la APK con esos métodos, verificar los 6 casos (2 acciones × navegador/PWA/APK).
