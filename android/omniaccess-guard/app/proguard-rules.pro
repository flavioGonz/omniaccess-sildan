# El puente con la consola: R8 no puede ver que lo llama JavaScript, así que se conservan sus métodos.
-keepclassmembers class uy.com.ies.omniaccess.guard.PuenteGuardia {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
