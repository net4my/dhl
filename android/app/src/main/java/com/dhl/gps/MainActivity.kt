package com.dhl.gps

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * GeoGuard – zeigt GPS-Position und Kompass-Richtung an.
 *
 * Die Oberfläche ist eine lokale HTML-Datei (assets/gps.html). Diese Activity
 * liefert die "sicheren" nativen Daten:
 *   - Standort über den System-LocationManager (GPS + Netzwerk, ohne Google Play Services)
 *   - Richtung über den Rotations-Vektor-Sensor (Magnetometer + Gyroskop)
 * und reicht sie per JavaScript-Bridge an die Web-Oberfläche weiter.
 */
class MainActivity : ComponentActivity(), LocationListener, SensorEventListener {

    private lateinit var webView: WebView
    private lateinit var locationManager: LocationManager
    private lateinit var sensorManager: SensorManager
    private var rotationSensor: Sensor? = null

    private val rotationMatrix = FloatArray(9)
    private val orientation = FloatArray(3)
    private var lastHeadingSent = 0L

    private var pendingStart = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            setGeolocationEnabled(true)
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
        }

        webView.addJavascriptInterface(Bridge(), "Android")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                // Lokale HTML-Seite – Standortfreigabe für den WebView erteilen.
                callback?.invoke(origin, true, false)
            }
        }

        webView.loadUrl("file:///android_asset/gps.html")
    }

    // ---------------------------------------------------------------------
    // JavaScript-Bridge: aus gps.html aufrufbar als window.Android.*
    // ---------------------------------------------------------------------
    inner class Bridge {
        @JavascriptInterface
        fun startLocation() {
            runOnUiThread { ensurePermissionThenStart() }
        }

        @JavascriptInterface
        fun stopLocation() {
            runOnUiThread { stopUpdates() }
        }

        @JavascriptInterface
        fun toast(msg: String) {
            runOnUiThread { Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show() }
        }

        @JavascriptInterface
        fun share(text: String) {
            runOnUiThread {
                val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(android.content.Intent.EXTRA_TEXT, text)
                }
                startActivity(android.content.Intent.createChooser(send, "Standort teilen"))
            }
        }
    }

    // ---------------------------------------------------------------------
    // Berechtigung + Start
    // ---------------------------------------------------------------------
    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun ensurePermissionThenStart() {
        if (hasLocationPermission()) {
            startUpdates()
        } else {
            pendingStart = true
            ActivityCompat.requestPermissions(
                this,
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                ),
                REQ_LOCATION
            )
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_LOCATION) {
            if (grantResults.isNotEmpty() && grantResults.any { it == PackageManager.PERMISSION_GRANTED }) {
                if (pendingStart) startUpdates()
            } else {
                webView.evaluateJavascript(
                    "window.onNativeLocation && window.onNativeLocation(null);" +
                        "document.getElementById('hint').textContent='Standort-Berechtigung verweigert.';",
                    null
                )
            }
            pendingStart = false
        }
    }

    private fun startUpdates() {
        if (!hasLocationPermission()) return
        try {
            // Zuletzt bekannte Position sofort anzeigen (schneller erster Fix).
            val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            var best: Location? = null
            for (p in providers) {
                if (locationManager.isProviderEnabled(p)) {
                    val l = locationManager.getLastKnownLocation(p)
                    if (l != null && (best == null || l.accuracy < best.accuracy)) best = l
                    locationManager.requestLocationUpdates(p, 1000L, 0f, this, mainLooper)
                }
            }
            best?.let { onLocationChanged(it) }
        } catch (se: SecurityException) {
            // Sollte durch Permission-Check nicht passieren.
        }
        rotationSensor?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_UI)
        }
    }

    private fun stopUpdates() {
        try { locationManager.removeUpdates(this) } catch (_: Exception) {}
        sensorManager.unregisterListener(this)
    }

    override fun onPause() {
        super.onPause()
        stopUpdates()
    }

    override fun onResume() {
        super.onResume()
        if (hasLocationPermission()) startUpdates()
    }

    // ---------------------------------------------------------------------
    // LocationListener
    // ---------------------------------------------------------------------
    override fun onLocationChanged(location: Location) {
        val json = JSONObject().apply {
            put("lat", location.latitude)
            put("lon", location.longitude)
            put("alt", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
            put("acc", if (location.hasAccuracy()) location.accuracy else JSONObject.NULL)
            put("speed", if (location.hasSpeed()) location.speed else JSONObject.NULL)
            put("bearing", if (location.hasBearing()) location.bearing else JSONObject.NULL)
            put("time", location.time)
            put("provider", providerLabel(location.provider))
        }
        webView.evaluateJavascript("window.onNativeLocation && window.onNativeLocation($json);", null)
    }

    private fun providerLabel(p: String?): String = when (p) {
        LocationManager.GPS_PROVIDER -> "GPS (Satellit)"
        LocationManager.NETWORK_PROVIDER -> "Netzwerk"
        else -> p ?: "GPS"
    }

    @Deprecated("Deprecated in API 29, für ältere Geräte erforderlich")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    // ---------------------------------------------------------------------
    // SensorEventListener (Kompass)
    // ---------------------------------------------------------------------
    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return
        val now = System.currentTimeMillis()
        if (now - lastHeadingSent < 80) return // ~12 Hz, schont die Bridge
        lastHeadingSent = now

        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)

        // Display-Rotation berücksichtigen (Portrait/Landscape).
        val rotation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            display?.rotation ?: 0 else @Suppress("DEPRECATION") windowManager.defaultDisplay.rotation

        val (axisX, axisY) = when (rotation) {
            android.view.Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
            android.view.Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
            android.view.Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
            else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
        }
        val remapped = FloatArray(9)
        SensorManager.remapCoordinateSystem(rotationMatrix, axisX, axisY, remapped)
        SensorManager.getOrientation(remapped, orientation)

        var azimuth = Math.toDegrees(orientation[0].toDouble())
        azimuth = (azimuth + 360.0) % 360.0
        webView.evaluateJavascript("window.onNativeHeading && window.onNativeHeading($azimuth);", null)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    override fun onDestroy() {
        super.onDestroy()
        stopUpdates()
        webView.destroy()
    }

    companion object {
        private const val REQ_LOCATION = 42
    }
}
