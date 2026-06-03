package com.dhl.gps

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.util.LruCache
import android.view.Surface
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.Distance
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.TravelEstimate
import androidx.car.app.model.DateTimeWithZone
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.TimeZone
import java.util.concurrent.Executors
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Android-Auto-Navigationsansicht mit gerenderter Straßenkarte (Heading-up),
 * Live-GPS, Kompass, Höhenmesser und Ziel-Info – gezeichnet auf die Auto-Surface.
 */
class GeoPilotNavScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

    private val locationManager =
        carContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val sensorManager =
        carContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    private var surface: Surface? = null
    private var surfW = 0
    private var surfH = 0
    private var visible = Rect()
    private val mainHandler = android.os.Handler(Looper.getMainLooper())

    private var last: Location? = null
    private var zoom = 16
    private var follow = true
    private var headingUp = true

    // Heading aus Sensor (Azimut), wenn GPS-Kurs fehlt (Stillstand)
    private var sensorAzimuth = Float.NaN
    private var smoothHeading = 0f

    private var streetName: String = ""
    private var lastGeocode = 0L

    // ---- Kachel-Cache ----
    private val tileCache = object : LruCache<String, Bitmap>(64) {}
    private val io = Executors.newFixedThreadPool(3)
    private val pending = HashSet<String>()

    private val locListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            last = location
            updateStreet(location)
            invalidate()
            renderFrame()
        }
        @Deprecated("Für ältere Geräte erforderlich")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
    }

    private val rotVec = FloatArray(9)
    private val orientation = FloatArray(3)
    private val sensorListener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            if (e.sensor.type == Sensor.TYPE_ROTATION_VECTOR) {
                SensorManager.getRotationMatrixFromVector(rotVec, e.values)
                SensorManager.getOrientation(rotVec, orientation)
                var az = Math.toDegrees(orientation[0].toDouble()).toFloat()
                if (az < 0) az += 360f
                sensorAzimuth = az
                // Nur neu zeichnen, wenn GPS keinen Kurs liefert (Stillstand)
                val l = last
                if (l == null || !l.hasSpeed() || l.speed < 1.5f) renderFrame()
            }
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }

    private val surfaceCallback = object : SurfaceCallback {
        override fun onSurfaceAvailable(c: SurfaceContainer) {
            surface = c.surface; surfW = c.width; surfH = c.height
            if (visible.isEmpty) visible.set(0, 0, surfW, surfH)
            renderFrame()
        }
        override fun onVisibleAreaChanged(area: Rect) { visible.set(area); renderFrame() }
        override fun onStableAreaChanged(area: Rect) { if (!area.isEmpty) { visible.set(area); renderFrame() } }
        override fun onSurfaceDestroyed(c: SurfaceContainer) { surface = null }
        override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
            if (scaleFactor > 1.05f) zoom = (zoom + 1).coerceAtMost(19)
            else if (scaleFactor < 0.95f) zoom = (zoom - 1).coerceAtLeast(3)
            renderFrame()
        }
    }

    init { lifecycle.addObserver(this) }

    override fun onStart(owner: LifecycleOwner) {
        try { carContext.getCarService(AppManager::class.java).setSurfaceCallback(surfaceCallback) } catch (_: Exception) {}
        if (hasPermission()) {
            try {
                last = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                    ?: locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, locListener, Looper.getMainLooper())
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000L, 0f, locListener, Looper.getMainLooper())
            } catch (_: SecurityException) {}
        }
        sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)?.let {
            sensorManager.registerListener(sensorListener, it, SensorManager.SENSOR_DELAY_UI)
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        try { locationManager.removeUpdates(locListener) } catch (_: Exception) {}
        try { sensorManager.unregisterListener(sensorListener) } catch (_: Exception) {}
    }

    private fun hasPermission(): Boolean =
        carContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        carContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun isDark(): Boolean = carContext.isDarkMode

    // ================= Template =================
    override fun onGetTemplate(): Template {
        val strip = ActionStrip.Builder()
            .addAction(Action.Builder().setTitle(if (headingUp) "Nord ↑" else "Fahrt ↑")
                .setOnClickListener { headingUp = !headingUp; renderFrame() }.build())
            .addAction(Action.Builder().setTitle("Daten")
                .setOnClickListener { screenManager.push(CarDashboardScreen(carContext)) }.build())
            .build()

        val mapStrip = ActionStrip.Builder()
            .addAction(Action.Builder().setIcon(txtIcon("＋")).setOnClickListener { zoom = (zoom + 1).coerceAtMost(19); renderFrame() }.build())
            .addAction(Action.Builder().setIcon(txtIcon("－")).setOnClickListener { zoom = (zoom - 1).coerceAtLeast(3); renderFrame() }.build())
            .addAction(Action.Builder().setIcon(txtIcon("◎")).setOnClickListener { follow = true; renderFrame() }.build())
            .build()

        val b = NavigationTemplate.Builder().setActionStrip(strip).setMapActionStrip(mapStrip)
        b.setBackgroundColor(if (isDark()) CarColor.PRIMARY else CarColor.DEFAULT)

        val l = last
        val sp = carContext.getSharedPreferences("geopilot_car", Context.MODE_PRIVATE)
        if (l != null && sp.contains("lat")) {
            val tlat = sp.getFloat("lat", 0f).toDouble()
            val tlon = sp.getFloat("lon", 0f).toDouble()
            val res = FloatArray(2)
            Location.distanceBetween(l.latitude, l.longitude, tlat, tlon, res)
            val km = res[0] / 1000.0
            val spd = if (l.hasSpeed() && l.speed > 1f) l.speed else 14f // ~50 km/h Annahme
            val sec = (res[0] / spd).toLong()
            val arrival = DateTimeWithZone.create(System.currentTimeMillis() + sec * 1000, TimeZone.getDefault())
            val te = TravelEstimate.Builder(
                Distance.create(if (km < 1) res[0].toDouble() else km, if (km < 1) Distance.UNIT_METERS else Distance.UNIT_KILOMETERS),
                arrival
            ).setRemainingTimeSeconds(sec).build()
            b.setDestinationTravelEstimate(te)
        }
        renderFrame()
        return b.build()
    }

    private fun txtIcon(s: String): CarIcon {
        val bmp = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 44f; textAlign = Paint.Align.CENTER; isFakeBoldText = true }
        c.drawText(s, 32f, 48f, p)
        return CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build()
    }

    // ================= Web-Mercator-Kacheln =================
    private fun lon2x(lon: Double, z: Int): Double = (lon + 180.0) / 360.0 * (1 shl z)
    private fun lat2y(lat: Double, z: Int): Double {
        val r = Math.toRadians(lat)
        return (1.0 - ln(tan(r) + 1.0 / cos(r)) / PI) / 2.0 * (1 shl z)
    }

    private fun tileUrl(z: Int, x: Int, y: Int): String {
        val sub = charArrayOf('a', 'b', 'c', 'd')[(x + y) % 4]
        val style = if (isDark()) "dark_all" else "voyager"
        return "https://$sub.basemaps.cartocdn.com/$style/$z/$x/$y.png"
    }

    private fun getTile(z: Int, x: Int, y: Int): Bitmap? {
        val n = 1 shl z
        if (x < 0 || y < 0 || x >= n || y >= n) return null
        val key = "$z/$x/$y/${if (isDark()) 1 else 0}"
        tileCache.get(key)?.let { return it }
        synchronized(pending) {
            if (!pending.contains(key)) {
                pending.add(key)
                io.execute {
                    var bmp: Bitmap? = null
                    try {
                        val conn = URL(tileUrl(z, x, y)).openConnection() as HttpURLConnection
                        conn.setRequestProperty("User-Agent", "GeoPilot/1.0 (Android Auto)")
                        conn.connectTimeout = 6000; conn.readTimeout = 6000
                        val ins: InputStream = conn.inputStream
                        bmp = BitmapFactory.decodeStream(ins)
                        ins.close(); conn.disconnect()
                    } catch (_: Exception) {}
                    synchronized(pending) { pending.remove(key) }
                    if (bmp != null) { tileCache.put(key, bmp); mainHandler.post { renderFrame() } }
                }
            }
        }
        return null
    }

    // ================= Zeichnen =================
    private fun currentHeading(l: Location?): Float {
        val h = if (l != null && l.hasBearing() && l.hasSpeed() && l.speed > 1.5f) l.bearing
        else if (!sensorAzimuth.isNaN()) sensorAzimuth
        else last?.bearing ?: 0f
        // glätten
        var diff = h - smoothHeading
        while (diff > 180) diff -= 360; while (diff < -180) diff += 360
        smoothHeading += diff * 0.25f
        if (smoothHeading < 0) smoothHeading += 360; if (smoothHeading >= 360) smoothHeading -= 360
        return smoothHeading
    }

    private fun renderFrame() {
        val s = surface ?: return
        if (surfW <= 0 || surfH <= 0) return
        val canvas: Canvas = try { s.lockCanvas(null) } catch (_: Exception) { return } ?: return
        try { draw(canvas) } catch (_: Exception) {} finally {
            try { s.unlockCanvasAndPost(canvas) } catch (_: Exception) {}
        }
    }

    private fun draw(c: Canvas) {
        val dark = isDark()
        c.drawColor(if (dark) Color.rgb(11, 27, 43) else Color.rgb(232, 236, 243))
        val l = last
        val cx = surfW / 2f
        val cy = surfH / 2f
        val heading = currentHeading(l)
        val rot = if (headingUp) -heading else 0f

        if (l != null) {
            val z = zoom
            val ctx = lon2x(l.longitude, z); val cty = lat2y(l.latitude, z)
            val worldX = ctx * 256.0; val worldY = cty * 256.0
            // Anzahl Kacheln, die den (rotierten) Bildschirm abdecken
            val radiusPx = sqrt((surfW * surfW + surfH * surfH).toDouble()) / 2.0
            val rTiles = (radiusPx / 256.0).toInt() + 2
            c.save()
            c.translate(cx, cy)
            c.rotate(rot)
            val baseX = ctx.toInt(); val baseY = cty.toInt()
            for (dx in -rTiles..rTiles) for (dy in -rTiles..rTiles) {
                val tx = baseX + dx; val ty = baseY + dy
                val bmp = getTile(z, tx, ty)
                val screenX = (tx * 256.0 - worldX).toFloat()
                val screenY = (ty * 256.0 - worldY).toFloat()
                if (bmp != null) c.drawBitmap(bmp, screenX, screenY, null)
                else {
                    val p = Paint(); p.color = if (dark) Color.rgb(16, 32, 48) else Color.rgb(220, 226, 234)
                    c.drawRect(screenX, screenY, screenX + 256f, screenY + 256f, p)
                }
            }
            // Ziel-Linie
            val sp = carContext.getSharedPreferences("geopilot_car", Context.MODE_PRIVATE)
            if (sp.contains("lat")) {
                val tlat = sp.getFloat("lat", 0f).toDouble(); val tlon = sp.getFloat("lon", 0f).toDouble()
                val tX = (lon2x(tlon, z) * 256.0 - worldX).toFloat(); val tY = (lat2y(tlat, z) * 256.0 - worldY).toFloat()
                val lp = Paint(Paint.ANTI_ALIAS_FLAG); lp.color = Color.rgb(245, 166, 35); lp.strokeWidth = 8f; lp.style = Paint.Style.STROKE
                c.drawLine(0f, 0f, tX, tY, lp)
                val mp = Paint(Paint.ANTI_ALIAS_FLAG); mp.color = Color.rgb(245, 166, 35)
                c.drawCircle(tX, tY, 12f, mp)
            }
            c.restore()
        }

        // Positions-Chevron (Mitte, zeigt bei Heading-up nach oben)
        drawChevron(c, cx, cy, if (headingUp) 0f else heading, l != null)
        // HUD
        drawHud(c, l, heading, dark)
        // Kompass-Rose
        drawCompass(c, heading, dark)
    }

    private fun drawChevron(c: Canvas, cx: Float, cy: Float, deg: Float, hasFix: Boolean) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = if (hasFix) Color.rgb(37, 99, 235) else Color.GRAY
        c.save(); c.translate(cx, cy); c.rotate(deg)
        val path = Path()
        path.moveTo(0f, -26f); path.lineTo(18f, 20f); path.lineTo(0f, 10f); path.lineTo(-18f, 20f); path.close()
        c.drawPath(path, p)
        val ring = Paint(Paint.ANTI_ALIAS_FLAG); ring.color = Color.WHITE; ring.style = Paint.Style.STROKE; ring.strokeWidth = 3f
        c.drawPath(path, ring)
        c.restore()
    }

    private fun drawHud(c: Canvas, l: Location?, heading: Float, dark: Boolean) {
        val left = visible.left + 24f
        var top = visible.top + 20f
        val card = Paint(Paint.ANTI_ALIAS_FLAG); card.color = if (dark) Color.argb(210, 14, 28, 43) else Color.argb(230, 255, 255, 255)
        val fg = if (dark) Color.WHITE else Color.rgb(11, 18, 32)
        val muted = if (dark) Color.rgb(138, 161, 184) else Color.rgb(100, 116, 139)
        val big = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fg; textSize = 64f; isFakeBoldText = true }
        val sml = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = muted; textSize = 30f }
        val mid = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fg; textSize = 40f; isFakeBoldText = true }

        // Tempo-Karte
        val spdKmh = if (l != null && l.hasSpeed()) (l.speed * 3.6f).roundToInt() else 0
        val r = RectF(left, top, left + 260f, top + 150f)
        c.drawRoundRect(r, 22f, 22f, card)
        c.drawText("$spdKmh", left + 24f, top + 86f, big)
        c.drawText("km/h", left + 24f, top + 124f, sml)

        // Höhenmesser + Kurs
        top += 166f
        val r2 = RectF(left, top, left + 260f, top + 188f)
        c.drawRoundRect(r2, 22f, 22f, card)
        val altTxt = if (l != null && l.hasAltitude()) "${l.altitude.roundToInt()} m" else "– m"
        c.drawText("⛰", left + 24f, top + 50f, mid)
        c.drawText(altTxt, left + 70f, top + 50f, mid)
        c.drawText("Höhe", left + 24f, top + 78f, sml)
        val card8 = cardinal(heading)
        c.drawText("${heading.roundToInt()}° $card8", left + 24f, top + 134f, mid)
        c.drawText("Kurs", left + 24f, top + 162f, sml)

        // Straßenname unten
        if (streetName.isNotEmpty()) {
            val bw = (visible.width() - 48).coerceAtLeast(200)
            val rb = RectF(visible.left + 24f, visible.bottom - 92f, visible.left + 24f + bw, visible.bottom - 24f)
            c.drawRoundRect(rb, 20f, 20f, card)
            val st = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fg; textSize = 38f; isFakeBoldText = true }
            c.drawText(clip(streetName, st, bw - 40f), rb.left + 22f, rb.top + 46f, st)
        }
    }

    private fun drawCompass(c: Canvas, heading: Float, dark: Boolean) {
        val cx = visible.right - 80f; val cy = visible.top + 80f; val rad = 52f
        val bg = Paint(Paint.ANTI_ALIAS_FLAG); bg.color = if (dark) Color.argb(210, 14, 28, 43) else Color.argb(230, 255, 255, 255)
        c.drawCircle(cx, cy, rad, bg)
        c.save(); c.translate(cx, cy); c.rotate(-heading)
        val n = Paint(Paint.ANTI_ALIAS_FLAG); n.color = Color.rgb(239, 68, 68)
        val path = Path(); path.moveTo(0f, -rad + 6f); path.lineTo(10f, 0f); path.lineTo(-10f, 0f); path.close()
        c.drawPath(path, n)
        val s = Paint(Paint.ANTI_ALIAS_FLAG); s.color = if (dark) Color.rgb(138, 161, 184) else Color.rgb(100, 116, 139)
        val path2 = Path(); path2.moveTo(0f, rad - 6f); path2.lineTo(10f, 0f); path2.lineTo(-10f, 0f); path2.close()
        c.drawPath(path2, s)
        c.restore()
        val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if (dark) Color.WHITE else Color.rgb(11,18,32); textSize = 24f; textAlign = Paint.Align.CENTER; isFakeBoldText = true }
        c.drawText("N", cx, cy - rad - 8f, tp)
    }

    private fun cardinal(deg: Float): String {
        val dirs = arrayOf("N", "NO", "O", "SO", "S", "SW", "W", "NW")
        return dirs[(((deg % 360) + 360) % 360 / 45f).roundToInt() % 8]
    }

    private fun clip(s: String, p: Paint, maxW: Float): String {
        if (p.measureText(s) <= maxW) return s
        var t = s
        while (t.isNotEmpty() && p.measureText("$t…") > maxW) t = t.dropLast(1)
        return "$t…"
    }

    private fun updateStreet(l: Location) {
        if (System.currentTimeMillis() - lastGeocode < 5000) return
        lastGeocode = System.currentTimeMillis()
        io.execute {
            try {
                val gc = Geocoder(carContext)
                @Suppress("DEPRECATION")
                val list = gc.getFromLocation(l.latitude, l.longitude, 1)
                val a = list?.firstOrNull()
                if (a != null) {
                    val road = a.thoroughfare ?: a.featureName ?: ""
                    val city = a.locality ?: a.subAdminArea ?: ""
                    val txt = listOf(road, city).filter { it.isNotBlank() }.joinToString(" · ")
                    if (txt.isNotBlank()) { streetName = txt; mainHandler.post { renderFrame() } }
                }
            } catch (_: Exception) {}
        }
    }
}
