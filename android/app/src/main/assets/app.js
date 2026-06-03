/* GeoGuard – App-Logik (offline). Nativ (Android-Bridge) und als Web/PWA. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var LS = window.localStorage;
  function hasNative() { return typeof window.Android !== "undefined" && window.Android; }
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("toast"); if (!t) return;
    t.innerHTML = msg; t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }
  function needOnline() { if (navigator.onLine === false) { toast("📡 Keine Internetverbindung – diese Funktion ist online."); return false; } return true; }

  // ================= Einheiten =================
  var units = LS.getItem("gg_units") || "metric";
  function isImp() { return units === "imperial"; }
  function fmtSpeed(ms) { return (ms == null || isNaN(ms)) ? "--" : (ms * (isImp() ? 2.23694 : 3.6)).toFixed(1); }
  function fmtAlt(m) { return (m == null || isNaN(m)) ? "--" : (m * (isImp() ? 3.28084 : 1)).toFixed(0); }
  function fmtDist(m) {
    if (m == null || isNaN(m)) return { v: "--", u: "m" };
    if (isImp()) { var ft = m * 3.28084; return ft < 1000 ? { v: ft.toFixed(0), u: "ft" } : { v: (m / 1609.344).toFixed(2), u: "mi" }; }
    return m < 1000 ? { v: m.toFixed(0), u: "m" } : { v: (m / 1000).toFixed(2), u: "km" };
  }
  function applyUnitLabels() {
    $("spdU").textContent = isImp() ? "mph" : "km/h"; $("altU").textContent = isImp() ? "ft" : "m";
    $("upU").textContent = isImp() ? "ft" : "m"; $("downU").textContent = isImp() ? "ft" : "m";
    $("hudUnit").textContent = isImp() ? "mph" : "km/h";
  }

  // ================= Geo-Mathematik =================
  function toRad(d) { return d * Math.PI / 180; } function toDeg(r) { return r * 180 / Math.PI; }
  function haversine(a, b, c, d) {
    var R = 6371000, dLat = toRad(c - a), dLon = toRad(d - b);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  function bearing(a, b, c, d) {
    var y = Math.sin(toRad(d - b)) * Math.cos(toRad(c));
    var x = Math.cos(toRad(a)) * Math.sin(toRad(c)) - Math.sin(toRad(a)) * Math.cos(toRad(c)) * Math.cos(toRad(d - b));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  function cardinal(deg) { return ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round((deg % 360) / 22.5) % 16]; }
  function toDMS(v, isLat) { var h = isLat ? (v >= 0 ? "N" : "S") : (v >= 0 ? "O" : "W"); v = Math.abs(v); var dd = Math.floor(v), mf = (v - dd) * 60, mm = Math.floor(mf), ss = ((mf - mm) * 60).toFixed(1); return dd + "° " + mm + "' " + ss + '" ' + h; }
  function fmt(v, dec) { return (v == null || isNaN(v)) ? "--" : Number(v).toFixed(dec); }

  // ================= Koordinaten: UTM / MGRS / Plus Code =================
  function latLonToUTM(lat, lon) {
    var a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    var zone = Math.floor((lon + 180) / 6) + 1, lon0 = toRad((zone - 1) * 6 - 180 + 3);
    var phi = toRad(lat), lam = toRad(lon);
    var N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
    var T = Math.tan(phi) * Math.tan(phi), C = ep2 * Math.cos(phi) * Math.cos(phi), A = Math.cos(phi) * (lam - lon0);
    var M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
      - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
      + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
      - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi));
    var easting = k0 * N * (A + (1 - T + C) * A * A * A / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
    var northing = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
    if (lat < 0) northing += 10000000;
    var band = "CDEFGHJKLMNPQRSTUVWX".charAt(Math.floor((lat + 80) / 8));
    return { zone: zone, band: band, easting: easting, northing: northing, hemi: lat >= 0 ? "N" : "S" };
  }
  function utmString(lat, lon) {
    if (lat < -80 || lat > 84) return "außerhalb UTM";
    var u = latLonToUTM(lat, lon);
    return u.zone + u.band + " " + Math.round(u.easting) + "E " + Math.round(u.northing) + "N";
  }
  function mgrsString(lat, lon) {
    if (lat < -80 || lat > 84) return "außerhalb MGRS";
    var u = latLonToUTM(lat, lon);
    var col = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"][(u.zone - 1) % 3].charAt(Math.floor(u.easting / 100000) - 1);
    var rowSet = (u.zone % 2 === 0) ? "FGHJKLMNPQRSTUVWXYZABCDE" : "ABCDEFGHJKLMNPQRSTUVWXYZ";
    var row = rowSet.charAt(Math.floor(u.northing % 2000000 / 100000) % rowSet.length);
    function pad5(n) { n = Math.floor(n % 100000).toString(); while (n.length < 5) n = "0" + n; return n; }
    return u.zone + u.band + " " + col + row + " " + pad5(u.easting) + " " + pad5(u.northing);
  }
  function plusCode(lat, lon) {
    var ALPH = "23456789CFGHJMPQRVWX";
    lat = Math.min(89.999999, Math.max(-90, lat));
    lon = ((lon % 360) + 540) % 360 - 180;
    var latC = lat + 90, lonC = lon + 180, res = 20, code = "";
    for (var i = 0; i < 5; i++) {
      var dl = Math.floor(latC / res); if (dl > 19) dl = 19; latC -= dl * res;
      var dn = Math.floor(lonC / res); if (dn > 19) dn = 19; lonC -= dn * res;
      code += ALPH.charAt(dl) + ALPH.charAt(dn);
      if (code.length === 8) code += "+";
      res /= 20;
    }
    return code;
  }

  // ================= SunCalc (Sonne & Mond, offline) =================
  var rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, eObl = rad * 23.4397;
  function toDays(date) { return (date.valueOf() / dayMs - 0.5 + J1970) - J2000; }
  function raF(l, b) { return Math.atan2(Math.sin(l) * Math.cos(eObl) - Math.tan(b) * Math.sin(eObl), Math.cos(l)); }
  function decF(l, b) { return Math.asin(Math.sin(b) * Math.cos(eObl) + Math.cos(b) * Math.sin(eObl) * Math.sin(l)); }
  function sidereal(d, lw) { return rad * (280.16 + 360.9856235 * d) - lw; }
  function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }
  function eclipticLong(M) { var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)); return M + C + rad * 102.9372 + Math.PI; }
  function sunCoords(d) { var M = solarMeanAnomaly(d), L = eclipticLong(M); return { dec: decF(L, 0), ra: raF(L, 0) }; }
  function sunPosition(date, lat, lng) {
    var lw = rad * -lng, phi = rad * lat, d = toDays(date), c = sunCoords(d), H = sidereal(d, lw) - c.ra;
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi));
    var alt = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
    return { azimuth: (toDeg(az) + 180) % 360, altitude: toDeg(alt) };
  }
  var J0 = 0.0009;
  function fromJulianDays(j) { return new Date((j + J2000 + 0.5 - J1970) * dayMs); }
  function sunTimes(date, lat, lng) {
    var lw = rad * -lng, phi = rad * lat, d = toDays(date);
    var n = Math.round(d - J0 - lw / (2 * Math.PI)), ds = J0 + (0 + lw) / (2 * Math.PI) + n;
    var M = solarMeanAnomaly(ds), L = eclipticLong(M), dec = decF(L, 0);
    var Jnoon = ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    var h0 = -0.833 * rad;
    var w = Math.acos((Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    var a = J0 + (w + lw) / (2 * Math.PI) + n, Jset = a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    var Jrise = Jnoon - (Jset - Jnoon);
    return { sunrise: fromJulianDays(Jrise), sunset: fromJulianDays(Jset) };
  }
  function moonIllum(date) {
    var d = toDays(date), s = sunCoords(d);
    var L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
    var l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dt = 385001 - 20905 * Math.cos(M);
    var mra = raF(l, b), mdec = decF(l, b), sdist = 149598000;
    var phi = Math.acos(Math.sin(s.dec) * Math.sin(mdec) + Math.cos(s.dec) * Math.cos(mdec) * Math.cos(s.ra - mra));
    var inc = Math.atan2(sdist * Math.sin(phi), dt - sdist * Math.cos(phi));
    var angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - mra), Math.sin(s.dec) * Math.cos(mdec) - Math.cos(s.dec) * Math.sin(mdec) * Math.cos(s.ra - mra));
    return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI };
  }
  function moonName(phase) {
    var names = [["🌑", "Neumond"], ["🌒", "zunehmend"], ["🌓", "1. Viertel"], ["🌔", "zunehmend"], ["🌕", "Vollmond"], ["🌖", "abnehmend"], ["🌗", "letztes Viertel"], ["🌘", "abnehmend"]];
    return names[Math.round(phase * 8) % 8];
  }
  function fmtTime(d) { return (d && !isNaN(d.getTime())) ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–"; }

  function updateSky(lat, lon) {
    try {
      var now = new Date(), t = sunTimes(now, lat, lon), sp = sunPosition(now, lat, lon), mi = moonIllum(now), mn = moonName(mi.phase);
      $("sunrise").textContent = fmtTime(t.sunrise);
      $("sunset").textContent = fmtTime(t.sunset);
      $("sunpos").textContent = Math.round(sp.azimuth) + "° / " + Math.round(sp.altitude) + "°";
      $("moon").textContent = mn[0] + " " + mn[1] + " (" + Math.round(mi.fraction * 100) + "%)";
      var sd = $("sunDot");
      if (sp.altitude > -6 && smooth != null) {
        sd.style.display = "block";
        var r = 76, rel = (sp.azimuth - smooth) * Math.PI / 180;
        sd.style.transform = "translate(" + (Math.sin(rel) * r) + "px," + (-Math.cos(rel) * r) + "px)";
      } else sd.style.display = "none";
    } catch (e) {}
  }

  // ================= Status & Kompass =================
  function setStatus(s, t) { $("dot").className = "dot " + (s || ""); $("statusText").textContent = t; if ($("hubDot")) $("hubDot").className = "dot " + (s || ""); if ($("hubPowerTxt")) $("hubPowerTxt").textContent = t; }
  (function () {
    var ticks = $("ticks");
    for (var d = 0; d < 360; d += 15) { var t = document.createElement("div"); t.className = "tick" + (d % 45 === 0 ? " major" : ""); t.style.transform = "translate(-50%,-100%) rotate(" + d + "deg)"; t.innerHTML = "<i></i>"; ticks.appendChild(t); }
    [["N", 0, "N"], ["O", 90, ""], ["S", 180, ""], ["W", 270, ""]].forEach(function (c) { var el = document.createElement("div"); el.className = "card-letter " + c[2]; el.style.transform = "translate(-50%,-50%) rotate(" + c[1] + "deg)"; el.innerHTML = "<span>" + c[0] + "</span>"; ticks.appendChild(el); });
  })();

  var heading = null, smooth = null, nativeHeadingSeen = false, usingWebSensor = false;
  var northRef = LS.getItem("gg_north") || "magnetic", declination = 0;
  function effHeading(magDeg) { return (northRef === "true") ? (magDeg + declination + 360) % 360 : magDeg; }
  function updateHeading(deg, source) {
    if (deg == null || isNaN(deg)) return;
    deg = effHeading((deg % 360 + 360) % 360); heading = deg;
    if (smooth == null) smooth = deg; else { var diff = ((deg - smooth + 540) % 360) - 180; smooth = (smooth + diff * 0.18 + 360) % 360; }
    var dc = $("dirCone"); if (dc) dc.style.transform = "rotate(" + smooth + "deg)";
    $("hdgDeg").textContent = Math.round(smooth); $("hdgCard").textContent = cardinal(smooth);
    if (source) $("hdgSource").textContent = "Sensor: " + source + (northRef === "true" ? " · echt N" : " · magn. N");
    $("hudHdg").textContent = Math.round(smooth) + "° " + cardinal(smooth);
    if ($("cmHdg")) $("cmHdg").textContent = Math.round(smooth) + "° " + cardinal(smooth);
    updateNavArrow();
  }

  // ===== Kompass-Instrumente (Status, Neigung, Magnetfeld) =====
  window.onNativeTilt = function (pitch, roll) { showTilt(Number(pitch), Number(roll)); };
  window.onNativeMagnetic = function (uT) { var v = Math.round(Number(uT)), el = $("magUt"); if (!el) return; el.textContent = v; el.style.color = (v >= 25 && v <= 65) ? "" : "var(--warning)"; };
  window.onNativeCompassAccuracy = function (acc) {
    var el = $("compAcc"); if (!el) return;
    var m = ({ 3: ["Hoch", "var(--success)"], 2: ["Mittel", "var(--primary)"], 1: ["Niedrig – kalibrieren", "var(--warning)"], 0: ["Unzuverlässig – kalibrieren", "var(--danger)"] })[acc] || ["–", "var(--text-muted)"];
    el.textContent = m[0]; el.style.color = m[1];
  };
  function showTilt(pitch, roll) {
    if (pitch == null || isNaN(pitch)) return;
    var t = $("tiltVal"); if (t) t.textContent = Math.round(pitch) + "° / " + Math.round(roll) + "°";
    var b = $("levelBubble"); if (!b) return;
    var x = Math.max(-18, Math.min(18, roll)), y = Math.max(-18, Math.min(18, pitch)), flat = Math.abs(pitch) < 2.5 && Math.abs(roll) < 2.5;
    b.style.left = (50 + x * 1.6) + "%"; b.style.top = (50 + y * 1.6) + "%";
    b.style.background = flat ? "var(--success)" : "var(--warning)"; b.style.boxShadow = "0 0 6px " + (flat ? "var(--success)" : "var(--warning)");
  }

  // ================= Position =================
  var lastFix = null, lastRawHeading = null;
  function updateLocation(p) {
    lastFix = p;
    if (p.declination != null && !isNaN(p.declination)) { declination = p.declination; $("declHint").textContent = "Missweisung: " + (p.declination >= 0 ? "+" : "") + p.declination.toFixed(1) + "° (" + (p.declination >= 0 ? "Ost" : "West") + ")"; }
    $("lat").textContent = fmt(p.lat, 6); $("lon").textContent = fmt(p.lon, 6);
    $("alt").textContent = fmtAlt(p.alt); $("spd").textContent = fmtSpeed(p.speed);
    $("course").textContent = (p.bearing != null && !isNaN(p.bearing)) ? Math.round(p.bearing) : "--";
    $("provider").textContent = p.provider || "GPS";
    $("dms").textContent = toDMS(p.lat, true) + "  /  " + toDMS(p.lon, false);
    $("utm").textContent = utmString(p.lat, p.lon); $("mgrs").textContent = mgrsString(p.lat, p.lon); $("plus").textContent = plusCode(p.lat, p.lon);
    $("ts").textContent = new Date(p.time || Date.now()).toLocaleTimeString("de-DE");
    $("hudSpeed").textContent = fmtSpeed(p.speed);

    var acc = p.acc, fill = $("accFill"), q = $("fixQuality");
    $("accVal").textContent = (acc != null && !isNaN(acc)) ? Math.round(acc) : "--";
    if (acc != null && !isNaN(acc)) {
      fill.style.width = Math.max(6, Math.min(100, 100 - (acc / 50 * 100))) + "%";
      var col, lab;
      if (acc <= 8) { col = "var(--success)"; lab = "SEHR GENAU"; } else if (acc <= 20) { col = "var(--primary)"; lab = "GUT"; }
      else if (acc <= 50) { col = "var(--warning)"; lab = "MITTEL"; } else { col = "var(--danger)"; lab = "UNGENAU"; }
      fill.style.background = col; q.textContent = lab;
    }
    if (p.bearing != null && !isNaN(p.bearing)) { lastRawHeading = p.bearing; if (!usingWebSensor && !nativeHeadingSeen) updateHeading(p.bearing, "GPS-Kurs"); }
    setStatus("live", "Aktiv");
    updateSky(p.lat, p.lon);
    onMapLocation(p); recordPoint(p); updateNavArrow(); checkGeofence();
    maybeWeather(p.lat, p.lon); routeProgress();
    updateTrackLive(p); updateTrackMap(p); maybeReverse(p.lat, p.lon); updateCompassMap(p); updateQuickTiles(p);
  }
  function updateQuickTiles(p) {
    if ($("qSpeed")) $("qSpeed").textContent = (p.speed != null && !isNaN(p.speed)) ? fmtSpeed(p.speed) : "0";
    if ($("qSpeedU")) $("qSpeedU").textContent = isImp() ? "mph" : "km/h";
    if ($("qAlt")) $("qAlt").textContent = fmtAlt(p.alt);
    if ($("qAltU")) $("qAltU").textContent = isImp() ? "ft" : "m";
    if ($("qCourse")) $("qCourse").textContent = (p.bearing != null && !isNaN(p.bearing)) ? Math.round(p.bearing) : "--";
    if ($("qAcc")) $("qAcc").textContent = (p.acc != null && !isNaN(p.acc)) ? Math.round(p.acc) : "--";
  }

  // ================= Native Bridge =================
  window.onNativeLocation = function (j) { if (j == null) { setStatus("err", "Keine Freigabe"); return; } try { updateLocation(typeof j === "string" ? JSON.parse(j) : j); } catch (e) {} };
  window.onNativeHeading = function (deg) { nativeHeadingSeen = true; lastRawHeading = Number(deg); updateHeading(Number(deg), "Magnetometer"); };
  window.onNativeGnss = function (j) { try { updateGnss(typeof j === "string" ? JSON.parse(j) : j); } catch (e) {} };

  // ================= Web-Fallback =================
  var watchId = null;
  function startWeb() {
    if (!("geolocation" in navigator)) { setStatus("err", "Kein GPS"); return; }
    setStatus("warn", "Suche Signal…");
    watchId = navigator.geolocation.watchPosition(function (pos) {
      var c = pos.coords; updateLocation({ lat: c.latitude, lon: c.longitude, alt: c.altitude, acc: c.accuracy, speed: c.speed, bearing: c.heading, time: pos.timestamp, provider: "GPS (Web)" });
    }, function (err) { setStatus("err", "Fehler"); toast("Standort-Fehler: " + err.message); }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    enableWebCompass();
  }
  function enableWebCompass() {
    function handler(e) { var h = null; if (e.webkitCompassHeading != null) h = e.webkitCompassHeading; else if (e.alpha != null) h = 360 - e.alpha; if (h != null) { usingWebSensor = true; lastRawHeading = h; updateHeading(h, e.webkitCompassHeading != null ? "iOS-Kompass" : "Orientierung"); } if (e.beta != null) showTilt(e.beta, e.gamma || 0); }
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().then(function (s) { if (s === "granted") window.addEventListener("deviceorientation", handler, true); }).catch(function () {});
    } else { window.addEventListener("deviceorientationabsolute", handler, true); window.addEventListener("deviceorientation", handler, true); }
  }
  var appActive = false;
  function syncSwitch() { var t = $("masterToggle"); if (t) t.classList.toggle("on", appActive); if ($("hubStatus")) $("hubStatus").textContent = appActive ? "Aktiv – Live-Daten laufen" : "App ist aus – oben einschalten"; }
  function startTracking() { appActive = true; syncSwitch(); if (hasNative()) { try { window.Android.startLocation(); } catch (e) {} setStatus("warn", "Suche Signal…"); } else startWeb(); setTimeout(ensureCompassMap, 200); }
  function stopTracking() {
    appActive = false; syncSwitch();
    if (hasNative()) { try { window.Android.stopLocation(); } catch (e) {} }
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    // Alles, was Strom zieht, beenden:
    if (typeof recording !== "undefined" && recording) { recording = false; if (recTimer) { clearInterval(recTimer); recTimer = null; } if ($("recBtn")) { $("recBtn").textContent = "⏺ Start"; $("recBtn").className = "b-success"; } if ($("tkState")) $("tkState").textContent = "Gestoppt"; }
    if (typeof pauseFlug === "function") pauseFlug();
    setStatus("", "Aus");
  }
  if ($("masterBtn")) $("masterBtn").onclick = function () { if (appActive) stopTracking(); else startTracking(); };

  $("startBtn").onclick = startTracking;
  $("stopBtn").onclick = stopTracking;
  $("calibBtn").onclick = function () { smooth = null; toast("Gerät in liegender Acht (∞) bewegen."); if (!hasNative()) enableWebCompass(); };

  function coordText() { return lastFix ? (lastFix.lat.toFixed(6) + ", " + lastFix.lon.toFixed(6)) : ""; }
  function osmUrl() { return lastFix ? ("https://www.openstreetmap.org/?mlat=" + lastFix.lat + "&mlon=" + lastFix.lon + "#map=17/" + lastFix.lat + "/" + lastFix.lon) : ""; }
  $("copyBtn").onclick = function () { if (!lastFix) { toast("Noch keine Position."); return; } var t = coordText(); if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast("Kopiert: " + t); }); else toast(t); };
  function shareLocation() { if (!lastFix) { toast("Noch keine Position."); return; } var txt = "Mein Standort: " + coordText() + " " + osmUrl(); if (navigator.share) navigator.share({ title: "Mein Standort", text: txt }).catch(function () {}); else if (hasNative()) { try { window.Android.share(txt); } catch (e) {} } else toast(osmUrl()); }
  $("shareBtn").onclick = shareLocation; $("shareBtn2").onclick = shareLocation;
  $("sosBtn").onclick = function () {
    var txt = lastFix ? ("NOTFALL! Ich brauche Hilfe. Standort: " + coordText() + " " + osmUrl()) : "NOTFALL! Ich brauche Hilfe. (Standort unbekannt)";
    if (hasNative()) { try { window.Android.sos(txt); return; } catch (e) {} }
    if (navigator.share) navigator.share({ text: txt }).catch(function () {}); else window.location.href = "sms:?body=" + encodeURIComponent(txt);
  };

  // ================= QR =================
  $("qrBtn").onclick = function () {
    if (!lastFix) { toast("Noch keine Position."); return; }
    var data = "geo:" + lastFix.lat.toFixed(6) + "," + lastFix.lon.toFixed(6);
    try {
      var qr = qrcode(0, "M"); qr.addData(data); qr.make();
      $("qrBox").innerHTML = qr.createImgTag(6, 8);
    } catch (e) { $("qrBox").textContent = data; }
    $("qrText").textContent = coordText();
    $("qrOverlay").classList.add("show");
  };
  $("qrOverlay").onclick = function () { this.classList.remove("show"); };

  // ================= HUD =================
  $("hudBtn").onclick = function () { $("hudOverlay").classList.add("show"); };
  $("hudOverlay").onclick = function () { this.classList.remove("show"); };

  // ================= Tabs =================
  var nav = $("nav");
  nav.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return; var tab = b.getAttribute("data-tab");
    Array.prototype.forEach.call(nav.children, function (c) { c.classList.toggle("sel", c === b); });
    ["dash", "map", "nav", "tracking", "sat", "flug", "more"].forEach(function (t) { $("page-" + t).classList.toggle("active", t === tab); });
    if (tab === "dash") ensureCompassMap();
    if (tab === "map") ensureMap();
    if (tab === "tracking") { openTrack(); drawProfile(); }
    if (tab === "flug") openFlug(); else pauseFlug();
  });
  function switchTab(tab) { var b = nav.querySelector('[data-tab="' + tab + '"]'); if (b) b.click(); }
  Array.prototype.forEach.call(document.querySelectorAll(".launch-tile"), function (b) { b.onclick = function () { switchTab(b.getAttribute("data-go")); }; });
  if ($("hubPower")) $("hubPower").onclick = function () { $("masterBtn").click(); };

  // ================= IndexedDB (Kacheln + Touren) =================
  var dbPromise = null;
  function getDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (res, rej) {
      var r = indexedDB.open("geoguard", 1);
      r.onupgradeneeded = function (e) { var db = e.target.result; if (!db.objectStoreNames.contains("tiles")) db.createObjectStore("tiles"); if (!db.objectStoreNames.contains("tours")) db.createObjectStore("tours", { keyPath: "id" }); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return dbPromise;
  }
  function idbGet(store, key) { return getDB().then(function (db) { return new Promise(function (res) { var t = db.transaction(store).objectStore(store).get(key); t.onsuccess = function () { res(t.result); }; t.onerror = function () { res(null); }; }); }); }
  function idbPut(store, val, key) { return getDB().then(function (db) { return new Promise(function (res) { var os = db.transaction(store, "readwrite").objectStore(store); var t = key !== undefined ? os.put(val, key) : os.put(val); t.onsuccess = function () { res(true); }; t.onerror = function () { res(false); }; }); }); }
  function idbDel(store, key) { return getDB().then(function (db) { return new Promise(function (res) { var t = db.transaction(store, "readwrite").objectStore(store).delete(key); t.onsuccess = function () { res(true); }; t.onerror = function () { res(false); }; }); }); }
  function idbAll(store) { return getDB().then(function (db) { return new Promise(function (res) { var out = [], c = db.transaction(store).objectStore(store).openCursor(); c.onsuccess = function (e) { var cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else res(out); }; c.onerror = function () { res(out); }; }); }); }
  function idbCount(store) { return getDB().then(function (db) { return new Promise(function (res) { var t = db.transaction(store).objectStore(store).count(); t.onsuccess = function () { res(t.result); }; t.onerror = function () { res(0); }; }); }); }
  function refreshTileCount() { idbCount("tiles").then(function (n) { $("tileCount").textContent = n; }); }

  // ================= Karte =================
  var map = null, meMarker = null, accCircle = null, trackLine = null, targetMarker = null, viewLine = null, followMe = true;
  var TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  var TILE_SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  var TILE_TOPO = "https://a.tile.opentopomap.org/{z}/{x}/{y}.png";
  var mapStyle = LS.getItem("gg_mapstyle") || "standard";
  var mapBaseLayer = null, trackBaseLayer = null, flugBaseLayer = null, compassBaseLayer = null;
  function makeBaseLayer() {
    if (mapStyle === "satellite") return L.tileLayer(TILE_SAT, { maxZoom: 19 });
    if (mapStyle === "terrain") return L.tileLayer(TILE_TOPO, { maxZoom: 17 });
    return new OfflineLayer(TILE_URL, { maxZoom: 19 });
  }
  function swapBase(m, old) { if (!m) return null; if (old) m.removeLayer(old); var nl = makeBaseLayer(); nl.addTo(m); if (nl.bringToBack) nl.bringToBack(); return nl; }
  function setMapStyle(s) {
    mapStyle = s; LS.setItem("gg_mapstyle", s);
    mapBaseLayer = swapBase(map, mapBaseLayer);
    trackBaseLayer = swapBase(trackMap, trackBaseLayer);
    flugBaseLayer = swapBase(flugMap, flugBaseLayer);
    compassBaseLayer = swapBase(compassMap, compassBaseLayer);
    var names = { standard: "Standard", satellite: "Satellit", terrain: "Gelände" };
    toast("Karte: " + names[s]);
  }
  function cycleMapStyle() { var arr = ["standard", "satellite", "terrain"], i = (arr.indexOf(mapStyle) + 1) % arr.length; setMapStyle(arr[i]); }
  function cacheTile(key, url) { if (!navigator.onLine) return; fetch(url).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) { if (b) idbPut("tiles", b, key); }).catch(function () {}); }
  var OfflineLayer = (typeof L !== "undefined") ? L.TileLayer.extend({
    createTile: function (coords, done) {
      var img = document.createElement("img"), self = this, key = coords.z + "/" + coords.x + "/" + coords.y;
      var url = L.Util.template(self._url, L.extend({ s: self._getSubdomain ? self._getSubdomain(coords) : "", x: coords.x, y: coords.y, z: coords.z }, self.options));
      idbGet("tiles", key).then(function (blob) {
        if (blob) { img.onload = function () { done(null, img); }; img.src = URL.createObjectURL(blob); }
        else { img.onload = function () { done(null, img); }; img.onerror = function () { done(null, img); }; img.src = url; cacheTile(key, url); }
      }).catch(function () { img.src = url; done(null, img); });
      return img;
    }
  }) : null;
  function ensureMap() {
    if (map || typeof L === "undefined") { if (map) setTimeout(function () { map.invalidateSize(); }, 50); return; }
    map = L.map("map", { zoomControl: true, attributionControl: false }).setView([51.1657, 10.4515], 5);
    mapBaseLayer = makeBaseLayer(); mapBaseLayer.addTo(map);
    trackLine = L.polyline([], { color: "#0ea5e9", weight: 5, opacity: .85 }).addTo(map);
    map.on("dragstart", function () { followMe = false; });
    map.on("click", function (e) { pickPlace(e.latlng.lat, e.latlng.lng, null); if (!stopMode) toast("Ziel auf Karte gesetzt."); });
    map.on("contextmenu", function (e) {
      var name = prompt("Name des Wegpunkts:", "Wegpunkt " + (loadWps().length + 1)); if (name == null) return;
      var wps = loadWps(); wps.push({ lat: e.latlng.lat, lon: e.latlng.lng, name: name || ("WP " + (wps.length + 1)) }); LS.setItem("gg_wps", JSON.stringify(wps)); renderWps(); toast("Wegpunkt angelegt.");
    });
    if (lastFix) onMapLocation(lastFix);
    refreshTileCount();
    setTimeout(function () { map.invalidateSize(); }, 60);
  }
  function onMapLocation(p) {
    if (!map) return; var ll = [p.lat, p.lon];
    if (!meMarker) { meMarker = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: "#0ea5e9", fillOpacity: 1 }).addTo(map); accCircle = L.circle(ll, { radius: p.acc || 0, color: "#0ea5e9", weight: 1, fillOpacity: .08 }).addTo(map); }
    else { meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(p.acc || 0); }
    if (followMe) map.setView(ll, Math.max(map.getZoom(), 16));
  }
  $("centerBtn").onclick = function () { followMe = true; if (map && lastFix) map.setView([lastFix.lat, lastFix.lon], 17); };
  ["layerBtn", "layerBtn2", "layerBtn3"].forEach(function (id) { var b = $(id); if (b) b.onclick = cycleMapStyle; });

  // Offline-Bereich herunterladen
  $("dlBtn").onclick = function () {
    if (!map) { toast("Karte zuerst öffnen."); return; }
    if (!navigator.onLine) { toast("Keine Internetverbindung."); return; }
    var b = map.getBounds(), z0 = map.getZoom(), tiles = [];
    for (var z = z0; z <= Math.min(19, z0 + 2); z++) {
      var min = map.project(b.getNorthWest(), z).divideBy(256).floor(), max = map.project(b.getSouthEast(), z).divideBy(256).floor();
      for (var x = min.x; x <= max.x; x++) for (var y = min.y; y <= max.y; y++) tiles.push({ z: z, x: x, y: y });
    }
    if (tiles.length > 2500) { toast("Bereich zu groß (" + tiles.length + " Kacheln). Erst hineinzoomen."); return; }
    toast("Lade " + tiles.length + " Kacheln…");
    var ok = 0, done = 0;
    tiles.forEach(function (t) {
      var key = t.z + "/" + t.x + "/" + t.y, url = TILE_URL.replace("{z}", t.z).replace("{x}", t.x).replace("{y}", t.y);
      fetch(url).then(function (r) { return r.ok ? r.blob() : null; }).then(function (bl) { if (bl) { ok++; return idbPut("tiles", bl, key); } }).catch(function () {}).then(function () {
        done++; if (done === tiles.length) { refreshTileCount(); toast(ok > 0 ? ("Offline gespeichert: " + ok + " Kacheln.") : "Kartenserver erlaubt kein Offline-Caching (CORS)."); }
      });
    });
  };

  // ================= Kompass-Karte (Dashboard) =================
  var compassMap = null, compassMarker = null;
  function ensureCompassMap() {
    if (compassMap || typeof L === "undefined" || !document.getElementById("compassMap")) { if (compassMap) setTimeout(function () { compassMap.invalidateSize(); }, 50); return; }
    var c = lastFix ? [lastFix.lat, lastFix.lon] : [51.1657, 10.4515];
    compassMap = L.map("compassMap", { zoomControl: false, attributionControl: false, doubleClickZoom: false, dragging: false, scrollWheelZoom: false, touchZoom: false, keyboard: false, tap: false }).setView(c, lastFix ? 16 : 5);
    compassBaseLayer = makeBaseLayer(); compassBaseLayer.addTo(compassMap);
    setTimeout(function () { compassMap.invalidateSize(); }, 80);
  }
  function updateCompassMap(p) {
    if (!compassMap) { ensureCompassMap(); return; }
    compassMap.setView([p.lat, p.lon], Math.max(compassMap.getZoom(), 16), { animate: true });
  }

  // ================= Track-Aufzeichnung =================
  var recording = false, track = [], trackDist = 0, trackStart = 0, maxSpeed = 0, recTimer = null;
  var autoPauseOn = LS.getItem("gg_autopause") === "1", autoPaused = false;
  var laps = [], lastLapDist = 0, lastLapTime = 0;
  function recordPoint(p) {
    if (p.speed != null && !isNaN(p.speed) && p.speed > maxSpeed) maxSpeed = p.speed;
    if (!recording) return;
    if (autoPauseOn && p.speed != null && !isNaN(p.speed)) {
      if (p.speed < 0.5) { if (!autoPaused) { autoPaused = true; $("tkState").textContent = "⏸ Auto-Pause"; } return; }
      if (autoPaused) { autoPaused = false; $("tkState").textContent = "● Aufzeichnung läuft"; }
    }
    var prev = track[track.length - 1];
    if (prev) trackDist += haversine(prev.lat, prev.lon, p.lat, p.lon);
    track.push({ lat: p.lat, lon: p.lon, alt: p.alt, t: p.time || Date.now() });
    if (trackLine) trackLine.addLatLng([p.lat, p.lon]);
    if (trackLine2) trackLine2.addLatLng([p.lat, p.lon]);
    refreshTrackStats(); drawProfile();
  }
  function renderLaps() {
    var c = $("lapsList"); if (!c) return;
    if (!laps.length) { c.innerHTML = '<div class="hint" style="text-align:left">Noch keine Runden.</div>'; return; }
    c.innerHTML = "";
    laps.slice().reverse().forEach(function (l) {
      var d = fmtDist(l.dist), mm = Math.floor(l.time / 60000), ss = Math.floor((l.time % 60000) / 1000);
      var row = document.createElement("div"); row.className = "wp-item";
      row.innerHTML = '<div style="flex:1"><div class="nm">🏁 Runde ' + l.n + '</div><div class="co">' + d.v + " " + d.u + " · " + mm + ":" + (ss < 10 ? "0" : "") + ss + " min</div></div>";
      c.appendChild(row);
    });
  }
  if ($("autoPauseTgl")) { $("autoPauseTgl").classList.toggle("on", autoPauseOn); $("autoPauseTgl").onclick = function () { autoPauseOn = !autoPauseOn; this.classList.toggle("on", autoPauseOn); LS.setItem("gg_autopause", autoPauseOn ? "1" : "0"); }; }
  if ($("lapBtn")) $("lapBtn").onclick = function () {
    if (!trackStart) { toast("Erst Aufzeichnung starten."); return; }
    var now = Date.now(); laps.push({ n: laps.length + 1, dist: trackDist - lastLapDist, time: now - (lastLapTime || trackStart) });
    lastLapDist = trackDist; lastLapTime = now; renderLaps(); toast("🏁 Runde " + laps.length + " markiert.");
  };
  function refreshTrackStats() {
    var d = fmtDist(trackDist); $("trkDist").textContent = d.v + " " + d.u;
    var secs = trackStart ? Math.floor((Date.now() - trackStart) / 1000) : 0, mm = Math.floor(secs / 60), ss = secs % 60;
    $("trkTime").textContent = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
    var avg = secs > 0 ? trackDist / secs : 0;
    $("trkSpd").textContent = fmtSpeed(avg) + " / " + fmtSpeed(maxSpeed);
    updateTrip();
  }
  $("recBtn").onclick = function () {
    if (!recording && !appActive) { toast("Bitte zuerst oben den Schalter (GPS) einschalten."); return; }
    recording = !recording; var b = $("recBtn");
    if (recording) {
      if (track.length === 0) { trackDist = 0; trackStart = Date.now(); maxSpeed = 0; if (trackLine) trackLine.setLatLngs([]); if (trackLine2) trackLine2.setLatLngs([]); }
      b.textContent = "⏸ Pause"; b.className = "b-warn"; recTimer = setInterval(refreshTrackStats, 1000);
      $("tkState").textContent = "● Aufzeichnung läuft";
    } else { b.textContent = "⏺ Start"; b.className = "b-success"; if (recTimer) { clearInterval(recTimer); recTimer = null; } $("tkState").textContent = "Pausiert"; }
  };
  $("recStopBtn").onclick = function () {
    recording = false; autoPaused = false; if (recTimer) { clearInterval(recTimer); recTimer = null; }
    track = []; trackDist = 0; trackStart = 0; maxSpeed = 0; profilePts = null;
    laps = []; lastLapDist = 0; lastLapTime = 0; renderLaps();
    if (trackLine) trackLine.setLatLngs([]); if (trackLine2) trackLine2.setLatLngs([]);
    $("recBtn").textContent = "⏺ Start"; $("recBtn").className = "b-success";
    refreshTrackStats(); drawProfile(); $("tkState").textContent = "Zurückgesetzt"; toast("Aufzeichnung zurückgesetzt.");
  };
  $("centerBtn2").onclick = function () { trackFollow = true; if (trackMap && lastFix) trackMap.setView([lastFix.lat, lastFix.lon], 16); };
  // ===== Tour als Bild =====
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function buildTourImage() {
    var pts = (profilePts && profilePts.length > 1) ? profilePts : track;
    if (pts.length < 2) { toast("Zu wenig Trackdaten für ein Bild."); return null; }
    var s = trackStats(pts), cv = document.createElement("canvas"); cv.width = 1080; cv.height = 1350; var ctx = cv.getContext("2d");
    var g = ctx.createLinearGradient(0, 0, 0, 1350); g.addColorStop(0, "#0b1220"); g.addColorStop(1, "#1e293b"); ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1350);
    ctx.fillStyle = "#38bdf8"; ctx.font = "bold 56px sans-serif"; ctx.fillText("🛰️ GeoPilot", 60, 110);
    ctx.fillStyle = "#94a3b8"; ctx.font = "30px sans-serif"; ctx.fillText(new Date().toLocaleString("de-DE"), 60, 158);
    var bx = 60, by = 200, bw = 960, bh = 640; ctx.strokeStyle = "#334155"; ctx.lineWidth = 2; rrect(ctx, bx, by, bw, bh, 24); ctx.stroke();
    var lats = pts.map(function (p) { return p.lat; }), lons = pts.map(function (p) { return p.lon; });
    var minLa = Math.min.apply(null, lats), maxLa = Math.max.apply(null, lats), minLo = Math.min.apply(null, lons), maxLo = Math.max.apply(null, lons);
    var spanLa = Math.max(1e-6, maxLa - minLa), spanLo = Math.max(1e-6, maxLo - minLo), pad = 50;
    var sc = Math.min((bw - 2 * pad) / spanLo, (bh - 2 * pad) / spanLa);
    var ox = bx + bw / 2 - (minLo + spanLo / 2) * sc, oy = by + bh / 2 + (minLa + spanLa / 2) * sc;
    function X(lo) { return ox + lo * sc; } function Y(la) { return oy - la * sc; }
    ctx.beginPath(); pts.forEach(function (p, i) { var x = X(p.lon), y = Y(p.lat); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = "#0ea5e9"; ctx.lineWidth = 7; ctx.lineJoin = "round"; ctx.stroke();
    ctx.fillStyle = "#22c55e"; ctx.beginPath(); ctx.arc(X(pts[0].lon), Y(pts[0].lat), 13, 0, 7); ctx.fill();
    ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(X(pts[pts.length - 1].lon), Y(pts[pts.length - 1].lat), 13, 0, 7); ctx.fill();
    var d = fmtDist(s.dist), mm = Math.floor(s.moveSec / 60), ss = Math.floor(s.moveSec % 60), u = isImp() ? " ft" : " m";
    var stats = [["Strecke", d.v + " " + d.u], ["Bewegungszeit", mm + ":" + (ss < 10 ? "0" : "") + ss + " min"], ["⬆ Aufstieg", fmtAlt(s.up) + u], ["⬇ Abstieg", fmtAlt(s.down) + u]];
    var sx = 60, sy = 890, sw = 465, sh = 175;
    stats.forEach(function (st, i) { var col = i % 2, row = Math.floor(i / 2), x = sx + col * (sw + 30), y = sy + row * (sh + 25); ctx.fillStyle = "#131c2e"; rrect(ctx, x, y, sw, sh, 20); ctx.fill(); ctx.fillStyle = "#94a3b8"; ctx.font = "28px sans-serif"; ctx.fillText(st[0], x + 30, y + 52); ctx.fillStyle = "#f1f5f9"; ctx.font = "bold 54px sans-serif"; ctx.fillText(st[1], x + 30, y + 120); });
    ctx.fillStyle = "#64748b"; ctx.font = "26px sans-serif"; ctx.fillText("Aufgezeichnet mit GeoPilot", 60, 1310);
    return cv.toDataURL("image/png");
  }
  $("shareTourBtn").onclick = function () {
    var url = buildTourImage(); if (!url) return; var txt = "Meine Tour mit GeoPilot 🛰️";
    if (hasNative()) { try { window.Android.shareImage(url, txt); return; } catch (e) {} }
    try {
      fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
        var file = new File([b], "geopilot-tour.png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], text: txt });
        else { var a = document.createElement("a"); a.href = url; a.download = "geopilot-tour.png"; a.click(); }
      });
    } catch (e) { var a = document.createElement("a"); a.href = url; a.download = "geopilot-tour.png"; a.click(); }
  };
  function buildGpx(pts, name) {
    var g = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GeoGuard" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>' + (name || "GeoGuard") + '</name><trkseg>\n';
    pts.forEach(function (pt) { g += '<trkpt lat="' + pt.lat + '" lon="' + pt.lon + '">' + (pt.alt != null && !isNaN(pt.alt) ? "<ele>" + pt.alt + "</ele>" : "") + "<time>" + new Date(pt.t).toISOString() + "</time></trkpt>\n"; });
    return g + "</trkseg></trk></gpx>";
  }
  $("exportBtn").onclick = function () {
    if (track.length < 2) { toast("Zu wenig Trackpunkte."); return; }
    var name = "geoguard-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".gpx", gpx = buildGpx(track, "GeoGuard " + new Date().toISOString());
    if (hasNative()) { try { window.Android.saveText(name, "application/gpx+xml", gpx); return; } catch (e) {} }
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" })); a.download = name; a.click(); toast("GPX exportiert.");
  };

  // ================= Tracking-Tab (eigene Karte + Live-Werte) =================
  var trackMap = null, trackLine2 = null, meMarker3 = null, accCircle2 = null, trackFollow = true;
  function ensureTrackMap() {
    if (trackMap || typeof L === "undefined") { if (trackMap) setTimeout(function () { trackMap.invalidateSize(); }, 50); return; }
    var c = lastFix ? [lastFix.lat, lastFix.lon] : [51.1657, 10.4515];
    trackMap = L.map("trackMap", { zoomControl: true, attributionControl: false }).setView(c, lastFix ? 15 : 5);
    trackBaseLayer = makeBaseLayer(); trackBaseLayer.addTo(trackMap);
    trackLine2 = L.polyline(track.map(function (p) { return [p.lat, p.lon]; }), { color: "#10b981", weight: 5, opacity: .9 }).addTo(trackMap);
    trackMap.on("dragstart", function () { trackFollow = false; });
    if (lastFix) updateTrackMap(lastFix);
    setTimeout(function () { trackMap.invalidateSize(); }, 60);
  }
  function openTrack() { ensureTrackMap(); refreshTrackStats(); if (lastFix) updateTrackLive(lastFix); }
  function updateTrackMap(p) {
    if (!trackMap) return; var ll = [p.lat, p.lon];
    if (!meMarker3) { meMarker3 = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: "#10b981", fillOpacity: 1 }).addTo(trackMap); accCircle2 = L.circle(ll, { radius: p.acc || 0, color: "#10b981", weight: 1, fillOpacity: .08 }).addTo(trackMap); }
    else { meMarker3.setLatLng(ll); accCircle2.setLatLng(ll).setRadius(p.acc || 0); }
    if (trackFollow) trackMap.setView(ll, Math.max(trackMap.getZoom(), 15));
  }
  function updateTrackLive(p) {
    var sp = $("tkSpeed"); if (sp) sp.textContent = fmtSpeed(p.speed) === "--" ? "0" : fmtSpeed(p.speed);
    if ($("tkSpeedU")) $("tkSpeedU").textContent = isImp() ? "mph" : "km/h";
    if ($("tkAlt")) $("tkAlt").textContent = fmtAlt(p.alt);
    if ($("tkAltU")) $("tkAltU").textContent = isImp() ? "ft" : "m";
    if ($("tkAcc")) $("tkAcc").textContent = (p.acc != null && !isNaN(p.acc)) ? Math.round(p.acc) : "--";
    if ($("tkCoord")) $("tkCoord").textContent = p.lat.toFixed(6) + ", " + p.lon.toFixed(6);
  }

  // ================= Trip-Computer + Höhenprofil =================
  function trackStats(pts) {
    var dist = 0, up = 0, down = 0, moveSec = 0;
    for (var i = 1; i < pts.length; i++) {
      var d = haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon); dist += d;
      var dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (dt > 0 && d / dt > 0.5) moveSec += dt;
      if (pts[i].alt != null && pts[i - 1].alt != null && !isNaN(pts[i].alt) && !isNaN(pts[i - 1].alt)) { var de = pts[i].alt - pts[i - 1].alt; if (de > 0.5) up += de; else if (de < -0.5) down += -de; }
    }
    return { dist: dist, up: up, down: down, moveSec: moveSec };
  }
  function updateTrip() {
    var s = trackStats(track), mm = Math.floor(s.moveSec / 60), ss = Math.floor(s.moveSec % 60);
    $("tcMove").textContent = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
    $("tcUp").textContent = fmtAlt(s.up); $("tcDown").textContent = fmtAlt(s.down);
  }
  var profilePts = null, profileMode = "alt";
  function profMsg(ctx, W, H, t) { ctx.fillStyle = "#94a3b8"; ctx.font = "14px sans-serif"; ctx.textAlign = "center"; ctx.fillText(t, W / 2, H / 2); ctx.textAlign = "left"; }
  function drawProfile() {
    var pts = profilePts || track, cv = $("profile"); if (!cv) return; var ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (pts.length < 2) { profMsg(ctx, W, H, "Noch keine Aufzeichnung"); return; }
    var cum = [0]; for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon));
    var total = cum[cum.length - 1] || 1, ser = [];
    if (profileMode === "speed") {
      for (var k = 1; k < pts.length; k++) { var dt = (pts[k].t - pts[k - 1].t) / 1000, dd = haversine(pts[k - 1].lat, pts[k - 1].lon, pts[k].lat, pts[k].lon); var ms = dt > 0 ? dd / dt : 0; ser.push({ x: cum[k], y: ms * (isImp() ? 2.23694 : 3.6) }); }
    } else {
      for (var m = 0; m < pts.length; m++) { if (pts[m].alt == null || isNaN(pts[m].alt)) continue; ser.push({ x: cum[m], y: pts[m].alt * (isImp() ? 3.28084 : 1) }); }
    }
    if (ser.length < 2) { profMsg(ctx, W, H, profileMode === "speed" ? "Keine Tempodaten" : "Keine Höhendaten"); return; }
    var ys = ser.map(function (s) { return s.y; }), min = Math.min.apply(null, ys), max = Math.max.apply(null, ys);
    if (profileMode === "speed") min = 0; if (max - min < 1) max = min + 1;
    function px(s) { return s.x / total * W; } function py(s) { return H - (s.y - min) / (max - min) * (H - 12) - 6; }
    ctx.beginPath(); ser.forEach(function (s, idx) { var x = px(s), y = py(s); if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.lineTo(px(ser[ser.length - 1]), H); ctx.lineTo(px(ser[0]), H); ctx.closePath();
    var sp = profileMode === "speed", grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, sp ? "rgba(16,163,74,.5)" : "rgba(37,99,235,.5)"); grd.addColorStop(1, sp ? "rgba(16,163,74,.04)" : "rgba(37,99,235,.04)");
    ctx.fillStyle = grd; ctx.fill();
    ctx.beginPath(); ser.forEach(function (s, idx) { var x = px(s), y = py(s); if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = sp ? "#16a34a" : "#2563eb"; ctx.lineWidth = 2; ctx.stroke();
    var unit = sp ? (isImp() ? " mph" : " km/h") : (isImp() ? " ft" : " m");
    ctx.fillStyle = "#94a3b8"; ctx.font = "11px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(Math.round(max) + unit, 4, 12); ctx.fillText(Math.round(min) + unit, 4, H - 4);
  }
  if ($("profMode")) Array.prototype.forEach.call($("profMode").children, function (b) { b.onclick = function () { profileMode = b.getAttribute("data-pm"); Array.prototype.forEach.call($("profMode").children, function (x) { x.classList.toggle("sel", x === b); }); drawProfile(); }; });

  // ================= Touren speichern / laden =================
  $("saveTourBtn").onclick = function () {
    if (track.length < 2) { toast("Zu wenig Trackpunkte zum Speichern."); return; }
    var name = prompt("Name der Tour:", "Tour " + new Date().toLocaleDateString("de-DE")); if (name == null) return;
    var s = trackStats(track), tour = { id: "t" + Date.now(), name: name || "Tour", date: Date.now(), pts: track.slice(), dist: s.dist, up: s.up, down: s.down, moveSec: s.moveSec };
    idbPut("tours", tour).then(function () { toast("Tour gespeichert."); renderTours(); });
  };
  $("importBtn").onclick = function () { $("gpxFile").click(); };
  $("gpxFile").onchange = function (e) {
    var f = e.target.files[0]; if (!f) return; var rd = new FileReader();
    rd.onload = function () {
      try {
        var xml = new DOMParser().parseFromString(rd.result, "application/xml"), nodes = xml.getElementsByTagName("trkpt"), pts = [];
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i], la = parseFloat(n.getAttribute("lat")), lo = parseFloat(n.getAttribute("lon"));
          var ele = n.getElementsByTagName("ele")[0], tm = n.getElementsByTagName("time")[0];
          pts.push({ lat: la, lon: lo, alt: ele ? parseFloat(ele.textContent) : null, t: tm ? Date.parse(tm.textContent) : Date.now() });
        }
        if (pts.length < 2) { toast("Keine Trackpunkte in der GPX-Datei."); return; }
        var s = trackStats(pts), tour = { id: "t" + Date.now(), name: f.name.replace(/\.gpx$/i, ""), date: Date.now(), pts: pts, dist: s.dist, up: s.up, down: s.down, moveSec: s.moveSec };
        idbPut("tours", tour).then(function () { toast("Importiert: " + pts.length + " Punkte."); renderTours(); viewTour(tour); });
      } catch (err) { toast("GPX-Import fehlgeschlagen."); }
    };
    rd.readAsText(f); e.target.value = "";
  };
  function renderTours() {
    idbAll("tours").then(function (tours) {
      var c = $("tourList"); if (!tours.length) { c.innerHTML = '<div class="hint">Noch keine Touren gespeichert.</div>'; return; }
      tours.sort(function (a, b) { return b.date - a.date; }); c.innerHTML = "";
      tours.forEach(function (tr) {
        var d = fmtDist(tr.dist), row = document.createElement("div"); row.className = "wp-item";
        row.innerHTML = '<div style="flex:1"><div class="nm">' + escapeHtml(tr.name) + '</div><div class="co">' + new Date(tr.date).toLocaleDateString("de-DE") + " · " + d.v + " " + d.u + " · ⬆" + fmtAlt(tr.up) + "</div></div>";
        var go = document.createElement("button"); go.className = "b-primary"; go.textContent = "👁"; go.onclick = function () { viewTour(tr); };
        var del = document.createElement("button"); del.className = "b-soft"; del.textContent = "🗑"; del.onclick = function () { idbDel("tours", tr.id).then(renderTours); };
        row.appendChild(go); row.appendChild(del); c.appendChild(row);
      });
    });
  }
  function viewTour(tr) {
    profilePts = tr.pts; switchTab("tracking"); drawProfile();
    var s = trackStats(tr.pts), d = fmtDist(s.dist), mm = Math.floor(s.moveSec / 60), ss = Math.floor(s.moveSec % 60);
    $("trkDist").textContent = d.v + " " + d.u; $("tcMove").textContent = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss; $("tcUp").textContent = fmtAlt(s.up); $("tcDown").textContent = fmtAlt(s.down);
    ensureTrackMap();
    setTimeout(function () {
      if (!trackMap) return; if (viewLine) trackMap.removeLayer(viewLine);
      viewLine = L.polyline(tr.pts.map(function (p) { return [p.lat, p.lon]; }), { color: "#f43f5e", weight: 4 }).addTo(trackMap);
      trackFollow = false; trackMap.fitBounds(viewLine.getBounds(), { padding: [30, 30] });
      toast("Tour „" + tr.name + "“ auf der Karte.");
    }, 140);
  }

  // ================= Navigation + Wegpunkte =================
  var target = null; try { target = JSON.parse(LS.getItem("gg_target") || "null"); } catch (e) {}
  function setTarget(lat, lon, name) {
    target = { lat: lat, lon: lon, name: name || null }; LS.setItem("gg_target", JSON.stringify(target)); geoAlerted = false;
    $("navTarget").textContent = (name ? name + " · " : "") + lat.toFixed(5) + ", " + lon.toFixed(5);
    if (map) { var ll = [lat, lon]; if (!targetMarker) targetMarker = L.marker(ll).addTo(map); else targetMarker.setLatLng(ll); }
    if (hasNative()) { try { window.Android.setCarTarget(lat, lon, name || "Ziel"); } catch (e) {} }
    addRecent(lat, lon, name);
    updateNavArrow();
  }
  // ===== Zwischenstopps & Vermeidungen =====
  var routeStops = []; try { routeStops = JSON.parse(LS.getItem("gg_stops") || "[]"); } catch (e) { routeStops = []; }
  var stopMode = false, avoidHighways = LS.getItem("gg_avoidhw") === "1", avoidTolls = LS.getItem("gg_avoidtoll") === "1";
  function pickPlace(lat, lon, name) { if (stopMode) addStop(lat, lon, name); else setTarget(lat, lon, name); }
  function addStop(lat, lon, name) { routeStops.push({ lat: lat, lon: lon, name: name || ("Stopp " + (routeStops.length + 1)) }); LS.setItem("gg_stops", JSON.stringify(routeStops)); renderStops(); toast("Zwischenstopp hinzugefügt."); }
  function renderStops() {
    var c = $("stopsList"); if (!c) return;
    if (!routeStops.length) { c.innerHTML = '<div class="hint" style="text-align:left">Keine Zwischenstopps. Route führt direkt zum Ziel.</div>'; return; }
    c.innerHTML = "";
    routeStops.forEach(function (s, i) {
      var row = document.createElement("div"); row.className = "wp-item";
      row.innerHTML = '<div style="flex:1"><div class="nm">' + (i + 1) + ". " + escapeHtml(s.name) + '</div><div class="co">' + s.lat.toFixed(4) + ", " + s.lon.toFixed(4) + "</div></div>";
      var del = document.createElement("button"); del.className = "b-soft"; del.textContent = "🗑"; del.onclick = function () { routeStops.splice(i, 1); LS.setItem("gg_stops", JSON.stringify(routeStops)); renderStops(); };
      row.appendChild(del); c.appendChild(row);
    });
  }
  function relDir(rel) { rel = (rel + 360) % 360; if (rel < 22 || rel >= 338) return "geradeaus"; if (rel < 68) return "leicht rechts"; if (rel < 112) return "rechts"; if (rel < 158) return "scharf rechts"; if (rel < 202) return "zurück"; if (rel < 248) return "scharf links"; if (rel < 292) return "links"; return "leicht links"; }
  function updateNavArrow() {
    var sd = $("tgtDot");
    if (!target || !lastFix) { if (sd) sd.style.display = "none"; if ($("tgtDir")) $("tgtDir").textContent = "Kein Ziel gesetzt"; if ($("cmTgt")) $("cmTgt").textContent = "–"; return; }
    var dist = haversine(lastFix.lat, lastFix.lon, target.lat, target.lon), brg = bearing(lastFix.lat, lastFix.lon, target.lat, target.lon);
    var d = fmtDist(dist); $("navDist").textContent = d.v; $("navDistU").textContent = d.u; $("navBear").textContent = Math.round(brg) + " " + cardinal(brg);
    var rel = (smooth != null) ? (brg - smooth) : brg; $("taPointer").style.transform = "rotate(" + rel + "deg)";
    if ($("tgtDir")) $("tgtDir").textContent = Math.round(brg) + "° " + cardinal(brg) + " · " + d.v + " " + d.u + (target.name ? " · " + target.name : "");
    if ($("cmTgt")) $("cmTgt").textContent = Math.round(brg) + "° " + cardinal(brg) + " · " + d.v + " " + d.u;
    if (sd) { if (smooth != null) { sd.style.display = "block"; var rr = (brg - smooth) * Math.PI / 180; sd.style.transform = "translate(" + (Math.sin(rr) * 76) + "px," + (-Math.cos(rr) * 76) + "px)"; } else sd.style.display = "none"; }
  }
  $("setTargetBtn").onclick = function () { var la = parseFloat($("inLat").value), lo = parseFloat($("inLon").value); if (isNaN(la) || isNaN(lo)) { toast("Bitte gültige Koordinaten."); return; } pickPlace(la, lo, null); if (!stopMode) toast("Ziel gesetzt."); };
  $("saveWpBtn").onclick = function () { if (!lastFix) { toast("Noch keine Position."); return; } var name = prompt("Name des Wegpunkts:", "Wegpunkt " + (loadWps().length + 1)); if (name == null) return; var wps = loadWps(); wps.push({ lat: lastFix.lat, lon: lastFix.lon, name: name || ("WP " + (wps.length + 1)) }); LS.setItem("gg_wps", JSON.stringify(wps)); renderWps(); };
  function loadWps() { try { return JSON.parse(LS.getItem("gg_wps") || "[]"); } catch (e) { return []; } }
  function renderWps() {
    var wps = loadWps(), c = $("wpList"); if (!wps.length) { c.innerHTML = '<div class="hint">Noch keine Wegpunkte.</div>'; return; } c.innerHTML = "";
    wps.forEach(function (w, i) {
      var row = document.createElement("div"); row.className = "wp-item";
      row.innerHTML = '<div style="flex:1"><div class="nm">' + escapeHtml(w.name) + '</div><div class="co">' + w.lat.toFixed(5) + ", " + w.lon.toFixed(5) + "</div></div>";
      var go = document.createElement("button"); go.className = "b-primary"; go.textContent = "🎯"; go.onclick = function () { pickPlace(w.lat, w.lon, w.name); if (!stopMode) toast("Ziel: " + w.name); };
      var del = document.createElement("button"); del.className = "b-soft"; del.textContent = "🗑"; del.onclick = function () { var a = loadWps(); a.splice(i, 1); LS.setItem("gg_wps", JSON.stringify(a)); renderWps(); };
      row.appendChild(go); row.appendChild(del); c.appendChild(row);
    });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (m) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]; }); }
  if (target) $("navTarget").textContent = (target.name ? target.name + " · " : "") + target.lat.toFixed(5) + ", " + target.lon.toFixed(5);

  // ===== Schnellziele (Favoriten) & Verlauf =====
  function goTo(lat, lon, name, zoom) {
    pickPlace(lat, lon, name); if (!stopMode) toast("Ziel: " + (name || "gesetzt"));
    switchTab("nav"); ensureMap(); if (map) { followMe = false; map.setView([lat, lon], zoom || 14); }
  }
  function favGet(k) { try { return JSON.parse(LS.getItem(k) || "null"); } catch (e) { return null; } }
  function favSave(k, o) { LS.setItem(k, JSON.stringify(o)); refreshFavButtons(); }
  function refreshFavButtons() {
    var h = favGet("gg_home"), w = favGet("gg_work");
    if ($("favHome")) $("favHome").textContent = "🏠 " + (h && h.name ? h.name : "Zuhause");
    if ($("favWork")) $("favWork").textContent = "💼 " + (w && w.name ? w.name : "Arbeit");
  }
  function favClick(k, label) {
    var f = favGet(k);
    if (f) { goTo(f.lat, f.lon, f.name || label); return; }
    var src = target || lastFix;
    if (!src) { toast("Erst ein Ziel suchen oder die App einschalten."); return; }
    var nm = (target && target.name) ? target.name : label;
    favSave(k, { lat: src.lat, lon: src.lon, name: nm });
    toast(label + " gespeichert.");
  }
  if ($("favHome")) $("favHome").onclick = function () { favClick("gg_home", "Zuhause"); };
  if ($("favWork")) $("favWork").onclick = function () { favClick("gg_work", "Arbeit"); };
  if ($("favSet")) $("favSet").onclick = function () {
    if (!target) { toast("Erst ein Ziel setzen, dann als Favorit speichern."); return; }
    var k = confirm("Aktuelles Ziel als ZUHAUSE speichern?\n(Abbrechen = als ARBEIT speichern)") ? "gg_home" : "gg_work";
    favSave(k, { lat: target.lat, lon: target.lon, name: target.name || (k === "gg_home" ? "Zuhause" : "Arbeit") });
    toast("Favorit gespeichert.");
  };
  refreshFavButtons();

  function loadRecents() { try { return JSON.parse(LS.getItem("gg_recents") || "[]"); } catch (e) { return []; } }
  function addRecent(lat, lon, name) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return;
    var r = loadRecents().filter(function (x) { return haversine(x.lat, x.lon, lat, lon) > 40; });
    r.unshift({ lat: lat, lon: lon, name: name || (lat.toFixed(4) + ", " + lon.toFixed(4)), t: Date.now() });
    if (r.length > 8) r = r.slice(0, 8);
    LS.setItem("gg_recents", JSON.stringify(r)); renderRecents();
  }
  function renderRecents() {
    var c = $("recentList"); if (!c) return; var r = loadRecents();
    if (!r.length) { c.innerHTML = '<div class="hint" style="text-align:left">Zuletzt gesuchte Ziele erscheinen hier.</div>'; return; }
    c.innerHTML = "";
    r.forEach(function (x) {
      var row = document.createElement("div"); row.className = "place-item";
      var dd = lastFix ? fmtDist(haversine(lastFix.lat, lastFix.lon, x.lat, x.lon)) : null;
      row.innerHTML = '<div class="pi-ico">🕘</div><div class="pi-main"><div class="pi-name">' + escapeHtml(x.name) + '</div><div class="pi-sub">' + x.lat.toFixed(4) + ", " + x.lon.toFixed(4) + '</div></div>' + (dd ? '<div class="pi-dist">' + dd.v + " " + dd.u + '</div>' : "");
      row.onclick = function () { goTo(x.lat, x.lon, x.name); };
      c.appendChild(row);
    });
  }
  renderRecents();

  // ===== POI-Suche in der Nähe (Overpass) =====
  var poiTags = { fuel: "amenity=fuel", parking: "amenity=parking", restaurant: "amenity=restaurant", cafe: "amenity=cafe", supermarket: "shop=supermarket", atm: "amenity=atm", pharmacy: "amenity=pharmacy", hotel: "tourism=hotel" };
  var poiIco = { fuel: "⛽", parking: "🅿️", restaurant: "🍴", cafe: "☕", supermarket: "🛒", atm: "🏧", pharmacy: "💊", hotel: "🏨" };
  var poiLbl = { fuel: "Tankstelle", parking: "Parkplatz", restaurant: "Restaurant", cafe: "Café", supermarket: "Supermarkt", atm: "Geldautomat", pharmacy: "Apotheke", hotel: "Hotel" };
  function poiSearch(cat) {
    if (!lastFix) { toast("Erst die App einschalten (Schalter oben), dann Umkreissuche."); return; }
    if (!needOnline()) { $("poiList").innerHTML = '<div class="hint">📡 Offline – Umkreissuche braucht Internet.</div>'; return; }
    Array.prototype.forEach.call($("poiRow").children, function (b) { b.classList.toggle("sel", b.getAttribute("data-poi") === cat); });
    $("poiList").innerHTML = '<div class="hint">Suche in der Nähe…</div>';
    var kv = (poiTags[cat] || "amenity=fuel").split("="), r = 3000;
    var q = "[out:json][timeout:25];(node[" + kv[0] + "=" + kv[1] + "](around:" + r + "," + lastFix.lat + "," + lastFix.lon + "););out body 40;";
    httpJson("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q)).then(function (j) {
      if (!j || !j.elements || !j.elements.length) { $("poiList").innerHTML = '<div class="hint">Nichts im Umkreis gefunden.</div>'; return; }
      var arr = j.elements.filter(function (e) { return e.lat != null; }).map(function (e) {
        var nm = (e.tags && (e.tags.name || e.tags.brand || e.tags.operator)) || poiLbl[cat] || "Ort";
        return { lat: e.lat, lon: e.lon, name: nm, d: haversine(lastFix.lat, lastFix.lon, e.lat, e.lon) };
      });
      arr.sort(function (a, b) { return a.d - b.d; });
      renderPoi(arr.slice(0, 12), cat);
    });
  }
  function renderPoi(arr, cat) {
    var c = $("poiList"); c.innerHTML = "";
    arr.forEach(function (x) {
      var row = document.createElement("div"); row.className = "place-item";
      var dd = fmtDist(x.d);
      row.innerHTML = '<div class="pi-ico">' + (poiIco[cat] || "📍") + '</div><div class="pi-main"><div class="pi-name">' + escapeHtml(x.name) + '</div><div class="pi-sub">' + (poiLbl[cat] || "Ort") + '</div></div><div class="pi-dist">' + dd.v + " " + dd.u + '</div>';
      row.onclick = function () { goTo(x.lat, x.lon, x.name, 15); };
      c.appendChild(row);
    });
  }
  if ($("poiRow")) Array.prototype.forEach.call($("poiRow").children, function (b) { b.onclick = function () { poiSearch(b.getAttribute("data-poi")); }; });

  renderWps(); renderTours(); renderStops();
  if ($("stopModeTgl")) { $("stopModeTgl").classList.toggle("on", stopMode); $("stopModeTgl").onclick = function () { stopMode = !stopMode; this.classList.toggle("on", stopMode); }; }
  if ($("stopsClear")) $("stopsClear").onclick = function () { routeStops = []; LS.setItem("gg_stops", "[]"); renderStops(); };
  if ($("avoidHwTgl")) { $("avoidHwTgl").classList.toggle("on", avoidHighways); $("avoidHwTgl").onclick = function () { avoidHighways = !avoidHighways; this.classList.toggle("on", avoidHighways); LS.setItem("gg_avoidhw", avoidHighways ? "1" : "0"); }; }
  if ($("avoidTollTgl")) { $("avoidTollTgl").classList.toggle("on", avoidTolls); $("avoidTollTgl").onclick = function () { avoidTolls = !avoidTolls; this.classList.toggle("on", avoidTolls); LS.setItem("gg_avoidtoll", avoidTolls ? "1" : "0"); }; }

  // ================= Alarme + Sprache =================
  var geoOn = LS.getItem("gg_geo") === "1", voiceOn = LS.getItem("gg_voice") === "1", geoAlerted = false, lastVoice = 0;
  $("geoTgl").classList.toggle("on", geoOn); $("voiceTgl").classList.toggle("on", voiceOn);
  $("geoRad").value = LS.getItem("gg_georad") || "50";
  $("geoTgl").onclick = function () { geoOn = !geoOn; this.classList.toggle("on", geoOn); LS.setItem("gg_geo", geoOn ? "1" : "0"); };
  $("voiceTgl").onclick = function () { voiceOn = !voiceOn; this.classList.toggle("on", voiceOn); LS.setItem("gg_voice", voiceOn ? "1" : "0"); if (voiceOn) speak("Sprachhinweise aktiv."); };
  $("geoRad").onchange = function () { LS.setItem("gg_georad", this.value); };
  function speak(text) { if (hasNative()) { try { window.Android.speak(text); return; } catch (e) {} } if (window.speechSynthesis) { try { var u = new SpeechSynthesisUtterance(text); u.lang = "de-DE"; window.speechSynthesis.speak(u); } catch (e) {} } }
  function vibrate(ms) { if (hasNative()) { try { window.Android.vibrate(typeof ms === "number" ? ms : 800); return; } catch (e) {} } if (navigator.vibrate) navigator.vibrate(ms); }
  function checkGeofence() {
    if (!target || !lastFix) return;
    var dist = haversine(lastFix.lat, lastFix.lon, target.lat, target.lon), rad = parseFloat($("geoRad").value) || 50;
    if (geoOn) {
      if (dist <= rad && !geoAlerted) { geoAlerted = true; vibrate([0, 400, 200, 400]); speak("Ziel erreicht."); if (hasNative()) { try { window.Android.notify("Ziel erreicht", "Du bist am Ziel angekommen."); } catch (e) {} } toast("🔔 Ziel erreicht!"); }
      else if (dist > rad * 1.5) geoAlerted = false;
    }
    if (voiceOn && Date.now() - lastVoice > 20000 && dist > rad) {
      lastVoice = Date.now(); var brg = bearing(lastFix.lat, lastFix.lon, target.lat, target.lon), rel = (smooth != null) ? (brg - smooth) : 0, d = fmtDist(dist);
      speak("Ziel " + d.v + " " + (d.u === "km" ? "Kilometer" : d.u === "mi" ? "Meilen" : d.u === "ft" ? "Fuß" : "Meter") + ", " + relDir(rel) + ".");
    }
  }

  // ================= GNSS =================
  function updateGnss(g) {
    $("satTotal").textContent = g.total != null ? g.total : "--"; $("satUsed").textContent = g.used != null ? g.used : "--";
    $("satCn0").textContent = g.avgCn0 != null ? Math.round(g.avgCn0) : "--"; $("satSys").textContent = (g.systems && g.systems.length) ? g.systems.join(" · ") : "–";
    var bars = $("satBars");
    if (g.sats && g.sats.length) {
      bars.innerHTML = "";
      g.sats.sort(function (a, b) { return (b.cn0 || 0) - (a.cn0 || 0); }).forEach(function (s) { var bar = document.createElement("div"); bar.className = "sat-bar" + (s.used ? " used" : ""); bar.style.height = Math.max(3, Math.min(100, (s.cn0 || 0) / 50 * 100)) + "%"; bar.title = (s.type || "") + " · " + (s.cn0 || 0) + " dBHz"; bars.appendChild(bar); });
      $("satHint").textContent = "Aktualisiert: " + new Date().toLocaleTimeString("de-DE");
    }
  }

  // ================= Online: HTTP-Brücke =================
  var httpCbs = {}, httpId = 0;
  window.onHttp = function (id, status, body) { var cb = httpCbs[id]; if (cb) { delete httpCbs[id]; cb(status, body); } };
  window.onGeocode = function (id, arr) { var cb = httpCbs[id]; if (cb) { delete httpCbs[id]; cb(200, arr); } };
  function nativeGet(url) { return new Promise(function (res) { var id = "h" + (++httpId); httpCbs[id] = function (s, b) { res({ status: s, body: b }); }; try { window.Android.httpGet(url, id); } catch (e) { res({ status: 0, body: "" }); } }); }
  function webGet(url) { return fetch(url).then(function (r) { return r.text().then(function (t) { return { status: r.status, body: t }; }); }).catch(function () { return { status: 0, body: "" }; }); }
  function httpGet(url) { return hasNative() ? nativeGet(url) : webGet(url); }
  function httpJson(url) { return httpGet(url).then(function (r) { try { return JSON.parse(r.body); } catch (e) { return null; } }); }
  function nativeGeocode(q) { return new Promise(function (res) { if (!hasNative()) { res(null); return; } var id = "g" + (++httpId); httpCbs[id] = function (s, arr) { res(arr); }; try { window.Android.geocode(q, id); } catch (e) { res(null); } }); }

  // ================= Adress-Suche / Geocoding =================
  function doSearch() {
    var q = $("addrInput").value.trim(); if (!q) return;
    if (!needOnline()) { $("addrResults").innerHTML = '<div class="hint">📡 Offline – Adress-Suche braucht Internet.</div>'; return; }
    $("addrResults").innerHTML = '<div class="hint">Suche…</div>';
    nativeGeocode(q).then(function (arr) {
      if (arr && arr.length) { showAddrResults(arr); return; }
      // Fallback: Nominatim (OSM)
      var url = "https://nominatim.openstreetmap.org/search?format=json&limit=6&q=" + encodeURIComponent(q);
      httpJson(url).then(function (list) {
        if (!list || !list.length) { $("addrResults").innerHTML = '<div class="hint">Nichts gefunden (oder offline).</div>'; return; }
        showAddrResults(list.map(function (r) { return { name: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon) }; }));
      });
    });
  }
  function showAddrResults(arr) {
    var c = $("addrResults"); c.innerHTML = "";
    arr.slice(0, 6).forEach(function (r) {
      var row = document.createElement("div"); row.className = "wp-item";
      row.innerHTML = '<div style="flex:1"><div class="nm" style="font-size:.84rem">' + escapeHtml(r.name) + '</div><div class="co">' + r.lat.toFixed(5) + ", " + r.lon.toFixed(5) + "</div></div>";
      var go = document.createElement("button"); go.className = "b-primary"; go.textContent = "🎯";
      go.onclick = function () { pickPlace(r.lat, r.lon, r.name.split(",")[0]); if (!stopMode) toast("Ziel: " + r.name.split(",")[0]); ensureMap(); if (map) { followMe = false; map.setView([r.lat, r.lon], 15); } };
      row.appendChild(go); c.appendChild(row);
    });
  }
  $("addrBtn").onclick = doSearch;
  $("addrInput").addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });
  var addrTimer = null;
  $("addrInput").addEventListener("input", function () {
    var q = this.value.trim();
    if (addrTimer) clearTimeout(addrTimer);
    if (q.length < 3) { $("addrResults").innerHTML = ""; return; }
    if (navigator.onLine === false) return;
    addrTimer = setTimeout(function () {
      nativeGeocode(q).then(function (arr) {
        if (arr && arr.length) { showAddrResults(arr); return; }
        httpJson("https://nominatim.openstreetmap.org/search?format=json&limit=6&q=" + encodeURIComponent(q)).then(function (list) {
          if (list && list.length) showAddrResults(list.map(function (r) { return { name: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon) }; }));
        });
      });
    }, 450);
  });

  // ================= Navigation (Valhalla, mehrmodal) =================
  var routeLine = null, routeSteps = [], routeStepIdx = 0, routeShape = [], navActive = false, lastReroute = 0, pendingNavStart = false;
  var routeOptions = [], routeOptIdx = 0, arrived = false;
  var navMode = LS.getItem("gg_mode") || "auto";
  Array.prototype.forEach.call($("modeSeg").children, function (b) { b.onclick = function () { navMode = b.getAttribute("data-m"); LS.setItem("gg_mode", navMode); Array.prototype.forEach.call($("modeSeg").children, function (x) { x.classList.toggle("sel", x === b); }); }; b.classList.toggle("sel", b.getAttribute("data-m") === navMode); });
  function decodePolyline(str, precision) {
    var index = 0, lat = 0, lng = 0, coords = [], shift, result, byte, factor = Math.pow(10, precision || 6);
    while (index < str.length) {
      shift = 0; result = 0; do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0; do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      coords.push([lat / factor, lng / factor]);
    }
    return coords;
  }
  function maneuverIcon(t) {
    if (t == null) return "⬆️";
    if (t === 4 || t === 5 || t === 6) return "🏁";
    if (t === 1 || t === 2 || t === 3) return "▶️";
    if (t === 26 || t === 27) return "🔄";
    if (t === 12 || t === 13) return "↩️";
    if (t === 9 || t === 18 || t === 23) return "↗️";
    if (t === 10 || t === 20) return "➡️";
    if (t === 11) return "↘️";
    if (t === 14) return "↙️";
    if (t === 15 || t === 21) return "⬅️";
    if (t === 16 || t === 19 || t === 24) return "↖️";
    if (t === 25 || t === 36 || t === 37) return "🔀";
    if (t === 28 || t === 29) return "⛴️";
    return "⬆️";
  }
  function osrmIcon(mod) { return ({ left: "⬅️", right: "➡️", "slight left": "↖️", "slight right": "↗️", "sharp left": "↙️", "sharp right": "↘️", straight: "⬆️", uturn: "↩️" })[mod] || "⬆️"; }
  function fmtDur(secs) { var m = Math.round(secs / 60); if (m < 1) return "< 1 min"; if (m < 60) return m + " min"; return Math.floor(m / 60) + " h " + (m % 60) + " min"; }
  function calcRoute() {
    if (!target || !lastFix) { toast("Erst Ziel und Position nötig."); return; }
    if (!needOnline()) { $("rtDist").textContent = "--"; $("rtTime").textContent = "--"; return; }
    $("rtDist").textContent = "…"; $("rtTime").textContent = "…";
    var locs = [{ lat: lastFix.lat, lon: lastFix.lon }].concat(routeStops.map(function (s) { return { lat: s.lat, lon: s.lon }; })).concat([{ lat: target.lat, lon: target.lon }]);
    var body = { locations: locs, costing: navMode, alternates: routeStops.length ? 0 : 2, directions_options: { language: "de", units: "kilometers" } };
    if (navMode === "auto" && (avoidHighways || avoidTolls)) body.costing_options = { auto: { use_highways: avoidHighways ? 0 : 1, use_tolls: avoidTolls ? 0 : 1 } };
    var url = "https://valhalla1.openstreetmap.de/route?json=" + encodeURIComponent(JSON.stringify(body));
    httpJson(url).then(function (j) {
      if (!j || !j.trip || !j.trip.legs || !j.trip.legs.length) { osrmFallback(); return; }
      var trips = [j.trip].concat((j.alternates || []).map(function (a) { return a.trip; }).filter(Boolean));
      routeOptions = trips.map(parseTrip);
      selectRoute(0);
      if (voiceOn) speak("Route berechnet. " + (Math.round(routeOptions[0].dist / 100) / 10) + " Kilometer, " + fmtDur(routeOptions[0].secs) + ".");
    });
  }
  function parseTrip(trip) {
    var shape = [], steps = [];
    (trip.legs || []).forEach(function (leg) {
      var lshape = decodePolyline(leg.shape, 6); shape = shape.concat(lshape);
      (leg.maneuvers || []).forEach(function (m) { steps.push({ instr: m.instruction || "weiter", icon: maneuverIcon(m.type), street: (m.street_names || []).join(", "), dist: (m.length || 0) * 1000, time: m.time || 0, loc: lshape[m.begin_shape_index] || [lastFix.lat, lastFix.lon], _ann: false }); });
    });
    var sum = trip.summary || {};
    return { dist: (sum.length || 0) * 1000, secs: sum.time || 0, shape: shape, steps: steps };
  }
  function osrmFallback() {
    if (navMode !== "auto") { toast("Route nicht gefunden (oder offline)."); $("rtDist").textContent = "--"; $("rtTime").textContent = "--"; return; }
    var url = "https://router.project-osrm.org/route/v1/driving/" + lastFix.lon + "," + lastFix.lat + ";" + target.lon + "," + target.lat + "?overview=full&geometries=geojson&steps=true";
    httpJson(url).then(function (j) {
      if (!j || j.code !== "Ok" || !j.routes || !j.routes.length) { toast("Route nicht gefunden (oder offline)."); $("rtDist").textContent = "--"; $("rtTime").textContent = "--"; return; }
      var rt = j.routes[0], shape = rt.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
      var st = (rt.legs && rt.legs[0] && rt.legs[0].steps) ? rt.legs[0].steps : [];
      var steps = st.map(function (s) { var mo = (s.maneuver && s.maneuver.modifier) || "", nm = s.name || ""; var dir = { left: "links", right: "rechts", "slight left": "leicht links", "slight right": "leicht rechts", "sharp left": "scharf links", "sharp right": "scharf rechts", straight: "geradeaus", uturn: "wenden" }[mo] || ""; return { instr: ("Weiter " + dir).trim() + (nm ? " auf " + nm : ""), icon: osrmIcon(mo), street: nm, dist: s.distance, time: s.duration, loc: [s.maneuver.location[1], s.maneuver.location[0]], _ann: false }; });
      routeOptions = [{ dist: rt.distance, secs: rt.duration, shape: shape, steps: steps }];
      selectRoute(0);
    });
  }
  function selectRoute(idx) {
    if (!routeOptions[idx]) return; routeOptIdx = idx; var o = routeOptions[idx];
    routeShape = o.shape; routeSteps = o.steps; routeStepIdx = 0; arrived = false;
    showRoute(o.dist, o.secs); renderRouteOptions();
  }
  function renderRouteOptions() {
    var c = $("routeOpts"); if (!c) return;
    if (routeOptions.length < 2) { c.innerHTML = ""; return; }
    c.innerHTML = "";
    routeOptions.forEach(function (o, i) { var d = fmtDist(o.dist), b = document.createElement("button"); b.className = (i === routeOptIdx ? "b-primary" : "b-soft"); b.style.cssText = "flex:1;flex-direction:column;gap:0;padding:8px"; b.innerHTML = '<span style="font-size:.95rem">' + fmtDur(o.secs) + '</span><span style="font-size:.68rem;opacity:.85">' + d.v + " " + d.u + (i === 0 ? " · schnellste" : "") + '</span>'; b.onclick = function () { selectRoute(i); toast("Route: " + fmtDur(o.secs)); }; c.appendChild(b); });
  }
  function showRoute(dist, secs) {
    var d = fmtDist(dist); $("rtDist").textContent = d.v + " " + d.u; $("rtTime").textContent = fmtDur(secs);
    ensureMap();
    setTimeout(function () { if (!map) return; if (routeLine) map.removeLayer(routeLine); routeLine = L.polyline(routeShape, { color: "#6366f1", weight: 6, opacity: .9 }).addTo(map); if (!navActive) { followMe = false; map.fitBounds(routeLine.getBounds(), { padding: [30, 30] }); } }, 100);
    renderSteps();
    if (pendingNavStart) { pendingNavStart = false; startNav(); }
  }
  function renderSteps() {
    var c = $("steps"); if (!routeSteps.length) { c.innerHTML = ""; return; } c.innerHTML = "";
    routeSteps.forEach(function (s, i) { var d = fmtDist(s.dist), row = document.createElement("div"); row.className = "wp-item"; if (i === routeStepIdx) row.style.borderColor = "var(--primary)"; row.innerHTML = '<div style="flex:1"><div class="nm" style="font-size:.82rem">' + (s.icon || "⬆️") + " " + escapeHtml(s.instr) + '</div><div class="co">' + d.v + " " + d.u + '</div></div>'; c.appendChild(row); });
  }
  function distToRoute(lat, lon) { var min = Infinity; for (var i = 0; i < routeShape.length; i += 2) { var dd = haversine(lat, lon, routeShape[i][0], routeShape[i][1]); if (dd < min) min = dd; } return min; }
  function remaining() {
    var distRem = 0, timeRem = 0;
    if (lastFix && routeSteps[routeStepIdx]) distRem += haversine(lastFix.lat, lastFix.lon, routeSteps[routeStepIdx].loc[0], routeSteps[routeStepIdx].loc[1]);
    for (var i = routeStepIdx + 1; i < routeSteps.length; i++) distRem += routeSteps[i].dist;
    for (var k = routeStepIdx; k < routeSteps.length; k++) timeRem += routeSteps[k].time;
    return { dist: distRem, time: timeRem };
  }
  function routeProgress() {
    if (!routeSteps.length || !lastFix) return;
    var s = routeSteps[routeStepIdx]; if (!s) return;
    var dToMan = haversine(lastFix.lat, lastFix.lon, s.loc[0], s.loc[1]);
    if (navActive) {
      // Ankunft erkannt
      if (target && !arrived && haversine(lastFix.lat, lastFix.lon, target.lat, target.lon) < 30) {
        arrived = true; if (voiceOn) speak("Sie haben Ihr Ziel erreicht."); toast("🏁 Ziel erreicht!"); stopNav(); return;
      }
      var eta = remaining(), ed = fmtDist(eta.dist), arr = new Date(Date.now() + eta.time * 1000);
      var nxt = routeSteps[routeStepIdx + 1] || s, after = routeSteps[routeStepIdx + 2];
      $("nbArrow").textContent = nxt.icon || "⬆️"; $("nbInstr").textContent = nxt.instr;
      var dd = fmtDist(dToMan); $("nbDist").textContent = "in " + dd.v + " " + dd.u + (after ? "  ›  danach " + (after.icon || "") : "");
      var spdTxt = (lastFix.speed != null && !isNaN(lastFix.speed)) ? " · " + fmtSpeed(lastFix.speed) + " " + (isImp() ? "mph" : "km/h") : "";
      $("nbEta").textContent = "Ankunft ~" + arr.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " · noch " + ed.v + " " + ed.u + " · " + fmtDur(eta.time) + spdTxt;
      if (map && followMe) map.setView([lastFix.lat, lastFix.lon], Math.max(map.getZoom(), 16));
      if (routeShape.length && distToRoute(lastFix.lat, lastFix.lon) > 60 && Date.now() - lastReroute > 8000) { lastReroute = Date.now(); toast("Route wird neu berechnet…"); if (voiceOn) speak("Route wird neu berechnet."); calcRoute(); return; }
    }
    if (dToMan < 30 && routeStepIdx < routeSteps.length - 1) { routeStepIdx++; renderSteps(); var ns = routeSteps[routeStepIdx]; if (voiceOn && ns) speak(ns.instr); }
    else if (voiceOn && dToMan < 180 && !s._ann) { s._ann = true; var d2 = fmtDist(dToMan); speak("In " + d2.v + " " + (d2.u === "km" ? "Kilometern" : "Metern") + ": " + s.instr); }
  }
  function startNav() { if (!routeSteps.length) { pendingNavStart = true; calcRoute(); return; } navActive = true; arrived = false; followMe = true; $("navBanner").classList.add("show"); $("navStartBtn").textContent = "⏹ Navigation läuft"; switchTab("map"); if (voiceOn) speak("Navigation gestartet."); routeProgress(); }
  function stopNav() { navActive = false; $("navBanner").classList.remove("show"); $("navStartBtn").textContent = "▶︎ Navigation starten"; }
  $("routeBtn").onclick = function () { calcRoute(); };
  $("navStartBtn").onclick = function () { if (navActive) stopNav(); else startNav(); };
  $("navStopBtn").onclick = stopNav;
  if ($("navRecenter")) $("navRecenter").onclick = function () { followMe = true; if (map && lastFix) map.setView([lastFix.lat, lastFix.lon], Math.max(map.getZoom(), 16)); };
  $("routeClearBtn").onclick = function () { stopNav(); if (routeLine && map) map.removeLayer(routeLine); routeLine = null; routeSteps = []; routeShape = []; $("steps").innerHTML = ""; $("rtDist").textContent = "--"; $("rtTime").textContent = "--"; };

  // ================= Flugradar (FR24-Stil – echte ADS-B-Daten) =================
  var flugMap = null, flugLayer = null, flugTrail = null, flugTimer = null, flugInterval = 8000, flugAutoOn = true, flugVisible = false;
  var followFlugHex = null, lastPlanes = [], flugFilter = "all", flugQuery = "", trailPts = [], acCache = {}, routeCache = {}, detailHex = null, flugRouteLayer = null;
  var flugMarkers = {}, flugAnim = null, airportsOn = false, airportLayer = null, airportTimer = null;
  var labelsOn = LS.getItem("gg_flbl") === "1";
  function makeLabel(p) {
    if (!labelsOn) return null;
    var alt = p.alt != null ? (p.alt >= 18000 ? "FL" + Math.round(p.alt / 100) : Math.round(p.alt).toLocaleString("de-DE") + "ft") : "";
    return { cs: escapeHtml(p.flight || p.hex), alt: alt };
  }
  function isEmergency(sq) { return sq === "7500" || sq === "7600" || sq === "7700"; }
  function altColor(ft, emerg) { if (emerg) return "#ef4444"; if (ft == null) return "#94a3b8"; if (ft < 3000) return "#f59e0b"; if (ft < 10000) return "#fbbf24"; if (ft < 20000) return "#34d399"; if (ft < 30000) return "#38bdf8"; return "#818cf8"; }
  function planeIcon(track, color, sel, label) {
    var svg = '<svg width="24" height="24" viewBox="0 0 24 24" style="transform:rotate(' + (track || 0) + 'deg);filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))"><path fill="' + color + '" stroke="' + (sel ? "#fff" : "rgba(0,0,0,.4)") + '" stroke-width="' + (sel ? 1 : 0.5) + '" d="M21,16v-2l-8-5V3.5C13,2.67,12.33,2,11.5,2S10,2.67,10,3.5V9l-8,5v2l8-2.5V19l-2,1.5V22l3.5-1l3.5,1v-1.5L13,19v-5.5L21,16z"/></svg>';
    var lbl = label ? '<div class="plane-lbl">' + label.cs + (label.alt ? '<div class="alt">' + label.alt + '</div>' : "") + '</div>' : "";
    return L.divIcon({ className: "", html: '<div class="plane-wrap">' + svg + lbl + "</div>", iconSize: [24, 24], iconAnchor: [12, 12] });
  }
  function ensureFlugMap() {
    if (flugMap || typeof L === "undefined") { if (flugMap) setTimeout(function () { flugMap.invalidateSize(); }, 50); return; }
    var c = lastFix ? [lastFix.lat, lastFix.lon] : [51.1657, 10.4515];
    flugMap = L.map("flugMap", { zoomControl: true, attributionControl: false }).setView(c, lastFix ? 9 : 5);
    flugBaseLayer = makeBaseLayer(); flugBaseLayer.addTo(flugMap);
    flugLayer = L.layerGroup().addTo(flugMap);
    flugMarkers = {};
    flugMap.on("moveend", function () { if (flugVisible) { loadFlights(); if (airportsOn) { if (airportTimer) clearTimeout(airportTimer); airportTimer = setTimeout(loadAirports, 600); } } });
    setTimeout(function () { flugMap.invalidateSize(); }, 60);
  }
  function openFlug() {
    flugVisible = true; ensureFlugMap(); loadFlights();
    if (flugAutoOn) { if (flugTimer) clearInterval(flugTimer); flugTimer = setInterval(loadFlights, flugInterval); }
    if (!flugAnim) flugAnim = setInterval(animateFlights, 250);
  }
  function pauseFlug() { flugVisible = false; if (flugTimer) { clearInterval(flugTimer); flugTimer = null; } if (flugAnim) { clearInterval(flugAnim); flugAnim = null; } }
  function animateFlights() {
    if (!flugVisible || !flugMap) return;
    var now = Date.now(), moved = false;
    lastPlanes.forEach(function (p) {
      if (p.gsKmh && p.trk != null && p.baseLat != null) {
        var dt = (now - p.t0) / 1000, distM = (p.gsKmh / 3.6) * dt, rad = p.trk * Math.PI / 180;
        p.lat = p.baseLat + (distM * Math.cos(rad)) / 111320;
        p.lon = p.baseLon + (distM * Math.sin(rad)) / (111320 * Math.cos(p.baseLat * Math.PI / 180));
        moved = true;
      }
    });
    if (moved) drawFlights(true);
  }
  function knKmh(kn) { return kn != null ? Math.round(kn * 1.852) : null; }
  function loadFlights() {
    if (!flugMap) return;
    if (navigator.onLine === false) { $("flugCount").textContent = "–"; $("flugList").innerHTML = '<div class="hint">📡 Offline – Flugradar braucht Internet.</div>'; return; }
    var c = flugMap.getCenter(), b = flugMap.getBounds();
    var radiusNm = Math.min(250, Math.max(30, Math.round(haversine(c.lat, c.lng, b.getNorth(), c.lng) / 1852 * 1.1)));
    $("flugCount").textContent = "…";
    httpJson("https://api.airplanes.live/v2/point/" + c.lat.toFixed(4) + "/" + c.lng.toFixed(4) + "/" + radiusNm).then(function (j) {
      if (j && j.ac && j.ac.length) {
        renderFlights(j.ac.map(function (a) { return { hex: a.hex, flight: (a.flight || "").trim() || a.r || a.hex, reg: a.r || "", type: a.t || "", lat: a.lat, lon: a.lon, alt: (typeof a.alt_baro === "number" ? a.alt_baro : null), gsKmh: knKmh(a.gs), trk: a.track, squawk: a.squawk || "", rate: (a.baro_rate != null ? a.baro_rate : null), onground: false }; }));
      } else { openSkyFallback(b); }
    });
  }
  function openSkyFallback(b) {
    httpJson("https://opensky-network.org/api/states/all?lamin=" + b.getSouth().toFixed(4) + "&lomin=" + b.getWest().toFixed(4) + "&lamax=" + b.getNorth().toFixed(4) + "&lomax=" + b.getEast().toFixed(4)).then(function (j) {
      if (!j || !j.states) { lastPlanes = []; drawFlights(false); return; }
      renderFlights(j.states.map(function (s) { var altM = (s[13] != null ? s[13] : s[7]); return { hex: s[0], flight: (s[1] || "").trim() || s[0], reg: "", type: "", lat: s[6], lon: s[5], onground: s[8], alt: (altM != null ? Math.round(altM * 3.28084) : null), gsKmh: (s[9] != null ? Math.round(s[9] * 3.6) : null), trk: s[10], squawk: s[14] || "", rate: (s[11] != null ? Math.round(s[11] * 196.85) : null) }; }));
    });
  }
  function passFilter(p) {
    if (flugQuery) { var q = flugQuery.toLowerCase(); if ((p.flight || "").toLowerCase().indexOf(q) < 0 && (p.reg || "").toLowerCase().indexOf(q) < 0 && (p.type || "").toLowerCase().indexOf(q) < 0) return false; }
    if (flugFilter === "high" && !(p.alt != null && p.alt >= 10000)) return false;
    if (flugFilter === "climb" && !(p.rate != null && p.rate > 100)) return false;
    if (flugFilter === "descend" && !(p.rate != null && p.rate < -100)) return false;
    if (flugFilter === "emerg" && !isEmergency(p.squawk)) return false;
    return true;
  }
  // ===== Flughäfen-Layer (OpenStreetMap/Overpass) =====
  function loadAirports() {
    if (!flugMap || !airportsOn) return;
    if (navigator.onLine === false) { toast("Flughäfen brauchen Internet."); return; }
    var b = flugMap.getBounds(), bbox = b.getSouth().toFixed(3) + "," + b.getWest().toFixed(3) + "," + b.getNorth().toFixed(3) + "," + b.getEast().toFixed(3);
    var q = '[out:json][timeout:20];(node["aeroway"="aerodrome"]["name"](' + bbox + ');way["aeroway"="aerodrome"]["name"](' + bbox + '););out center 120;';
    httpJson("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q)).then(function (j) {
      if (!airportsOn) return;
      if (!airportLayer) airportLayer = L.layerGroup().addTo(flugMap); else airportLayer.clearLayers();
      if (!j || !j.elements) return;
      j.elements.forEach(function (el) {
        var lat = el.lat != null ? el.lat : (el.center && el.center.lat), lon = el.lon != null ? el.lon : (el.center && el.center.lon);
        if (lat == null || lon == null) return;
        var t = el.tags || {}, iata = t.iata || t["iata"] || "", name = t.name || "Flughafen";
        L.marker([lat, lon], { icon: L.divIcon({ className: "", html: '<div style="font-size:17px;filter:drop-shadow(0 1px 1px #0008)">🛫</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) })
          .bindPopup("<b>🛫 " + escapeHtml(name) + "</b>" + (iata ? " (" + escapeHtml(iata) + ")" : "")).addTo(airportLayer);
      });
    });
  }
  function renderFlights(planes) {
    var now = Date.now();
    lastPlanes = planes.filter(function (p) { return p.lat != null && p.lon != null && !p.onground; });
    lastPlanes.forEach(function (p) { p.baseLat = p.lat; p.baseLon = p.lon; p.t0 = now; p.distKm = lastFix ? haversine(lastFix.lat, lastFix.lon, p.lat, p.lon) / 1000 : null; });
    drawFlights(false);
    if (detailHex) renderDetail();
    if (flugVisible && !flugAnim) flugAnim = setInterval(animateFlights, 250);
  }
  function drawFlights(animOnly) {
    if (!flugMap || !flugLayer) return;
    var planes = lastPlanes.filter(passFilter), seen = {};
    planes.forEach(function (p) {
      seen[p.hex] = 1;
      var emerg = isEmergency(p.squawk), sel = (followFlugHex === p.hex), col = altColor(p.alt, emerg), rec = flugMarkers[p.hex];
      var lblKey = labelsOn ? ((p.flight || "") + "|" + (p.alt || "")) : "";
      if (!rec) {
        var m = L.marker([p.lat, p.lon], { icon: planeIcon(p.trk, col, sel, makeLabel(p)) });
        m.on("click", (function (hex) { return function () { openDetail(hex); }; })(p.hex));
        m.addTo(flugLayer); flugMarkers[p.hex] = { marker: m, trk: p.trk, col: col, sel: sel, lblKey: lblKey };
      } else {
        rec.marker.setLatLng([p.lat, p.lon]);
        if (rec.trk !== p.trk || rec.col !== col || rec.sel !== sel || rec.lblKey !== lblKey) { rec.marker.setIcon(planeIcon(p.trk, col, sel, makeLabel(p))); rec.trk = p.trk; rec.col = col; rec.sel = sel; rec.lblKey = lblKey; }
      }
    });
    Object.keys(flugMarkers).forEach(function (hex) { if (!seen[hex]) { flugLayer.removeLayer(flugMarkers[hex].marker); delete flugMarkers[hex]; } });
    $("flugCount").textContent = planes.length + (lastPlanes.length !== planes.length ? " / " + lastPlanes.length : "");
    if (followFlugHex) {
      var f = lastPlanes.filter(function (p) { return p.hex === followFlugHex; })[0];
      if (f) {
        flugMap.setView([f.lat, f.lon], flugMap.getZoom(), { animate: false });
        trailPts.push([f.lat, f.lon]); if (trailPts.length > 150) trailPts.shift();
        if (!flugTrail) flugTrail = L.polyline(trailPts, { color: "#38bdf8", weight: 3, opacity: .85, dashArray: "5 5" }).addTo(flugMap); else flugTrail.setLatLngs(trailPts);
        drawFlightRoute(f);
        if (!routeCache[(f.flight || "").trim()]) fetchDetailData(f.hex);
      }
    } else if (flugRouteLayer) { flugMap.removeLayer(flugRouteLayer); flugRouteLayer = null; }
    if (animOnly) return;
    var list = $("flugList");
    if (lastFix) planes.sort(function (a, b) { return (a.distKm || 1e9) - (b.distKm || 1e9); });
    else planes.sort(function (a, b) { return (b.alt || 0) - (a.alt || 0); });
    if (!planes.length) { list.innerHTML = '<div class="hint">Keine Flüge (Filter/Bereich prüfen).</div>'; return; }
    list.innerHTML = "";
    planes.slice(0, 60).forEach(function (p) {
      var emerg = isEmergency(p.squawk), route = routeCache[(p.flight || "").trim()];
      var row = document.createElement("div"); row.className = "wp-item"; row.style.cursor = "pointer";
      if (emerg) row.style.borderColor = "var(--danger)"; if (followFlugHex === p.hex) row.style.borderColor = "var(--primary)";
      var routeTxt = (route && route.from) ? (route.from + " → " + route.to) : "";
      row.innerHTML = '<div style="flex:1"><div class="nm">✈ ' + escapeHtml(p.flight) + (p.reg ? ' <span style="color:var(--text-muted);font-weight:400">' + escapeHtml(p.reg) + '</span>' : "") + (emerg ? ' <span style="color:var(--danger)">⚠</span>' : "") + '</div><div class="co">' + (routeTxt ? escapeHtml(routeTxt) + " · " : "") + (p.alt != null ? p.alt.toLocaleString("de-DE") + " ft" : "–") + " · " + (p.gsKmh != null ? p.gsKmh + " km/h" : "–") + (p.distKm != null ? " · " + p.distKm.toFixed(0) + " km" : "") + '</div></div><div style="color:var(--text-muted)">›</div>';
      row.onclick = function () { openDetail(p.hex); };
      list.appendChild(row);
    });
  }
  function planeByHex(hex) { return lastPlanes.filter(function (p) { return p.hex === hex; })[0]; }
  function drawFlightRoute(p) {
    var route = routeCache[(p.flight || "").trim()];
    if (!route || route.oLat == null || isNaN(route.oLat) || route.dLat == null || isNaN(route.dLat)) { if (flugRouteLayer) { flugMap.removeLayer(flugRouteLayer); flugRouteLayer = null; } return; }
    if (flugRouteLayer) flugMap.removeLayer(flugRouteLayer);
    flugRouteLayer = L.layerGroup().addTo(flugMap);
    var o = [route.oLat, route.oLon], d = [route.dLat, route.dLon], cur = [p.lat, p.lon];
    L.polyline([o, d], { color: "#64748b", weight: 2, opacity: .45, dashArray: "2 6" }).addTo(flugRouteLayer);
    L.polyline([o, cur], { color: "#10b981", weight: 3, opacity: .85 }).addTo(flugRouteLayer);
    L.polyline([cur, d], { color: "#38bdf8", weight: 3, opacity: .85, dashArray: "6 6" }).addTo(flugRouteLayer);
    L.marker(o, { icon: L.divIcon({ className: "", html: '<div style="font-size:15px">🛫</div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).bindPopup("Start: " + (route.from || "")).addTo(flugRouteLayer);
    L.marker(d, { icon: L.divIcon({ className: "", html: '<div style="font-size:15px">🛬</div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).bindPopup("Ziel: " + (route.to || "")).addTo(flugRouteLayer);
  }
  function flightProgress(p, route) {
    if (!route || route.oLat == null || isNaN(route.oLat) || route.dLat == null || isNaN(route.dLat) || p.lat == null) return null;
    var flown = haversine(route.oLat, route.oLon, p.lat, p.lon) / 1000, remain = haversine(p.lat, p.lon, route.dLat, route.dLon) / 1000, total = flown + remain;
    var gs = p.gsKmh || 0;
    return { flown: flown, remain: remain, total: total, pct: total > 0 ? Math.max(0, Math.min(100, flown / total * 100)) : 0, etaMin: gs > 50 ? Math.round(remain / gs * 60) : null, elapsedMin: gs > 50 ? Math.round(flown / gs * 60) : null };
  }
  function openDetail(hex) { detailHex = hex; $("flugDetail").classList.add("show"); renderDetail(); fetchDetailData(hex); }
  function closeDetail() { detailHex = null; $("flugDetail").classList.remove("show"); }
  function fetchDetailData(hex) {
    if (!acCache[hex]) {
      acCache[hex] = { pending: true };
      httpJson("https://api.adsbdb.com/v0/aircraft/" + encodeURIComponent(hex)).then(function (j) {
        var a = j && j.response && j.response.aircraft;
        acCache[hex] = a ? { type: a.type, manu: a.manufacturer, reg: a.registration, owner: a.registered_owner, country: a.registered_owner_country_name, photo: a.url_photo_thumbnail || a.url_photo } : {};
        if (detailHex === hex) renderDetail();
      });
    }
    var p = planeByHex(hex), cs = (p && p.flight || "").trim();
    if (cs && !routeCache[cs]) {
      routeCache[cs] = { pending: true };
      httpJson("https://api.adsbdb.com/v0/callsign/" + encodeURIComponent(cs)).then(function (j) {
        var r = j && j.response && j.response.flightroute;
        routeCache[cs] = r ? {
          airline: r.airline ? r.airline.name : "",
          from: r.origin ? r.origin.iata_code : "", fromName: r.origin ? r.origin.municipality : "",
          to: r.destination ? r.destination.iata_code : "", toName: r.destination ? r.destination.municipality : "",
          oLat: r.origin ? parseFloat(r.origin.latitude) : null, oLon: r.origin ? parseFloat(r.origin.longitude) : null,
          dLat: r.destination ? parseFloat(r.destination.latitude) : null, dLon: r.destination ? parseFloat(r.destination.longitude) : null
        } : {};
        if (detailHex === hex) renderDetail();
        if (followFlugHex === hex) drawFlights();
      });
    }
  }
  function renderDetail() {
    var hex = detailHex; if (!hex) return;
    var p = planeByHex(hex) || {}, ac = acCache[hex] || {}, route = routeCache[(p.flight || "").trim()] || {}, emerg = isEmergency(p.squawk);
    function cell(k, v) { return '<div class="fd-cell"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }
    var html = "";
    if (ac.photo) html += '<img class="fd-photo" src="' + ac.photo + '" alt="" onerror="this.style.display=\'none\'"/>';
    html += '<div class="fd-title">✈ ' + escapeHtml(p.flight || hex) + (emerg ? ' <span style="color:var(--danger)">⚠ NOTFALL</span>' : "") + '</div>';
    if (route.airline) html += '<div style="color:var(--text-muted);font-weight:600;text-align:center">' + escapeHtml(route.airline) + '</div>';
    if (route.from || route.to) html += '<div class="fd-route"><span>' + escapeHtml(route.from || "???") + '</span><span style="color:var(--primary)">✈</span><span>' + escapeHtml(route.to || "???") + '</span></div>';
    if (route.fromName || route.toName) html += '<div style="text-align:center;color:var(--text-muted);font-size:.8rem;margin-top:-4px">' + escapeHtml(route.fromName || "") + ' → ' + escapeHtml(route.toName || "") + '</div>';
    var prog = flightProgress(p, route);
    if (prog) {
      var arrT = prog.etaMin != null ? new Date(Date.now() + prog.etaMin * 60000) : null;
      html += '<div class="progress"><div style="width:' + prog.pct.toFixed(0) + '%"></div></div>';
      html += '<div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--text-muted)"><span>🛫 ' + escapeHtml(route.from || "") + '</span><span>' + prog.pct.toFixed(0) + '%</span><span>' + escapeHtml(route.to || "") + ' 🛬</span></div>';
      html += '<div class="fd-grid" style="margin-top:8px">';
      html += cell("✅ Abgeflogen", prog.flown.toFixed(0) + " km" + (prog.elapsedMin != null ? " · ~" + prog.elapsedMin + " min" : ""));
      html += cell("➡️ Verbleibend", prog.remain.toFixed(0) + " km" + (prog.etaMin != null ? " · ~" + prog.etaMin + " min" : ""));
      html += cell("📏 Gesamtstrecke", prog.total.toFixed(0) + " km");
      html += cell("🛬 Ankunft (gesch.)", arrT ? arrT.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr" : "–");
      html += '</div>';
    }
    html += '<div class="fd-grid">';
    html += cell("Höhe", p.alt != null ? p.alt.toLocaleString("de-DE") + " ft" : "–");
    html += cell("Tempo", p.gsKmh != null ? p.gsKmh + " km/h" : "–");
    html += cell("Kurs", p.trk != null ? Math.round(p.trk) + "°" : "–");
    html += cell("Vertikal", p.rate != null ? (p.rate > 0 ? "⬆ " : p.rate < 0 ? "⬇ " : "") + Math.abs(p.rate) + " ft/min" : "–");
    html += cell("Squawk", (p.squawk || "–") + (emerg ? " ⚠" : ""));
    html += cell("Entfernung", p.distKm != null ? p.distKm.toFixed(1) + " km" : "–");
    html += cell("Kennzeichen", escapeHtml(ac.reg || p.reg || "–"));
    html += cell("Typ", escapeHtml(ac.type || p.type || "–"));
    if (ac.manu) html += cell("Hersteller", escapeHtml(ac.manu));
    if (ac.owner) html += cell("Halter/Airline", escapeHtml(ac.owner));
    html += '</div>';
    html += '<div class="btn-row" style="margin-top:12px"><button id="fdFollow" class="b-primary">' + (followFlugHex === hex ? "⏹ Verfolgung stoppen" : "🎯 Verfolgen") + '</button><button id="fdCenter" class="b-soft">🗺 Auf Karte</button></div>';
    if (!ac.reg && !route.from) html += '<div class="hint" style="margin-top:8px">Lade Flugzeug-/Routendaten…</div>';
    $("flugDetBody").innerHTML = html;
    $("fdFollow").onclick = function () {
      if (followFlugHex === hex) followFlugHex = null;
      else followFlugHex = hex;
      trailPts = []; if (flugTrail) { flugMap.removeLayer(flugTrail); flugTrail = null; }
      renderDetail(); drawFlights();
    };
    $("fdCenter").onclick = function () { if (p.lat) { closeDetail(); flugMap.setView([p.lat, p.lon], Math.max(flugMap.getZoom(), 10)); } };
  }
  $("flugDetClose").onclick = closeDetail;
  if ($("flugDetGrip")) $("flugDetGrip").onclick = closeDetail;
  // ===== Flug-Suche (lokal zentrieren, sonst weltweit) =====
  function gotoGlobal(a) {
    flugMap.setView([a.lat, a.lon], 8);
    setTimeout(function () { loadFlights(); }, 60);
    setTimeout(function () { openDetail(a.hex); }, 1000);
  }
  function searchFlight() {
    var q = $("flugSearch").value.trim(); flugQuery = q;
    if (!q) { drawFlights(); return; }
    var s = q.toLowerCase();
    var local = lastPlanes.filter(function (p) { return (p.flight || "").toLowerCase().indexOf(s) >= 0 || (p.reg || "").toLowerCase().indexOf(s) >= 0; });
    if (local.length) { var f = local[0]; if (flugSheet()) flugSheet().classList.add("collapsed"); flugMap.setView([f.lat, f.lon], Math.max(flugMap.getZoom(), 9)); openDetail(f.hex); drawFlights(); return; }
    if (navigator.onLine === false) { toast("Suche braucht Internet."); return; }
    toast("Suche „" + q + "“ weltweit…");
    httpJson("https://api.airplanes.live/v2/callsign/" + encodeURIComponent(q.toUpperCase())).then(function (j) {
      if (j && j.ac && j.ac.length && j.ac[0].lat != null) { gotoGlobal(j.ac[0]); return; }
      httpJson("https://api.airplanes.live/v2/reg/" + encodeURIComponent(q.toUpperCase())).then(function (j2) {
        if (j2 && j2.ac && j2.ac.length && j2.ac[0].lat != null) gotoGlobal(j2.ac[0]);
        else toast("„" + q + "“ nicht gefunden (evtl. am Boden/offline).");
      });
    });
  }
  function flugSheet() { return $("flugSheet"); }
  $("flugSearchBtn").onclick = searchFlight;
  $("flugSearch").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); searchFlight(); } });
  $("flugSearch").addEventListener("input", function () { flugQuery = this.value.trim(); drawFlights(); });
  // ===== Filter-Chips =====
  if ($("flugChips")) Array.prototype.forEach.call($("flugChips").children, function (b) {
    b.onclick = function () {
      flugFilter = b.getAttribute("data-f");
      Array.prototype.forEach.call($("flugChips").children, function (x) { x.classList.toggle("sel", x === b); });
      drawFlights();
    };
  });
  // ===== Labels auf der Karte =====
  if ($("labelBtn")) { $("labelBtn").classList.toggle("on", labelsOn); $("labelBtn").onclick = function () { labelsOn = !labelsOn; this.classList.toggle("on", labelsOn); LS.setItem("gg_flbl", labelsOn ? "1" : "0"); drawFlights(); }; }
  // ===== Bottom-Sheet ein-/ausklappen =====
  function toggleSheet() { var sh = $("flugSheet"); if (sh) sh.classList.toggle("collapsed"); }
  if ($("flugSheetHandle")) $("flugSheetHandle").onclick = toggleSheet;
  if ($("flugSheetHead")) $("flugSheetHead").onclick = toggleSheet;
  $("airportBtn").onclick = function () {
    airportsOn = !airportsOn; this.classList.toggle("on", airportsOn);
    if (airportsOn) { toast("Lade Flughäfen…"); loadAirports(); } else if (airportLayer) { airportLayer.clearLayers(); }
  };
  $("flugRefresh").onclick = function () { loadFlights(); };
  $("flugAuto").onclick = function () { flugAutoOn = !flugAutoOn; this.classList.toggle("on", flugAutoOn); toast("Auto-Aktualisierung " + (flugAutoOn ? "an" : "aus")); if (flugAutoOn) { if (flugVisible) { loadFlights(); flugTimer = setInterval(loadFlights, flugInterval); } } else if (flugTimer) { clearInterval(flugTimer); flugTimer = null; } };

  // ================= Wetter (Open-Meteo) =================
  var lastWeather = 0;
  function wxDesc(code) {
    var m = { 0: "Klar", 1: "Überw. klar", 2: "Teilw. bewölkt", 3: "Bewölkt", 45: "Nebel", 48: "Reifnebel", 51: "Niesel", 53: "Niesel", 55: "Niesel", 61: "Regen", 63: "Regen", 65: "Starkregen", 71: "Schnee", 73: "Schnee", 75: "Starkschnee", 80: "Schauer", 81: "Schauer", 82: "Starkschauer", 95: "Gewitter", 96: "Gewitter", 99: "Gewitter" };
    return m[code] || "–";
  }
  function maybeWeather(lat, lon) {
    if (navigator.onLine === false) return;
    if (Date.now() - lastWeather < 600000) return; lastWeather = Date.now();
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat.toFixed(4) + "&longitude=" + lon.toFixed(4) + "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation";
    httpJson(url).then(function (j) {
      if (!j || !j.current) return; var c = j.current;
      $("wxTemp").textContent = Math.round(c.temperature_2m);
      $("wxWind").textContent = Math.round(c.wind_speed_10m);
      $("wxDesc").textContent = wxDesc(c.weather_code);
      $("wxHum").textContent = Math.round(c.relative_humidity_2m) + "% / " + (c.precipitation != null ? c.precipitation : 0) + " mm";
    });
  }

  // ================= Adresse (Reverse-Geocoding) =================
  var lastRev = 0, lastRevPos = null;
  function maybeReverse(lat, lon) {
    if (navigator.onLine === false) return;
    if (lastRevPos && haversine(lastRevPos.lat, lastRevPos.lon, lat, lon) < 60 && Date.now() - lastRev < 120000) return;
    if (Date.now() - lastRev < 12000) return;
    lastRev = Date.now(); lastRevPos = { lat: lat, lon: lon };
    httpJson("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=" + lat.toFixed(5) + "&lon=" + lon.toFixed(5)).then(function (j) {
      if (!j) return; var el = $("placeName"); if (!el) return;
      if (j.address) { var a = j.address; var line = [(a.road || a.pedestrian || a.footway || a.path || ""), (a.house_number || "")].filter(Boolean).join(" "); var city = [a.postcode || "", (a.city || a.town || a.village || a.suburb || a.county || "")].filter(Boolean).join(" "); el.textContent = [line, city, a.country || ""].filter(Boolean).join(", ") || (j.display_name || "–"); }
      else if (j.display_name) el.textContent = j.display_name;
    });
  }

  // ================= Einstellungen =================
  var baseTheme = LS.getItem("gg_basetheme");
  if (!baseTheme) { var old = LS.getItem("gg_theme"); baseTheme = (old === "dark" || old === "light") ? old : "auto"; }
  var nightOn = LS.getItem("gg_night") === "1";
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function resolvedTheme() { if (nightOn) return "night"; if (baseTheme === "auto") return (mq && mq.matches) ? "dark" : "light"; return baseTheme; }
  function applyTheme() {
    var t = resolvedTheme();
    document.documentElement.setAttribute("data-theme", t);
    if ($("themeSeg")) Array.prototype.forEach.call($("themeSeg").children, function (b) { b.classList.toggle("sel", b.getAttribute("data-t") === baseTheme); });
    if ($("nightTgl")) $("nightTgl").classList.toggle("on", nightOn);
    var mc = document.querySelector('meta[name=theme-color]'); if (mc) mc.setAttribute("content", t === "night" ? "#000000" : t === "dark" ? "#0b1220" : "#f5f7fb");
  }
  if ($("themeSeg")) Array.prototype.forEach.call($("themeSeg").children, function (b) { b.onclick = function () { baseTheme = b.getAttribute("data-t"); LS.setItem("gg_basetheme", baseTheme); applyTheme(); }; });
  if ($("nightTgl")) $("nightTgl").onclick = function () { nightOn = !nightOn; LS.setItem("gg_night", nightOn ? "1" : "0"); applyTheme(); };
  if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (baseTheme === "auto" && !nightOn) applyTheme(); });
  applyTheme();

  function selUnits(u) { units = u; LS.setItem("gg_units", u); applyUnitLabels(); Array.prototype.forEach.call($("unitSeg").children, function (b) { b.classList.toggle("sel", b.getAttribute("data-u") === u); }); if (lastFix) updateLocation(lastFix); refreshTrackStats(); }
  Array.prototype.forEach.call($("unitSeg").children, function (b) { b.onclick = function () { selUnits(b.getAttribute("data-u")); }; b.classList.toggle("sel", b.getAttribute("data-u") === units); });
  applyUnitLabels();

  Array.prototype.forEach.call($("northSeg").children, function (b) { b.onclick = function () { northRef = b.getAttribute("data-n"); LS.setItem("gg_north", northRef); Array.prototype.forEach.call($("northSeg").children, function (x) { x.classList.toggle("sel", x === b); }); if (lastRawHeading != null) updateHeading(lastRawHeading, null); }; b.classList.toggle("sel", b.getAttribute("data-n") === northRef); });

  var wakeLock = null;
  async function setWake(on) {
    $("wakeTgl").classList.toggle("on", on); LS.setItem("gg_wake", on ? "1" : "0");
    if (hasNative()) { try { window.Android.keepAwake(on); } catch (e) {} }
    try { if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); else if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
  }
  $("wakeTgl").onclick = function () { setWake(!$("wakeTgl").classList.contains("on")); };
  if (LS.getItem("gg_wake") === "1") setWake(true);

  $("bgTgl").onclick = function () { var on = !$("bgTgl").classList.contains("on"); $("bgTgl").classList.toggle("on", on); LS.setItem("gg_bg", on ? "1" : "0"); if (hasNative()) { try { window.Android.setBackground(on); } catch (e) {} } else toast("Hintergrund-Tracking nur in der nativen App (APK)."); };
  if (LS.getItem("gg_bg") === "1") $("bgTgl").classList.add("on");

  // ================= Akku & Laufzeit =================
  var sessionStart = Date.now(), battHist = [], lastBattWarn = 0;
  var powerSave = LS.getItem("gg_power") === "1", battWarnOn = LS.getItem("gg_battwarn") !== "0";
  $("powerTgl").classList.toggle("on", powerSave); $("battWarnTgl").classList.toggle("on", battWarnOn);
  function battIconFor(pct, charging) { if (charging) return "⚡"; if (pct >= 0 && pct <= 10) return "🪫"; return "🔋"; }
  window.onNativeBattery = function (j) { try { updateBattery(typeof j === "string" ? JSON.parse(j) : j); } catch (e) {} };
  function updateBattery(b) {
    var pct = b.pct;
    $("battPct").textContent = pct >= 0 ? pct : "--";
    $("battTopPct").textContent = pct >= 0 ? (pct + "%") : "--%";
    $("battIcon").textContent = battIconFor(pct, b.charging);
    $("battStatus").textContent = b.charging ? ("lädt" + (b.plugged && b.plugged !== "–" ? " (" + b.plugged + ")" : "")) : "entlädt";
    $("battTemp").textContent = (b.temp != null && b.temp > 0) ? b.temp.toFixed(1) : "--";
    $("battHealth").textContent = (b.volt > 0 ? b.volt.toFixed(2) + " V · " : "") + (b.health || "–");
    var fill = $("battFill"); if (pct >= 0) { fill.style.width = pct + "%"; fill.style.background = pct <= 15 ? "var(--danger)" : pct <= 30 ? "var(--warning)" : "var(--success)"; }
    if (!b.charging && pct >= 0) {
      battHist.push({ t: Date.now(), pct: pct }); if (battHist.length > 60) battHist.shift();
      var first = battHist[0], last = battHist[battHist.length - 1], dtH = (last.t - first.t) / 3600000, drop = first.pct - last.pct;
      if (dtH > 0.03 && drop > 0) { var rate = drop / dtH, hrs = pct / rate, hh = Math.floor(hrs), mm = Math.round((hrs - hh) * 60); $("battRemain").textContent = "~" + hh + " h " + mm + " min"; }
    } else if (b.charging) { $("battRemain").textContent = "lädt…"; }
    if (battWarnOn && !b.charging && pct >= 0 && pct <= 15 && Date.now() - lastBattWarn > 300000) {
      lastBattWarn = Date.now(); vibrate(800); speak("Achtung, Akku bei " + pct + " Prozent.");
      if (hasNative()) { try { window.Android.notify("Akku niedrig", "Nur noch " + pct + "% – Energiesparmodus empfohlen."); } catch (e) {} }
      toast("🪫 Akku niedrig: " + pct + "%");
    }
  }
  setInterval(function () { var s = Math.floor((Date.now() - sessionStart) / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; $("battSession").textContent = (hh > 0 ? hh + ":" : "") + (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss; }, 1000);
  function applyPower(on) {
    powerSave = on; $("powerTgl").classList.toggle("on", on); LS.setItem("gg_power", on ? "1" : "0");
    if (hasNative()) { try { window.Android.setLocationInterval(on ? 8000 : 1000); } catch (e) {} }
    flugInterval = on ? 30000 : 15000; if (flugTimer) { clearInterval(flugTimer); flugTimer = setInterval(loadFlights, flugInterval); }
  }
  $("powerTgl").onclick = function () { applyPower(!powerSave); toast(powerSave ? "🍃 Energiesparmodus an." : "Energiesparmodus aus."); };
  if (powerSave) applyPower(true);
  $("battWarnTgl").onclick = function () { battWarnOn = !battWarnOn; this.classList.toggle("on", battWarnOn); LS.setItem("gg_battwarn", battWarnOn ? "1" : "0"); };
  $("battOptBtn").onclick = function () { if (hasNative()) { try { window.Android.requestIgnoreBatteryOptimization(); setTimeout(updateOptStatus, 1500); } catch (e) {} } else toast("Nur in der nativen App (APK)."); };
  function updateOptStatus() { if (hasNative()) { try { var ig = window.Android.isIgnoringBattery(); $("battOptHint").textContent = ig ? "✅ GeoGuard ist von der Akku-Optimierung ausgenommen." : "⚠️ Noch nicht ausgenommen – Hintergrund-Tracking kann beendet werden."; } catch (e) {} } }
  updateOptStatus();
  if (!hasNative() && navigator.getBattery) { navigator.getBattery().then(function (bat) { function upd() { updateBattery({ pct: Math.round(bat.level * 100), charging: bat.charging, plugged: bat.charging ? "USB" : "–", temp: 0, volt: 0, health: "–", tech: "–" }); } upd(); bat.addEventListener("levelchange", upd); bat.addEventListener("chargingchange", upd); }); }

  // ================= Verbindung, Hilfe, Reset =================
  function updateConn() { var on = navigator.onLine !== false, tag = $("connTag"); if (tag) { tag.textContent = on ? "online" : "offline"; tag.className = "conn " + (on ? "on" : "off"); } return on; }
  window.addEventListener("online", function () { updateConn(); toast("📡 Wieder online."); });
  window.addEventListener("offline", function () { updateConn(); toast("📡 Offline – Live-Funktionen pausiert."); });
  updateConn();

  function openHelp() { $("helpOverlay").classList.add("show"); }
  function closeHelp() { $("helpOverlay").classList.remove("show"); }
  $("logoBtn").onclick = openHelp;
  $("helpOpenBtn").onclick = openHelp;
  $("helpClose").onclick = closeHelp;

  // ===== Onboarding-Tour =====
  var tourSteps = [
    { i: "🛰️", t: "Willkommen bei GeoPilot", x: "Dein All-in-One-Begleiter für GPS, Kompass, Navigation, Tracking und Live-Flugradar – das Meiste funktioniert auch offline. Energiesparend: standardmäßig ist alles AUS." },
    { i: "🔋", t: "An/Aus spart Strom", x: "Oben rechts ist der Schalter (Aus/Aktiv) bzw. ▶︎ Start. GPS & Sensoren laufen nur, wenn du sie startest – und stoppen automatisch, sobald du die App verlässt. So frisst nichts unbemerkt Akku." },
    { i: "🧭", t: "Dashboard", x: "Kompass mit Live-Karte und Richtungspfeil, dazu Tempo, Höhe, Kurs und Genauigkeit auf einen Blick. Tippe auf eine Überschrift, um Details (Koordinaten, Himmel, Wetter) zu öffnen." },
    { i: "🗺️", t: "Karte", x: "Deine Live-Position auf der Karte. Du kannst Kartenausschnitte herunterladen, um sie offline zu nutzen." },
    { i: "🎯", t: "Ziel & Navigation", x: "Adresse suchen oder auf die Karte tippen, Modus wählen (🚗 Auto · 🚶 Fuß · 🚴 Rad) und losnavigieren – mit Sprachansagen, Alternativen und Ankunftszeit." },
    { i: "📍", t: "Tracking", x: "Strecke aufzeichnen mit großen Live-Werten, Höhenprofil und GPX-Export. Deine Touren bleiben gespeichert." },
    { i: "🛰️", t: "Satelliten", x: "GNSS-Status: sichtbare und genutzte Satelliten, Signalstärke und Systeme (GPS, Galileo, GLONASS …)." },
    { i: "✈️", t: "Flugradar", x: "Echte Flugzeuge live in deiner Umgebung – mit Route von→nach, Foto, Höhe/Tempo und flüssiger Verfolgung." },
    { i: "⚙️", t: "Mehr & Einstellungen", x: "Akku, Einheiten, helles/dunkles Design, Tabs an/aus zum Stromsparen und SOS. Tipp jederzeit aufs Logo 🛰️ für die Hilfe." }
  ];
  var tourIdx = 0;
  function renderTour() {
    var s = tourSteps[tourIdx];
    $("tourIcon").textContent = s.i; $("tourTitle").textContent = s.t; $("tourText").textContent = s.x;
    var dots = ""; for (var k = 0; k < tourSteps.length; k++) dots += '<i class="' + (k === tourIdx ? "on" : "") + '"></i>'; $("tourDots").innerHTML = dots;
    $("tourNext").textContent = tourIdx === tourSteps.length - 1 ? "Los geht's ✓" : "Weiter";
  }
  function startTour() { tourIdx = 0; renderTour(); $("tour").classList.add("show"); }
  function endTour() { $("tour").classList.remove("show"); LS.setItem("gg_tour", "1"); }
  $("tourNext").onclick = function () { if (tourIdx < tourSteps.length - 1) { tourIdx++; renderTour(); } else endTour(); };
  $("tourSkip").onclick = endTour;
  $("tourBtn").onclick = startTour;
  if (!LS.getItem("gg_tour")) setTimeout(startTour, 700);

  $("resetBtn").onclick = function () {
    if (!window.confirm("Alle Wegpunkte, Touren und Einstellungen auf diesem Gerät löschen?")) return;
    try { LS.clear(); } catch (e) {}
    try { indexedDB.deleteDatabase("geoguard"); } catch (e) {}
    toast("Zurückgesetzt – App wird neu geladen…");
    setTimeout(function () { location.reload(); }, 800);
  };

  // ================= Tabs an/aus (Energie sparen) =================
  function loadTabsCfg() { try { return JSON.parse(LS.getItem("gg_tabs") || "{}"); } catch (e) { return {}; } }
  function tabEnabled(t, cfg) { cfg = cfg || loadTabsCfg(); return cfg[t] !== false; }
  function applyTabs() {
    var cfg = loadTabsCfg();
    Array.prototype.forEach.call(nav.children, function (b) {
      var t = b.getAttribute("data-tab");
      b.style.display = (t === "dash" || t === "more" || tabEnabled(t, cfg)) ? "" : "none";
    });
    var active = nav.querySelector("button.sel");
    if (active && active.style.display === "none") switchTab("dash");
  }
  function buildTabToggles() {
    var c = $("tabToggles"); if (!c) return; c.innerHTML = ""; var cfg = loadTabsCfg();
    Array.prototype.forEach.call(nav.children, function (b) {
      var t = b.getAttribute("data-tab"); if (t === "dash" || t === "more") return;
      var row = document.createElement("div"); row.className = "switch";
      row.innerHTML = '<div class="t">' + escapeHtml(b.textContent.trim()) + "</div>";
      var tg = document.createElement("div"); tg.className = "toggle" + (tabEnabled(t, cfg) ? " on" : "");
      tg.onclick = function () { var c2 = loadTabsCfg(); c2[t] = !(c2[t] !== false); LS.setItem("gg_tabs", JSON.stringify(c2)); this.classList.toggle("on"); applyTabs(); };
      row.appendChild(tg); c.appendChild(row);
    });
  }
  $("tabsAll").onclick = function () { LS.setItem("gg_tabs", "{}"); buildTabToggles(); applyTabs(); toast("Alle Tabs aktiv."); };
  $("tabsTrackOnly").onclick = function () {
    var cfg = {};
    Array.prototype.forEach.call(nav.children, function (b) { var t = b.getAttribute("data-tab"); if (t === "dash" || t === "more") return; cfg[t] = (t === "tracking"); });
    LS.setItem("gg_tabs", JSON.stringify(cfg)); buildTabToggles(); applyTabs();
    if (typeof applyPower === "function" && !powerSave) applyPower(true);
    toast("🍃 Nur Tracking aktiv – Strom sparen.");
  };
  buildTabToggles(); applyTabs();
  if ($("tabsBtn")) $("tabsBtn").onclick = function () { buildTabToggles(); $("tabsOverlay").classList.add("show"); };
  if ($("tabsClose")) $("tabsClose").onclick = function () { $("tabsOverlay").classList.remove("show"); };

  // ================= Einklappbare Karten (Übersicht) =================
  (function setupCollapse() {
    var cards = document.querySelectorAll(".card.collapsible");
    Array.prototype.forEach.call(cards, function (card) {
      var title = card.querySelector(".section-title"); if (!title) return;
      var body = document.createElement("div"); body.className = "card-body";
      while (title.nextSibling) body.appendChild(title.nextSibling);
      card.appendChild(body);
      var key = "gg_col_" + title.textContent.replace(/[^a-zA-ZäöüÄÖÜ ]/g, "").trim().slice(0, 18);
      var ch = document.createElement("span"); ch.className = "chev"; ch.textContent = "▾"; title.appendChild(ch);
      var saved = LS.getItem(key);
      card.classList.toggle("open", saved != null ? saved === "1" : !card.classList.contains("collapsed"));
      title.addEventListener("click", function () { var o = !card.classList.contains("open"); card.classList.toggle("open", o); LS.setItem(key, o ? "1" : "0"); });
    });
  })();

  // ================= Start =================
  setTimeout(ensureCompassMap, 400);
  setStatus("", "Aus"); syncSwitch();
})();
