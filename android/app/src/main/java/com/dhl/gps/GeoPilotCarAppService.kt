package com.dhl.gps

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

/**
 * Einstiegspunkt für Android Auto. Stellt die GeoPilot-Oberfläche auf dem
 * Auto-Display bereit (Live-Position, Tempo, Kurs und aktives Ziel).
 */
class GeoPilotCarAppService : CarAppService() {

    // Für seitlich installierte Test-APKs alle Hosts zulassen.
    // (Für eine Play-Store-Veröffentlichung würde man hier streng validieren.)
    override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = object : Session() {
        override fun onCreateScreen(intent: Intent): Screen = GeoPilotNavScreen(carContext)
    }
}
