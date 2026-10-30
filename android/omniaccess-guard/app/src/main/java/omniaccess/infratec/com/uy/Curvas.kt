package omniaccess.infratec.com.uy

import android.app.Activity
import android.os.Build
import android.view.animation.PathInterpolator

/** La curva de las transiciones de iOS (arranca rápido y se asienta sin rebote), la misma que usa el panel. */
object Curvas {
    val ios = PathInterpolator(0.32f, 0.72f, 0f, 1f)

    /** Un fundido corto entre pantallas, en lugar del deslizamiento por defecto de Android. */
    fun fundido(a: Activity) {
        if (Build.VERSION.SDK_INT >= 34) a.overrideActivityTransition(Activity.OVERRIDE_TRANSITION_OPEN, android.R.anim.fade_in, android.R.anim.fade_out)
        else @Suppress("DEPRECATION") a.overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }
}
