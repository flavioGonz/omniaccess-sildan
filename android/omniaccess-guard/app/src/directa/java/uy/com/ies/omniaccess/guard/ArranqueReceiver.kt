package uy.com.ies.omniaccess.guard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Al encender la tablet de garita, vuelve el servicio de turno (el pánico y la ubicación). Abrir la
 * consola sola al prender ya no lo permite Android 10+; el aviso fijo del servicio la abre con un toque.
 */
class ArranqueReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action != Intent.ACTION_BOOT_COMPLETED || Ajustes(c).servidor == null) return
        try { androidx.core.content.ContextCompat.startForegroundService(c, Intent(c, ServicioGuardia::class.java)) } catch (_: Exception) { }
    }
}
