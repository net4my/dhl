/* GeoGuard – App-Logik (offline). Funktioniert nativ (Android-Bridge) und als Web/PWA. */
(function () {
  "use strict";

  // ---------- Hilfen ----------
  var $ = function (id) { return document.getElementById(id); };
  var LS = window.localStorage;
  function hasNative() { return typeof window.Android !== "undefined" && window.Android; }
  function toast(msg) {
    if (hasNative()) { try { window.Android.toast(msg); return; } catch (e) {} }
    var h = $("hint"); if (h) h.innerHTML = msg;
  }

  // ---------- Einheiten ----------
  var units = LS.getItem("gg_units") || "metric";
  function isImp() { return units === "imperial"; }
  function fmtSpeed(ms) { // m/s -> Anzeige
    if (ms == null || isNaN(ms)) return "--";
    return (ms * (isImp() ? 2.23694 : 3.6)).toFixed(1);
  }
  function fmtAlt(m) {
    if (m == null || isNaN(m)) return "--";
    return (m * (isImp() ? 3.28084 : 1)).toFixed(0);
  }
  function fmtDist(m) { // Meter -> {v,u}
    if (m == null || isNaN(m)) return { v: "--", u: "m" };
    if (isImp()) {
      var ft = m * 3.28084;
      return ft < 1000 ? { v: ft.toFixed(0), u: "ft" } : { v: (m / 1609.344).toFixed(2), u: "mi" };
    }
    return m < 1000 ? { v: m.toFixed(0), u: "m" } : { v: (m / 1000).toFixed(2), u: "km" };
  }
  function applyUnitLabels() {
    $("spdU").textContent = isImp() ? "mph" : "km/h";
    $("altU").textContent = isImp() ? "ft" : "m";
  }

  // ---------- Geo-Mathematik ----------
  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }
  function haversine(a, b, c, d) { // lat1,lon1,lat2,lon2 -> Meter
    var R = 6371000, dLat = toRad(c - a), dLon = toRad(d - b);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  function bearing(a, b, c, d) {
    var y = Math.sin(toRad(d - b)) * Math.cos(toRad(c));
    var x = Math.cos(toRad(a)) * Math.sin(toRad(c)) - Math.sin(toRad(a)) * Math.cos(toRad(c)) * Math.cos(toRad(d - b));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  function cardinal(deg) {
    var dirs = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round((deg % 360) / 22.5) % 16];
  }
  function toDMS(value, isLat) {
    var hemi = isLat ? (value >= 0 ? "N" : "S") : (value >= 0 ? "O" : "W");
    value = Math.abs(value);
    var dd = Math.floor(value), mf = (value - dd) * 60, mm = Math.floor(mf), ss = ((mf - mm) * 60).toFixed(1);
    return dd + "° " + mm + "' " + ss + '" ' + hemi;
  }
  function fmt(v, dec) { return (v == null || isNaN(v)) ? "--" : Number(v).toFixed(dec); }

  // ---------- Status ----------
  function setStatus(state, text) { $("dot").className = "dot " + (state || ""); $("statusText").textContent = text; }

  // ---------- Kompass-Skala ----------
  (function () {
    var ticks = $("ticks");
    for (var d = 0; d < 360; d += 15) {
      var t = document.createElement("div");
      t.className = "tick" + (d % 45 === 0 ? " major" : "");
      t.style.transform = "translate(-50%,-100%) rotate(" + d + "deg)";
      t.innerHTML = "<i></i>"; ticks.appendChild(t);
    }
    [["N", 0, "N"], ["O", 90, ""], ["S", 180, ""], ["W", 270, ""]].forEach(function (c) {
      var el = document.createElement("div");
      el.className = "card-letter " + c[2];
      el.style.transform = "translate(-50%,-50%) rotate(" + c[1] + "deg)";
      el.innerHTML = "<span>" + c[0] + "</span>"; ticks.appendChild(el);
    });
  })();

  // ---------- Heading ----------
  var heading = null, smooth = null, nativeHeadingSeen = false, usingWebSensor = false;
  function updateHeading(deg, source) {
    if (deg == null || isNaN(deg)) return;
    deg = (deg % 360 + 360) % 360; heading = deg;
    if (smooth == null) smooth = deg;
    else { var diff = ((deg - smooth + 540) % 360) - 180; smooth = (smooth + diff * 0.18 + 360) % 360; }
    $("rose").style.transform = "rotate(" + (-smooth) + "deg)";
    $("hdgDeg").textContent = Math.round(smooth);
    $("hdgCard").textContent = cardinal(smooth);
    if (source) $("hdgSource").textContent = "Sensor: " + source;
    updateNavArrow();
  }

  // ---------- Position ----------
  var lastFix = null;
  function updateLocation(p) {
    lastFix = p;
    $("lat").textContent = fmt(p.lat, 6);
    $("lon").textContent = fmt(p.lon, 6);
    $("alt").textContent = fmtAlt(p.alt);
    $("spd").textContent = fmtSpeed(p.speed);
    $("course").textContent = (p.bearing != null && !isNaN(p.bearing)) ? Math.round(p.bearing) : "--";
    $("provider").textContent = p.provider || "GPS";
    $("dms").textContent = toDMS(p.lat, true) + "  /  " + toDMS(p.lon, false);
    $("ts").textContent = new Date(p.time || Date.now()).toLocaleTimeString("de-DE");

    var acc = p.acc, fill = $("accFill"), q = $("fixQuality");
    $("accVal").textContent = (acc != null && !isNaN(acc)) ? Math.round(acc) : "--";
    if (acc != null && !isNaN(acc)) {
      fill.style.width = Math.max(6, Math.min(100, 100 - (acc / 50 * 100))) + "%";
      var col, lab;
      if (acc <= 8) { col = "var(--success)"; lab = "SEHR GENAU"; }
      else if (acc <= 20) { col = "var(--primary)"; lab = "GUT"; }
      else if (acc <= 50) { col = "var(--warning)"; lab = "MITTEL"; }
      else { col = "var(--danger)"; lab = "UNGENAU"; }
      fill.style.background = col; q.textContent = lab;
    }
    if (usingWebSensor === false && nativeHeadingSeen === false && p.bearing != null && !isNaN(p.bearing))
      updateHeading(p.bearing, "GPS-Kurs");

    setStatus("live", "Aktiv");
    onMapLocation(p);
    recordPoint(p);
    updateNavArrow();
  }

  // ---------- Native Bridge ----------
  window.onNativeLocation = function (j) {
    if (j == null) { setStatus("err", "Keine Freigabe"); return; }
    try { updateLocation(typeof j === "string" ? JSON.parse(j) : j); } catch (e) {}
  };
  window.onNativeHeading = function (deg) { nativeHeadingSeen = true; updateHeading(Number(deg), "Magnetometer"); };
  window.onNativeGnss = function (j) { try { updateGnss(typeof j === "string" ? JSON.parse(j) : j); } catch (e) {} };

  // ---------- Web-Fallback ----------
  var watchId = null;
  function startWeb() {
    if (!("geolocation" in navigator)) { setStatus("err", "Kein GPS"); return; }
    setStatus("warn", "Suche Signal…");
    watchId = navigator.geolocation.watchPosition(function (pos) {
      var c = pos.coords;
      updateLocation({ lat: c.latitude, lon: c.longitude, alt: c.altitude, acc: c.accuracy, speed: c.speed, bearing: c.heading, time: pos.timestamp, provider: "GPS (Web)" });
    }, function (err) { setStatus("err", "Fehler"); toast("Standort-Fehler: " + err.message); },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    enableWebCompass();
  }
  function enableWebCompass() {
    function handler(e) {
      var h = null;
      if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
      else if (e.alpha != null) h = 360 - e.alpha;
      if (h != null) { usingWebSensor = true; updateHeading(h, e.webkitCompassHeading != null ? "iOS-Kompass" : "Orientierung"); }
    }
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().then(function (s) { if (s === "granted") window.addEventListener("deviceorientation", handler, true); }).catch(function () {});
    } else {
      window.addEventListener("deviceorientationabsolute", handler, true);
      window.addEventListener("deviceorientation", handler, true);
    }
  }

  function startTracking() {
    if (hasNative()) { try { window.Android.startLocation(); } catch (e) {} setStatus("warn", "Suche Signal…"); }
    else startWeb();
  }
  function stopTracking() {
    if (hasNative()) { try { window.Android.stopLocation(); } catch (e) {} }
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    setStatus("", "Gestoppt");
  }

  // ---------- Dashboard-Buttons ----------
  $("startBtn").onclick = startTracking;
  $("stopBtn").onclick = stopTracking;
  $("copyBtn").onclick = function () {
    if (!lastFix) { toast("Noch keine Position."); return; }
    var t = lastFix.lat.toFixed(6) + ", " + lastFix.lon.toFixed(6);
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast("Kopiert: " + t); });
    else toast(t);
  };
  $("calibBtn").onclick = function () { smooth = null; toast("Gerät in liegender Acht (∞) bewegen."); if (!hasNative()) enableWebCompass(); };

  function shareLocation() {
    if (!lastFix) { toast("Noch keine Position."); return; }
    var url = "https://www.openstreetmap.org/?mlat=" + lastFix.lat + "&mlon=" + lastFix.lon + "#map=17/" + lastFix.lat + "/" + lastFix.lon;
    var txt = "Mein Standort: " + lastFix.lat.toFixed(6) + ", " + lastFix.lon.toFixed(6) + " " + url;
    if (navigator.share) navigator.share({ title: "Mein Standort", text: txt }).catch(function () {});
    else if (hasNative()) { try { window.Android.share(txt); } catch (e) {} }
    else toast(url);
  }
  $("shareBtn").onclick = shareLocation;
  $("sosBtn").onclick = function () {
    var txt = lastFix ? ("NOTFALL! Ich brauche Hilfe. Mein Standort: " + lastFix.lat.toFixed(6) + ", " + lastFix.lon.toFixed(6) +
      " https://www.openstreetmap.org/?mlat=" + lastFix.lat + "&mlon=" + lastFix.lon + "#map=17/" + lastFix.lat + "/" + lastFix.lon)
      : "NOTFALL! Ich brauche Hilfe. (Standort noch unbekannt)";
    if (hasNative()) { try { window.Android.sos(txt); return; } catch (e) {} }
    if (navigator.share) navigator.share({ text: txt }).catch(function () {});
    else { window.location.href = "sms:?body=" + encodeURIComponent(txt); }
  };

  // ---------- Tabs ----------
  var nav = $("nav");
  nav.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var tab = b.getAttribute("data-tab");
    Array.prototype.forEach.call(nav.children, function (c) { c.classList.toggle("sel", c === b); });
    ["dash", "map", "nav", "sat", "more"].forEach(function (t) { $("page-" + t).classList.toggle("active", t === tab); });
    if (tab === "map") ensureMap();
  });

  // ---------- Karte (Leaflet) ----------
  var map = null, meMarker = null, accCircle = null, trackLine = null, targetMarker = null, followMe = true;
  function ensureMap() {
    if (map || typeof L === "undefined") { if (map) setTimeout(function () { map.invalidateSize(); }, 50); return; }
    map = L.map("map", { zoomControl: true, attributionControl: false }).setView([51.1657, 10.4515], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    trackLine = L.polyline([], { color: "#0ea5e9", weight: 5, opacity: .85 }).addTo(map);
    map.on("dragstart", function () { followMe = false; });
    if (lastFix) onMapLocation(lastFix);
    setTimeout(function () { map.invalidateSize(); }, 60);
  }
  function onMapLocation(p) {
    if (!map) return;
    var ll = [p.lat, p.lon];
    if (!meMarker) {
      meMarker = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: "#0ea5e9", fillOpacity: 1 }).addTo(map);
      accCircle = L.circle(ll, { radius: p.acc || 0, color: "#0ea5e9", weight: 1, fillOpacity: .08 }).addTo(map);
    } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(p.acc || 0); }
    if (followMe) map.setView(ll, Math.max(map.getZoom(), 16));
  }
  $("centerBtn").onclick = function () { followMe = true; if (map && lastFix) map.setView([lastFix.lat, lastFix.lon], 17); };

  // ---------- Track-Aufzeichnung ----------
  var recording = false, track = [], trackDist = 0, trackStart = 0, maxSpeed = 0, recTimer = null;
  function recordPoint(p) {
    if (p.speed != null && !isNaN(p.speed) && p.speed > maxSpeed) maxSpeed = p.speed;
    if (!recording) return;
    var prev = track[track.length - 1];
    if (prev) trackDist += haversine(prev.lat, prev.lon, p.lat, p.lon);
    track.push({ lat: p.lat, lon: p.lon, alt: p.alt, t: p.time || Date.now() });
    if (trackLine) trackLine.addLatLng([p.lat, p.lon]);
    refreshTrackStats();
  }
  function refreshTrackStats() {
    var d = fmtDist(trackDist); $("trkDist").textContent = d.v + " " + d.u;
    var secs = trackStart ? Math.floor((Date.now() - trackStart) / 1000) : 0;
    var mm = Math.floor(secs / 60), ss = secs % 60;
    $("trkTime").textContent = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
    var avg = secs > 0 ? trackDist / secs : 0; // m/s
    $("trkSpd").textContent = fmtSpeed(avg) + " / " + fmtSpeed(maxSpeed) + " " + (isImp() ? "mph" : "km/h");
  }
  $("recBtn").onclick = function () {
    recording = !recording;
    var b = $("recBtn");
    if (recording) {
      if (track.length === 0) { trackDist = 0; trackStart = Date.now(); maxSpeed = 0; if (trackLine) trackLine.setLatLngs([]); }
      else if (!trackStart) trackStart = Date.now();
      b.textContent = "⏸ Pause"; b.className = "b-danger";
      recTimer = setInterval(refreshTrackStats, 1000);
      if (!hasNative() && watchId == null) startWeb(); else if (hasNative()) startTracking();
    } else {
      b.textContent = "⏺ Aufzeichnen"; b.className = "b-success";
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
    }
  };
  $("exportBtn").onclick = function () {
    if (track.length < 2) { toast("Zu wenig Trackpunkte. Erst aufzeichnen."); return; }
    var gpx = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GeoGuard" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>GeoGuard ' +
      new Date(trackStart || Date.now()).toISOString() + '</name><trkseg>\n';
    track.forEach(function (pt) {
      gpx += '<trkpt lat="' + pt.lat + '" lon="' + pt.lon + '">' +
        (pt.alt != null && !isNaN(pt.alt) ? "<ele>" + pt.alt + "</ele>" : "") +
        "<time>" + new Date(pt.t).toISOString() + "</time></trkpt>\n";
    });
    gpx += "</trkseg></trk></gpx>";
    var name = "geoguard-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".gpx";
    if (hasNative()) { try { window.Android.saveText(name, "application/gpx+xml", gpx); return; } catch (e) {} }
    var blob = new Blob([gpx], { type: "application/gpx+xml" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    toast("GPX exportiert (" + track.length + " Punkte).");
  };

  // ---------- Navigation zum Ziel ----------
  var target = null;
  try { target = JSON.parse(LS.getItem("gg_target") || "null"); } catch (e) {}
  function setTarget(lat, lon, name) {
    target = { lat: lat, lon: lon, name: name || null };
    LS.setItem("gg_target", JSON.stringify(target));
    $("navTarget").textContent = (name ? name + " · " : "") + lat.toFixed(5) + ", " + lon.toFixed(5);
    if (map) { var ll = [lat, lon]; if (!targetMarker) targetMarker = L.marker(ll).addTo(map); else targetMarker.setLatLng(ll); }
    updateNavArrow();
  }
  function updateNavArrow() {
    if (!target || !lastFix) return;
    var dist = haversine(lastFix.lat, lastFix.lon, target.lat, target.lon);
    var brg = bearing(lastFix.lat, lastFix.lon, target.lat, target.lon);
    var d = fmtDist(dist); $("navDist").textContent = d.v; $("navDistU").textContent = d.u;
    $("navBear").textContent = Math.round(brg) + " " + cardinal(brg);
    var rel = (smooth != null) ? (brg - smooth) : brg;
    $("taPointer").style.transform = "rotate(" + rel + "deg)";
  }
  $("setTargetBtn").onclick = function () {
    var la = parseFloat($("inLat").value), lo = parseFloat($("inLon").value);
    if (isNaN(la) || isNaN(lo)) { toast("Bitte gültige Koordinaten eingeben."); return; }
    setTarget(la, lo, null); toast("Ziel gesetzt.");
  };
  $("saveWpBtn").onclick = function () {
    if (!lastFix) { toast("Noch keine Position."); return; }
    var name = prompt("Name des Wegpunkts:", "Wegpunkt " + (loadWps().length + 1));
    if (name == null) return;
    var wps = loadWps(); wps.push({ lat: lastFix.lat, lon: lastFix.lon, name: name || ("WP " + (wps.length + 1)) });
    LS.setItem("gg_wps", JSON.stringify(wps)); renderWps();
  };
  function loadWps() { try { return JSON.parse(LS.getItem("gg_wps") || "[]"); } catch (e) { return []; } }
  function renderWps() {
    var wps = loadWps(), c = $("wpList");
    if (!wps.length) { c.innerHTML = '<div class="hint">Noch keine Wegpunkte.</div>'; return; }
    c.innerHTML = "";
    wps.forEach(function (w, i) {
      var row = document.createElement("div"); row.className = "wp-item";
      row.innerHTML = '<div style="flex:1"><div class="nm">' + escapeHtml(w.name) + '</div><div class="co">' +
        w.lat.toFixed(5) + ", " + w.lon.toFixed(5) + '</div></div>';
      var go = document.createElement("button"); go.className = "b-primary"; go.textContent = "🎯";
      go.onclick = function () { setTarget(w.lat, w.lon, w.name); toast("Ziel: " + w.name); switchTab("nav"); };
      var del = document.createElement("button"); del.className = "b-soft"; del.textContent = "🗑";
      del.onclick = function () { var a = loadWps(); a.splice(i, 1); LS.setItem("gg_wps", JSON.stringify(a)); renderWps(); };
      row.appendChild(go); row.appendChild(del); c.appendChild(row);
    });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (m) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]; }); }
  function switchTab(tab) { var b = nav.querySelector('[data-tab="' + tab + '"]'); if (b) b.click(); }
  if (target) $("navTarget").textContent = (target.name ? target.name + " · " : "") + target.lat.toFixed(5) + ", " + target.lon.toFixed(5);
  renderWps();

  // ---------- GNSS / Satelliten ----------
  function updateGnss(g) {
    $("satTotal").textContent = g.total != null ? g.total : "--";
    $("satUsed").textContent = g.used != null ? g.used : "--";
    $("satCn0").textContent = g.avgCn0 != null ? Math.round(g.avgCn0) : "--";
    $("satSys").textContent = g.systems && g.systems.length ? g.systems.join(" · ") : "–";
    var bars = $("satBars");
    if (g.sats && g.sats.length) {
      bars.innerHTML = "";
      g.sats.sort(function (a, b) { return (b.cn0 || 0) - (a.cn0 || 0); }).forEach(function (s) {
        var bar = document.createElement("div");
        bar.className = "sat-bar" + (s.used ? " used" : "");
        bar.style.height = Math.max(3, Math.min(100, (s.cn0 || 0) / 50 * 100)) + "%";
        bar.title = (s.type || "") + " · " + (s.cn0 || 0) + " dBHz";
        bars.appendChild(bar);
      });
      $("satHint").textContent = "Aktualisiert: " + new Date().toLocaleTimeString("de-DE");
    }
  }

  // ---------- Einstellungen ----------
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); $("themeTgl").classList.toggle("on", t === "light"); LS.setItem("gg_theme", t); }
  applyTheme(LS.getItem("gg_theme") || "dark");
  $("themeTgl").onclick = function () { applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light"); };

  function selUnits(u) {
    units = u; LS.setItem("gg_units", u); applyUnitLabels();
    Array.prototype.forEach.call($("unitSeg").children, function (b) { b.classList.toggle("sel", b.getAttribute("data-u") === u); });
    if (lastFix) updateLocation(lastFix); refreshTrackStats();
  }
  Array.prototype.forEach.call($("unitSeg").children, function (b) { b.onclick = function () { selUnits(b.getAttribute("data-u")); }; });
  applyUnitLabels();
  Array.prototype.forEach.call($("unitSeg").children, function (b) { b.classList.toggle("sel", b.getAttribute("data-u") === units); });

  // Bildschirm anlassen
  var wakeLock = null;
  async function setWake(on) {
    $("wakeTgl").classList.toggle("on", on); LS.setItem("gg_wake", on ? "1" : "0");
    if (hasNative()) { try { window.Android.keepAwake(on); } catch (e) {} }
    try {
      if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
      else if (wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) {}
  }
  $("wakeTgl").onclick = function () { setWake(!$("wakeTgl").classList.contains("on")); };
  if (LS.getItem("gg_wake") === "1") setWake(true);

  // Hintergrund-Tracking
  $("bgTgl").onclick = function () {
    var on = !$("bgTgl").classList.contains("on");
    $("bgTgl").classList.toggle("on", on); LS.setItem("gg_bg", on ? "1" : "0");
    if (hasNative()) { try { window.Android.setBackground(on); } catch (e) {} }
    else toast("Hintergrund-Tracking gibt es nur in der nativen App (APK).");
  };
  if (LS.getItem("gg_bg") === "1") $("bgTgl").classList.add("on");

  // ---------- Start ----------
  if (target && map) setTarget(target.lat, target.lon, target.name);
  if (hasNative()) { setStatus("warn", "Initialisiere…"); try { window.Android.startLocation(); } catch (e) {} }
  else setStatus("", "Bereit – Tracking starten");
})();
