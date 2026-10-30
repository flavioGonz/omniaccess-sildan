package uy.com.ies.omniaccess.guard

import android.webkit.JavascriptInterface

/**
 * `window.AndroidGuard` en la consola. Los nombres son los de la APK anterior (los usa
 * src/lib/guard-native.ts en el servidor); se suman los que ese archivo ya esperaba
 * (showKeyboard, hideKeyboard, openUrl) y dos para cambiar de guardia o de servidor.
 *
 * Sólo lo usa la consola del servidor configurado: cualquier otra página se abre fuera de la app
 * (MainActivity.Cliente.shouldOverrideUrlLoading), así que nunca ve este puente.
 */
class PuenteGuardia(private val a: MainActivity) {
    @JavascriptInterface fun isNative() = true
    @JavascriptInterface fun getVersion(): String = BuildConfig.VERSION_NAME
    @JavascriptInterface fun getVersionCode(): Int = BuildConfig.VERSION_CODE
    @JavascriptInterface fun getCanal(): String = BuildConfig.FLAVOR
    @JavascriptInterface fun vibrate(ms: Int) = a.vibrar(ms)
    @JavascriptInterface fun torch(on: Boolean) = a.linterna(on)
    @JavascriptInterface fun speak(text: String?) = a.hablar(text)
    @JavascriptInterface fun alarm(on: Boolean) { a.sonarAlarma(on) }
    @JavascriptInterface fun startService() = a.iniciarServicio()
    @JavascriptInterface fun stopService() = a.detenerServicio()
    @JavascriptInterface fun keepAwake(on: Boolean) { a.mantenerDespierta(on) }
    @JavascriptInterface fun getBattery(): Int = a.bateria()
    @JavascriptInterface fun getSignal(): String = a.senal()
    @JavascriptInterface fun openSettings() = a.abrirAjustesApp()
    @JavascriptInterface fun enableNfc(on: Boolean) { a.nfcPrender(on) }
    @JavascriptInterface fun openAccessibility() = a.abrirAccesibilidad()
    @JavascriptInterface fun showKeyboard() { a.teclado(true) }
    @JavascriptInterface fun hideKeyboard() { a.teclado(false) }
    @JavascriptInterface fun openUrl(url: String?) { if (!url.isNullOrBlank()) a.abrirAfuera(url) }
    @JavascriptInterface fun cambiarGuardia() { a.cambiarGuardia() }
    @JavascriptInterface fun cambiarServidor() { a.cambiarServidor() }
}
