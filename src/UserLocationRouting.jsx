/**
 * UserLocationRouting.jsx
 * 
 * Sistem Deteksi Posisi Pengguna, Lalu Lintas Banjir (Google Maps Style) & Alert Geofence:
 * 1. Live GPS tracking pengguna (Marker pulsing radar blue dot seperti Google Maps)
 * 2. Visualisasi warna jalan ala Google Maps Traffic (Hijau = Aman, Kuning/Oranye = Waspada, Merah = Bahaya/Macet Banjir)
 * 3. Geofence Web Emergency Alert: Notifikasi HANYA berbunyi/muncul saat pengguna MASUK kawasan banjir aktif
 *    (Pengguna di luar wilayah banjir TIDAK diganggu notifikasi)
 * 4. Badge Ketinggian Air Mengambang di Peta: Pengguna di luar wilayah bisa langsung melihat
 *    ketinggian air tiap daerah (misal: "Jl. Marina: 68 cm (Merah)")
 * 5. Ringkasan Ketinggian Air Seluruh Wilayah (Traffic Legend / Overview Drawer)
 * 6. Coming Soon Badge: Notifikasi Telegram & SMS
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Navigation, Crosshair, AlertTriangle, CheckCircle2,
  MapPin, ShieldAlert, X, ArrowRight, Route, Loader2, Info,
  Volume2, VolumeX, Bell, BellRing, ChevronDown, ChevronUp,
  Radio, Waves, Car, Compass, ExternalLink, ShieldCheck
} from 'lucide-react';

// ─── Formula Jarak Haversine (dalam meter) ──────────────────────────────────
export const getDistanceMeters = (lat1, lon1, lat2, lon2) => {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return 999999;
  const R = 6371000; // Radius bumi (meter)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

// ─── Hitung Jarak Tegak Lurus Titik ke Segmen Garis Jalan (Meter) ────────────
export const distToSegmentMeters = (pLat, pLng, aLat, aLng, bLat, bLng) => {
  const midLatRad = ((aLat + bLat) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(midLatRad);
  const kLat = 111139; // 1 derajat lat ~ 111.1 km
  const kLng = 111139 * cosLat;

  const px = (pLng - aLng) * kLng;
  const py = (pLat - aLat) * kLat;
  const bx = (bLng - aLng) * kLng;
  const by = (bLat - aLat) * kLat;

  const l2 = bx * bx + by * by;
  if (l2 === 0) return Math.hypot(px, py);

  let t = (px * bx + py * by) / l2;
  t = Math.max(0, Math.min(1, t));

  const projX = t * bx;
  const projY = t * by;
  return Math.hypot(px - projX, py - projY);
};

// ─── Cek Apakah Titik Berada di Dalam Poligon (Ray-Casting Algorithm) ───────
export const isPointInPolygon = (lat, lng, polygon) => {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0];
    const xj = polygon[j][1], yj = polygon[j][0];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// ─── Web Audio API: Bunyi Alarm Darurat Banjir (Acoustic Chime) ──────────────
export const playEmergencyFloodChime = () => {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const playBeep = (freq, startOffset, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
      gain.gain.setValueAtTime(0.2, ctx.currentTime + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + duration);
    };

    // Nada peringatan 3 ketukan (A5, A5, C6)
    playBeep(880, 0, 0.14);
    playBeep(880, 0.18, 0.14);
    playBeep(1046, 0.36, 0.28);
  } catch (err) {
    console.warn('Web Audio warning suppressed:', err);
  }
};

// ─── Browser Native Web Notification ─────────────────────────────────────────
export const sendBrowserFloodNotification = (areaName, waterLevel) => {
  if (!('Notification' in window)) return;
  const title = '🚨 AWAS: MEMASUKI AREA BANJIR!';
  const body = `Anda berada di area genangan banjir ${areaName || 'jalan'} (Ketinggian air: ${waterLevel || '>30'} cm). Harap berhati-hati atau cari rute aman!`;

  if (Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/favicon.ico' });
    } catch (_) {}
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        try {
          new Notification(title, { body, icon: '/favicon.ico' });
        } catch (_) {}
      }
    });
  }
};

// ─── Icon Marker Posisi Pengguna (Pulsing Radar Blue Dot Google Maps) ────────
export const createUserLocationIcon = (heading = null) => {
  const headingTransform = (heading !== null && heading !== undefined)
    ? `transform: rotate(${heading}deg);`
    : '';

  return L.divIcon({
    className: 'user-gps-marker',
    html: `
      <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
        <!-- Pulsing radar wave -->
        <div style="
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: rgba(14, 165, 233, 0.35);
          animation: user-gps-pulse 2s infinite ease-out;
        "></div>
        <!-- Direction cone if heading available -->
        ${heading !== null && heading !== undefined ? `
          <div style="
            position: absolute;
            top: -6px;
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 12px solid #0284c7;
            ${headingTransform}
          "></div>
        ` : ''}
        <!-- Core Blue Dot (Google Maps Style) -->
        <div style="
          position: relative;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #0284c7;
          border: 3px solid #ffffff;
          box-shadow: 0 2px 10px rgba(2, 132, 199, 0.8), 0 0 0 2px rgba(2, 132, 199, 0.3);
          z-index: 2;
        "></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
};

// ─── Ambil Rute Menggunakan OSRM Routing API (Gratis & Terpercaya) ───────────
export const fetchOsrmRoute = async (startLat, startLng, destLat, destLng) => {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${destLng},${destLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Gagal mengambil rute dari server navigasi');
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) {
      throw new Error('Tidak ditemukan rute jalan ke tujuan tersebut');
    }

    const route = data.routes[0];
    const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const distanceKm = (route.distance / 1000).toFixed(1);
    const durationMin = Math.round(route.duration / 60);

    return {
      coordinates,
      distanceKm,
      durationMin,
      summary: route.legs?.[0]?.summary || 'Jalan Raya'
    };
  } catch (err) {
    console.warn('OSRM Route fetch fallback:', err);
    return {
      coordinates: [[startLat, startLng], [destLat, destLng]],
      distanceKm: (getDistanceMeters(startLat, startLng, destLat, destLng) / 1000).toFixed(1),
      durationMin: Math.round(getDistanceMeters(startLat, startLng, destLat, destLng) / 600),
      summary: 'Garis Langsung (Estimasi)'
    };
  }
};

// ─── Evaluasi Apakah Rute Melintasi Zona Banjir ──────────────────────────────
export const checkRouteFloodSafety = (routeCoords, floodZones, deviceData, isSimulationMode = false, simulatedValue = 0) => {
  if (!routeCoords || routeCoords.length === 0) return { isSafe: true, floodedPoints: [] };

  const floodedPoints = [];
  const dangerousAreas = [];

  // A. Dari perangkat IoT yang airnya sedang naik / siaga
  (deviceData || []).forEach(dev => {
    const level = isSimulationMode ? simulatedValue : (Number(dev.water_level) || 0);
    const isOnline = dev.isOnline !== false;
    if ((isOnline || isSimulationMode) && (level >= 30 || String(dev.status).toLowerCase().includes('siaga') || String(dev.status).toLowerCase().includes('waspada'))) {
      dangerousAreas.push({
        name: dev.name || 'Titik Sensor',
        lat: dev.lat,
        lng: dev.lng,
        radius: 120,
        water_level: level,
        type: 'sensor'
      });
    }
  });

  // B. Dari zona banjir yang dikonfigurasi (Zona 1, 2, 3)
  (floodZones || []).forEach(zone => {
    const checkSub = (sz) => {
      if (sz.enabled === false) return;
      const effectiveLevel = isSimulationMode ? simulatedValue : 0;
      // Berbahaya jika warna merah/oranye atau level simulasi >= 30
      const isDangerousColor = sz.color === '#ef4444' || sz.color === '#f97316' || sz.color === '#ea580c';
      if (!isDangerousColor && effectiveLevel < 30) return;

      if (sz.type === 'road' && sz.road_points) {
        sz.road_points.forEach(pt => {
          dangerousAreas.push({
            name: `${zone.name || 'Jalan'} (${sz.name || 'Kontur Jalan'})`,
            lat: pt[0],
            lng: pt[1],
            radius: Number(sz.road_width || 18) * 3,
            type: 'road',
            water_level: effectiveLevel || 50
          });
        });
      } else {
        const center = sz.center || zone.center || [zone.lat, zone.lng];
        if (center) {
          dangerousAreas.push({
            name: `${zone.name || 'Wilayah'} (${sz.name || 'Zona'})`,
            lat: center[0],
            lng: center[1],
            radius: Number(sz.radius_meter || 100),
            type: 'zone',
            water_level: effectiveLevel || 50
          });
        }
      }
    };

    if (zone.sub_zones && Array.isArray(zone.sub_zones)) {
      zone.sub_zones.forEach(checkSub);
    } else {
      checkSub(zone);
    }
  });

  // Periksa rute jalan terhadap area berbahaya
  for (const pt of routeCoords) {
    for (const area of dangerousAreas) {
      const dist = getDistanceMeters(pt[0], pt[1], area.lat, area.lng);
      if (dist <= area.radius) {
        if (!floodedPoints.some(f => f.name === area.name)) {
          floodedPoints.push({
            name: area.name,
            distanceToArea: dist,
            water_level: area.water_level,
            lat: area.lat,
            lng: area.lng
          });
        }
      }
    }
  }

  return {
    isSafe: floodedPoints.length === 0,
    floodedPoints
  };
};

// ─── Evaluasi Posisi Pengguna Saat Ini Terhadap Banjir (Geofencing Akurat) ────
// PERATURAN MUTLAK:
// Hanya return 'danger' jika pengguna SECARA FISIK MASUK ke dalam radius/garis jalan banjir aktif!
// Pengguna di luar wilayah banjir SELALU aman dan TIDAK menerima notifikasi alarm.
export const checkUserLocationSafety = (
  userLat,
  userLng,
  floodZones = [],
  deviceData = [],
  isSimulationMode = false,
  simulatedValue = 0
) => {
  if (!userLat || !userLng) return { status: 'unknown' };

  let activeFloods = [];

  // 1. Periksa sensor IoT terdekat
  (deviceData || []).forEach(dev => {
    const level = isSimulationMode ? simulatedValue : (Number(dev.water_level) || 0);
    const isOnline = dev.isOnline !== false;
    const isHazard = (isOnline || isSimulationMode) && (
      level >= 30 ||
      String(dev.status).toLowerCase().includes('siaga') ||
      String(dev.status).toLowerCase().includes('bahaya') ||
      String(dev.status).toLowerCase().includes('waspada')
    );

    if (isHazard && dev.lat && dev.lng) {
      const dist = getDistanceMeters(userLat, userLng, dev.lat, dev.lng);
      // Radius zona tiang sensor (default 90m)
      const hazardRadius = 90;
      if (dist <= hazardRadius) {
        activeFloods.push({
          name: dev.name || 'Titik Sensor',
          water_level: level,
          distance: dist,
          type: 'sensor',
          statusText: level >= 50 ? 'Bahaya (Siaga 1)' : 'Waspada'
        });
      }
    }
  });

  // 2. Periksa Zona Tersimpan (Zona 1 Tiang, Zona 2 Kontur Jalan, Zona 3 Hilir)
  (floodZones || []).forEach(zone => {
    // Ambil data level dari sensor terkait jika ada
    const matchedDev = (deviceData || []).find(d => d.id === zone.id || d.id === zone.deviceId);
    const devLevel = matchedDev ? (Number(matchedDev.water_level) || 0) : 0;
    const effectiveLevel = isSimulationMode ? simulatedValue : devLevel;

    const evaluateSubZone = (sz) => {
      if (sz.enabled === false) return;

      // Cek apakah zona ini berstatus banjir aktif:
      // (Banjir jika level >= 30 cm, atau warna disetel merah/oranye/bahaya)
      const isDangerousColor = sz.color === '#ef4444' || sz.color === '#f97316' || sz.color === '#ea580c';
      const isWaterHigh = effectiveLevel >= 30;
      if (!isDangerousColor && !isWaterHigh) {
        // Zona aman / hijau -> pengguna masuk sini tidak dianggap bahaya
        return;
      }

      const activeWaterDepth = effectiveLevel > 0 ? effectiveLevel : (isDangerousColor ? 60 : 35);

      // A. Jika tipe kontur jalan (Zona 2) -> cek jarak ke segmen jalan
      if (sz.type === 'road' && sz.road_points && sz.road_points.length >= 2) {
        const roadWidth = Number(sz.road_width || 18);
        const roadBuffer = roadWidth * 1.5; // buffer lebar jalan dalam meter
        let minRoadDist = 999999;

        for (let i = 0; i < sz.road_points.length - 1; i++) {
          const ptA = sz.road_points[i];
          const ptB = sz.road_points[i + 1];
          const d = distToSegmentMeters(userLat, userLng, ptA[0], ptA[1], ptB[0], ptB[1]);
          if (d < minRoadDist) minRoadDist = d;
        }

        if (minRoadDist <= roadBuffer) {
          activeFloods.push({
            name: `${zone.name || 'Jalan Raya'} - ${sz.name || 'Kontur Jalan'}`,
            water_level: activeWaterDepth,
            distance: Math.round(minRoadDist),
            type: 'road',
            statusText: activeWaterDepth >= 50 ? 'Banjir Parah (Macet/Lumpuh)' : 'Genangan Air'
          });
        }
      }
      // B. Jika tipe poligon (Zona 3 Hilir)
      else if (sz.type === 'polygon' && sz.polygon_points && sz.polygon_points.length >= 3) {
        if (isPointInPolygon(userLat, userLng, sz.polygon_points)) {
          activeFloods.push({
            name: `${zone.name || 'Wilayah'} - ${sz.name || 'Area Cekungan'}`,
            water_level: activeWaterDepth,
            distance: 0,
            type: 'polygon',
            statusText: 'Kawasan Tergenang'
          });
        }
      }
      // C. Jika tipe lingkaran (Zona 1 Tiang)
      else {
        const center = sz.center || zone.center || (zone.lat && zone.lng ? [zone.lat, zone.lng] : null);
        if (center) {
          const dist = getDistanceMeters(userLat, userLng, center[0], center[1]);
          const radius = Number(sz.radius_meter || 80);
          if (dist <= radius) {
            activeFloods.push({
              name: `${zone.name || 'Area'} - ${sz.name || 'Radius Tiang'}`,
              water_level: activeWaterDepth,
              distance: dist,
              type: 'circle',
              statusText: activeWaterDepth >= 50 ? 'Bahaya Tinggi' : 'Waspada'
            });
          }
        }
      }
    };

    if (zone.sub_zones && Array.isArray(zone.sub_zones)) {
      zone.sub_zones.forEach(evaluateSubZone);
    } else {
      evaluateSubZone(zone);
    }
  });

  // HASIL GEOFENCING:
  // Hanya 'danger' jika pengguna berada di DALAM kawasan banjir aktif
  if (activeFloods.length > 0) {
    const primaryHazard = activeFloods[0];
    return {
      status: 'danger',
      isInsideFlood: true,
      hazard: primaryHazard,
      allHazards: activeFloods,
      message: `PERINGATAN: Posisi Anda berada di dalam zona genangan air aktif (${primaryHazard.name})! Ketinggian air: ${primaryHazard.water_level} cm.`
    };
  }

  // Pengguna di luar wilayah banjir -> SELALU AMAN & TENANG
  return {
    status: 'safe',
    isInsideFlood: false,
    message: 'Lokasi Anda saat ini aman. Anda berada di luar area genangan banjir.'
  };
};

// ─── Komponen Banner: Emergency Geofence Alert (Pop-up HANYA Saat Masuk Banjir) ─
export const GeofenceEmergencyAlert = ({
  userSafety,
  onDismiss,
  onCenterMap
}) => {
  const [snoozed, setSnoozed] = useState(false);
  const lastAlertZoneRef = useRef(null);

  // Auto-play audio & trigger notifikasi saat user BARU SAJA masuk zona bahaya
  useEffect(() => {
    if (userSafety?.status === 'danger' && userSafety?.hazard) {
      const zoneKey = `${userSafety.hazard.name}-${userSafety.hazard.water_level}`;
      if (lastAlertZoneRef.current !== zoneKey) {
        lastAlertZoneRef.current = zoneKey;
        setSnoozed(false);
        playEmergencyFloodChime();
        sendBrowserFloodNotification(userSafety.hazard.name, userSafety.hazard.water_level);
      }
    } else {
      lastAlertZoneRef.current = null;
      setSnoozed(false);
    }
  }, [userSafety]);

  // JIKA TIDAK ADA BAHAYA ATAU SEDANG DISNOOZE -> TIDAK TAMPILKAN APAPUN
  if (!userSafety || userSafety.status !== 'danger' || !userSafety.hazard || snoozed) {
    return null;
  }

  const hazard = userSafety.hazard;
  const isHighDanger = (hazard.water_level || 0) >= 50;

  return (
    <div
      className="geofence-emergency-banner"
      style={{
        position: 'fixed',
        top: '68px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        width: 'calc(100% - 24px)',
        maxWidth: '560px',
        background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.98), rgba(153, 27, 27, 0.98))',
        color: '#ffffff',
        borderRadius: '16px',
        boxShadow: '0 12px 40px rgba(220, 38, 38, 0.5), 0 0 0 2px rgba(254, 226, 226, 0.3)',
        border: '2px solid #fecaca',
        padding: '14px 16px',
        backdropFilter: 'blur(12px)',
        animation: 'bounceInDown 0.35s ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        {/* Pulsing Hazard Icon */}
        <div style={{
          width: '42px',
          height: '42px',
          borderRadius: '12px',
          background: 'rgba(255, 255, 255, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          border: '1px solid rgba(255, 255, 255, 0.4)',
          animation: 'pulse 1.2s infinite'
        }}>
          <ShieldAlert size={26} color="#ffffff" />
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 800,
              fontSize: '0.88rem',
              letterSpacing: '0.5px',
              textTransform: 'uppercase'
            }}>
              <span>🚨 PERINGATAN DARURAT: MASUK ZONA BANJIR!</span>
            </div>
            <button
              onClick={() => {
                setSnoozed(true);
                if (typeof onDismiss === 'function') onDismiss();
              }}
              title="Tutup Notifikasi"
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                borderRadius: '50%',
                width: '24px',
                height: '24px',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <X size={15} />
            </button>
          </div>

          <div style={{
            fontSize: '0.84rem',
            fontWeight: 700,
            marginTop: '4px',
            color: '#fef08a'
          }}>
            📍 {hazard.name} &bull; Ketinggian Air: {hazard.water_level} cm
          </div>

          <div style={{
            fontSize: '0.74rem',
            lineHeight: 1.35,
            marginTop: '4px',
            color: '#fee2e2'
          }}>
            {isHighDanger
              ? '⛔ Bahaya Tinggi! Air jalan cukup dalam. Sepeda motor & mobil sedan berisiko mogok/hanyut. Harap segera putar balik atau cari jalan alternatif!'
              : '⚠️ Hati-hati! Terdapat genangan air di ruas jalan ini. Kurangi kecepatan dan pantau batas tinggi knalpot kendaraan.'}
          </div>

          {/* Badges Coming Soon for Telegram & SMS as requested */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '8px',
            flexWrap: 'wrap'
          }}>
            <span style={{
              fontSize: '0.66rem',
              padding: '2px 8px',
              borderRadius: '9999px',
              background: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <span>💬 Notifikasi Telegram</span>
              <span style={{ opacity: 0.8, fontSize: '0.62rem' }}>(Coming Soon)</span>
            </span>

            <span style={{
              fontSize: '0.66rem',
              padding: '2px 8px',
              borderRadius: '9999px',
              background: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <span>📱 SMS Alert</span>
              <span style={{ opacity: 0.8, fontSize: '0.62rem' }}>(Coming Soon)</span>
            </span>

            {onCenterMap && (
              <button
                onClick={onCenterMap}
                style={{
                  fontSize: '0.68rem',
                  padding: '3px 10px',
                  borderRadius: '6px',
                  background: '#ffffff',
                  border: 'none',
                  color: '#991b1b',
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginLeft: 'auto'
                }}
              >
                Lihat di Peta
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Komponen Layer Peta: Floating Badge Ketinggian Air Seluruh Wilayah ──────
// Zoom-Responsive: Semakin zoom out semakin kecil, jika terlalu jauh (zoom < 13) disembunyikan otomatis
export const FloodTrafficBadgeLayer = ({
  deviceData = [],
  floodZones = [],
  isSimulationMode = false,
  simulatedValue = 0,
  onSelectDevice
}) => {
  const map = useMap();
  const [currentZoom, setCurrentZoom] = useState(() => map.getZoom());
  const markersRef = useRef([]);

  // Pantau perubahan zoom peta secara real-time
  useEffect(() => {
    const handleZoom = () => {
      setCurrentZoom(map.getZoom());
    };
    map.on('zoomend', handleZoom);
    map.on('zoom', handleZoom);
    return () => {
      map.off('zoomend', handleZoom);
      map.off('zoom', handleZoom);
    };
  }, [map]);

  // Helper pemendek nama lokasi agar tidak memanjang
  const getShortName = (name) => {
    if (!name) return '';
    const lower = name.toLowerCase();
    if (lower.includes('politeknik')) return 'Polibatam';
    if (lower.includes('marina')) return 'Marina';
    if (lower.includes('batu aji')) return 'Batu Aji';
    if (lower.includes('tiban')) return 'Tiban';
    if (lower.includes('nagoya')) return 'Nagoya';
    if (lower.includes('batam centre') || lower.includes('batam center')) return 'Batam Centre';
    if (lower.includes('sekupang')) return 'Sekupang';
    const clean = name.replace(/^(Jalan|Jl\.)\s+/i, '').split(/[-–,]/)[0].trim();
    return clean.length > 10 ? clean.slice(0, 9) + '..' : clean;
  };

  useEffect(() => {
    // Bersihkan marker lama
    markersRef.current.forEach(m => {
      try { map.removeLayer(m); } catch (_) {}
    });
    markersRef.current = [];

    // JIKA TERLALU JAUH (zoom < 13) -> SEMBUNYIKAN TOTAL AGAR TIDAK MENGGANGGU
    if (currentZoom < 13) {
      return;
    }

    // Skala ukuran badge responsif terhadap zoom:
    // - Zoom >= 16: Skala 0.95 (tampil nama ringkas + level cm)
    // - Zoom 15: Skala 0.82 (tampil nama ringkas + level cm)
    // - Zoom 14: Skala 0.72 (hanya tampil titik warna + level cm, lebih kecil)
    // - Zoom 13: Skala 0.60 (mini pill kecil)
    let scale = 0.95;
    let showName = true;

    if (currentZoom >= 16) {
      scale = 0.95;
      showName = true;
    } else if (currentZoom === 15) {
      scale = 0.82;
      showName = true;
    } else if (currentZoom === 14) {
      scale = 0.72;
      showName = false; // Ringkas: hanya dot + cm
    } else {
      scale = 0.60;
      showName = false;
    }

    // Kumpulkan titik-titik pantau yang valid
    const items = [];

    (deviceData || []).forEach(dev => {
      if (!dev.lat || !dev.lng) return;
      const level = isSimulationMode ? simulatedValue : (Number(dev.water_level) || 0);
      const isOnline = dev.isOnline !== false;

      let statusColor = '#22c55e'; // Hijau Aman (< 20 cm)
      let statusBadge = 'Aman';

      if (!isOnline && !isSimulationMode) {
        statusColor = '#94a3b8';
        statusBadge = 'Offline';
      } else if (level >= 50) {
        statusColor = '#ef4444'; // Merah Bahaya (>= 50 cm)
        statusBadge = 'Bahaya';
      } else if (level >= 20) {
        statusColor = '#f59e0b'; // Oranye/Kuning Waspada (20-49 cm)
        statusBadge = 'Waspada';
      }

      items.push({
        id: dev.id,
        name: dev.name || 'Titik Pantau',
        lat: Number(dev.lat),
        lng: Number(dev.lng),
        level,
        statusColor,
        statusBadge,
        device: dev
      });
    });

    // Render Badge Mengambang Mini & Responsif
    items.forEach(item => {
      const shortName = getShortName(item.name);

      const icon = L.divIcon({
        className: 'flood-traffic-badge-marker',
        html: `
          <div style="
            display: inline-flex;
            align-items: center;
            gap: 3.5px;
            background: rgba(15, 23, 42, 0.88);
            color: #ffffff;
            border: 1px solid ${item.statusColor};
            border-radius: 9999px;
            padding: 1.5px 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.45);
            font-family: inherit;
            font-size: 10px;
            font-weight: 700;
            white-space: nowrap;
            backdrop-filter: blur(4px);
            pointer-events: none;
            transform: translate(-50%, -28px) scale(${scale});
            transform-origin: bottom center;
            transition: transform 0.2s ease, opacity 0.2s ease;
          ">
            <span style="
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background: ${item.statusColor};
              box-shadow: 0 0 4px ${item.statusColor};
              flex-shrink: 0;
            "></span>
            ${showName && shortName ? `
              <span style="color: #cbd5e1; font-size: 9px; margin-right: 1px;">
                ${shortName}
              </span>
            ` : ''}
            <span style="
              color: ${item.statusColor};
              font-weight: 800;
              font-size: 9.5px;
            ">
              ${item.level} cm
            </span>
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });

      const marker = L.marker([item.lat, item.lng], { icon, zIndexOffset: 50 });
      marker.addTo(map);
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach(m => {
        try { map.removeLayer(m); } catch (_) {}
      });
      markersRef.current = [];
    };
  }, [deviceData, isSimulationMode, simulatedValue, currentZoom, map]);

  return null;
};

// ─── Komponen Layer Peta: Garis Rute OSRM ────────────────────────────────────
export const UserLocationMapLayer = ({
  userLocation,
  activeRoute,
  routeSafety
}) => {
  const map = useMap();
  const routeLayersRef = useRef([]);

  useEffect(() => {
    routeLayersRef.current.forEach(l => {
      try { map.removeLayer(l); } catch (_) {}
    });
    routeLayersRef.current = [];

    if (activeRoute && activeRoute.coordinates && activeRoute.coordinates.length >= 2) {
      const isRouteSafe = routeSafety?.isSafe !== false;
      const routeColor = isRouteSafe ? '#0284c7' : '#ef4444';

      const outerLine = L.polyline(activeRoute.coordinates, {
        color: isRouteSafe ? '#0369a1' : '#991b1b',
        weight: 8,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
      });

      const innerLine = L.polyline(activeRoute.coordinates, {
        color: routeColor,
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        dashArray: isRouteSafe ? null : '8, 8'
      });

      outerLine.addTo(map);
      innerLine.addTo(map);
      routeLayersRef.current.push(outerLine, innerLine);

      try {
        const bounds = L.latLngBounds(activeRoute.coordinates);
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
      } catch (_) {}
    }

    return () => {
      routeLayersRef.current.forEach(l => {
        try { map.removeLayer(l); } catch (_) {}
      });
      routeLayersRef.current = [];
    };
  }, [activeRoute, routeSafety, map]);

  return null;
};

// ─── Komponen Tombol Floating: GPS Google Maps Style dengan Live Tracking ────
export const UserLocationFloatingButton = ({
  onLocateUser,
  isLocating,
  isTrackingLive,
  userLocation
}) => {
  return (
    <div className="user-gps-floating-btn-wrap">
      {/* Tooltip / Label status tracking */}
      {isTrackingLive && (
        <div className="user-gps-live-badge">
          <Radio size={11} className="animate-pulse" />
          <span>GPS Aktif</span>
        </div>
      )}

      <button
        onClick={onLocateUser}
        title={isTrackingLive ? 'Pusatkan ke Posisi GPS Saya' : 'Aktifkan Deteksi Posisi GPS Saya'}
        className="user-gps-main-btn"
        style={{
          background: userLocation ? '#0284c7' : 'rgba(15, 23, 42, 0.95)',
          border: `2px solid ${userLocation ? '#38bdf8' : '#334155'}`,
        }}
      >
        {isLocating ? (
          <Loader2 size={20} className="animate-spin" color="#38bdf8" />
        ) : (
          <Crosshair size={22} color={userLocation ? '#ffffff' : '#38bdf8'} />
        )}
      </button>
    </div>
  );
};

// ─── Komponen: Ringkasan Ketinggian Air Seluruh Wilayah (Untuk User di Luar Area) ───
export const FloodOverviewDrawer = ({
  deviceData = [],
  isSimulationMode = false,
  simulatedValue = 0,
  userLocation = null,
  onFlyToDevice
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!deviceData || deviceData.length === 0) return null;

  // Urutkan: area yang paling tinggi airnya tampil di atas
  const sortedDevices = [...deviceData].sort((a, b) => {
    const lvlA = isSimulationMode ? simulatedValue : (Number(a.water_level) || 0);
    const lvlB = isSimulationMode ? simulatedValue : (Number(b.water_level) || 0);
    return lvlB - lvlA;
  });

  return (
    <div className={`flood-overview-drawer-wrap ${isOpen ? 'open' : 'closed'}`}>
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="flood-overview-toggle-btn"
        >
          <Waves size={15} color="#38bdf8" />
          <span className="overview-btn-text">Pantau Air ({deviceData.length})</span>
          <ChevronUp size={14} color="#94a3b8" />
        </button>
      ) : (
        <div className="flood-overview-sheet">
          {/* Header */}
          <div style={{
            padding: '9px 12px',
            background: 'rgba(30, 41, 59, 0.6)',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc' }}>
              <Waves size={14} color="#38bdf8" />
              <span>Status Ketinggian Air Wilayah</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
            >
              <ChevronDown size={16} />
            </button>
          </div>

          {/* List Wilayah */}
          <div style={{ maxHeight: '220px', overflowY: 'auto', padding: '6px' }}>
            {sortedDevices.map(dev => {
              const level = isSimulationMode ? simulatedValue : (Number(dev.water_level) || 0);
              const isOnline = dev.isOnline !== false;

              let color = '#22c55e';
              let statusText = 'Aman';
              if (!isOnline && !isSimulationMode) {
                color = '#94a3b8';
                statusText = 'OFF';
              } else if (level >= 50) {
                color = '#ef4444';
                statusText = 'Bahaya';
              } else if (level >= 20) {
                color = '#f59e0b';
                statusText = 'Waspada';
              }

              let distanceText = null;
              if (userLocation && dev.lat && dev.lng) {
                const distM = getDistanceMeters(userLocation.lat, userLocation.lng, dev.lat, dev.lng);
                distanceText = distM > 1000 ? `${(distM / 1000).toFixed(1)} km` : `${distM} m`;
              }

              return (
                <div
                  key={dev.id}
                  onClick={() => {
                    if (onFlyToDevice && dev.lat && dev.lng) {
                      onFlyToDevice(dev);
                    }
                  }}
                  style={{
                    padding: '7px 8px',
                    borderRadius: '8px',
                    margin: '3px 0',
                    background: 'rgba(30, 41, 59, 0.4)',
                    border: `1px solid ${color}33`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(30, 41, 59, 0.4)'}
                >
                  <div style={{ flex: 1, minWidth: 0, paddingRight: '8px' }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {dev.name}
                    </div>
                    {distanceText && (
                      <div style={{ fontSize: '0.65rem', color: '#64748b' }}>
                        📍 {distanceText} dari Anda
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 800, color }}>
                      {level} cm
                    </div>
                    <div style={{ fontSize: '0.62rem', color, fontWeight: 600 }}>
                      {statusText}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Komponen Floating Card: Status Deteksi Rute & Navigasi ─────────────────
export const RouteFloodNavigationCard = ({
  userLocation,
  userSafety,
  searchedDestination,
  activeRoute,
  routeSafety,
  isLoadingRoute,
  onCalculateRoute,
  onCancelRoute,
  onLocateUser
}) => {
  const [minimized, setMinimized] = useState(false);

  // HANYA tampilkan jika pengguna sedang mencari rute perjalanan atau ada rute aktif
  // Tidak memblokir layar ponsel saat pengguna hanya mengaktifkan GPS sendiri
  if (!searchedDestination && !activeRoute) return null;

  return (
    <div className="route-navigation-card" style={{
      border: `1px solid ${
        routeSafety && !routeSafety.isSafe
          ? '#ef4444'
          : userSafety?.status === 'danger'
          ? '#ef4444'
          : '#334155'
      }`,
    }}>
      {/* Header Bar */}
      <div style={{
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: routeSafety && !routeSafety.isSafe ? 'rgba(239,68,68,0.2)' : 'rgba(30, 41, 59, 0.5)',
        borderBottom: '1px solid #1e293b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Route size={16} color={routeSafety && !routeSafety.isSafe ? '#ef4444' : '#38bdf8'} />
          <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>
            {activeRoute ? 'Navigasi Rute Anti-Banjir' : 'Deteksi Lokasi GPS'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => setMinimized(!minimized)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
          >
            {minimized ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          {activeRoute && (
            <button
              onClick={onCancelRoute}
              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
              title="Tutup Rute"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {!minimized && (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Status Lokasi Pengguna Saat Ini */}
          {userLocation ? (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              padding: '8px 10px',
              borderRadius: '8px',
              background:
                userSafety?.status === 'danger'
                  ? 'rgba(239, 68, 68, 0.15)'
                  : 'rgba(34, 197, 94, 0.12)',
              border: `1px solid ${
                userSafety?.status === 'danger'
                  ? '#ef4444'
                  : '#16a34a'
              }`
            }}>
              {userSafety?.status === 'danger' ? (
                <ShieldAlert size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} />
              ) : (
                <ShieldCheck size={18} color="#22c55e" style={{ flexShrink: 0, marginTop: '2px' }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{
                  fontWeight: 700,
                  fontSize: '0.78rem',
                  color: userSafety?.status === 'danger' ? '#f87171' : '#4ade80'
                }}>
                  {userSafety?.status === 'danger'
                    ? '⚠️ Posisi Anda Masuk Area Banjir!'
                    : '🟢 Posisi Anda Aman (Di Luar Banjir)'}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '2px', lineHeight: 1.3 }}>
                  {userSafety?.message}
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              borderRadius: '8px',
              background: '#1e293b',
              border: '1px solid #334155'
            }}>
              <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                Lokasi GPS belum diaktifkan
              </span>
              <button
                onClick={onLocateUser}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: '#0284c7',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Crosshair size={12} /> Deteksi Posisi
              </button>
            </div>
          )}

          {/* Informasi Cek Rute ke Tujuan */}
          {searchedDestination && (
            <div style={{ borderTop: '1px solid #1e293b', paddingTop: '10px' }}>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>
                📍 Tujuan Perjalanan:
              </div>
              <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: '0.82rem' }}>
                {searchedDestination.title}
              </div>

              {activeRoute ? (
                <div style={{ marginTop: '8px' }}>
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: routeSafety?.isSafe ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.2)',
                    border: `1px solid ${routeSafety?.isSafe ? '#16a34a' : '#ef4444'}`,
                    marginBottom: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {routeSafety?.isSafe ? (
                        <CheckCircle2 size={16} color="#22c55e" />
                      ) : (
                        <ShieldAlert size={16} color="#ef4444" />
                      )}
                      <span style={{
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        color: routeSafety?.isSafe ? '#4ade80' : '#f87171'
                      }}>
                        {routeSafety?.isSafe ? 'Rute Aman Bebas Banjir' : '⚠️ PERINGATAN: RUTE MELEWATI BANJIR!'}
                      </span>
                    </div>

                    {!routeSafety?.isSafe && (
                      <div style={{ fontSize: '0.7rem', color: '#fca5a5', marginTop: '4px', lineHeight: 1.3 }}>
                        Ditemukan potensi genangan air di depan:
                        <ul style={{ paddingLeft: '16px', marginTop: '3px' }}>
                          {routeSafety.floodedPoints.map((fp, i) => (
                            <li key={i}>
                              <strong>{fp.name}</strong> {fp.water_level ? `(${fp.water_level} cm)` : ''}
                            </li>
                          ))}
                        </ul>
                        Disarankan cari jalur alternatif!
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#cbd5e1' }}>
                    <span>Jarak: <strong>{activeRoute.distanceKm} km</strong></span>
                    <span>Waktu Tempuh: <strong>~{activeRoute.durationMin} mnt</strong></span>
                  </div>
                </div>
              ) : (
                <button
                  onClick={onCalculateRoute}
                  disabled={isLoadingRoute || !userLocation}
                  style={{
                    width: '100%',
                    marginTop: '8px',
                    padding: '8px',
                    borderRadius: '8px',
                    border: 'none',
                    background: userLocation ? '#0284c7' : '#334155',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    cursor: userLocation ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  {isLoadingRoute ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Menganalisis Rute & Titik Banjir...
                    </>
                  ) : (
                    <>
                      <Navigation size={14} />
                      Cek Apakah Rute Ini Ada Banjir di Depan
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
