package uy.com.ies.omniaccess.guard

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.SystemClock
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Pánico con tres toques a un botón de volumen aunque la pantalla esté apagada o la app no esté
 * adelante. Necesita el servicio de accesibilidad, que Play sólo permite a herramientas de
 * accesibilidad: por eso existe sólo en el sabor `directa`. Mira las teclas de volumen y nada más.
 */
class PanicoVolumenService : AccessibilityService() {
    private val toques = LongArray(3)
    private var indice = 0

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    override fun onKeyEvent(e: KeyEvent): Boolean {
        if (e.action != KeyEvent.ACTION_DOWN || (e.keyCode != KeyEvent.KEYCODE_VOLUME_UP && e.keyCode != KeyEvent.KEYCODE_VOLUME_DOWN)) return false
        toques[indice % 3] = SystemClock.elapsedRealtime(); indice++
        if (indice >= 3 && toques.max() - toques.min() < 2_000) {
            indice = 0; toques.fill(0)
            try {
                startActivity(Intent(this, MainActivity::class.java).setAction(MainActivity.accionPanico(this))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
            } catch (_: Exception) { }
        }
        return false
    }
}
