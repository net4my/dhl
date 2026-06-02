# JavaScript-Bridge-Methoden müssen erhalten bleiben.
-keepclassmembers class com.dhl.gps.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
