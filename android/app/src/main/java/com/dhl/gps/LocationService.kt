package com.dhl.gps

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Foreground-Dienst, der den Standort auch bei geschlossener App aktiv hält
 * (zeigt eine dauerhafte Benachrichtigung). Nutzt nur den System-LocationManager,
 * keine Google Play Services.
 */
class LocationService : Service() {

    private lateinit var locationManager: LocationManager

    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {}
        @Deprecated("Für ältere Geräte erforderlich")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        startInForeground()
        requestUpdates()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    private fun requestUpdates() {
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) return
        try {
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000L, 0f, listener, mainLooper)
        } catch (se: SecurityException) {
        }
    }

    private fun startInForeground() {
        val channelId = "geoguard_location"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Standort-Tracking", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            PendingIntent.FLAG_IMMUTABLE else 0
        val pending = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), flags)

        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("GeoGuard aktiv")
            .setContentText("Standort wird im Hintergrund verfolgt")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .setContentIntent(pending)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    override fun onDestroy() {
        try { locationManager.removeUpdates(listener) } catch (_: Exception) {}
        super.onDestroy()
    }

    companion object {
        private const val NOTIF_ID = 7
    }
}
