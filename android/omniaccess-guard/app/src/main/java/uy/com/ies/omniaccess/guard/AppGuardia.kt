package uy.com.ies.omniaccess.guard

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class AppGuardia : Application() {
    override fun onCreate() {
        super.onCreate()
        // El canal del servicio de guardia existe desde el arranque: Android 13+ lo necesita antes
        // de pedir el permiso de notificaciones para que el pedido tenga sentido para el guardia.
        val nm = getSystemService(NotificationManager::class.java)
        val canal = NotificationChannel(ServicioGuardia.CANAL, getString(R.string.servicio_canal), NotificationManager.IMPORTANCE_LOW)
        canal.description = getString(R.string.servicio_canal_detalle)
        canal.setShowBadge(false)
        nm?.createNotificationChannel(canal)
    }
}
