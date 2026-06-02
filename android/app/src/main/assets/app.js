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
  function setStatus(s, t) { $("dot").className = "dot " + (s || ""); $("statusText").textContent = t; }
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
    $("rose").style.transform = "rotate(" + (-smooth) + "deg)";
    $("hdgDeg").textContent = Math.round(smooth); $("hdgCard").textContent = cardinal(smooth);
    if (source) $("hdgSource").textContent = "Sensor: " + source + (northRef === "true" ? " · echt N" : " · magn. N");
    $("hudHdg").textContent = Math.round(smooth) + "° " + cardinal(smooth);
    updateNavArrow();
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
    function handler(e) { var h = null; if (e.webkitCompassHeading != null) h = e.webkitCompassHeading; else if (e.alpha != null) h = 360 - e.alpha; if (h != null) { usingWebSensor = true; lastRawHeading = h; updateHeading(h, e.webkitCompassHeading != null ? "iOS-Kompass" : "Orientierung"); } }
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().then(function (s) { if (s === "granted") window.addEventListener("deviceorientation", handler, true); }).catch(function () {});
    } else { window.addEventListener("deviceorientationabsolute", handler, true); window.addEventListener("deviceorientation", handler, true); }
  }
  function startTracking() { if (hasNative()) { try { window.Android.startLocation(); } catch (e) {} setStatus("warn", "Suche Signal…"); } else startWeb(); }
  function stopTracking() { if (hasNative()) { try { window.Android.stopLocation(); } catch (e) {} } if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } setStatus("", "Gestoppt"); }

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
    ["dash", "map", "nav", "tours", "sat", "flug", "more"].forEach(function (t) { $("page-" + t).classList.toggle("active", t === tab); });
    if (tab === "map") ensureMap();
    if (tab === "tours") drawProfile();
    if (tab === "flug") openFlug(); else pauseFlug();
  });
  function switchTab(tab) { var b = nav.querySelector('[data-tab="' + tab + '"]'); if (b) b.click(); }

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
    new OfflineLayer(TILE_URL, { maxZoom: 19 }).addTo(map);
    trackLine = L.polyline([], { color: "#0ea5e9", weight: 5, opacity: .85 }).addTo(map);
    map.on("dragstart", function () { followMe = false; });
    map.on("click", function (e) { setTarget(e.latlng.lat, e.latlng.lng, null); toast("Ziel auf Karte gesetzt."); });
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

  // ================= Track-Aufzeichnung =================
  var recording = false, track = [], trackDist = 0, trackStart = 0, maxSpeed = 0, recTimer = null;
  function recordPoint(p) {
    if (p.speed != null && !isNaN(p.speed) && p.speed > maxSpeed) maxSpeed = p.speed;
    if (!recording) return;
    var prev = track[track.length - 1];
    if (prev) trackDist += haversine(prev.lat, prev.lon, p.lat, p.lon);
    track.push({ lat: p.lat, lon: p.lon, alt: p.alt, t: p.time || Date.now() });
    if (trackLine) trackLine.addLatLng([p.lat, p.lon]);
    refreshTrackStats(); drawProfile();
  }
  function refreshTrackStats() {
    var d = fmtDist(trackDist); $("trkDist").textContent = d.v + " " + d.u;
    var secs = trackStart ? Math.floor((Date.now() - trackStart) / 1000) : 0, mm = Math.floor(secs / 60), ss = secs % 60;
    $("trkTime").textContent = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
    var avg = secs > 0 ? trackDist / secs : 0;
    $("trkSpd").textContent = fmtSpeed(avg) + " / " + fmtSpeed(maxSpeed);
    updateTrip();
  }
  $("recBtn").onclick = function () {
    recording = !recording; var b = $("recBtn");
    if (recording) {
      if (track.length === 0) { trackDist = 0; trackStart = Date.now(); maxSpeed = 0; if (trackLine) trackLine.setLatLngs([]); }
      b.textContent = "⏸ Pause"; b.className = "b-danger"; recTimer = setInterval(refreshTrackStats, 1000);
      startTracking();
    } else { b.textContent = "⏺ Rec"; b.className = "b-success"; if (recTimer) { clearInterval(recTimer); recTimer = null; } }
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
    var s = trackStats(track), d = fmtDist(s.dist), mm = Math.floor(s.moveSec / 60), ss = Math.floor(s.moveSec % 60);
    $("tcDist").textContent = d.v + " " + d.u;
    $("tcMove").textContent = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
    $("tcUp").textContent = fmtAlt(s.up); $("tcDown").textContent = fmtAlt(s.down);
  }
  var profilePts = null;
  function drawProfile() {
    var pts = profilePts || track, cv = $("profile"); if (!cv) return; var ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    var alts = pts.filter(function (p) { return p.alt != null && !isNaN(p.alt); });
    if (alts.length < 2) { ctx.fillStyle = "#94a3b8"; ctx.font = "16px sans-serif"; ctx.fillText("Keine Höhendaten", 12, H / 2); return; }
    var min = Math.min.apply(null, alts.map(function (p) { return p.alt; })), max = Math.max.apply(null, alts.map(function (p) { return p.alt; }));
    if (max - min < 1) max = min + 1;
    var cum = [0]; for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon));
    var total = cum[cum.length - 1] || 1;
    ctx.beginPath();
    for (var j = 0; j < pts.length; j++) { if (pts[j].alt == null || isNaN(pts[j].alt)) continue; var x = cum[j] / total * W, y = H - (pts[j].alt - min) / (max - min) * (H - 10) - 5; if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    var grd = ctx.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, "rgba(14,165,233,.55)"); grd.addColorStop(1, "rgba(14,165,233,.04)"); ctx.fillStyle = grd; ctx.fill();
    ctx.fillStyle = "#94a3b8"; ctx.font = "11px sans-serif"; ctx.fillText(Math.round(max) + " m", 4, 12); ctx.fillText(Math.round(min) + " m", 4, H - 4);
  }

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
    profilePts = tr.pts; switchTab("tours"); drawProfile();
    var s = trackStats(tr.pts), d = fmtDist(s.dist), mm = Math.floor(s.moveSec / 60), ss = Math.floor(s.moveSec % 60);
    $("tcDist").textContent = d.v + " " + d.u; $("tcMove").textContent = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss; $("tcUp").textContent = fmtAlt(s.up); $("tcDown").textContent = fmtAlt(s.down);
    ensureMap();
    setTimeout(function () {
      if (!map) return; if (viewLine) map.removeLayer(viewLine);
      viewLine = L.polyline(tr.pts.map(function (p) { return [p.lat, p.lon]; }), { color: "#f43f5e", weight: 4 }).addTo(map);
      followMe = false; map.fitBounds(viewLine.getBounds(), { padding: [30, 30] });
      toast("Tour „" + tr.name + "“ auf der Karte.");
    }, 120);
  }

  // ================= Navigation + Wegpunkte =================
  var target = null; try { target = JSON.parse(LS.getItem("gg_target") || "null"); } catch (e) {}
  function setTarget(lat, lon, name) {
    target = { lat: lat, lon: lon, name: name || null }; LS.setItem("gg_target", JSON.stringify(target)); geoAlerted = false;
    $("navTarget").textContent = (name ? name + " · " : "") + lat.toFixed(5) + ", " + lon.toFixed(5);
    if (map) { var ll = [lat, lon]; if (!targetMarker) targetMarker = L.marker(ll).addTo(map); else targetMarker.setLatLng(ll); }
    updateNavArrow();
  }
  function relDir(rel) { rel = (rel + 360) % 360; if (rel < 22 || rel >= 338) return "geradeaus"; if (rel < 68) return "leicht rechts"; if (rel < 112) return "rechts"; if (rel < 158) return "scharf rechts"; if (rel < 202) return "zurück"; if (rel < 248) return "scharf links"; if (rel < 292) return "links"; return "leicht links"; }
  function updateNavArrow() {
    if (!target || !lastFix) return;
    var dist = haversine(lastFix.lat, lastFix.lon, target.lat, target.lon), brg = bearing(lastFix.lat, lastFix.lon, target.lat, target.lon);
    var d = fmtDist(dist); $("navDist").textContent = d.v; $("navDistU").textContent = d.u; $("navBear").textContent = Math.round(brg) + " " + cardinal(brg);
    var rel = (smooth != null) ? (brg - smooth) : brg; $("taPointer").style.transform = "rotate(" + rel + "deg)";
  }
  $("setTargetBtn").onclick = function () { var la = parseFloat($("inLat").value), lo = parseFloat($("inLon").value); if (isNaN(la) || isNaN(lo)) { toast("Bitte gültige Koordinaten."); return; } setTarget(la, lo, null); toast("Ziel gesetzt."); };
  $("saveWpBtn").onclick = function () { if (!lastFix) { toast("Noch keine Position."); return; } var name = prompt("Name des Wegpunkts:", "Wegpunkt " + (loadWps().length + 1)); if (name == null) return; var wps = loadWps(); wps.push({ lat: lastFix.lat, lon: lastFix.lon, name: name || ("WP " + (wps.length + 1)) }); LS.setItem("gg_wps", JSON.stringify(wps)); renderWps(); };
  function loadWps() { try { return JSON.parse(LS.getItem("gg_wps") || "[]"); } catch (e) { return []; } }
  function renderWps() {
    var wps = loadWps(), c = $("wpList"); if (!wps.length) { c.innerHTML = '<div class="hint">Noch keine Wegpunkte.</div>'; return; } c.innerHTML = "";
    wps.forEach(function (w, i) {
      var row = document.createElement("div"); row.className = "wp-item";
      row.innerHTML = '<div style="flex:1"><div class="nm">' + escapeHtml(w.name) + '</div><div class="co">' + w.lat.toFixed(5) + ", " + w.lon.toFixed(5) + "</div></div>";
      var go = document.createElement("button"); go.className = "b-primary"; go.textContent = "🎯"; go.onclick = function () { setTarget(w.lat, w.lon, w.name); toast("Ziel: " + w.name); };
      var del = document.createElement("button"); del.className = "b-soft"; del.textContent = "🗑"; del.onclick = function () { var a = loadWps(); a.splice(i, 1); LS.setItem("gg_wps", JSON.stringify(a)); renderWps(); };
      row.appendChild(go); row.appendChild(del); c.appendChild(row);
    });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (m) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]; }); }
  if (target) $("navTarget").textContent = (target.name ? target.name + " · " : "") + target.lat.toFixed(5) + ", " + target.lon.toFixed(5);
  renderWps(); renderTours();

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
      go.onclick = function () { setTarget(r.lat, r.lon, r.name.split(",")[0]); toast("Ziel: " + r.name.split(",")[0]); ensureMap(); if (map) { followMe = false; map.setView([r.lat, r.lon], 15); } };
      row.appendChild(go); c.appendChild(row);
    });
  }
  $("addrBtn").onclick = doSearch;
  $("addrInput").addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });

  // ================= Navigation (Valhalla, mehrmodal) =================
  var routeLine = null, routeSteps = [], routeStepIdx = 0, routeShape = [], navActive = false, lastReroute = 0, pendingNavStart = false;
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
  function navArrowFor(instr) {
    var s = (instr || "").toLowerCase();
    if (s.indexOf("ziel") >= 0 || s.indexOf("angekommen") >= 0) return "🏁";
    if (s.indexOf("kreisverkehr") >= 0) return "🔄";
    if (s.indexOf("scharf links") >= 0) return "↰"; if (s.indexOf("scharf rechts") >= 0) return "↱";
    if (s.indexOf("links") >= 0) return "⬅️"; if (s.indexOf("rechts") >= 0) return "➡️";
    if (s.indexOf("wenden") >= 0 || s.indexOf("umkehr") >= 0) return "↩️";
    return "⬆️";
  }
  function fmtDur(secs) { var m = Math.round(secs / 60); if (m < 60) return m + " min"; return Math.floor(m / 60) + " h " + (m % 60) + " min"; }
  function calcRoute() {
    if (!target || !lastFix) { toast("Erst Ziel und Position nötig."); return; }
    if (!needOnline()) { $("rtDist").textContent = "--"; $("rtTime").textContent = "--"; return; }
    $("rtDist").textContent = "…"; $("rtTime").textContent = "…";
    var body = { locations: [{ lat: lastFix.lat, lon: lastFix.lon }, { lat: target.lat, lon: target.lon }], costing: navMode, directions_options: { language: "de", units: "kilometers" } };
    var url = "https://valhalla1.openstreetmap.de/route?json=" + encodeURIComponent(JSON.stringify(body));
    httpJson(url).then(function (j) {
      if (!j || !j.trip || !j.trip.legs || !j.trip.legs.length) { osrmFallback(); return; }
      var leg = j.trip.legs[0];
      routeShape = decodePolyline(leg.shape, 6);
      routeSteps = (leg.maneuvers || []).map(function (m) { return { instr: m.instruction || "weiter", dist: (m.length || 0) * 1000, time: m.time || 0, loc: routeShape[m.begin_shape_index] || [lastFix.lat, lastFix.lon], _ann: false }; });
      routeStepIdx = 0; showRoute((leg.summary.length || 0) * 1000, leg.summary.time || 0);
    });
  }
  function osrmFallback() {
    if (navMode !== "auto") { toast("Route nicht gefunden (oder offline)."); $("rtDist").textContent = "--"; $("rtTime").textContent = "--"; return; }
    var url = "https://router.project-osrm.org/route/v1/driving/" + lastFix.lon + "," + lastFix.lat + ";" + target.lon + "," + target.lat + "?overview=full&geometries=geojson&steps=true";
    httpJson(url).then(function (j) {
      if (!j || j.code !== "Ok" || !j.routes || !j.routes.length) { toast("Route nicht gefunden (oder offline)."); $("rtDist").textContent = "--"; $("rtTime").textContent = "--"; return; }
      var rt = j.routes[0]; routeShape = rt.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
      var steps = (rt.legs && rt.legs[0] && rt.legs[0].steps) ? rt.legs[0].steps : [];
      routeSteps = steps.map(function (s) { var mo = (s.maneuver && s.maneuver.modifier) || "", nm = s.name || ""; var dir = { left: "links", right: "rechts", "slight left": "leicht links", "slight right": "leicht rechts", "sharp left": "scharf links", "sharp right": "scharf rechts", straight: "geradeaus", uturn: "wenden" }[mo] || ""; return { instr: ("Weiter " + dir).trim() + (nm ? " auf " + nm : ""), dist: s.distance, time: s.duration, loc: [s.maneuver.location[1], s.maneuver.location[0]], _ann: false }; });
      routeStepIdx = 0; showRoute(rt.distance, rt.duration);
    });
  }
  function showRoute(dist, secs) {
    var d = fmtDist(dist); $("rtDist").textContent = d.v + " " + d.u; $("rtTime").textContent = fmtDur(secs);
    ensureMap();
    setTimeout(function () { if (!map) return; if (routeLine) map.removeLayer(routeLine); routeLine = L.polyline(routeShape, { color: "#6366f1", weight: 6, opacity: .9 }).addTo(map); if (!navActive) { followMe = false; map.fitBounds(routeLine.getBounds(), { padding: [30, 30] }); } }, 100);
    renderSteps();
    if (voiceOn) speak("Route berechnet. " + (Math.round(dist / 100) / 10) + " Kilometer, " + fmtDur(secs) + ".");
    if (pendingNavStart) { pendingNavStart = false; startNav(); }
  }
  function renderSteps() {
    var c = $("steps"); if (!routeSteps.length) { c.innerHTML = ""; return; } c.innerHTML = "";
    routeSteps.forEach(function (s, i) { var d = fmtDist(s.dist), row = document.createElement("div"); row.className = "wp-item"; if (i === routeStepIdx) row.style.borderColor = "var(--primary)"; row.innerHTML = '<div style="flex:1"><div class="nm" style="font-size:.82rem">' + navArrowFor(s.instr) + " " + escapeHtml(s.instr) + '</div><div class="co">' + d.v + " " + d.u + '</div></div>'; c.appendChild(row); });
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
      var eta = remaining(), ed = fmtDist(eta.dist), arr = new Date(Date.now() + eta.time * 1000);
      var nxt = routeSteps[routeStepIdx + 1] || s;
      $("nbArrow").textContent = navArrowFor(nxt.instr); $("nbInstr").textContent = nxt.instr;
      var dd = fmtDist(dToMan); $("nbDist").textContent = "in " + dd.v + " " + dd.u;
      $("nbEta").textContent = "Ankunft ~" + arr.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " · noch " + ed.v + " " + ed.u + " · " + fmtDur(eta.time);
      if (map) { followMe = true; map.setView([lastFix.lat, lastFix.lon], Math.max(map.getZoom(), 16)); }
      if (routeShape.length && distToRoute(lastFix.lat, lastFix.lon) > 60 && Date.now() - lastReroute > 8000) { lastReroute = Date.now(); toast("Route wird neu berechnet…"); if (voiceOn) speak("Route wird neu berechnet."); calcRoute(); return; }
    }
    if (dToMan < 30 && routeStepIdx < routeSteps.length - 1) { routeStepIdx++; renderSteps(); var ns = routeSteps[routeStepIdx]; if (voiceOn && ns) speak(ns.instr); }
    else if (voiceOn && dToMan < 180 && !s._ann) { s._ann = true; var d2 = fmtDist(dToMan); speak("In " + d2.v + " " + (d2.u === "km" ? "Kilometern" : "Metern") + ": " + s.instr); }
  }
  function startNav() { if (!routeSteps.length) { pendingNavStart = true; calcRoute(); return; } navActive = true; $("navBanner").classList.add("show"); $("navStartBtn").textContent = "⏹ Navigation läuft"; switchTab("map"); if (voiceOn) speak("Navigation gestartet."); routeProgress(); }
  function stopNav() { navActive = false; $("navBanner").classList.remove("show"); $("navStartBtn").textContent = "▶︎ Navigation starten"; }
  $("routeBtn").onclick = function () { calcRoute(); };
  $("navStartBtn").onclick = function () { if (navActive) stopNav(); else startNav(); };
  $("navStopBtn").onclick = stopNav;
  $("routeClearBtn").onclick = function () { stopNav(); if (routeLine && map) map.removeLayer(routeLine); routeLine = null; routeSteps = []; routeShape = []; $("steps").innerHTML = ""; $("rtDist").textContent = "--"; $("rtTime").textContent = "--"; };

  // ================= Flugradar (eigener Tab – echte ADS-B-Daten) =================
  var flugMap = null, flugLayer = null, flugTimer = null, flugInterval = 15000, flugAutoOn = true, flugVisible = false, followFlugHex = null;
  function isEmergency(sq) { return sq === "7500" || sq === "7600" || sq === "7700"; }
  function planeIcon(track, emerg) { return L.divIcon({ className: "", html: '<div style="font-size:22px;line-height:1;transform:rotate(' + ((track || 0) - 45) + 'deg);filter:drop-shadow(0 0 ' + (emerg ? "5px #ef4444" : "2px #000") + ')">✈️</div>', iconSize: [24, 24], iconAnchor: [12, 12] }); }
  function ensureFlugMap() {
    if (flugMap || typeof L === "undefined") { if (flugMap) setTimeout(function () { flugMap.invalidateSize(); }, 50); return; }
    var c = lastFix ? [lastFix.lat, lastFix.lon] : [51.1657, 10.4515];
    flugMap = L.map("flugMap", { zoomControl: true, attributionControl: false }).setView(c, lastFix ? 9 : 5);
    new OfflineLayer(TILE_URL, { maxZoom: 19 }).addTo(flugMap);
    flugLayer = L.layerGroup().addTo(flugMap);
    flugMap.on("moveend", function () { if (flugVisible) loadFlights(); });
    setTimeout(function () { flugMap.invalidateSize(); }, 60);
  }
  function openFlug() { flugVisible = true; ensureFlugMap(); loadFlights(); if (flugAutoOn) { if (flugTimer) clearInterval(flugTimer); flugTimer = setInterval(loadFlights, flugInterval); } }
  function pauseFlug() { flugVisible = false; if (flugTimer) { clearInterval(flugTimer); flugTimer = null; } }
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
      if (!j || !j.states) { if (flugLayer) flugLayer.clearLayers(); $("flugCount").textContent = "0"; $("flugList").innerHTML = '<div class="hint">Keine Daten (oder offline).</div>'; return; }
      renderFlights(j.states.map(function (s) { var altM = (s[13] != null ? s[13] : s[7]); return { hex: s[0], flight: (s[1] || "").trim() || s[0], reg: "", type: "", lat: s[6], lon: s[5], onground: s[8], alt: (altM != null ? Math.round(altM * 3.28084) : null), gsKmh: (s[9] != null ? Math.round(s[9] * 3.6) : null), trk: s[10], squawk: s[14] || "", rate: (s[11] != null ? Math.round(s[11] * 196.85) : null) }; }));
    });
  }
  function renderFlights(planes) {
    if (flugLayer) flugLayer.clearLayers();
    var list = $("flugList");
    planes = planes.filter(function (p) { return p.lat != null && p.lon != null && !p.onground; });
    $("flugCount").textContent = planes.length;
    planes.forEach(function (p) {
      p.distKm = lastFix ? haversine(lastFix.lat, lastFix.lon, p.lat, p.lon) / 1000 : null;
      var emerg = isEmergency(p.squawk);
      var m = L.marker([p.lat, p.lon], { icon: planeIcon(p.trk, emerg) }).addTo(flugLayer);
      m.bindPopup("<b>✈ " + escapeHtml(p.flight) + "</b>" + (p.reg ? " (" + escapeHtml(p.reg) + ")" : "") +
        (p.type ? "<br>Typ: " + escapeHtml(p.type) : "") +
        "<br>Höhe: " + (p.alt != null ? p.alt.toLocaleString("de-DE") + " ft" : "–") +
        "<br>Tempo: " + (p.gsKmh != null ? p.gsKmh + " km/h" : "–") +
        "<br>Kurs: " + (p.trk != null ? Math.round(p.trk) + "°" : "–") +
        (p.rate != null && Math.abs(p.rate) > 50 ? "<br>" + (p.rate > 0 ? "⬆ steigt " : "⬇ sinkt ") + Math.abs(p.rate) + " ft/min" : "") +
        (p.squawk ? "<br>Squawk: " + p.squawk : "") +
        (p.distKm != null ? "<br>Entfernung: " + p.distKm.toFixed(1) + " km" : "") +
        (emerg ? '<br><b style="color:#ef4444">⚠ NOTFALL-CODE</b>' : ""));
      if (followFlugHex && p.hex === followFlugHex) { flugMap.panTo([p.lat, p.lon]); m.openPopup(); }
    });
    if (lastFix) planes.sort(function (a, b) { return (a.distKm || 1e9) - (b.distKm || 1e9); });
    else planes.sort(function (a, b) { return (b.alt || 0) - (a.alt || 0); });
    if (!planes.length) { list.innerHTML = '<div class="hint">Keine Flugzeuge im Bereich. Karte verschieben oder rauszoomen.</div>'; return; }
    list.innerHTML = "";
    planes.slice(0, 50).forEach(function (p) {
      var emerg = isEmergency(p.squawk), row = document.createElement("div"); row.className = "wp-item";
      if (emerg) row.style.borderColor = "var(--danger)"; if (followFlugHex === p.hex) row.style.borderColor = "var(--primary)";
      row.innerHTML = '<div style="flex:1"><div class="nm">✈ ' + escapeHtml(p.flight) + (p.reg ? ' <span style="color:var(--text-muted);font-weight:400">' + escapeHtml(p.reg) + '</span>' : "") + (emerg ? ' <span style="color:var(--danger)">⚠</span>' : "") + '</div><div class="co">' + (p.type ? escapeHtml(p.type) + " · " : "") + (p.alt != null ? p.alt.toLocaleString("de-DE") + " ft" : "–") + " · " + (p.gsKmh != null ? p.gsKmh + " km/h" : "–") + (p.distKm != null ? " · " + p.distKm.toFixed(0) + " km" : "") + '</div></div>';
      var go = document.createElement("button"); go.className = "b-primary"; go.textContent = "🎯";
      go.onclick = function () { if (followFlugHex === p.hex) { followFlugHex = null; toast("Verfolgung beendet."); } else { followFlugHex = p.hex; flugMap.setView([p.lat, p.lon], Math.max(flugMap.getZoom(), 9)); toast("Folge ✈ " + p.flight); } };
      row.appendChild(go); list.appendChild(row);
    });
  }
  $("flugRefresh").onclick = function () { loadFlights(); };
  $("flugAuto").onclick = function () { flugAutoOn = !flugAutoOn; this.textContent = "⏯ Auto-Refresh: " + (flugAutoOn ? "an" : "aus"); this.className = flugAutoOn ? "b-success" : "b-soft"; if (flugAutoOn) { if (flugVisible) { loadFlights(); flugTimer = setInterval(loadFlights, flugInterval); } } else if (flugTimer) { clearInterval(flugTimer); flugTimer = null; } };

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

  // ================= Einstellungen =================
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); $("themeTgl").classList.toggle("on", t === "light"); $("nightTgl").classList.toggle("on", t === "night"); LS.setItem("gg_theme", t); var mc = document.querySelector('meta[name=theme-color]'); if (mc) mc.setAttribute("content", t === "night" ? "#000000" : t === "light" ? "#f1f5f9" : "#0f172a"); }
  applyTheme(LS.getItem("gg_theme") || "dark");
  $("themeTgl").onclick = function () { applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light"); };
  $("nightTgl").onclick = function () { applyTheme(document.documentElement.getAttribute("data-theme") === "night" ? "dark" : "night"); };

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
  if (!LS.getItem("gg_seen")) { LS.setItem("gg_seen", "1"); setTimeout(openHelp, 700); }

  $("resetBtn").onclick = function () {
    if (!window.confirm("Alle Wegpunkte, Touren und Einstellungen auf diesem Gerät löschen?")) return;
    try { LS.clear(); } catch (e) {}
    try { indexedDB.deleteDatabase("geoguard"); } catch (e) {}
    toast("Zurückgesetzt – App wird neu geladen…");
    setTimeout(function () { location.reload(); }, 800);
  };

  // ================= Start =================
  if (hasNative()) { setStatus("warn", "Initialisiere…"); try { window.Android.startLocation(); } catch (e) {} } else setStatus("", "Bereit – Tracking starten");
})();
