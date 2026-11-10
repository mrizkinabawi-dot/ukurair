/**
 * UserLocationRouting.jsx
 * 
 * Fitur Deteksi Lokasi Pengguna & Cek Rute Aman Banjir:
 * 1. Deteksi GPS pengguna (marker pulsing dot seperti Google Maps)
 * 2. Cek apakah pengguna berada di dalam / dekat zona banjir
 * 3. Ambil rute jalan OSRM dari posisi pengguna ke tujuan
 * 4. Analisis apakah rute melewati titik banjir / jalan tergenang di depan
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Navigation, Crosshair, AlertTriangle, CheckCircle2,
  MapPin, ShieldAlert, X, ArrowRight, Route, Loader2, Info
} from 'lucide-react';

// ─── Formula Jarak Haversine (dalam meter) ──────────────────────────────────
export const getDistanceMeters = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 999999;
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

// ─── Icon Marker Posisi Pengguna (Pulsing Radar Blue Dot) ────────────────────
export const createUserLocationIcon = () => {
  return L.divIcon({
    className: 'user-gps-marker',
    html: `
      <div style="position: relative; width: 24px; height: 24px;">
        <div style="
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: rgba(56, 189, 248, 0.4);
          animation: user-gps-pulse 2s infinite ease-out;
        "></div>
        <div style="
          position: absolute;
          top: 4px;
          left: 4px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #0284c7;
          border: 3px solid #ffffff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        "></div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
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
    // OSRM mengembalikan [lng, lat], balikkan ke [lat, lng] untuk Leaflet
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
    console.warn('OSRM Route fetch error:', err);
    // Fallback: garis lurus jika OSRM sedang lambat / offline
    return {
      coordinates: [[startLat, startLng], [destLat, destLng]],
      distanceKm: (getDistanceMeters(startLat, startLng, destLat, destLng) / 1000).toFixed(1),
      durationMin: Math.round(getDistanceMeters(startLat, startLng, destLat, destLng) / 600),
      summary: 'Garis Langsung (Estimasi)'
    };
  }
};

// ─── Evaluasi Apakah Rute Melintasi Zona Banjir ──────────────────────────────
export const checkRouteFloodSafety = (routeCoords, floodZones, deviceData) => {
  if (!routeCoords || routeCoords.length === 0) return { isSafe: true, floodedPoints: [] };

  const floodedPoints = [];

  // 1. Kumpulkan semua area yang saat ini berstatus banjir / siaga / zona air aktif
  const dangerousAreas = [];

  // A. Dari perangkat IoT yang airnya sedang naik / siaga
  (deviceData || []).forEach(dev => {
    const level = Number(dev.water_level) || 0;
    const isOnline = dev.isOnline !== false;
    // Anggap bahaya jika air >= 30 cm atau status siaga/waspada
    if (isOnline && (level >= 30 || String(dev.status).toLowerCase().includes('siaga') || String(dev.status).toLowerCase().includes('waspada'))) {
      dangerousAreas.push({
        name: dev.name || 'Titik Sensor',
        lat: dev.lat,
        lng: dev.lng,
        radius: 120, // meter
        water_level: level,
        type: 'sensor'
      });
    }
  });

  // B. Dari zona banjir yang dikonfigurasi (Zona 1, 2, 3)
  (floodZones || []).forEach(zone => {
    if (zone.sub_zones && Array.isArray(zone.sub_zones)) {
      zone.sub_zones.forEach(sz => {
        if (sz.enabled !== false && sz.color !== '#22c55e') { // bukan hijau aman
          // Jika kontur jalan
          if (sz.type === 'road' && sz.road_points) {
            sz.road_points.forEach(pt => {
              dangerousAreas.push({
                name: `${zone.name || 'Jalan'} - ${sz.name}`,
                lat: pt[0],
                lng: pt[1],
                radius: Number(sz.road_width || 18) * 3,
                type: 'road',
                color: sz.color
              });
            });
          } else {
            const center = sz.center || zone.center || [zone.lat, zone.lng];
            if (center) {
              dangerousAreas.push({
                name: `${zone.name || 'Area'} - ${sz.name}`,
                lat: center[0],
                lng: center[1],
                radius: Number(sz.radius_meter || 100),
                type: 'zone',
                color: sz.color
              });
            }
          }
        }
      });
    } else if (zone.enabled !== false && zone.color !== '#22c55e') {
      const center = zone.center || [zone.lat, zone.lng];
      if (center) {
        dangerousAreas.push({
          name: zone.name || 'Zona Genangan',
          lat: center[0],
          lng: center[1],
          radius: Number(zone.radius_meter || 120),
          type: 'zone',
          color: zone.color
        });
      }
    }
  });

  // 2. Periksa setiap titik pada rute jalan terhadap area berbahaya
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

// ─── Evaluasi Posisi Pengguna Saat Ini Terhadap Banjir ───────────────────────
export const checkUserLocationSafety = (userLat, userLng, floodZones, deviceData) => {
  if (!userLat || !userLng) return { status: 'unknown' };

  let nearestFlood = null;
  let minDistance = 999999;
  let isInside = false;

  // Cek ke titik sensor
  (deviceData || []).forEach(dev => {
    const level = Number(dev.water_level) || 0;
    const isOnline = dev.isOnline !== false;
    if (isOnline && (level >= 30 || String(dev.status).toLowerCase().includes('siaga'))) {
      const dist = getDistanceMeters(userLat, userLng, dev.lat, dev.lng);
      if (dist < minDistance) {
        minDistance = dist;
        nearestFlood = { name: dev.name, distance: dist, water_level: level };
        if (dist <= 100) isInside = true;
      }
    }
  });

  // Cek ke zona terdaftar
  (floodZones || []).forEach(zone => {
    const checkSub = (sz) => {
      if (sz.enabled !== false && sz.color !== '#22c55e') {
        const center = sz.center || zone.center || [zone.lat, zone.lng];
        if (center) {
          const dist = getDistanceMeters(userLat, userLng, center[0], center[1]);
          const radius = Number(sz.radius_meter || 100);
          if (dist < minDistance) {
            minDistance = dist;
            nearestFlood = { name: `${zone.name || 'Titik'} (${sz.name})`, distance: dist };
            if (dist <= radius) isInside = true;
          }
        }
      }
    };

    if (zone.sub_zones && Array.isArray(zone.sub_zones)) {
      zone.sub_zones.forEach(checkSub);
    } else {
      checkSub(zone);
    }
  });

  if (isInside) {
    return {
      status: 'danger',
      message: `PERINGATAN: Posisi Anda berada di area potensi banjir dekat ${nearestFlood?.name}!`,
      nearestFlood
    };
  }

  if (minDistance <= 300) {
    return {
      status: 'warning',
      message: `Waspada: Anda berada sekitar ${minDistance} meter dari area genangan air (${nearestFlood?.name}).`,
      nearestFlood
    };
  }

  return {
    status: 'safe',
    message: 'Lokasi Anda aman. Tidak ada genangan banjir di sekitar Anda saat ini.',
    nearestFlood
  };
};

// ─── Komponen Layer Peta: Marker Pengguna & Jalur Rute ──────────────────────
export const UserLocationMapLayer = ({
  userLocation,
  activeRoute,
  routeSafety
}) => {
  const map = useMap();
  const routeLayersRef = useRef([]);

  // Render garis rute jalan OSRM di peta
  useEffect(() => {
    // Hapus rute lama
    routeLayersRef.current.forEach(l => {
      try { map.removeLayer(l); } catch (_) {}
    });
    routeLayersRef.current = [];

    if (activeRoute && activeRoute.coordinates && activeRoute.coordinates.length >= 2) {
      const isRouteSafe = routeSafety?.isSafe !== false;
      const routeColor = isRouteSafe ? '#0284c7' : '#ef4444'; // Biru jika aman, Merah jika banjir

      // Garis luar (casing bayangan)
      const outerLine = L.polyline(activeRoute.coordinates, {
        color: isRouteSafe ? '#0369a1' : '#991b1b',
        weight: 8,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round'
      });

      // Garis utama
      const innerLine = L.polyline(activeRoute.coordinates, {
        color: routeColor,
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        dashArray: isRouteSafe ? null : '8, 8' // Putus-putus jika berbahaya
      });

      outerLine.addTo(map);
      innerLine.addTo(map);
      routeLayersRef.current.push(outerLine, innerLine);

      // Fit bounds peta agar rute pas di layar
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

// ─── Komponen Tombol Floating: "Lokasi Saya" (GPS Button) ───────────────────
export const UserLocationFloatingButton = ({
  onLocateUser,
  isLocating,
  userLocation
}) => {
  return (
    <button
      onClick={onLocateUser}
      title="Temukan Lokasi Saya Sekarang"
      style={{
        position: 'absolute',
        bottom: '150px',
        right: '16px',
        zIndex: 998,
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        background: userLocation ? '#0284c7' : 'rgba(15, 23, 42, 0.95)',
        border: `2px solid ${userLocation ? '#38bdf8' : '#334155'}`,
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        transition: 'all 0.2s ease',
      }}
    >
      {isLocating ? (
        <Loader2 size={20} className="animate-spin" color="#38bdf8" />
      ) : (
        <Crosshair size={20} color={userLocation ? '#ffffff' : '#38bdf8'} />
      )}
    </button>
  );
};

// ─── Komponen Floating Card: Status Lokasi & Cek Rute Aman ───────────────────
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

  // Jika tidak ada lokasi user dan tidak ada tujuan, tidak perlu render
  if (!userLocation && !searchedDestination) return null;

  return (
    <div style={{
      position: 'absolute',
      top: '74px',
      left: '12px',
      right: '12px',
      maxWidth: '430px',
      margin: '0 auto',
      zIndex: 999,
      background: 'rgba(15, 23, 42, 0.95)',
      border: `1px solid ${
        routeSafety && !routeSafety.isSafe
          ? '#ef4444'
          : userSafety?.status === 'danger'
          ? '#ef4444'
          : '#334155'
      }`,
      borderRadius: '14px',
      boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
      backdropFilter: 'blur(10px)',
      color: '#f8fafc',
      overflow: 'hidden',
      fontSize: '0.8rem',
      animation: 'fadeIn 0.2s'
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
            {activeRoute ? 'Navigasi Rute Anti-Banjir' : 'Deteksi Lokasi & Cuaca'}
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
          {/* 1. Status Lokasi Pengguna Saat Ini */}
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
                  : userSafety?.status === 'warning'
                  ? 'rgba(250, 204, 21, 0.15)'
                  : 'rgba(34, 197, 94, 0.12)',
              border: `1px solid ${
                userSafety?.status === 'danger'
                  ? '#ef4444'
                  : userSafety?.status === 'warning'
                  ? '#ca8a04'
                  : '#16a34a'
              }`
            }}>
              {userSafety?.status === 'danger' ? (
                <ShieldAlert size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} />
              ) : userSafety?.status === 'warning' ? (
                <AlertTriangle size={18} color="#facc15" style={{ flexShrink: 0, marginTop: '2px' }} />
              ) : (
                <CheckCircle2 size={18} color="#22c55e" style={{ flexShrink: 0, marginTop: '2px' }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{
                  fontWeight: 700,
                  fontSize: '0.78rem',
                  color:
                    userSafety?.status === 'danger'
                      ? '#f87171'
                      : userSafety?.status === 'warning'
                      ? '#fde047'
                      : '#4ade80'
                }}>
                  {userSafety?.status === 'danger'
                    ? '⚠️ Anda Berada di Area Banjir!'
                    : userSafety?.status === 'warning'
                    ? 'Waspada Banjir Dekat Anda'
                    : '🟢 Lokasi Anda Aman'}
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
                Lokasi Anda belum terdeteksi
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

          {/* 2. Informasi Cek Rute ke Tujuan */}
          {searchedDestination && (
            <div style={{ borderTop: '1px solid #1e293b', paddingTop: '10px' }}>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>
                📍 Tujuan Perjalanan:
              </div>
              <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: '0.82rem' }}>
                {searchedDestination.title}
              </div>

              {/* Jika rute sudah dihitung */}
              {activeRoute ? (
                <div style={{ marginTop: '8px' }}>
                  {/* Status Keamanan Rute */}
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
                        Disarankan berhati-hati atau cari jalur alternatif!
                      </div>
                    )}
                  </div>

                  {/* Ringkasan Jarak & Waktu Tempuh */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#cbd5e1' }}>
                    <span>Jarak: <strong>{activeRoute.distanceKm} km</strong></span>
                    <span>Estimasi Waktu: <strong>~{activeRoute.durationMin} mnt</strong></span>
                  </div>
                </div>
              ) : (
                /* Tombol Hitung Rute */
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
                      Cek Apakah Rute Ini Ada Banjir
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
