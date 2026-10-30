package uy.com.ies.omniaccess.guard

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * El turno activo: una notificación fija que mantiene viva la app (pánico, ubicación, avisos)
 * mientras el guardia hace la ronda con la pantalla apagada. Es de tipo ubicación, que es lo que
 * declara el manifiesto y lo que hay que justificar en Play Console.
 */
class ServicioGuardia : Service() {
    // El tipo «location» está en src/main/AndroidManifest.xml y llega al manifiesto final de los dos
    // sabores (verificado en el merged manifest). El lint de `directa` mira sólo el manifiesto de ese
    // sabor, que no declara el servicio, y da un falso positivo.
    @SuppressLint("ForegroundServiceType")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val abrir = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val aviso = Notification.Builder(this, CANAL)
            .setContentTitle(getString(R.string.servicio_titulo))
            .setContentText(getString(R.string.servicio_texto))
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentIntent(abrir)
            .setOngoing(true)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(AVISO_ID, aviso, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            else startForeground(AVISO_ID, aviso)
        } catch (_: Exception) {
            // Sin permiso de ubicación Android no deja arrancar el servicio: la consola igual anda en pantalla.
            stopSelf()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CANAL = "turno"
        private const val AVISO_ID = 4201
    }
}
