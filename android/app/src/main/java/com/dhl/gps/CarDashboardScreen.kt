package com.dhl.gps

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * Auto-Bildschirm: zeigt Live-GPS und das in der Handy-App gesetzte Ziel.
 * Der Standort kommt direkt vom System-LocationManager (gleiche Berechtigung
 * wie die Telefon-App). Das Ziel wird über SharedPreferences geteilt.
 */
class CarDashboardScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

    private val locationManager =
        carContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var last: Location? = null

    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) { last = location; invalidate() }
        @Deprecated("Für ältere Geräte erforderlich")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
    }

    init { lifecycle.addObserver(this) }

    override fun onStart(owner: LifecycleOwner) {
        if (!hasPermission()) return
        try {
            last = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000L, 0f, listener, Looper.getMainLooper())
            locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000L, 0f, listener, Looper.getMainLooper())
        } catch (e: SecurityException) {
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        try { locationManager.removeUpdates(listener) } catch (_: Exception) {}
    }

    private fun hasPermission(): Boolean =
        carContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        carContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun fmtDist(m: Float): String =
        if (m < 1000) "${Math.round(m)} m" else String.format("%.1f km", m / 1000.0)

    override fun onGetTemplate(): Template {
        val pane = Pane.Builder()

        if (!hasPermission()) {
            pane.addRow(
                Row.Builder()
                    .setTitle("Standort nicht freigegeben")
                    .addText("Bitte zuerst in der GeoPilot-Handy-App den Standort erlauben.")
                    .build()
            )
        } else {
            val l = last
            if (l == null) {
                pane.addRow(Row.Builder().setTitle("Suche GPS-Signal…").addText("Bitte einen Moment warten.").build())
            } else {
                pane.addRow(
                    Row.Builder().setTitle("Position")
                        .addText(String.format("%.5f, %.5f", l.latitude, l.longitude)).build()
                )
                pane.addRow(
                    Row.Builder().setTitle("Tempo")
                        .addText(if (l.hasSpeed()) "${Math.round(l.speed * 3.6f)} km/h" else "–").build()
                )
                pane.addRow(
                    Row.Builder().setTitle("Kurs")
                        .addText(if (l.hasBearing()) "${Math.round(l.bearing)}°" else "–").build()
                )

                val sp = carContext.getSharedPreferences("geopilot_car", Context.MODE_PRIVATE)
                if (sp.contains("lat")) {
                    val tlat = sp.getFloat("lat", 0f).toDouble()
                    val tlon = sp.getFloat("lon", 0f).toDouble()
                    val tname = sp.getString("name", "Ziel") ?: "Ziel"
                    val res = FloatArray(2)
                    Location.distanceBetween(l.latitude, l.longitude, tlat, tlon, res)
                    val brg = ((res[1] + 360) % 360).toInt()
                    pane.addRow(
                        Row.Builder().setTitle("Ziel: $tname")
                            .addText("${fmtDist(res[0])} · Richtung $brg°").build()
                    )
                } else {
                    pane.addRow(Row.Builder().setTitle("Kein Ziel gesetzt").addText("Ziel in der Handy-App auswählen.").build())
                }
            }
        }

        pane.addAction(
            Action.Builder()
                .setTitle("Aktualisieren")
                .setBackgroundColor(CarColor.BLUE)
                .setOnClickListener { invalidate() }
                .build()
        )

        return PaneTemplate.Builder(pane.build())
            .setHeaderAction(Action.APP_ICON)
            .setTitle("GeoPilot")
            .build()
    }
}
