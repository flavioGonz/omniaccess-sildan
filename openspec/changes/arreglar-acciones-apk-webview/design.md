# Design

## Context

Ver proposal.md (Why). Las dos acciones ya están implementadas como diálogos in-app (Radix
Dialog): `PlateManualButton` abre un modal con un `Input`; `MinInteriorButton` abre
`MinInteriorDialog`, que trae el captcha vía `/api/min-interior` y envía el código. El puente
nativo está en `src/lib/guard-native.ts` (`window.AndroidGuard`). El síntoma vive solo en la
APK (WebView Android); en navegador/PWA ambas funcionan. El código fuente del wrapper Android
NO está en este repo.

## Goals / Non-Goals

**Goals:**
- Que ambas acciones funcionen en el WebView con la misma experiencia que en navegador.
- Dejar escrito el contrato mínimo de WebView/puente para no volver a romperlo.

**Non-Goals:**
- Reescribir el wrapper Android (se coordina aparte; acá solo el lado web y el contrato).
- Cambiar el flujo de captcha a algo automático (queda humano-en-el-medio, por política).
- Tocar otras acciones del guardia.

## Decisions

- **Diagnóstico primero, en la tablet real.** Antes de tocar código, reproducir con logs
  (remote debugging del WebView / `read_console_messages`) para distinguir las hipótesis:
  (a) el tap no abre el diálogo, (b) el diálogo abre pero el teclado no sube, (c) el overlay/
  focus-trap de Radix captura el toque en WebView, (d) `/api/min-interior` o la imagen del
  captcha no cargan en el WebView. No parchear a ciegas: los intentos previos (#194/#195)
  fallaron por eso.
- **Teclado del input de matrícula.** Mantener el `forceFocus` escalonado, pero validar si el
  WebView necesita además `android:windowSoftInputMode=adjustResize` y
  `WebSettings` con foco habilitado; si el foco web no basta, exponer un método del puente
  (p.ej. `AndroidGuard.showKeyboard()`) en vez de seguir sumando `setTimeout`.
- **In-app siempre.** Ni "Cargar matrícula" ni "Min. Interior" deben usar `window.open` ni
  salir a un navegador externo; el captcha se sirve y resuelve dentro del diálogo.
- **Contrato de WebView documentado** en la skill `omniaccess-deploy` y en `guard-native.ts`,
  para que web y APK queden alineadas en futuros releases.

## Risks / Trade-offs

- [El fix real puede estar en el wrapper Android, fuera del repo] → el entregable web incluye
  el contrato exacto que debe cumplir la APK y una verificación en tablet; si el wrapper
  necesita cambios, se emite como tarea para el proyecto Android.
- [Regresión en navegador/PWA al tocar el foco] → verificar las dos acciones en los tres
  clientes antes de cerrar.

## Migration Plan

Sin migración de datos. Se despliega con el loop estándar (build → restart `omniaccess-web` →
verificar HTTP 200) y se prueba en la tablet. Rollback = revertir el commit del cambio.

## Open Questions

- ¿Qué versión de la APK corre hoy en las tablets del primer barrio y expone el puente? (Define si
  el fix puede ser solo-web o requiere un release de APK.)
