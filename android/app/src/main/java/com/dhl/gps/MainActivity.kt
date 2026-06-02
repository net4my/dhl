package com.dhl.gps

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.PowerManager
import android.provider.Settings
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.location.Geocoder
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import android.view.WindowManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * GeoGuard – GPS, Kompass, Karte, Navigation und GNSS-Status.
 *
 * Die Oberfläche ist eine lokale Web-App (assets/gps.html + app.js). Diese Activity
 * liefert die nativen Daten und Aktionen über eine JavaScript-Bridge:
 *   - Standort     : System-LocationManager (GPS + Netzwerk, ohne Play Services)
 *   - Richtung     : Rotations-Vektor-Sensor (Magnetometer + Gyroskop)
 *   - Satelliten   : GnssStatus (Anzahl, Signalstärke, Systeme)
 *   - Datei/SOS    : GPX speichern, SOS-SMS, Bildschirm wach, Hintergrund-Dienst
 */
class MainActivity : ComponentActivity(), LocationListener, SensorEventListener {

    private lateinit var webView: WebView
    private lateinit var locationManager: LocationManager
    private lateinit var sensorManager: SensorManager
    private var rotationSensor: Sensor? = null
    private var gnssCallback: GnssStatus.Callback? = null

    private val rotationMatrix = FloatArray(9)
    private val orientation = FloatArray(3)
    private var lastHeadingSent = 0L
    private var pendingStart = false
    private var tts: TextToSpeech? = null
    private val io: ExecutorService = Executors.newCachedThreadPool()
    private var locationIntervalMs = 1000L
    private var batteryReceiver: BroadcastReceiver? = null

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
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                callback?.invoke(origin, true, false)
            }
        }
        webView.loadUrl("file:///android_asset/gps.html")

        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) tts?.language = Locale.GERMAN
        }
    }

    // ---------------------------------------------------------------------
    // JavaScript-Bridge (window.Android.*)
    // ---------------------------------------------------------------------
    inner class Bridge {
        @JavascriptInterface fun startLocation() = runOnUiThread { ensurePermissionThenStart() }
        @JavascriptInterface fun stopLocation() = runOnUiThread { stopUpdates() }

        @JavascriptInterface
        fun toast(msg: String) = runOnUiThread { Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show() }

        @JavascriptInterface
        fun share(text: String) = runOnUiThread {
            val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
            startActivity(Intent.createChooser(send, "Standort teilen"))
        }

        @JavascriptInterface
        fun sos(text: String) = runOnUiThread {
            try {
                val sms = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).apply { putExtra("sms_body", text) }
                startActivity(sms)
            } catch (e: Exception) {
                val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
                startActivity(Intent.createChooser(send, "SOS senden"))
            }
        }

        @JavascriptInterface
        fun keepAwake(on: Boolean) = runOnUiThread {
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        @JavascriptInterface
        fun setBackground(on: Boolean) = runOnUiThread {
            if (on) {
                if (Build.VERSION.SDK_INT >= 33 &&
                    ContextCompat.checkSelfPermission(this@MainActivity, "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED
                ) {
                    ActivityCompat.requestPermissions(this@MainActivity, arrayOf("android.permission.POST_NOTIFICATIONS"), REQ_NOTIF)
                }
                ContextCompat.startForegroundService(this@MainActivity, Intent(this@MainActivity, LocationService::class.java))
            } else {
                stopService(Intent(this@MainActivity, LocationService::class.java))
            }
        }

        @JavascriptInterface
        fun vibrate(ms: Int) = runOnUiThread { doVibrate(ms.toLong()) }

        @JavascriptInterface
        fun speak(text: String) = runOnUiThread {
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "gg")
        }

        @JavascriptInterface
        fun notify(title: String, text: String) = runOnUiThread { doNotify(title, text) }

        /** GPS-Aktualisierungsintervall ändern (Energiesparen). */
        @JavascriptInterface
        fun setLocationInterval(ms: Int) = runOnUiThread {
            locationIntervalMs = ms.toLong().coerceAtLeast(500L)
            if (hasLocationPermission()) {
                try { locationManager.removeUpdates(this@MainActivity) } catch (_: Exception) {}
                requestProviderUpdates(false)
            }
        }

        @JavascriptInterface
        fun isIgnoringBattery(): Boolean {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            return pm.isIgnoringBatteryOptimizations(packageName)
        }

        /** Dialog: GeoGuard von der Akku-Optimierung ausnehmen. */
        @JavascriptInterface
        fun requestIgnoreBatteryOptimization() = runOnUiThread {
            try {
                val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                    startActivity(
                        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                    )
                } else {
                    startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                }
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Akku-Einstellungen nicht verfügbar.", Toast.LENGTH_SHORT).show()
            }
        }

        /** Server-seitiger HTTP-GET (umgeht CORS). Antwort via window.onHttp(id,status,body). */
        @JavascriptInterface
        fun httpGet(url: String, id: String) {
            io.execute {
                var status = 0
                var body = ""
                try {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.connectTimeout = 15000
                    conn.readTimeout = 20000
                    conn.setRequestProperty("User-Agent", "GeoGuard/1.4 (Android)")
                    conn.setRequestProperty("Accept", "application/json")
                    status = conn.responseCode
                    val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                    body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                    conn.disconnect()
                } catch (e: Exception) {
                    body = e.message ?: "network error"
                }
                val idJs = JSONObject.quote(id)
                val bodyJs = JSONObject.quote(body)
                runOnUiThread {
                    webView.evaluateJavascript("window.onHttp && window.onHttp($idJs, $status, $bodyJs);", null)
                }
            }
        }

        /** Adresse -> Koordinaten über den System-Geocoder. Antwort via window.onGeocode(id,array). */
        @JavascriptInterface
        fun geocode(query: String, id: String) {
            io.execute {
                val arr = JSONArray()
                try {
                    if (Geocoder.isPresent()) {
                        val gc = Geocoder(this@MainActivity, Locale.getDefault())
                        @Suppress("DEPRECATION")
                        val results = gc.getFromLocationName(query, 6)
                        results?.forEach { a ->
                            val line = a.getAddressLine(0)
                            val name = line ?: listOfNotNull(a.featureName, a.locality, a.countryName).joinToString(", ")
                            arr.put(JSONObject().apply {
                                put("name", name)
                                put("lat", a.latitude)
                                put("lon", a.longitude)
                            })
                        }
                    }
                } catch (e: Exception) {
                }
                val idJs = JSONObject.quote(id)
                runOnUiThread {
                    webView.evaluateJavascript("window.onGeocode && window.onGeocode($idJs, $arr);", null)
                }
            }
        }

        @JavascriptInterface
        fun saveText(filename: String, mime: String, content: String) = runOnUiThread {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, filename)
                        put(MediaStore.Downloads.MIME_TYPE, mime)
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    if (uri != null) {
                        contentResolver.openOutputStream(uri)?.use { it.write(content.toByteArray()) }
                        values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0)
                        contentResolver.update(uri, values, null, null)
                        Toast.makeText(this@MainActivity, "Gespeichert in Downloads: $filename", Toast.LENGTH_LONG).show()
                    }
                } else {
                    val dir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                    val f = File(dir, filename)
                    f.writeText(content)
                    Toast.makeText(this@MainActivity, "Gespeichert: ${f.absolutePath}", Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Speichern fehlgeschlagen: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    // ---------------------------------------------------------------------
    // Berechtigung + Start/Stop
    // ---------------------------------------------------------------------
    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun ensurePermissionThenStart() {
        if (hasLocationPermission()) startUpdates()
        else {
            pendingStart = true
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                REQ_LOCATION
            )
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_LOCATION) {
            if (grantResults.isNotEmpty() && grantResults.any { it == PackageManager.PERMISSION_GRANTED }) {
                if (pendingStart) startUpdates()
            } else {
                webView.evaluateJavascript("window.onNativeLocation && window.onNativeLocation(null);", null)
            }
            pendingStart = false
        }
    }

    private fun startUpdates() {
        if (!hasLocationPermission()) return
        requestProviderUpdates(true)
        rotationSensor?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
    }

    private fun requestProviderUpdates(useLastKnown: Boolean) {
        if (!hasLocationPermission()) return
        try {
            val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            var best: Location? = null
            for (p in providers) {
                if (locationManager.isProviderEnabled(p)) {
                    val l = locationManager.getLastKnownLocation(p)
                    if (l != null && (best == null || l.accuracy < best.accuracy)) best = l
                    locationManager.requestLocationUpdates(p, locationIntervalMs, 0f, this, mainLooper)
                }
            }
            if (useLastKnown) best?.let { onLocationChanged(it) }
            registerGnss()
        } catch (se: SecurityException) {
            // durch Permission-Check abgesichert
        }
    }

    private fun stopUpdates() {
        try { locationManager.removeUpdates(this) } catch (_: Exception) {}
        unregisterGnss()
        sensorManager.unregisterListener(this)
    }

    override fun onPause() {
        super.onPause()
        sensorManager.unregisterListener(this)
        batteryReceiver?.let { try { unregisterReceiver(it) } catch (_: Exception) {} }
        batteryReceiver = null
    }

    override fun onResume() {
        super.onResume()
        if (hasLocationPermission()) startUpdates()
        registerBattery()
    }

    private fun registerBattery() {
        if (batteryReceiver != null) return
        batteryReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) { intent?.let { pushBattery(it) } }
        }
        val sticky = registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        sticky?.let { pushBattery(it) }
    }

    private fun pushBattery(intent: Intent) {
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val pct = if (level >= 0 && scale > 0) level * 100 / scale else -1
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        val plugged = when (intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)) {
            BatteryManager.BATTERY_PLUGGED_AC -> "Netzteil"
            BatteryManager.BATTERY_PLUGGED_USB -> "USB"
            BatteryManager.BATTERY_PLUGGED_WIRELESS -> "Kabellos"
            else -> "–"
        }
        val temp = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) / 10.0
        val volt = intent.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1) / 1000.0
        val health = when (intent.getIntExtra(BatteryManager.EXTRA_HEALTH, -1)) {
            BatteryManager.BATTERY_HEALTH_GOOD -> "Gut"
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> "Überhitzt"
            BatteryManager.BATTERY_HEALTH_DEAD -> "Defekt"
            BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "Überspannung"
            BatteryManager.BATTERY_HEALTH_COLD -> "Kalt"
            else -> "–"
        }
        val json = JSONObject().apply {
            put("pct", pct); put("charging", charging); put("plugged", plugged)
            put("temp", temp); put("volt", volt); put("health", health)
            put("tech", intent.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY) ?: "–")
        }
        webView.evaluateJavascript("window.onNativeBattery && window.onNativeBattery($json);", null)
    }

    // ---------------------------------------------------------------------
    // GNSS-Satellitenstatus
    // ---------------------------------------------------------------------
    private fun registerGnss() {
        if (gnssCallback != null || !hasLocationPermission()) return
        val cb = object : GnssStatus.Callback() {
            override fun onSatelliteStatusChanged(status: GnssStatus) {
                val count = status.satelliteCount
                var used = 0
                var cn0sum = 0f
                var cn0cnt = 0
                val systems = sortedSetOf<String>()
                val sats = JSONArray()
                for (i in 0 until count) {
                    val cn0 = status.getCn0DbHz(i)
                    val inFix = status.usedInFix(i)
                    if (inFix) used++
                    if (cn0 > 0f) { cn0sum += cn0; cn0cnt++ }
                    val type = constellationName(status.getConstellationType(i))
                    systems.add(type)
                    sats.put(JSONObject().apply { put("cn0", cn0); put("used", inFix); put("type", type) })
                }
                val g = JSONObject().apply {
                    put("total", count)
                    put("used", used)
                    put("avgCn0", if (cn0cnt > 0) cn0sum / cn0cnt else JSONObject.NULL)
                    put("systems", JSONArray(systems.toList()))
                    put("sats", sats)
                }
                runOnUiThread { webView.evaluateJavascript("window.onNativeGnss && window.onNativeGnss($g);", null) }
            }
        }
        try {
            locationManager.registerGnssStatusCallback(cb, Handler(mainLooper))
            gnssCallback = cb
        } catch (se: SecurityException) {
        }
    }

    private fun unregisterGnss() {
        gnssCallback?.let { try { locationManager.unregisterGnssStatusCallback(it) } catch (_: Exception) {} }
        gnssCallback = null
    }

    private fun constellationName(type: Int): String = when (type) {
        GnssStatus.CONSTELLATION_GPS -> "GPS"
        GnssStatus.CONSTELLATION_GLONASS -> "GLONASS"
        GnssStatus.CONSTELLATION_GALILEO -> "Galileo"
        GnssStatus.CONSTELLATION_BEIDOU -> "BeiDou"
        GnssStatus.CONSTELLATION_QZSS -> "QZSS"
        GnssStatus.CONSTELLATION_SBAS -> "SBAS"
        GnssStatus.CONSTELLATION_IRNSS -> "IRNSS"
        else -> "Andere"
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
            val geo = GeomagneticField(
                location.latitude.toFloat(),
                location.longitude.toFloat(),
                if (location.hasAltitude()) location.altitude.toFloat() else 0f,
                location.time
            )
            put("declination", geo.declination)
        }
        webView.evaluateJavascript("window.onNativeLocation && window.onNativeLocation($json);", null)
    }

    private fun doVibrate(ms: Long) {
        val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION") getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    private fun doNotify(title: String, text: String) {
        val channelId = "geoguard_alerts"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(channelId, "Hinweise", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(this).notify(99, notification)
        } catch (se: SecurityException) {
            // POST_NOTIFICATIONS nicht erteilt – Alarm trotzdem via Vibration/Toast.
        }
    }

    private fun providerLabel(p: String?): String = when (p) {
        LocationManager.GPS_PROVIDER -> "GPS (Satellit)"
        LocationManager.NETWORK_PROVIDER -> "Netzwerk"
        else -> p ?: "GPS"
    }

    @Deprecated("Für ältere Geräte erforderlich")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    // ---------------------------------------------------------------------
    // Kompass (SensorEventListener)
    // ---------------------------------------------------------------------
    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return
        val now = System.currentTimeMillis()
        if (now - lastHeadingSent < 80) return
        lastHeadingSent = now

        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
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
        tts?.shutdown()
        io.shutdownNow()
        webView.destroy()
    }

    companion object {
        private const val REQ_LOCATION = 42
        private const val REQ_NOTIF = 43
    }
}
