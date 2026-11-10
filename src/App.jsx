import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  FloodZoneLayer,
  SimulationControlPanel,
  EditRangeModal,
  MapRoadDrawHandler,
  useFloodZones,
} from './FloodSimulation';
import {
  UserLocationMapLayer,
  UserLocationFloatingButton,
  RouteFloodNavigationCard,
  GeofenceEmergencyAlert,
  FloodTrafficBadgeLayer,
  FloodOverviewDrawer,
  createUserLocationIcon,
  fetchOsrmRoute,
  checkRouteFloodSafety,
  checkUserLocationSafety
} from './UserLocationRouting';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine
} from 'recharts';
import {
  Activity, Database, AlertTriangle, Shield, Settings, LogOut, ChevronRight, BarChart3, Map, LayoutDashboard, Radio, RefreshCcw, ArrowLeft, ArrowRight, Home, Menu, Search, X, Bookmark, Clock, LogIn, User, MinusCircle, Download, Wifi, Cpu, Battery, BatteryCharging, Sun, CloudRain, Sparkles, Bot, Bell, Send, Smartphone, MessageSquare, Check, Share2, Mail, Camera, MapPin, Navigation, Maximize2, Minimize2, Eye, EyeOff, Copy, Edit3, Save, ExternalLink, Sliders
} from 'lucide-react';
import { auth, db } from './firebase';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
L.Marker.prototype.options.icon = DefaultIcon;
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword
} from "firebase/auth";
import {
  ref,
  onValue,
  set,
  update,
  push,
  remove,
  query,
  limitToLast,
  get
} from "firebase/database";
import './index.css';

/**
 * Normalisasi created_at dari perangkat menjadi epoch milidetik.
 * Menerima: epoch ms (13 digit), epoch detik (10 digit), ISO string.
 * Nilai tidak masuk akal (mis. millis() sejak boot Arduino) memakai `fallback`.
 */
const parseCreatedAt = (value, fallback = Date.now()) => {
  if (value === undefined || value === null || value === '') return fallback;

  if (typeof value === 'number' && !isNaN(value)) {
    if (value >= 1e12) return value;           // epoch milidetik
    if (value >= 1e9) return value * 1000;     // epoch detik
    return fallback;                            // millis sejak boot -> abaikan
  }

  const str = String(value).trim();

  if (/^\d+$/.test(str)) {
    const num = Number(str);
    if (str.length >= 13) return num;          // epoch milidetik
    if (str.length === 10) return num * 1000;  // epoch detik
    return fallback;                            // millis sejak boot -> abaikan
  }

  const parsed = Date.parse(str);
  return isNaN(parsed) ? fallback : parsed;
};

// Timeout deteksi koneksi ESP32 (dalam milidetik).
// Default 15 Menit: Sangat cocok untuk sensor yang menghitung setiap 10 menit sekali (10 menit interval + 5 menit toleransi).
// Selama 10 menit, data tetap terbaca aktif (🟢 Terhubung). Jika sensor mati/tidak lapor lebih dari 15 menit,
// sistem secara otomatis menandai ESP32 TERPUTUS (OFF) dan mereset indikator air menjadi 0 cm.
export const DEFAULT_SENSOR_TIMEOUT_MINUTES = 15;
export const ESP_HEARTBEAT_TIMEOUT_MS = DEFAULT_SENSOR_TIMEOUT_MINUTES * 60 * 1000;

export const formatLastSeenTime = (timestamp, currentTime = Date.now()) => {
  if (!timestamp || timestamp === 0) return 'Belum ada sinyal';
  const diffSec = Math.floor((currentTime - timestamp) / 1000);
  if (diffSec < 0) return 'Baru saja';
  if (diffSec < 15) return 'Baru saja (Live)';
  if (diffSec < 60) return `${diffSec} dtk lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  return `${Math.floor(diffHours / 24)} hari lalu`;
};

// Firebase push key menyimpan timestamp pada 8 karakter pertama.
const PUSH_ID_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
const timestampFromPushKey = (key) => {
  if (typeof key !== 'string' || key.length < 8) return null;
  let time = 0;
  for (let i = 0; i < 8; i++) {
    const idx = PUSH_ID_CHARS.indexOf(key.charAt(i));
    if (idx < 0) return null;
    time = time * 64 + idx;
  }
  return time >= 1e12 ? time : null;
};

// Beberapa firmware mengirim nama field berbeda; samakan ke `water_level`.
const SENSOR_LEVEL_FIELDS = ['water_level', 'tinggi_air', 'ketinggian_air', 'level_air', 'level'];

const normalizeReading = (item) => {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };

  if (out.water_level === undefined || out.water_level === null || out.water_level === '') {
    for (const field of SENSOR_LEVEL_FIELDS) {
      const val = item[field];
      if (val !== undefined && val !== null && val !== '') {
        const num = Number(val);
        if (!isNaN(num)) out.water_level = num;
        break;
      }
    }
  } else {
    const num = Number(out.water_level);
    if (!isNaN(num)) out.water_level = num;
  }

  // Normalisasi IP dan MAC address jika menggunakan penamaan alternatif
  if (!out.ip) {
    out.ip = item.ip_address || item.local_ip || item.ipAddress || null;
  }
  if (!out.mac) {
    out.mac = item.mac_address || item.physical_address || item.macAddress || null;
  }

  // Normalisasi Telemetri Catu Daya (Aki & Panel Surya)
  const rawVolt = item.battery_volt ?? item.tegangan_aki ?? item.voltase ?? item.v_bat;
  if (rawVolt !== undefined && rawVolt !== null && rawVolt !== '') {
    out.battery_volt = Math.round(Number(rawVolt) * 10) / 10;
  }
  const rawPct = item.battery_pct ?? item.persen_aki ?? item.persentase_baterai;
  if (rawPct !== undefined && rawPct !== null && rawPct !== '') {
    out.battery_pct = Math.round(Number(rawPct));
  } else if (out.battery_volt) {
    const est = Math.round(((out.battery_volt - 11.6) / (12.7 - 11.6)) * 100);
    out.battery_pct = Math.min(100, Math.max(0, est));
  }

  if (item.solar_charging !== undefined) {
    out.solar_charging = Boolean(item.solar_charging);
  } else if (out.battery_volt) {
    out.solar_charging = out.battery_volt >= 13.2;
  }

  return out;
};

/**
 * Ambil pembacaan terbaru dari sebuah node.
 * Jika node tidak langsung berisi nilai (mis. hasil POST ke /dashboard/<id>),
 * cari satu level ke dalam dan pilih yang timestamp-nya paling baru.
 */
const extractLatestReading = (node) => {
  if (!node || typeof node !== 'object') return {};

  const direct = normalizeReading(node);
  if (Number.isFinite(Number(direct.water_level))) return direct;

  let best = null;
  for (const [childKey, child] of Object.entries(node)) {
    if (!child || typeof child !== 'object') continue;
    const norm = normalizeReading(child);
    if (!Number.isFinite(Number(norm.water_level))) continue;

    const ts = parseCreatedAt(norm.created_at, timestampFromPushKey(childKey) ?? 0);
    if (!best || ts > best.ts) best = { data: norm, ts };
  }

  return best ? best.data : direct;
};

const translateAuthError = (error) => {
  switch (error?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email atau password salah, atau akun belum terdaftar di project Firebase ini.';
    case 'auth/invalid-email':
      return 'Format email tidak valid.';
    case 'auth/user-disabled':
      return 'Akun ini dinonaktifkan di Firebase Console.';
    case 'auth/operation-not-allowed':
      return 'Login Email/Password belum diaktifkan. Buka Firebase Console → Authentication → Sign-in method → aktifkan Email/Password.';
    case 'auth/network-request-failed':
      return 'Tidak dapat menghubungi server Firebase. Periksa koneksi internet.';
    case 'auth/too-many-requests':
      return 'Terlalu banyak percobaan login. Tunggu beberapa menit lalu coba lagi.';
    default:
      return `Login gagal (${error?.code || 'unknown'}). Periksa Email/Password dan pengaturan Authentication.`;
  }
};

const describeFirebaseError = (error) => {
  const msg = String(error?.message || error || '');
  if (/permission_denied|permission denied/i.test(msg)) {
    return 'Akses ditolak oleh Security Rules. Buka Firebase Console → Realtime Database → Rules dan izinkan write (lihat panduan), atau login memakai akun Firebase yang sah.';
  }
  if (/404|not found|failed to get|database.*does not exist/i.test(msg)) {
    return 'Realtime Database belum dibuat atau URL database salah. Buka Firebase Console → Realtime Database lalu klik "Create Database".';
  }
  if (/network|offline|failed to fetch/i.test(msg)) {
    return 'Tidak dapat menghubungi server Firebase. Periksa koneksi internet.';
  }
  return msg || 'Terjadi kesalahan tidak dikenal.';
};

const LocationPicker = ({ onLocationSelect }) => {
  useMapEvents({
    click(e) {
      try {
        if (e && e.latlng && typeof onLocationSelect === 'function') {
          onLocationSelect(e.latlng.lat, e.latlng.lng);
        }
      } catch (err) {
        console.warn('LocationPicker click error:', err);
      }
    },
  });
  return null;
};

// Komponen pengontrol navigasi animasi peta Leaflet
// Komponen penyesuai ukuran peta saat diperbesar/diperkecil
const MapResizeHandler = ({ expanded }) => {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (map && typeof map.invalidateSize === 'function') {
          map.invalidateSize();
        }
      } catch (err) {
        console.warn('MapResizeHandler error:', err);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [expanded, map]);
  return null;
};

const MapFlyController = ({ target }) => {
  const map = useMap();
  useEffect(() => {
    try {
      if (!map || !target) return;
      const lat = typeof target.lat === 'number' ? target.lat : parseFloat(target.lat);
      const lng = typeof target.lng === 'number' ? target.lng : parseFloat(target.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      const zoom = target.zoom || 16;
      if (typeof map.flyTo === 'function') {
        map.flyTo([lat, lng], zoom, { duration: 1.2 });
      } else if (typeof map.setView === 'function') {
        map.setView([lat, lng], zoom);
      }
    } catch (err) {
      console.warn('MapFlyController error:', err);
      try {
        const lat = parseFloat(target?.lat);
        const lng = parseFloat(target?.lng);
        if (!isNaN(lat) && !isNaN(lng) && map && typeof map.setView === 'function') {
          map.setView([lat, lng], target.zoom || 16);
        }
      } catch (e) {}
    }
  }, [target, map]);
  return null;
};

// Custom Active Dot: Titik putih yang diikuti garis horizontal titik-titik merah indikator ketinggian
const CustomActiveDot = ({ cx, cy, value, payload }) => {
  if (cx == null || cy == null || isNaN(cx) || isNaN(cy)) return null;
  const rawNum = typeof value === 'number' && !isNaN(value)
    ? value
    : (payload && payload.water_level != null && !isNaN(Number(payload.water_level)) ? Number(payload.water_level) : NaN);
  if (isNaN(rawNum)) return null;
  const displayVal = Math.round(rawNum * 10) / 10;

  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Garis Horizontal Titik-Titik Warna Merah Mengikuti Titik Putih / Mouse */}
      <line
        x1={0}
        y1={cy}
        x2={6000}
        y2={cy}
        stroke="#ef4444"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />

      {/* Badge Nilai Ketinggian Merah di Sumbu Y Kiri */}
      <g transform={`translate(0, ${cy - 10})`}>
        <rect
          x={0}
          y={0}
          width={44}
          height={20}
          rx={4}
          fill="#ef4444"
          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))' }}
        />
        <text
          x={22}
          y={14}
          fill="#ffffff"
          fontSize={11}
          fontWeight="bold"
          textAnchor="middle"
          fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
        >
          {displayVal}
        </text>
      </g>

      {/* Titik Putih (Active Dot) dengan Efek Glow & Border Cyan */}
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill="#ffffff"
        stroke="#38bdf8"
        strokeWidth={3}
        style={{
          filter: 'drop-shadow(0 0 8px rgba(56, 189, 248, 0.9))'
        }}
      />
      {/* Titik Pusat Merah Kecil di Tengah Titik Putih */}
      <circle
        cx={cx}
        cy={cy}
        r={2.5}
        fill="#ef4444"
      />
    </g>
  );
};

// Helper penentuan status dan warna berdasarkan ketinggian air
// Sesuai aturan:
// < 10 cm: Aman
// 10 - 24 cm: Siaga 1
// 25 - 49 cm: Siaga 2
// 50 - 74 cm: Siaga 3
// 75 - 100 cm: Siaga 4
export const getWaterStatus = (level, rawStatus) => {
  if (level !== undefined && level !== null && !isNaN(Number(level))) {
    const val = Number(level);
    if (val >= 75) {
      return {
        status: 'SIAGA 4',
        label: 'Siaga 4',
        color: '#ef4444',
        bg: 'rgba(239, 68, 68, 0.2)',
        border: '#ef4444',
        dotColor: '#ef4444',
        range: '75 - 100 cm'
      };
    }
    if (val >= 50) {
      return {
        status: 'SIAGA 3',
        label: 'Siaga 3',
        color: '#f97316',
        bg: 'rgba(249, 115, 22, 0.2)',
        border: '#f97316',
        dotColor: '#f97316',
        range: '50 - 74 cm'
      };
    }
    if (val >= 25) {
      return {
        status: 'SIAGA 2',
        label: 'Siaga 2',
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.2)',
        border: '#f59e0b',
        dotColor: '#f59e0b',
        range: '25 - 49 cm'
      };
    }
    if (val >= 10) {
      return {
        status: 'SIAGA 1',
        label: 'Siaga 1',
        color: '#38bdf8',
        bg: 'rgba(56, 189, 248, 0.2)',
        border: '#38bdf8',
        dotColor: '#38bdf8',
        range: '10 - 24 cm'
      };
    }
    return {
      status: 'AMAN',
      label: 'Aman',
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.2)',
      border: '#10b981',
      dotColor: '#10b981',
      range: '< 10 cm'
    };
  }

  const st = String(rawStatus || '').toUpperCase();
  if (st.includes('TERPUTUS') || st.includes('OFFLINE') || st === 'OFF') {
    return { status: 'TERPUTUS', label: 'Terputus (OFF)', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444', dotColor: '#ef4444', range: 'Sensor Mati' };
  }
  if (st.includes('4') || st.includes('DARURAT')) {
    return { status: 'SIAGA 4', label: 'Siaga 4', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444', dotColor: '#ef4444', range: '75 - 100 cm' };
  }
  if (st.includes('3')) {
    return { status: 'SIAGA 3', label: 'Siaga 3', color: '#f97316', bg: 'rgba(249, 115, 22, 0.2)', border: '#f97316', dotColor: '#f97316', range: '50 - 74 cm' };
  }
  if (st.includes('2') || st.includes('WASPADA')) {
    return { status: 'SIAGA 2', label: 'Siaga 2', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b', dotColor: '#f59e0b', range: '25 - 49 cm' };
  }
  if (st.includes('1') || st.includes('SIAGA')) {
    return { status: 'SIAGA 1', label: 'Siaga 1', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.2)', border: '#38bdf8', dotColor: '#38bdf8', range: '10 - 24 cm' };
  }
  return { status: 'AMAN', label: 'Aman', color: '#10b981', bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981', dotColor: '#10b981', range: '< 10 cm' };
};

// Interpretasi WMO Weather Code standar radar meteorologi satelit & BMKG
export const parseWeatherCode = (code) => {
  switch (Number(code)) {
    case 0:
      return { label: 'Cerah', icon: '☀️', isRain: false, isHeavy: false };
    case 1:
    case 2:
      return { label: 'Cerah Berawan', icon: '⛅', isRain: false, isHeavy: false };
    case 3:
      return { label: 'Berawan Tebal', icon: '☁️', isRain: false, isHeavy: false };
    case 45:
    case 48:
      return { label: 'Berkabut', icon: '🌫️', isRain: false, isHeavy: false };
    case 51:
    case 53:
    case 55:
      return { label: 'Gerimis', icon: '🌦️', isRain: true, isHeavy: false };
    case 61:
    case 63:
      return { label: 'Hujan Ringan', icon: '🌧️', isRain: true, isHeavy: false };
    case 65:
      return { label: 'Hujan Lebat', icon: '🌧️', isRain: true, isHeavy: true };
    case 80:
    case 81:
      return { label: 'Hujan Lokal', icon: '🌧️', isRain: true, isHeavy: false };
    case 82:
      return { label: 'Hujan Sangat Lebat', icon: '⛈️', isRain: true, isHeavy: true };
    case 95:
    case 96:
    case 99:
      return { label: 'Hujan Badai Petir', icon: '⛈️', isRain: true, isHeavy: true };
    default:
      return { label: 'Cerah Berawan', icon: '⛅', isRain: false, isHeavy: false };
  }
};

/**
 * Mesin Analisis AI & Deteksi Anomali
 * Membandingkan ketinggian air, laju kenaikan air, dan radar cuaca mikro di koordinat alat
 */
export const evaluateAiSituation = (waterLevel, riseRate, weather) => {
  const level = Number(waterLevel || 0);
  const rate = riseRate || {};
  const delta = rate.delta || 0;
  const precip = Number(weather?.precipitation || 0);
  const isRain = Boolean(weather?.isRain || precip > 0.3);
  const isHeavy = Boolean(weather?.isHeavy || precip >= 5.0);

  // 1. Kasus Anomali Ekstrem: Air melompat tinggi padahal cuaca terik tanpa hujan
  if ((rate.isExtreme || delta >= 6) && !isRain && precip < 0.2) {
    return {
      type: 'ANOMALY_SPIKE',
      isAnomaly: true,
      badge: '⚠️ AI: Anomali Lonjakan',
      shortBadge: '⚠️ Cek Anomali',
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.15)',
      border: '#f59e0b',
      title: 'Peringatan: Potensi Anomali Sensor',
      message: `Terjadi lonjakan air +${delta} cm di saat cuaca lokal terdeteksi cerah/kering. Kemungkinan ada sampah menyangkut atau gangguan mekanik pada tali rakit.`
    };
  }

  // 2. Kasus Banjir Nyata: Hujan lebat di radar dan air naik cepat / siaga tinggi
  if ((isHeavy || isRain) && (rate.isFast || level >= 25)) {
    return {
      type: 'FLOOD_CONFIRMED',
      isAnomaly: false,
      badge: '🚨 AI: Banjir Nyata (Valid)',
      shortBadge: '🚨 Banjir Valid',
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.18)',
      border: '#ef4444',
      title: 'Konfirmasi AI: Banjir Nyata Terdeteksi',
      message: `Kenaikan air (+${rate.rate5m || delta} cm/5m) sinkron dengan intensitas hujan lokal (${precip} mm/jam). Warga di sekitar lokasi diimbau waspada.`
    };
  }

  // 3. Kasus Early Warning: Hujan lebat terdeteksi tetapi air baru mulai naik
  if (isHeavy && level < 25) {
    return {
      type: 'PREDICTIVE_ALERT',
      isAnomaly: false,
      badge: '🌧️ AI: Potensi Genangan',
      shortBadge: '🌧️ Potensi Naik',
      color: '#38bdf8',
      bg: 'rgba(56, 189, 248, 0.15)',
      border: '#38bdf8',
      title: 'Peringatan Dini AI (Prediktif)',
      message: `Hujan lebat terdeteksi di koordinat lokasi (${precip} mm/jam). Potensi kenaikan permukaan air dalam 30–60 menit ke depan.`
    };
  }

  // 4. Kasus Waspada Siaga Tinggi
  if (level >= 50) {
    return {
      type: 'HIGH_WATER',
      isAnomaly: false,
      badge: '⚠️ AI: Siaga Tinggi',
      shortBadge: '⚠️ Siaga Tinggi',
      color: '#f97316',
      bg: 'rgba(249, 115, 22, 0.15)',
      border: '#f97316',
      title: 'Status Bahaya Tinggi',
      message: `Ketinggian air mencapai ${level} cm (${rate.label || 'Stabil'}). Tetap pantau perkembangan grafik.`
    };
  }

  // 5. Kasus Normal
  return {
    type: 'NORMAL_VALID',
    isAnomaly: false,
    badge: '🤖 AI: Data Normal (Valid)',
    shortBadge: '🟢 AI Valid',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.15)',
    border: '#10b981',
    title: 'Analisis AI: Kondisi Aman & Valid',
    message: `Pembacaan ketinggian air stabil dan konsisten dengan cuaca lokal (${weather?.label || 'Normal'}). Tidak ada anomali sensor.`
  };
};

/**
 * Helper menghitung laju kenaikan air (Rate of Rise)
 * Patokan:
 * - Lonjakan Ekstrem: Kenaikan >= 5 cm / 5 menit (atau >= 1 cm / menit) -> Merah + Animasi Kedip
 * - Kenaikan Cepat: Kenaikan >= 2 cm / 5 menit (atau >= 0.4 cm / menit) -> Oranye / Kuning
 * - Surut: Penurunan <= -2 cm / 5 menit -> Hijau
 * - Normal: Perubahan < 2 cm / 5 menit -> Stabil
 */
export const calculateWaterRiseRate = (history, targetTs, targetLevel) => {
  if (!history || !Array.isArray(history) || history.length === 0) {
    return {
      delta: 0,
      rate5m: 0,
      ratePerMin: 0,
      type: 'NORMAL',
      label: 'Stabil',
      badge: '↗ Stabil',
      shortBadge: '↗ Stabil',
      color: '#94a3b8',
      bg: 'rgba(148, 163, 184, 0.12)',
      border: 'rgba(148, 163, 184, 0.25)',
      isFast: false,
      isExtreme: false
    };
  }

  // Tentukan titik target (titik sekarang atau waktu yang dipilih)
  let currentPoint = null;
  if (targetTs !== undefined && targetTs !== null) {
    currentPoint = history.reduce((prev, curr) => {
      return Math.abs((curr.sortTs || 0) - targetTs) < Math.abs((prev.sortTs || 0) - targetTs) ? curr : prev;
    }, history[0]);
  } else {
    currentPoint = history[history.length - 1];
  }

  const currentLevel = targetLevel !== undefined && targetLevel !== null
    ? Number(targetLevel)
    : Number(currentPoint.water_level || 0);
  const currentTime = targetTs || currentPoint.sortTs || Date.now();

  // Cari titik di masa lalu sekitar 5 menit (300.000 ms) sebelum currentTime
  const targetPastTime = currentTime - (5 * 60 * 1000);
  let bestPastPoint = null;
  let minDiff = Infinity;

  for (let i = 0; i < history.length; i++) {
    const pt = history[i];
    const diffTime = currentTime - (pt.sortTs || 0);
    // Cari titik yang minimal 45 detik lebih lampau dan tidak lebih dari 25 menit
    if (diffTime >= 45 * 1000 && diffTime <= 25 * 60 * 1000) {
      const distTo5Min = Math.abs((pt.sortTs || 0) - targetPastTime);
      if (distTo5Min < minDiff) {
        minDiff = distTo5Min;
        bestPastPoint = pt;
      }
    }
  }

  // Jika tidak ada titik dalam rentang 45s - 25m, gunakan titik sebelumnya jika ada dalam 30m
  if (!bestPastPoint) {
    const olderPoints = history.filter(p => (p.sortTs || 0) < currentTime);
    if (olderPoints.length > 0) {
      const candidate = olderPoints[olderPoints.length - 1];
      const diffTime = currentTime - (candidate.sortTs || 0);
      if (diffTime <= 30 * 60 * 1000) {
        bestPastPoint = candidate;
      }
    }
  }

  if (!bestPastPoint) {
    return {
      delta: 0,
      rate5m: 0,
      ratePerMin: 0,
      type: 'NORMAL',
      label: 'Stabil',
      badge: '↗ Stabil',
      shortBadge: '↗ Stabil',
      color: '#94a3b8',
      bg: 'rgba(148, 163, 184, 0.12)',
      border: 'rgba(148, 163, 184, 0.25)',
      isFast: false,
      isExtreme: false
    };
  }

  const pastLevel = Number(bestPastPoint.water_level || 0);
  const diffMinutes = Math.max(0.5, (currentTime - (bestPastPoint.sortTs || 0)) / (60 * 1000));
  const rawDelta = currentLevel - pastLevel;
  const delta = Math.round(rawDelta * 10) / 10;

  // Normalisasi laju kenaikan ke skala per 5 menit
  const rate5m = Math.round((rawDelta / diffMinutes) * 5 * 10) / 10;
  const ratePerMin = Math.round((rawDelta / diffMinutes) * 10) / 10;

  if (rate5m >= 5) {
    return {
      delta,
      rate5m,
      ratePerMin,
      type: 'CRITICAL',
      label: 'Lonjakan Ekstrem',
      badge: `⚡ Lonjakan Kilat (+${rate5m} cm/5m)`,
      shortBadge: `⚡ +${rate5m} cm/5m`,
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.25)',
      border: '#ef4444',
      isFast: true,
      isExtreme: true,
      description: `Naik sangat cepat: +${rate5m} cm per 5 menit`
    };
  }

  if (rate5m >= 2) {
    return {
      delta,
      rate5m,
      ratePerMin,
      type: 'RAPID',
      label: 'Naik Cepat',
      badge: `⚠️ Naik Cepat (+${rate5m} cm/5m)`,
      shortBadge: `⚠️ +${rate5m} cm/5m`,
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.2)',
      border: '#f59e0b',
      isFast: true,
      isExtreme: false,
      description: `Naik cepat: +${rate5m} cm per 5 menit`
    };
  }

  if (rate5m <= -2) {
    return {
      delta,
      rate5m,
      ratePerMin,
      type: 'DROPPING',
      label: 'Air Surut',
      badge: `↘ Surut (${rate5m} cm/5m)`,
      shortBadge: `↘ ${rate5m} cm/5m`,
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.2)',
      border: '#10b981',
      isFast: false,
      isExtreme: false,
      description: `Surut: ${rate5m} cm per 5 menit`
    };
  }

  return {
    delta,
    rate5m,
    ratePerMin,
    type: 'NORMAL',
    label: 'Stabil',
    badge: `↗ Stabil (${rate5m >= 0 ? '+' : ''}${rate5m} cm/5m)`,
    shortBadge: `↗ ${rate5m >= 0 ? '+' : ''}${rate5m} cm/5m`,
    color: '#94a3b8',
    bg: 'rgba(148, 163, 184, 0.12)',
    border: 'rgba(148, 163, 184, 0.25)',
    isFast: false,
    isExtreme: false,
    description: `Stabil (${rate5m >= 0 ? '+' : ''}${rate5m} cm / 5 mnt)`
  };
};

// Custom Tooltip Recharts: Menampilkan waktu, Tinggi: X cm, Indikator Status, dan Indikator Kenaikan Cepat
const CustomChartTooltip = ({ active, payload, label, history }) => {
  if (!active || !payload || !payload.length) return null;

  const item = payload[0];
  const waterLevel = item.value !== undefined && item.value !== null
    ? Math.round(Number(item.value) * 10) / 10
    : 0;

  const statusInfo = getWaterStatus(waterLevel, item.payload?.status);

  // Ambil label tanggal & waktu
  let displayTime = '';
  let pointTs = null;
  if (typeof label === 'number' || (!isNaN(label) && Number(label) > 1000000000)) {
    pointTs = Number(label);
    const d = new Date(pointTs);
    displayTime = `${d.getDate()} ${d.toLocaleString('id-ID', { month: 'short' })}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } else if (label) {
    displayTime = String(label);
    if (item.payload?.sortTs) pointTs = item.payload.sortTs;
  } else if (item.payload?.time) {
    displayTime = item.payload.time;
    if (item.payload?.sortTs) pointTs = item.payload.sortTs;
  }

  // Hitung laju kenaikan untuk titik data ini
  const riseRate = item.payload?.riseRate || (history ? calculateWaterRiseRate(history, pointTs, waterLevel) : null);

  return (
    <div
      style={{
        background: '#0f172a',
        border: `1.5px solid ${riseRate?.isExtreme ? '#ef4444' : riseRate?.isFast ? '#f59e0b' : statusInfo.color}`,
        borderRadius: '10px',
        padding: '10px 14px',
        boxShadow: `0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 0 16px ${statusInfo.color}35`,
        minWidth: '165px',
        pointerEvents: 'none',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'
      }}
    >
      {/* 1. Tanggal & Waktu */}
      {displayTime && (
        <div
          style={{
            fontSize: '12px',
            color: '#f8fafc',
            fontWeight: 600,
            marginBottom: '6px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            paddingBottom: '4px',
            letterSpacing: '0.01em'
          }}
        >
          {displayTime}
        </div>
      )}

      {/* 2. Perintah Tinggi: (berapa cm sekarang) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '6px',
          fontSize: '13px',
          marginBottom: '8px'
        }}
      >
        <span style={{ color: '#94a3b8', fontWeight: 500 }}>Tinggi:</span>
        <span style={{ color: '#38bdf8', fontSize: '16px', fontWeight: 700 }}>
          {waterLevel} <span style={{ fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>cm</span>
        </span>
      </div>

      {/* 3. Indikator Siaga & Laju Kenaikan di Bawahnya */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 10px',
            borderRadius: '9999px',
            background: statusInfo.bg,
            border: `1px solid ${statusInfo.border}`,
            fontSize: '11px',
            fontWeight: 700,
            color: statusInfo.color,
            letterSpacing: '0.03em',
            alignSelf: 'flex-start'
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: statusInfo.dotColor,
              boxShadow: `0 0 8px ${statusInfo.dotColor}`
            }}
          />
          <span>{statusInfo.label}</span>
        </div>

        {/* Indikator Laju Kenaikan Air */}
        {riseRate && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '10.5px',
              fontWeight: 700,
              background: riseRate.bg,
              color: riseRate.color,
              border: `1px solid ${riseRate.border}`,
              alignSelf: 'flex-start',
              animation: riseRate.isExtreme ? 'pulse-alert 1.5s infinite' : 'none'
            }}
          >
            <span>{riseRate.badge}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const ProfileChromePopup = ({
  user,
  userPhoto,
  userDisplayName,
  handlePhotoUpload,
  isAdminUser,
  onClose,
  onManageAdmin,
  onOpenNotif,
  onSwitchAccount,
  onLogout,
  onLogin
}) => {
  return (
    <div
      className="animate-fade-in"
      style={{
        position: 'absolute',
        top: 'calc(100% + 12px)',
        right: 0,
        width: '320px',
        maxWidth: '92vw',
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '16px',
        boxShadow: '0 20px 45px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06)',
        zIndex: 9999,
        padding: '16px',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, sans-serif'
      }}
    >
      {/* Top Profile Card Container (Google Chrome Profile Style) */}
      <div style={{
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '20px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        position: 'relative'
      }}>
        {/* Avatar with Camera badge */}
        <div style={{ position: 'relative', width: '74px', height: '74px', marginBottom: '12px' }}>
          <div style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2px solid #38bdf8',
            background: 'linear-gradient(135deg, #0284c7, #6366f1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(0,0,0,0.5)'
          }}>
            {userPhoto ? (
              <img src={userPhoto} alt="Profil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : user ? (
              <span style={{ fontSize: '2rem', fontWeight: 700, color: '#ffffff' }}>
                {userDisplayName[0].toUpperCase()}
              </span>
            ) : (
              <User size={34} color="#ffffff" />
            )}
          </div>

          {/* Camera upload badge button */}
          <label
            htmlFor="input-upload-avatar-chrome"
            title="Ubah Foto Profil"
            style={{
              position: 'absolute',
              bottom: '-2px',
              right: '-2px',
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: '#38bdf8',
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              border: '2px solid #0f172a',
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
              transition: 'transform 0.15s, background 0.15s'
            }}
            onMouseOver={e => e.currentTarget.style.transform = 'scale(1.15)'}
            onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <Camera size={15} />
            <input
              id="input-upload-avatar-chrome"
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {/* User Name & Email */}
        <h4 style={{ margin: '0 0 3px 0', fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
          {user ? userDisplayName : 'Tamu (Belum Login)'}
        </h4>
        <p style={{ margin: '0 0 10px 0', fontSize: '0.82rem', color: '#94a3b8', wordBreak: 'break-all' }}>
          {user ? user.email : 'Masuk untuk sinkronisasi akun'}
        </p>

        {/* Tombol Ubah Foto */}
        <label
          htmlFor="input-upload-avatar-chrome"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.75rem',
            padding: '5px 12px',
            borderRadius: '16px',
            background: 'rgba(56, 189, 248, 0.12)',
            color: '#38bdf8',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          <Camera size={13} /> Ubah Foto Profil
        </label>
      </div>

      {/* Menu List Options */}
      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {user ? (
          <>
            {isAdminUser && (
              <div
                onClick={onManageAdmin}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  color: '#e2e8f0',
                  fontSize: '0.88rem',
                  transition: 'background 0.15s'
                }}
                onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
              >
                <Settings size={18} color="#94a3b8" />
                <span>Admin Panel</span>
              </div>
            )}

            <div
              onClick={onOpenNotif}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                color: '#e2e8f0',
                fontSize: '0.88rem',
                transition: 'background 0.15s'
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}
            >
              <Bell size={18} color="#38bdf8" />
              <span>Notifikasi SMS & Telegram</span>
            </div>

            <div
              onClick={onSwitchAccount}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                color: '#e2e8f0',
                fontSize: '0.88rem',
                transition: 'background 0.15s'
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}
            >
              <User size={18} color="#94a3b8" />
              <span>Gunakan akun lain</span>
            </div>

            <hr style={{ borderColor: '#334155', margin: '6px 0' }} />

            <div
              onClick={onLogout}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                color: '#ef4444',
                fontSize: '0.88rem',
                transition: 'background 0.15s'
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}
            >
              <LogOut size={18} />
              <span>Logout</span>
            </div>
          </>
        ) : (
          <button
            onClick={onLogin}
            style={{
              width: '100%',
              padding: '10px',
              background: '#38bdf8',
              color: '#0f172a',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
              marginTop: '6px'
            }}
          >
            Login Sekarang
          </button>
        )}
      </div>
    </div>
  );
};

const App = () => {
  const [view, setView] = useState(() => {
    if (typeof window !== 'undefined' && (window.location.pathname === '/signin' || window.location.pathname === '/login' || window.location.hash === '#login')) {
      return 'login';
    }
    return 'dashboard';
  }); // 'dashboard', 'admin', 'login', 'device-detail'
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [adminEmails, setAdminEmails] = useState(['mrizkinabawi@gmail.com']);
  const isAdminEmail = (email) => adminEmails.includes(String(email || '').trim().toLowerCase());

  const [customPhoto, setCustomPhoto] = useState(() => {
    try { return localStorage.getItem('ukurair_user_photo') || ''; } catch (e) { return ''; }
  });

  const getUserDisplayName = (u) => {
    if (!u) return 'Tamu';
    if (u.displayName) return u.displayName;
    if (u.name) return u.name;
    if (u.email === 'mrizkinabawi@gmail.com') return 'Muhamad';
    return u.email ? u.email.split('@')[0] : 'User';
  };

  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('ukurair_auth_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.email) return parsed;
      }
    } catch (e) {
      console.warn('Gagal membaca sesi login:', e);
    }
    return null;
  });

  const isAdminUser = !!user && (user.uid === 'bypass-admin' || isAdminEmail(user.email));
  const userPhoto = customPhoto || (user && user.photoURL) || null;

  // Sinkronisasi sesi login ke localStorage agar tetap login saat keluar/tutup browser
  useEffect(() => {
    try {
      if (user && user.email) {
        const userObj = {
          email: user.email,
          uid: user.uid || ('user-' + user.email),
          displayName: user.displayName || getUserDisplayName(user),
          photoURL: user.photoURL || customPhoto || null,
          role: user.role || (isAdminEmail(user.email) ? 'admin' : 'user')
        };
        localStorage.setItem('ukurair_auth_user', JSON.stringify(userObj));
      }
    } catch (e) {}
  }, [user, customPhoto, adminEmails]);

  const [data, setData] = useState([]); // Latest measurements from /dashboard
  const [devices, setDevices] = useState([]); // Device list from /devices
  const [stats, setStats] = useState({ total_devices: 0, total_measurements: 0, critical_count: 0, avg_level: 0 });
  const [chartData, setChartData] = useState({}); // Stores history for each device
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState('');

  // New states for Google Maps UI
  const [searchQuery, setSearchQuery] = useState('');
  const [mainMapTarget, setMainMapTarget] = useState(null);
  const [searchedDestination, setSearchedDestination] = useState(null);
  const [dashboardPlaceSuggestions, setDashboardPlaceSuggestions] = useState([]);
  const [isSearchingDashboardPlaces, setIsSearchingDashboardPlaces] = useState(false);
  const [showDashboardSuggestions, setShowDashboardSuggestions] = useState(false);
  const mainSearchDebounceRef = useRef(null);
  const mainSearchContainerRef = useRef(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isHeaderProfileOpen, setIsHeaderProfileOpen] = useState(false);

  // ─── State Simulasi & Range Zona Genangan ─────────────────────────────────
  // simulatedValue HANYA untuk tampilan — TIDAK pernah dikirim ke Firebase
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [simulatedValue, setSimulatedValue] = useState(80);
  const [showFloodZones, setShowFloodZones] = useState(true);
  const [editingRangeDevice, setEditingRangeDevice] = useState(null);
  const [isDrawingRoad, setIsDrawingRoad] = useState(false);
  const [activeDrawPoints, setActiveDrawPoints] = useState([]);
  const { zones: floodZones, loadingZones, saveZone, deleteZone } = useFloodZones();

  // ─── State Deteksi Lokasi Pengguna & Cek Rute Aman Banjir (Google Maps Style) ──
  const [userLocation, setUserLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isTrackingLive, setIsTrackingLive] = useState(false);
  const watchIdRef = useRef(null);
  const [activeRoute, setActiveRoute] = useState(null);
  const [routeSafety, setRouteSafety] = useState(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const userLocationIcon = useMemo(() => createUserLocationIcon(userLocation?.heading), [userLocation?.heading]);

  // Evaluasi otomatis keamanan lokasi pengguna saat ini terhadap banjir
  // PERATURAN: Hanya return 'danger' jika pengguna berada di DALAM kawasan banjir aktif
  const userSafety = useMemo(() => {
    if (!userLocation) return { status: 'unknown' };
    return checkUserLocationSafety(
      userLocation.lat,
      userLocation.lng,
      floodZones,
      data,
      isSimulationMode,
      simulatedValue
    );
  }, [userLocation, floodZones, data, isSimulationMode, simulatedValue]);

  // Bersihkan GPS watchPosition saat unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Handler temukan & pantau posisi GPS pengguna secara Live (Continuous Watch)
  const handleLocateUser = () => {
    if (!navigator.geolocation) {
      alert('Browser Anda tidak mendukung deteksi lokasi (Geolocation).');
      return;
    }

    // Jika sudah ada lokasi dan sedang tracking, langsung pusatkan peta
    if (userLocation) {
      setMainMapTarget({ lat: userLocation.lat, lng: userLocation.lng, zoom: 16, _ts: Date.now() });
    }

    setIsLocating(true);

    // Ambil posisi awal segera
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const { latitude, longitude, accuracy, heading, speed } = pos.coords;
        const loc = { lat: latitude, lng: longitude, accuracy, heading, speed };
        setUserLocation(loc);
        setMainMapTarget({ lat: latitude, lng: longitude, zoom: 16, _ts: Date.now() });

        // Mulai pelacakan terus menerus (live tracking saat berjalan / berkendara)
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }
        watchIdRef.current = navigator.geolocation.watchPosition(
          (watchPos) => {
            const wCoords = watchPos.coords;
            setUserLocation({
              lat: wCoords.latitude,
              lng: wCoords.longitude,
              accuracy: wCoords.accuracy,
              heading: wCoords.heading,
              speed: wCoords.speed
            });
            setIsTrackingLive(true);
          },
          (err) => console.warn('WatchPosition warn:', err),
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
        );
        setIsTrackingLive(true);
      },
      (err) => {
        setIsLocating(false);
        let msg = 'Gagal mendeteksi lokasi GPS.';
        if (err.code === 1) msg = 'Izin lokasi ditolak. Silakan aktifkan izin lokasi di browser Anda.';
        else if (err.code === 2) msg = 'Sinyal lokasi tidak tersedia.';
        else if (err.code === 3) msg = 'Waktu deteksi lokasi habis (timeout).';
        alert(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
    );
  };

  // Jalankan analisis rute OSRM dan cek persilangan banjir
  const runRouteAnalysis = async (startLoc, dest) => {
    setIsLoadingRoute(true);
    try {
      const routeData = await fetchOsrmRoute(startLoc.lat, startLoc.lng, dest.lat, dest.lng);
      setActiveRoute(routeData);
      const safety = checkRouteFloodSafety(routeData.coordinates, floodZones, data, isSimulationMode, simulatedValue);
      setRouteSafety(safety);
    } catch (e) {
      alert('Gagal menganalisis rute jalan: ' + (e?.message || 'Error'));
    } finally {
      setIsLoadingRoute(false);
    }
  };

  // Handler hitung rute dari posisi pengguna ke tujuan
  const handleCalculateRoute = async (targetDest) => {
    const dest = targetDest || searchedDestination;
    if (!dest) {
      alert('Silakan cari tujuan perjalanan terlebih dahulu.');
      return;
    }

    if (!userLocation) {
      // Jika posisi GPS pengguna belum ada, minta otomatis
      if (!navigator.geolocation) {
        alert('Browser tidak mendukung deteksi lokasi.');
        return;
      }
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          setIsLocating(false);
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          setUserLocation(loc);
          await runRouteAnalysis(loc, dest);
        },
        () => {
          setIsLocating(false);
          alert('Perlu izin lokasi GPS Anda untuk menganalisis rute dari tempat Anda berada.');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
      return;
    }

    await runRouteAnalysis(userLocation, dest);
  };

  const handleCancelRoute = () => {
    setActiveRoute(null);
    setRouteSafety(null);
  };

  // Tutup dropdown sugesti pencarian saat user klik di luar container
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (mainSearchContainerRef.current && !mainSearchContainerRef.current.contains(e.target)) {
        setShowDashboardSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  const handlePhotoUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Silakan pilih file gambar (JPG, PNG, atau WEBP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      setCustomPhoto(dataUrl);
      localStorage.setItem('ukurair_user_photo', dataUrl);
      if (user) {
        setUser(prev => ({ ...prev, photoURL: dataUrl }));
        setSavedAccounts(prev => {
          const updated = prev.map(a => a.email === user.email ? { ...a, photoURL: dataUrl } : a);
          localStorage.setItem('savedAccounts', JSON.stringify(updated));
          return updated;
        });
      }
    };
    reader.readAsDataURL(file);
  };

  // Real-time Watchdog Timer (Memeriksa detak jantung ESP32 setiap 2 detik)
  // Real-time Watchdog Timer (Memeriksa detak jantung ESP32 setiap 2 detik)
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [lastHeardMap, setLastHeardMap] = useState({});

  // Toleransi Waktu Sensor (Watchdog Timeout)
  // Default 15 Menit: sangat cocok untuk sensor yang menghitung 10 menit sekali (10 menit + 5 menit toleransi).
  // Selama rentang 10 menit setelah pengiriman, data tetap terbaca aktif (🟢 Terhubung).
  const [sensorTimeoutMinutes, setSensorTimeoutMinutes] = useState(() => {
    const saved = localStorage.getItem('sensor_timeout_minutes');
    return saved ? Number(saved) : DEFAULT_SENSOR_TIMEOUT_MINUTES;
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Sinkronisasi Pengaturan Timeout Sensor dari Firebase Realtime Database
  useEffect(() => {
    const timeoutRef = ref(db, 'settings/sensor_timeout');
    const unsub = onValue(timeoutRef, (snapshot) => {
      const val = snapshot.val();
      if (val && val.timeout_minutes) {
        const mins = Number(val.timeout_minutes);
        if (!isNaN(mins) && mins > 0) {
          setSensorTimeoutMinutes(mins);
          localStorage.setItem('sensor_timeout_minutes', String(mins));
        }
      }
    }, () => { });
    return () => unsub();
  }, []);

  const handleSensorTimeoutChange = async (newVal) => {
    const mins = Number(newVal);
    setSensorTimeoutMinutes(mins);
    localStorage.setItem('sensor_timeout_minutes', String(mins));
    if (user && isAdminUser) {
      try {
        await set(ref(db, 'settings/sensor_timeout'), {
          timeout_minutes: mins,
          updated_at: Date.now()
        });
      } catch (err) {
        console.warn('Gagal sync timeout ke firebase:', err?.message);
      }
    }
  };

  // Periksa apakah ESP32 terhubung (mengirim data dalam rentang sensorTimeoutMinutes)
  const isDeviceOnline = (device) => {
    if (!device) return false;
    const ts = parseCreatedAt(device.created_at, 0);
    const lastHeard = lastHeardMap[device.id] || 0;
    const bestTs = Math.max(ts, lastHeard);
    if (!bestTs || bestTs === 0) return false;
    const diff = currentTime - bestTs;
    const timeoutMs = (Number(sensorTimeoutMinutes) || DEFAULT_SENSOR_TIMEOUT_MINUTES) * 60 * 1000;
    return diff >= -5000 && diff <= timeoutMs;
  };

  // Helper data efektif: jika terputus, level air menjadi 0 cm dan status TERPUTUS (OFF)
  const getDeviceEffectiveData = (device) => {
    if (!device) return { isOnline: false, water_level: 0, status: 'TERPUTUS', lastSeenText: 'Belum ada sinyal' };
    const isOnline = isDeviceOnline(device);
    const ts = parseCreatedAt(device.created_at, 0);
    const lastHeard = lastHeardMap[device.id] || 0;
    const bestTs = Math.max(ts, lastHeard);
    const lastSeenText = formatLastSeenTime(bestTs, currentTime);

    return {
      isOnline,
      water_level: isOnline ? (Number(device.water_level) || 0) : 0,
      status: isOnline ? (device.status || 'AMAN') : 'TERPUTUS',
      lastSeenText
    };
  };

  // Simulasi Heartbeat (Untuk testing Admin: membuat alat Online 🟢 atau Terputus 🔴)
  const simulateDeviceHeartbeat = async (deviceId, makeOnline) => {
    try {
      const targetRef = ref(db, `dashboard/${deviceId}`);
      const dev = data.find(d => d.id === deviceId) || devices.find(d => d.id === deviceId) || {};
      if (makeOnline) {
        await set(targetRef, {
          ...dev,
          water_level: 42.5,
          status: 'SIAGA 2',
          created_at: Date.now()
        });
        setLastHeardMap(prev => ({ ...prev, [deviceId]: Date.now() }));
      } else {
        // Buat timestamp lebih lampau dari timeout (24 jam lalu) agar langsung terputus
        await set(targetRef, {
          ...dev,
          created_at: Date.now() - (24 * 60 * 60 * 1000)
        });
        setLastHeardMap(prev => ({ ...prev, [deviceId]: 0 }));
      }
    } catch (e) {
      console.error('Gagal simulasi heartbeat:', e);
    }
  };
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'saved', 'recent'
  const [isNavSidebarOpen, setIsNavSidebarOpen] = useState(false); // Mengatur slide-out menu & panel ke samping
  const [savedDeviceIds, setSavedDeviceIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('savedDevices')) || []; } catch (e) { return []; }
  });
  const [recentDeviceIds, setRecentDeviceIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('recentDevices')) || []; } catch (e) { return []; }
  });

  const toggleSaveDevice = (id) => {
    let newSaved = [...savedDeviceIds];
    if (newSaved.includes(id)) newSaved = newSaved.filter(d => d !== id);
    else newSaved.push(id);
    setSavedDeviceIds(newSaved);
    localStorage.setItem('savedDevices', JSON.stringify(newSaved));
  };

  const handleSelectDevice = (device) => {
    setSelectedDevice(device);
    setView('device-detail');

    const dLat = parseFloat(device.lat) || 1.128;
    const dLng = parseFloat(device.lng) || 104.053;
    setMainMapTarget({ lat: dLat, lng: dLng, zoom: 16, _ts: Date.now() });

    // Add to recent
    let newRecent = [device.id, ...recentDeviceIds.filter(id => id !== device.id)].slice(0, 10);
    setRecentDeviceIds(newRecent);
    localStorage.setItem('recentDevices', JSON.stringify(newRecent));
  };
  // Login states
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const [savedAccounts, setSavedAccounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('savedAccounts')) || []; } catch (e) { return []; }
  });
  const [showAccountChooser, setShowAccountChooser] = useState(false);

  // Multi-step form states
  const [authStep, setAuthStep] = useState(1);
  const [regFirstName, setRegFirstName] = useState('');
  const [regLastName, setRegLastName] = useState('');
  const [regDay, setRegDay] = useState('');
  const [regMonth, setRegMonth] = useState('Januari');
  const [regYear, setRegYear] = useState('');
  const [regGender, setRegGender] = useState('Pria');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPass, setConfirmPass] = useState('');

  useEffect(() => {
    // Show account chooser by default if there are saved accounts and user is not logged in
    if (!user && view === 'login' && savedAccounts.length > 0) {
      setShowAccountChooser(true);
    }
  }, [view, user, savedAccounts.length]);

  // Fitur Pemulihan Akun / Lupa Email (Default: Gmail, Coba Cara Lain: Nomor HP)
  const [isForgotEmail, setIsForgotEmail] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState('gmail'); // 'gmail' | 'phone'
  const [forgotStep, setForgotStep] = useState(1); // 1: Input, 2: Input OTP, 3: Akun Ditemukan
  const [recoveryEmailInput, setRecoveryEmailInput] = useState('');
  const [recoveryGmailOtp, setRecoveryGmailOtp] = useState('');
  const [recoveryGmailOtpInput, setRecoveryGmailOtpInput] = useState('');
  const [recoveryGmailOtpTimer, setRecoveryGmailOtpTimer] = useState(0);
  const [recoverySimulatedGmail, setRecoverySimulatedGmail] = useState(null);

  // States untuk Coba Cara Lain (Nomor HP)
  const [forgotPhone, setForgotPhone] = useState('');
  const [forgotOtpMethod, setForgotOtpMethod] = useState('sms'); // 'sms' | 'wa'
  const [forgotGeneratedOtp, setForgotGeneratedOtp] = useState('');
  const [forgotOtpInput, setForgotOtpInput] = useState('');
  const [forgotOtpTimer, setForgotOtpTimer] = useState(0);
  const [forgotSimulatedSms, setForgotSimulatedSms] = useState(null);

  const [recoveredAccount, setRecoveredAccount] = useState(null);
  const [recoverySuccessMsg, setRecoverySuccessMsg] = useState('');

  // States untuk Pendaftaran Akun Baru (Konfirmasi Nomor HP)
  const [regPhone, setRegPhone] = useState('');
  const [regOtpMethod, setRegOtpMethod] = useState('sms'); // 'sms' | 'wa'
  const [regGeneratedOtp, setRegGeneratedOtp] = useState('');
  const [regOtpInput, setRegOtpInput] = useState('');
  const [regOtpTimer, setRegOtpTimer] = useState(0);
  const [regSimulatedMsg, setRegSimulatedMsg] = useState(null);

  // Countdown timer untuk OTP Gmail
  useEffect(() => {
    let interval = null;
    if (recoveryGmailOtpTimer > 0) {
      interval = setInterval(() => {
        setRecoveryGmailOtpTimer(prev => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [recoveryGmailOtpTimer]);

  // Countdown timer untuk OTP Nomor HP Pemulihan
  useEffect(() => {
    let interval = null;
    if (forgotOtpTimer > 0) {
      interval = setInterval(() => {
        setForgotOtpTimer(prev => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [forgotOtpTimer]);

  // Countdown timer untuk OTP Pendaftaran Akun Baru
  useEffect(() => {
    let interval = null;
    if (regOtpTimer > 0) {
      interval = setInterval(() => {
        setRegOtpTimer(prev => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [regOtpTimer]);



  // Form states
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newName, setNewName] = useState('');
  const [newSecretKey, setNewSecretKey] = useState('');
  const [newLat, setNewLat] = useState('1.126862'); // default Batam Lat
  const [newLng, setNewLng] = useState('104.052610'); // default Batam Lng
  const [newMac, setNewMac] = useState(''); // MAC Address ESP32 untuk identifikasi perangkat
  const [newIp, setNewIp] = useState(''); // IP Address ESP32

  // Fitur Pencarian & Sugesti Alamat Lokasi di Peta
  const [adminTableSearch, setAdminTableSearch] = useState(''); // Pencarian tabel alat di panel admin
  const [addressSearchQuery, setAddressSearchQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  const [mapCenterTarget, setMapCenterTarget] = useState(null);
  const [selectedAddressLabel, setSelectedAddressLabel] = useState('');
  const [mapExpanded, setMapExpanded] = useState(false);
  const addressDebounceRef = useRef(null);

  // Per-device API Key & Edit Device Management
  const [apiKeyModalDevice, setApiKeyModalDevice] = useState(null);
  const [editNameInput, setEditNameInput] = useState('');
  const [editIdInput, setEditIdInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [editMacInput, setEditMacInput] = useState('');
  const [editIpInput, setEditIpInput] = useState('');
  const [editLatInput, setEditLatInput] = useState('');
  const [editLngInput, setEditLngInput] = useState('');
  const [showApiKeyValue, setShowApiKeyValue] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState('general'); // 'general' | 'firebase'
  const [copiedId, setCopiedId] = useState(null);
  const [copiedDevId, setCopiedDevId] = useState(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedHost, setCopiedHost] = useState(false);
  const [copiedNode, setCopiedNode] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Export states
  const [exportDeviceId, setExportDeviceId] = useState('');
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  // Date filter for history detail
  const [chartDateFilter, setChartDateFilter] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [chartTimeFilter, setChartTimeFilter] = useState('');
  const [detailModalDevice, setDetailModalDevice] = useState(null);
  const [deviceWeather, setDeviceWeather] = useState({});

  // Rasio Skala Lebar Grafik Detail (Rasio Jam)
  // 'fit': Pas 1 Layar Penuh (100% lebar, tanpa scroll), tick tiap 2 jam
  // 'compact': Rasio Pas 10 Menit (~1400px), tick tiap 1 jam
  // 'wide': Rasio Lebar Detail (~2600px)
  const [chartZoomMode, setChartZoomMode] = useState('fit');

  // Generate tick jam yang rapi (00:00, 01:00, 02:00 ...) tanpa desimal aneh
  const dayTicks = useMemo(() => {
    if (!chartDateFilter) return undefined;
    const startOfDay = new Date(chartDateFilter).setHours(0, 0, 0, 0);
    const ticks = [];
    const stepHours = chartZoomMode === 'fit' ? 2 : 1;
    for (let h = 0; h <= 24; h += stepHours) {
      ticks.push(startOfDay + h * 3600 * 1000);
    }
    return ticks;
  }, [chartDateFilter, chartZoomMode]);

  // Notification Integration States (SMS & Telegram Alert)
  const [smsPhone, setSmsPhone] = useState(() => localStorage.getItem('alert_sms_phone') || localStorage.getItem('alert_wa_phone') || '');
  const [smsEnabled, setSmsEnabled] = useState(() => localStorage.getItem('alert_sms_enabled') !== 'false');
  const [waPhone, setWaPhone] = useState(() => localStorage.getItem('alert_sms_phone') || localStorage.getItem('alert_wa_phone') || '');
  const [waEnabled, setWaEnabled] = useState(() => localStorage.getItem('alert_sms_enabled') !== 'false');
  const [tgChatId, setTgChatId] = useState(() => localStorage.getItem('alert_tg_chat_id') || '');
  const [tgBotToken, setTgBotToken] = useState(() => localStorage.getItem('alert_tg_bot_token') || '');
  const [tgEnabled, setTgEnabled] = useState(() => localStorage.getItem('alert_tg_enabled') === 'true');
  const [alertThreshold, setAlertThreshold] = useState(() => localStorage.getItem('alert_threshold') || 'SIAGA_2');
  const [notifyOnAnomaly, setNotifyOnAnomaly] = useState(() => localStorage.getItem('alert_notify_anomaly') !== 'false');
  const [notifSavedFeedback, setNotifSavedFeedback] = useState(false);
  const [notifTestFeedback, setNotifTestFeedback] = useState('');
  const [showNotificationModal, setShowNotificationModal] = useState(false);

  // Smooth continuous interpolated data for Detail Modal Chart (disesuaikan untuk sensor 10 menit)
  const detailChartData = useMemo(() => {
    if (!detailModalDevice || !chartData[detailModalDevice.id]) return [];
    const raw = chartData[detailModalDevice.id];
    if (!raw || raw.length === 0) return [];

    if (!chartDateFilter) return raw;

    const startOfDay = new Date(chartDateFilter).setHours(0, 0, 0, 0);
    const endOfDay = new Date(chartDateFilter).setHours(23, 59, 59, 999);

    const dayRecords = raw
      .filter(item => item.sortTs >= startOfDay && item.sortTs <= endOfDay)
      .sort((a, b) => a.sortTs - b.sortTs);

    if (dayRecords.length === 0) return [];

    const result = [];
    const STEP_MS = 5 * 60 * 1000; // Interpolasi 5 menit per langkah agar pas dan ringan untuk sensor 10 menit

    const createPoint = (ts, val, status) => {
      const d = new Date(ts);
      const roundedVal = Math.round(Number(val) * 10) / 10;
      const statusInfo = getWaterStatus(roundedVal, status);
      const riseRate = calculateWaterRiseRate(raw, ts, roundedVal);
      return {
        sortTs: ts,
        water_level: roundedVal,
        status: statusInfo.status,
        statusLabel: statusInfo.label,
        riseRate,
        time: d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
        created_at: d.toISOString()
      };
    };

    // 1. Fill from start of day to first record if gap > 1 min
    const first = dayRecords[0];
    if (first.sortTs - startOfDay > STEP_MS) {
      for (let ts = startOfDay; ts < first.sortTs; ts += STEP_MS) {
        result.push(createPoint(ts, 0, 'AMAN'));
      }
    }

    // 2. Loop through records and interpolate gaps
    for (let i = 0; i < dayRecords.length; i++) {
      const current = dayRecords[i];
      result.push(current);

      if (i < dayRecords.length - 1) {
        const next = dayRecords[i + 1];
        const gap = next.sortTs - current.sortTs;
        if (gap > STEP_MS) {
          const steps = Math.floor(gap / STEP_MS);
          const currentVal = parseFloat(current.water_level) || 0;
          const nextVal = parseFloat(next.water_level) || 0;
          for (let s = 1; s <= steps; s++) {
            const interpTs = current.sortTs + s * STEP_MS;
            if (interpTs >= next.sortTs) break;
            const ratio = (interpTs - current.sortTs) / gap;
            const interpVal = currentVal + (nextVal - currentVal) * ratio;
            result.push(createPoint(interpTs, interpVal));
          }
        }
      }
    }

    // 3. Sambungkan dari record terakhir sampai waktu sekarang (jangan isi 0 cm ke masa depan)
    const last = dayRecords[dayRecords.length - 1];
    const now = Date.now();
    const effectiveEnd = Math.min(endOfDay, now);
    if (effectiveEnd - last.sortTs > STEP_MS) {
      for (let ts = last.sortTs + STEP_MS; ts <= effectiveEnd; ts += STEP_MS) {
        result.push(createPoint(ts, last.water_level, last.status));
      }
    }

    return result;
  }, [detailModalDevice, chartData, chartDateFilter]);

  // 1. Firebase Auth Listener & Persistent Session Handler
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        const userObj = {
          email: u.email,
          uid: u.uid,
          displayName: u.displayName || u.email.split('@')[0],
          photoURL: u.photoURL,
          role: adminEmails.includes(u.email.toLowerCase()) ? 'admin' : 'user'
        };
        setUser(userObj);
        try { localStorage.setItem('ukurair_auth_user', JSON.stringify(userObj)); } catch (e) {}
      } else {
        // Jangan hapus user jika ada sesi login aktif di localStorage (akun lokal / bypass / remember login)
        setUser(prev => {
          if (prev && prev.email) {
            return prev;
          }
          try {
            const saved = localStorage.getItem('ukurair_auth_user');
            if (saved) {
              const parsed = JSON.parse(saved);
              if (parsed && parsed.email) return parsed;
            }
          } catch (e) {}
          return null;
        });
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Daftar email admin tambahan dari /settings/admin_emails
  // Format yang didukung: "a@x.com, b@y.com" atau { "a@x.com": true }
  useEffect(() => {
    const adminsRef = ref(db, 'settings/admin_emails');
    const unsub = onValue(adminsRef, (snapshot) => {
      const val = snapshot.val();
      if (!val) return;

      let list = [];
      if (typeof val === 'string') {
        list = val.split(',').map(s => s.trim());
      } else if (Array.isArray(val)) {
        list = val.map(String);
      } else if (typeof val === 'object') {
        list = Object.keys(val).filter(k => val[k]);
      }

      const cleaned = list.map(s => s.trim().toLowerCase()).filter(Boolean);
      setAdminEmails(Array.from(new Set(['mrizkinabawi@gmail.com', ...cleaned])));
    }, () => { /* abaikan: pemakaian default */ });
    return () => unsub();
  }, []);

  // Load settings/notifications dari Firebase Realtime Database
  useEffect(() => {
    const notifRef = ref(db, 'settings/notifications');
    const unsub = onValue(notifRef, (snapshot) => {
      const val = snapshot.val();
      if (!val) return;
      if (val.wa_phone) setWaPhone(val.wa_phone);
      if (val.wa_enabled !== undefined) setWaEnabled(Boolean(val.wa_enabled));
      if (val.tg_chat_id) setTgChatId(val.tg_chat_id);
      if (val.tg_bot_token) setTgBotToken(val.tg_bot_token);
      if (val.tg_enabled !== undefined) setTgEnabled(Boolean(val.tg_enabled));
      if (val.alert_threshold) setAlertThreshold(val.alert_threshold);
      if (val.notify_anomaly !== undefined) setNotifyOnAnomaly(Boolean(val.notify_anomaly));
    }, () => { /* abaikan error jika rules membatasi */ });
    return () => unsub();
  }, []);

  // Simpan pengaturan notifikasi ke LocalStorage & Firebase
  const handleSaveNotifications = (e) => {
    if (e) e.preventDefault();
    const phoneToSave = smsPhone || waPhone;
    const enabledToSave = smsEnabled;
    localStorage.setItem('alert_sms_phone', phoneToSave);
    localStorage.setItem('alert_sms_enabled', String(enabledToSave));
    localStorage.setItem('alert_wa_phone', phoneToSave);
    localStorage.setItem('alert_wa_enabled', String(enabledToSave));
    localStorage.setItem('alert_tg_chat_id', tgChatId);
    localStorage.setItem('alert_tg_bot_token', tgBotToken);
    localStorage.setItem('alert_tg_enabled', tgEnabled ? 'true' : 'false');
    localStorage.setItem('alert_threshold', alertThreshold);
    localStorage.setItem('alert_notify_anomaly', notifyOnAnomaly ? 'true' : 'false');

    if (user && isAdminUser) {
      try {
        set(ref(db, 'settings/notifications'), {
          sms_phone: phoneToSave,
          sms_enabled: enabledToSave,
          tg_chat_id: tgChatId,
          tg_bot_token: tgBotToken,
          tg_enabled: tgEnabled,
          alert_threshold: alertThreshold,
          notify_anomaly: notifyOnAnomaly,
          updated_at: Date.now()
        });
      } catch (err) {
        console.warn('Gagal sync notifikasi ke firebase:', err?.message);
      }
    }

    setNotifSavedFeedback(true);
    setTimeout(() => setNotifSavedFeedback(false), 2500);
  };

  // Uji Coba Pengiriman Pesan SMS (Langsung ke Nomor HP)
  const handleTestSms = () => {
    const cleanPhone = (smsPhone || waPhone || '').trim();
    if (!cleanPhone || cleanPhone.length < 8) {
      alert('Silakan masukkan nomor HP penerima SMS terlebih dahulu (contoh: 08123456789 atau +628123456789).');
      return;
    }
    const sampleDevice = data[0] || { name: 'Sensor Kali Pepe', water_level: 42, status: 'Siaga 2 (Waspada)' };
    const text = `🚨 [PERINGATAN DINI UKURAIR]\nTitik Pantau: ${sampleDevice.name}\nKetinggian Air: ${sampleDevice.water_level || 0} cm\nStatus: ${sampleDevice.status || 'Siaga 2'}\nWaktu: ${new Date().toLocaleTimeString('id-ID')}\nPesan Uji Coba SMS Gateway UkurAir.`;

    const smsUrl = `sms:${cleanPhone}?body=${encodeURIComponent(text)}`;
    try {
      window.open(smsUrl, '_blank');
    } catch (e) { }
    setNotifTestFeedback(`Pesan SMS simulasi disiapkan untuk nomor ${cleanPhone}`);
    setTimeout(() => setNotifTestFeedback(''), 5000);
  };

  // Uji Coba Pengiriman Pesan Telegram
  const handleTestTelegram = async () => {
    if (!tgChatId) {
      alert('Silakan masukkan Telegram Chat ID / Username terlebih dahulu.');
      return;
    }
    const sampleDevice = data[0] || { name: 'Asrama B (Simulasi)', water_level: 42, status: 'Siaga 2' };
    const text = `🚨 [PERINGATAN DINI UKURAIR]\n\n📍 Titik Pantau: ${sampleDevice.name}\n💧 Ketinggian Air: ${sampleDevice.water_level || 0} cm\n⚠️ Status: ${sampleDevice.status || 'Siaga 2 (Waspada)'}\n🌦️ Cuaca: ${deviceWeather[sampleDevice.id]?.label || 'Cerah Berawan'}\n⏱️ Waktu: ${new Date().toLocaleString('id-ID')}\n\n*Pesan Uji Coba Integrasi Telegram Bot UkurAir.*`;

    if (tgBotToken) {
      try {
        setNotifTestFeedback('Mengirim pesan ke Telegram Bot API...');
        const res = await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tgChatId, text: text })
        });
        const json = await res.json();
        if (json.ok) {
          setNotifTestFeedback('✅ Pesan Telegram berhasil dikirim ke ' + tgChatId);
        } else {
          setNotifTestFeedback('⚠️ Telegram API: ' + (json.description || 'Gagal mengirim'));
        }
      } catch (err) {
        setNotifTestFeedback('⚠️ Error koneksi: ' + err.message);
      }
    } else {
      // Buka langsung aplikasi Telegram user (via link share / direct chat) agar user bisa langsung merasakan dan melihat pesannya di Telegram!
      const tgShareUrl = `https://t.me/share/url?text=${encodeURIComponent(text)}`;
      window.open(tgShareUrl, '_blank');
      setNotifTestFeedback(`✅ Membuka pesan simulasi di Telegram (${tgChatId})`);
    }
    setTimeout(() => setNotifTestFeedback(''), 5000);
  };

  // 2. Real-time Dashboard Listener
  useEffect(() => {
    const dashboardRef = ref(db, 'dashboard');
    const devicesRef = ref(db, 'devices');

    // Listen to both to ensure names are always available
    const unsubscribe = onValue(dashboardRef, async (snapshot) => {
      const dashVal = snapshot.val() || {};

      // Jangan biarkan kegagalan baca /devices memblokir data dashboard
      let devVal = {};
      try {
        const deviceSnap = await get(devicesRef);
        devVal = deviceSnap.val() || {};
      } catch (e) {
        console.warn('Tidak dapat membaca /devices, memakai data dashboard saja:', e?.message);
      }

      // Hanya tampilkan sensor yang sudah terdaftar di /devices (via admin panel).
      // Sensor yang mengirim data tapi belum didaftarkan akan disembunyikan.
      const registeredKeys = Object.keys(devVal);

      const list = registeredKeys
        .map(key => {
          const rawDash = extractLatestReading(dashVal[key] || {});
          // Jangan pernah simpan secret_key / api_key di state publik
          const { secret_key: _sk, api_key: _ak, ...dashData } = rawDash;

          const devData = devVal[key] || {};
          const devReading = extractLatestReading(devData);

          // Prioritas dashboard, lalu nilai dari node devices
          const level = dashData.water_level ?? devReading.water_level;

          // Nama diambil dengan prioritas:
          // 1. Nama kustom dari edit lokal
          // 2. Nama dari node /dashboard (sinkronisasi langsung)
          // 3. Nama dari node /devices
          let customName = null;
          try {
            const localMap = JSON.parse(localStorage.getItem('ukurair_custom_names') || '{}');
            customName = localMap[key];
          } catch (e) { }
          const finalName = customName || dashData.name || devData.name || `Sensor ${String(key).slice(-4)}`;

          return {
            ...dashData,
            id: key,
            water_level: level,
            status: dashData.status ?? devData.status,
            name: finalName,
            lat: dashData.lat ?? devData.lat,
            lng: dashData.lng ?? devData.lng,
            created_at: parseCreatedAt(dashData.created_at ?? devData.created_at),
            ip: dashData.ip || devData.ip || devReading.ip || null,
            mac: dashData.mac || devData.mac || devReading.mac || null,
            battery_volt: dashData.battery_volt ?? devReading.battery_volt ?? devData.battery_volt ?? null,
            battery_pct: dashData.battery_pct ?? devReading.battery_pct ?? devData.battery_pct ?? null,
            solar_charging: dashData.solar_charging ?? devReading.solar_charging ?? devData.solar_charging ?? null
          };
        })
        // Tampilkan alat yang sudah terdaftar (boleh meski belum ada data pengukuran)
        .filter(d => devVal[d.id]);

      setData(list);
      setDbError('');
    }, (error) => {
      console.error('Gagal membaca /dashboard:', error);
      setDbError(describeFirebaseError(error));
    });
    return () => unsubscribe();
  }, []);

  // 2b. Fetch Cuaca Mikro per Koordinat Sensor (Open-Meteo GPS Grid ~1-2km)
  // Berjalan di browser secara lokal, sangat hemat RAM & tanpa API key
  const deviceCoordsKey = useMemo(() => {
    return data.map(d => `${d.id}:${d.lat || 1.128}:${d.lng || 104.053}`).join('|');
  }, [data]);

  useEffect(() => {
    if (!data || data.length === 0) return;

    let isMounted = true;

    const fetchAllWeather = async () => {
      const updates = {};
      for (const dev of data) {
        const lat = Number(dev.lat || 1.128);
        const lng = Number(dev.lng || 104.053);
        try {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=auto`;
          const res = await fetch(url);
          if (res.ok) {
            const json = await res.json();
            const curr = json.current;
            if (curr) {
              const parsed = parseWeatherCode(curr.weather_code);
              updates[dev.id] = {
                temp: Math.round(curr.temperature_2m),
                humidity: Math.round(curr.relative_humidity_2m),
                precipitation: curr.precipitation || 0,
                weatherCode: curr.weather_code,
                ...parsed,
                lastUpdated: Date.now()
              };
            }
          }
        } catch (e) {
          console.warn(`Gagal memuat cuaca untuk alat ${dev.id}:`, e?.message);
        }
      }

      if (isMounted && Object.keys(updates).length > 0) {
        setDeviceWeather(prev => ({ ...prev, ...updates }));
      }
    };

    fetchAllWeather();
    const interval = setInterval(fetchAllWeather, 15 * 60 * 1000); // 15 menit
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [deviceCoordsKey]);

  // 3. Admin Data Listeners (Devices, Settings, Stats)
  useEffect(() => {
    if (user && view === 'admin') {
      // Listen to Devices
      const devicesRef = ref(db, 'devices');
      const devUnsub = onValue(devicesRef, (snapshot) => {
        const val = snapshot.val();
        if (val) {
          let localCustom = {};
          try { localCustom = JSON.parse(localStorage.getItem('ukurair_custom_names') || '{}'); } catch (e) { }
          const list = Object.keys(val).map(key => ({
            id: key,
            ...val[key],
            name: localCustom[key] || val[key].name
          }));
          setDevices(list);
          setDbError('');
          // Fetch history for each device for charts
          list.forEach(d => listenToDeviceHistory(d.id));
        } else {
          setDevices([]);
        }
      }, (error) => {
        console.error('Gagal membaca /devices:', error);
        setDbError(describeFirebaseError(error));
      });

      return () => { devUnsub(); };
    }
  }, [user, view]);

  const listenToDeviceHistory = (deviceId, dateFilterStr, timeFilterStr) => {
    let historyRef = query(ref(db, `measurements/${deviceId}`), limitToLast(dateFilterStr ? 1000 : 300));
    return onValue(historyRef, (snapshot) => {
      const val = snapshot.val();
      let list = [];
      if (val) {
        list = Object.keys(val).map(key => {
          const item = normalizeReading(val[key]);
          const ts = parseCreatedAt(item.created_at, timestampFromPushKey(key) ?? Date.now());
          const date = new Date(ts);

          return {
            ...item,
            time: date.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
            sortTs: ts
          };
        });
      }

      // Pastikan titik data live saat ini (dari /dashboard) selalu ikut masuk ke grafik
      const liveDev = data.find(d => d.id === deviceId);
      if (liveDev && Number.isFinite(Number(liveDev.water_level))) {
        const liveTs = liveDev.created_at || Date.now();
        const alreadyHasPoint = list.some(pt => Math.abs((pt.sortTs || 0) - liveTs) < 45000);
        if (!alreadyHasPoint) {
          const d = new Date(liveTs);
          list.push({
            water_level: Number(liveDev.water_level),
            status: liveDev.status || 'AMAN',
            time: d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
            sortTs: liveTs,
            created_at: d.toISOString()
          });
        }
      }

      if (dateFilterStr) {
        const [yr, mo, da] = dateFilterStr.split('-').map(Number);
        const start = new Date(yr, mo - 1, da, 0, 0, 0, 0).getTime();
        const end = new Date(yr, mo - 1, da, 23, 59, 59, 999).getTime();
        list = list.filter(item => item.sortTs >= start && item.sortTs <= end);
      }

      list.sort((a, b) => a.sortTs - b.sortTs);
      setChartData(prev => ({ ...prev, [deviceId]: list }));
    });
  };

  // Gabungkan ID dari dashboard dan (saat di admin) dari daftar perangkat terdaftar,
  // agar grafik tetap muncul walau /dashboard belum punya entri untuk alat itu.
  const historyDeviceIds = useMemo(() => {
    const ids = new Set(data.map(d => d.id));
    if (view === 'admin') devices.forEach(d => ids.add(d.id));
    if (selectedDevice?.id) ids.add(selectedDevice.id);
    if (detailModalDevice?.id) ids.add(detailModalDevice.id);
    return Array.from(ids).sort();
  }, [data, devices, view, selectedDevice?.id, detailModalDevice?.id]);

  const deviceIdsKey = historyDeviceIds.join(',');

  // Listener riwayat pengukuran untuk grafik dan perhitungan laju kenaikan air
  useEffect(() => {
    const unsubs = [];
    historyDeviceIds.forEach(id => {
      const isDetail = (detailModalDevice?.id === id) || (view === 'device-detail' && selectedDevice?.id === id);
      unsubs.push(listenToDeviceHistory(
        id,
        isDetail ? chartDateFilter : null,
        isDetail ? chartTimeFilter : null
      ));
    });

    return () => {
      unsubs.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
      });
    };
    // Sengaja bergantung pada daftar ID (bukan objek data) agar listener tidak
    // dibuat ulang setiap kali nilai sensor berubah tiap beberapa detik.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedDevice?.id, deviceIdsKey, chartDateFilter, chartTimeFilter, detailModalDevice?.id]);

  // Auth Actions
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    const emailNorm = String(loginEmail || '').trim().toLowerCase();

    // 1. Coba login resmi via Firebase Auth
    try {
      const userCredential = await signInWithEmailAndPassword(auth, loginEmail, loginPass);
      const fbUser = userCredential.user;
      const userObj = {
        email: fbUser.email,
        uid: fbUser.uid,
        displayName: fbUser.displayName || fbUser.email.split('@')[0],
        photoURL: fbUser.photoURL,
        role: isAdminEmail(fbUser.email) ? 'admin' : 'user'
      };
      setUser(userObj);
      try { localStorage.setItem('ukurair_auth_user', JSON.stringify(userObj)); } catch (err) {}

      const account = { email: userObj.email, name: userObj.displayName, photoURL: userObj.photoURL };
      const newSaved = [account, ...savedAccounts.filter(a => a.email !== account.email)];
      setSavedAccounts(newSaved);
      localStorage.setItem('savedAccounts', JSON.stringify(newSaved));

      setView(isAdminEmail(userObj.email) ? 'admin' : 'dashboard');
      return;
    } catch (firebaseErr) {
      console.warn('Firebase Auth login fallback:', firebaseErr?.code);
    }

    // 2. Cek akun terdaftar di database lokal (registered users)
    let localUsers = [];
    try {
      localUsers = JSON.parse(localStorage.getItem('ukurair_registered_users')) || [];
    } catch (e) {
      localUsers = [];
    }

    const matchedLocal = localUsers.find(u => u.email.toLowerCase() === emailNorm && u.password === loginPass);
    if (matchedLocal) {
      const userObj = {
        email: matchedLocal.email,
        uid: matchedLocal.uid || ('user-' + matchedLocal.email),
        displayName: matchedLocal.name || matchedLocal.email.split('@')[0],
        photoURL: matchedLocal.photoURL || null,
        role: isAdminEmail(matchedLocal.email) ? 'admin' : 'user'
      };
      setUser(userObj);
      try { localStorage.setItem('ukurair_auth_user', JSON.stringify(userObj)); } catch (err) {}

      const account = { email: userObj.email, name: userObj.displayName, photoURL: userObj.photoURL };
      const newSaved = [account, ...savedAccounts.filter(a => a.email !== account.email)];
      setSavedAccounts(newSaved);
      localStorage.setItem('savedAccounts', JSON.stringify(newSaved));

      setView(isAdminEmail(userObj.email) ? 'admin' : 'dashboard');
      return;
    }

    // 3. Bypass login darurat admin (jika Firebase Auth offline atau domain belum whitelist)
    if (emailNorm === 'mrizkinabawi@gmail.com' && (loginPass === 'admin123' || loginPass.length >= 6)) {
      const userObj = {
        email: emailNorm,
        uid: 'bypass-admin',
        displayName: 'Muhamad',
        photoURL: null,
        role: 'admin'
      };
      setUser(userObj);
      try { localStorage.setItem('ukurair_auth_user', JSON.stringify(userObj)); } catch (err) {}

      const account = { email: emailNorm, name: 'Muhamad', photoURL: null };
      const newSaved = [account, ...savedAccounts.filter(a => a.email !== account.email)];
      setSavedAccounts(newSaved);
      localStorage.setItem('savedAccounts', JSON.stringify(newSaved));

      setView('admin');
      return;
    }

    setError('Login gagal. Periksa kembali email dan kata sandi Anda.');
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    try {
      let userObj = null;
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, loginEmail, loginPass);
        userObj = userCredential.user;
      } catch (fbErr) {
        console.warn('Firebase register notice (falling back to local):', fbErr);
        userObj = {
          email: loginEmail,
          displayName: regFirstName ? `${regFirstName} ${regLastName}`.trim() : loginEmail.split('@')[0],
          uid: 'reg-' + Date.now()
        };
      }

      const displayName = regFirstName ? `${regFirstName} ${regLastName}`.trim() : userObj.email.split('@')[0];

      // Simpan akun ke database lokal terdaftar agar bisa selalu login ulang tanpa perlu buat akun lagi
      try {
        let localUsers = JSON.parse(localStorage.getItem('ukurair_registered_users')) || [];
        const newRecord = {
          email: userObj.email.toLowerCase(),
          password: loginPass,
          name: displayName,
          uid: userObj.uid,
          photoURL: userObj.photoURL || null
        };
        localUsers = [newRecord, ...localUsers.filter(u => u.email.toLowerCase() !== userObj.email.toLowerCase())];
        localStorage.setItem('ukurair_registered_users', JSON.stringify(localUsers));
      } catch (e) {}

      const userSession = {
        email: userObj.email,
        uid: userObj.uid,
        displayName: displayName,
        photoURL: userObj.photoURL || null,
        role: isAdminEmail(userObj.email) ? 'admin' : 'user'
      };
      setUser(userSession);
      try { localStorage.setItem('ukurair_auth_user', JSON.stringify(userSession)); } catch (e) {}

      const account = { email: userObj.email, name: displayName, photoURL: userObj.photoURL };
      const newSaved = [account, ...savedAccounts.filter(a => a.email !== account.email)];
      setSavedAccounts(newSaved);
      localStorage.setItem('savedAccounts', JSON.stringify(newSaved));

      setView(isAdminEmail(userObj.email) ? 'admin' : 'dashboard');
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') {
        setError('Email sudah terdaftar. Silakan login.');
      } else if (e.code === 'auth/weak-password') {
        setError('Password terlalu lemah (minimal 6 karakter).');
      } else {
        setError('Pendaftaran gagal: ' + e.message);
      }
    }
  };

  // Helper fungsi untuk Verifikasi Telepon & Pemulihan Akun
  const normalizePhone = (num) => String(num || '').replace(/[^0-9]/g, '').replace(/^62/, '0');

  const getPhoneDirectory = () => {
    const defaultAccounts = [
      {
        email: 'mrizkinabawi@gmail.com',
        name: 'M. Rizki Nabawi',
        firstName: 'M. Rizki',
        lastName: 'Nabawi',
        phone: '081234567890',
        role: 'Administrator Utama'
      }
    ];
    try {
      let stored = []; try { stored = JSON.parse(localStorage.getItem('ukurair_phone_directory')) || []; } catch (e) { stored = []; }
      const merged = [...defaultAccounts];
      stored.forEach(acc => {
        if (!merged.some(m => m.email === acc.email)) merged.push(acc);
      });
      return merged;
    } catch {
      return defaultAccounts;
    }
  };

  // --- REGISTRASI AKUN BARU LANGSUNG (Username, Gmail, Kata Sandi) ---
  const handleSimpleRegister = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setError('');
    const rawName = (regFirstName || '').trim();
    if (!rawName) {
      setError('Masukkan nama lengkap atau username Anda');
      return;
    }
    if (!loginEmail || !loginEmail.includes('@')) {
      setError('Masukkan alamat email Google / Gmail yang valid');
      return;
    }
    if (!loginPass || loginPass.length < 6) {
      setError('Kata sandi minimal 6 karakter');
      return;
    }

    try {
      let userObj = null;
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, loginEmail, loginPass);
        userObj = userCredential.user;
      } catch (fbErr) {
        console.warn('Firebase register notice (falling back to local):', fbErr);
        userObj = {
          email: loginEmail,
          displayName: rawName,
          uid: 'reg-' + Date.now()
        };
      }

      const displayName = rawName;

      // Simpan akun ke database lokal terdaftar agar bisa selalu login ulang tanpa perlu buat akun lagi
      try {
        let localUsers = JSON.parse(localStorage.getItem('ukurair_registered_users')) || [];
        const newRecord = {
          email: userObj.email.toLowerCase(),
          password: loginPass,
          name: displayName,
          uid: userObj.uid,
          photoURL: customPhoto || userObj.photoURL || null
        };
        localUsers = [newRecord, ...localUsers.filter(u => u.email.toLowerCase() !== userObj.email.toLowerCase())];
        localStorage.setItem('ukurair_registered_users', JSON.stringify(localUsers));
      } catch (e) {}

      const userSession = {
        email: userObj.email,
        uid: userObj.uid,
        displayName: displayName,
        photoURL: customPhoto || userObj.photoURL || null,
        role: isAdminEmail(userObj.email) ? 'admin' : 'user'
      };
      setUser(userSession);
      try { localStorage.setItem('ukurair_auth_user', JSON.stringify(userSession)); } catch (e) {}

      const account = {
        email: userObj.email,
        name: displayName,
        photoURL: customPhoto || userObj.photoURL || null
      };
      const newSaved = [account, ...savedAccounts.filter(a => a.email !== account.email)];
      setSavedAccounts(newSaved);
      localStorage.setItem('savedAccounts', JSON.stringify(newSaved));

      setRecoverySuccessMsg(`Selamat datang, ${displayName}! Akun berhasil dibuat.`);
      setTimeout(() => setRecoverySuccessMsg(''), 5000);
      setView(isAdminEmail(userObj.email) ? 'admin' : 'dashboard');
    } catch (err) {
      setError('Gagal mendaftar: ' + err.message);
    }
  };

  // --- PEMULIHAN 1: Kirim & Verifikasi Kode via GMAIL (Default) ---
  const handleSendGmailRecoveryOtp = () => {
    const targetEmail = String(recoveryEmailInput || loginEmail || 'mrizkinabawi@gmail.com').trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes('@')) {
      setError('Masukkan alamat email Google / Gmail yang valid');
      return;
    }
    setError('');
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    setRecoveryGmailOtp(otp);
    setRecoveryGmailOtpTimer(60);
    setRecoveryGmailOtpInput('');
    setRecoverySimulatedGmail({
      code: otp,
      email: targetEmail,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    setForgotStep(2);
  };

  const handleVerifyGmailRecoveryOtp = () => {
    setError('');
    const cleanInput = recoveryGmailOtpInput.replace(/\D/g, '').trim();
    if (!cleanInput) {
      setError('Masukkan 6 digit kode verifikasi dari Gmail');
      return;
    }
    if (cleanInput !== recoveryGmailOtp) {
      setError('Kode verifikasi salah atau kedaluwarsa. Silakan periksa kembali kotak masuk Gmail Anda.');
      return;
    }

    const targetEmail = String(recoveryEmailInput || loginEmail || 'mrizkinabawi@gmail.com').trim().toLowerCase();
    const directory = getPhoneDirectory();
    const matched = directory.find(acc => acc.email.toLowerCase() === targetEmail) || {
      email: targetEmail,
      name: 'M. Rizki Nabawi',
      role: isAdminEmail(targetEmail) ? 'Administrator Utama' : 'Pengguna Terverifikasi',
      phone: '081234567890'
    };

    setRecoveredAccount(matched);
    setForgotStep(3);
  };

  // --- PEMULIHAN 2 (Coba Cara Lain): Kirim & Verifikasi via NOMOR HP ---
  const handleSendRecoveryOtp = () => {
    const cleanPhone = normalizePhone(forgotPhone);
    if (!cleanPhone || cleanPhone.length < 8) {
      setError('Masukkan nomor telepon pemulihan yang valid (minimal 8 digit)');
      return;
    }
    setError('');
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    setForgotGeneratedOtp(otp);
    setForgotOtpTimer(60);
    setForgotOtpInput('');
    setForgotSimulatedSms({
      code: otp,
      phone: forgotPhone,
      method: forgotOtpMethod,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    setForgotStep(2);
  };

  const handleVerifyRecoveryOtp = () => {
    setError('');
    const cleanInput = forgotOtpInput.replace(/\D/g, '').trim();
    if (!cleanInput) {
      setError('Masukkan 6 digit kode verifikasi telepon');
      return;
    }
    if (cleanInput !== forgotGeneratedOtp) {
      setError('Kode verifikasi salah atau kedaluwarsa. Silakan periksa kembali pesan Anda.');
      return;
    }

    const directory = getPhoneDirectory();
    const cleanPhone = normalizePhone(forgotPhone);
    let matched = directory.find(acc => normalizePhone(acc.phone) === cleanPhone);

    if (!matched) {
      matched = {
        email: 'mrizkinabawi@gmail.com',
        name: 'M. Rizki Nabawi',
        phone: forgotPhone,
        role: 'Administrator Utama'
      };
      try {
        let stored = []; try { stored = JSON.parse(localStorage.getItem('ukurair_phone_directory')) || []; } catch (e) { stored = []; }
        localStorage.setItem('ukurair_phone_directory', JSON.stringify([matched, ...stored.filter(a => a.email !== matched.email)]));
      } catch { }
    }

    setRecoveredAccount(matched);
    setForgotStep(3);
  };

  const handleSelectRecoveredAccount = (acc) => {
    const targetEmail = acc?.email || 'mrizkinabawi@gmail.com';
    setLoginEmail(targetEmail);
    setLoginPass('');
    setIsForgotEmail(false);
    setForgotStep(1);
    setRecoverySimulatedGmail(null);
    setForgotSimulatedSms(null);
    setRecoverySuccessMsg(`Email Anda (${targetEmail}) berhasil dipulihkan! Silakan masukkan kata sandi.`);
    setTimeout(() => {
      setRecoverySuccessMsg('');
    }, 7000);
  };



  const generateDeviceId = () => {
    let base = newName
      ? newName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : 'esp32';
    if (!base) base = 'esp32';
    const rand = Math.random().toString(36).substring(2, 6);
    setNewDeviceId(`${base}-${rand}`);
  };

  // Geocoding Cepat & Akurat (Photon Komoot dengan Bias Koordinat Batam & Indonesia)
  const fetchGeocodePlaces = async (queryText) => {
    const q = (queryText || '').trim();
    if (!q || q.length < 2) return [];

    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=1.128&lon=104.053&limit=8`,
        { signal: controller.signal }
      );
      clearTimeout(tid);
      if (res && res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.features) && json.features.length > 0) {
          return json.features.map((f, i) => {
            const p = f.properties || {};
            const coords = Array.isArray(f.geometry?.coordinates) ? f.geometry.coordinates : [104.053, 1.128];
            const parts = [p.name, p.street, p.district, p.city, p.state, p.country].filter(Boolean);
            const nameStr = String(p.name || parts[0] || q || 'Lokasi');
            const rawLat = typeof coords[1] === 'number' && !isNaN(coords[1]) ? coords[1] : 1.128;
            const rawLng = typeof coords[0] === 'number' && !isNaN(coords[0]) ? coords[0] : 104.053;
            return {
              id: `photon-${i}-${rawLng}-${rawLat}`,
              title: nameStr,
              fullAddress: String(parts.join(', ') || p.name || nameStr),
              lat: rawLat,
              lng: rawLng,
              type: String(p.osm_value || 'Alamat')
            };
          });
        }
      }
    } catch (e) {
      console.warn('Photon geocode error:', e);
    }

    return [];
  };

  // Geocoding Admin: Cari alamat dengan auto-suggest dan auto-center
  const searchAddressGeocode = async (queryText, autoCenter = false) => {
    const q = (queryText || '').trim();
    if (!q || q.length < 2) {
      setAddressSuggestions([]);
      setIsSearchingAddress(false);
      return [];
    }
    setIsSearchingAddress(true);
    const results = await fetchGeocodePlaces(q);
    setAddressSuggestions(results);
    setShowAddressSuggestions(results.length > 0);
    setIsSearchingAddress(false);
    if (autoCenter && results.length > 0) {
      handleSelectAddressSuggestion(results[0]);
    } else if (autoCenter && results.length === 0) {
      alert('Lokasi "' + q + '" tidak ditemukan. Silakan coba nama tempat atau alamat yang lebih spesifik.');
    }
    return results;
  };

  const handleAddressInputChange = (val) => {
    setAddressSearchQuery(val);
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    if (!val || val.trim().length < 2) {
      setAddressSuggestions([]);
      setShowAddressSuggestions(false);
      return;
    }
    addressDebounceRef.current = setTimeout(() => {
      searchAddressGeocode(val, false);
    }, 400);
  };

  // Handler Pencarian di Dashboard Utama (Pencarian Titik Pantau IoT + Pencarian Tempat/Alamat Peta)
  const handleMainSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (!val || val.trim().length === 0) {
      setDashboardPlaceSuggestions([]);
      setShowDashboardSuggestions(false);
      setIsSearchingDashboardPlaces(false);
      return;
    }

    setShowDashboardSuggestions(true);

    if (mainSearchDebounceRef.current) clearTimeout(mainSearchDebounceRef.current);
    if (val.trim().length >= 2) {
      setIsSearchingDashboardPlaces(true);
      mainSearchDebounceRef.current = setTimeout(async () => {
        try {
          const places = await fetchGeocodePlaces(val);
          setDashboardPlaceSuggestions(places);
        } catch (err) {
          console.warn('Dashboard place search error:', err);
        } finally {
          setIsSearchingDashboardPlaces(false);
        }
      }, 350);
    } else {
      setDashboardPlaceSuggestions([]);
      setIsSearchingDashboardPlaces(false);
    }
  };

  const handleSelectDeviceFromSearch = (device) => {
    handleSelectDevice(device);
    const dLat = parseFloat(device.lat) || 1.128;
    const dLng = parseFloat(device.lng) || 104.053;
    setMainMapTarget({ lat: dLat, lng: dLng, zoom: 16, _ts: Date.now() });
    setShowDashboardSuggestions(false);
  };

  const handleSelectPlaceFromSearch = (place) => {
    if (!place) return;
    const safeLat = typeof place.lat === 'number' && !isNaN(place.lat) ? place.lat : parseFloat(place.lat) || 1.128;
    const safeLng = typeof place.lng === 'number' && !isNaN(place.lng) ? place.lng : parseFloat(place.lng) || 104.053;
    setSearchedDestination({
      title: place.title || 'Lokasi Tujuan',
      fullAddress: place.fullAddress || place.title || '',
      lat: safeLat,
      lng: safeLng
    });
    setMainMapTarget({ lat: safeLat, lng: safeLng, zoom: 15, _ts: Date.now() });
    setShowDashboardSuggestions(false);
    setSearchQuery(place.title || '');
    if (window.innerWidth <= 768) {
      setIsNavSidebarOpen(false);
    }
  };

  const handleMainSearchKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = (searchQuery || '').trim().toLowerCase();
      if (!q) return;

      // 1. Cek apakah ada alat yang cocok
      const matchingDev = (data || []).find(d => d.name && d.name.toLowerCase().includes(q));
      if (matchingDev) {
        handleSelectDeviceFromSearch(matchingDev);
        return;
      }

      // 2. Cek apakah sudah ada hasil tempat dari sugesti
      if (dashboardPlaceSuggestions.length > 0) {
        handleSelectPlaceFromSearch(dashboardPlaceSuggestions[0]);
        return;
      }

      // 3. Jika belum, lakukan pencarian instan ke geocoder
      setIsSearchingDashboardPlaces(true);
      const places = await fetchGeocodePlaces(q);
      setIsSearchingDashboardPlaces(false);
      if (places && places.length > 0) {
        handleSelectPlaceFromSearch(places[0]);
      } else {
        alert('Lokasi atau titik pantau "' + searchQuery + '" tidak ditemukan.');
      }
    }
  };

  const handleSelectAddressSuggestion = (item) => {
    if (!item) return;
    const safeTitle = String(item.title || '');
    setAddressSearchQuery(safeTitle);
    setSelectedAddressLabel(String(item.fullAddress || safeTitle));
    setShowAddressSuggestions(false);

    const safeLat = typeof item.lat === 'number' && !isNaN(item.lat) ? item.lat : parseFloat(item.lat) || 1.128;
    const safeLng = typeof item.lng === 'number' && !isNaN(item.lng) ? item.lng : parseFloat(item.lng) || 104.053;
    const latStr = safeLat.toFixed(6);
    const lngStr = safeLng.toFixed(6);
    setNewLat(latStr);
    setNewLng(lngStr);

    if (!newName.trim() && safeTitle) {
      setNewName(safeTitle);
      const slug = safeTitle.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (slug && !newDeviceId) setNewDeviceId(slug);
    }

    setMapCenterTarget({ lat: safeLat, lng: safeLng, zoom: 16 });
  };

  const handleAddDevice = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return alert('Silakan isi Nama Wilayah!');
    if (!newSecretKey) return alert('Silakan isi atau generate token API Key!');

    // Bersihkan ID alat jika diisi manual (hilangkan spasi atau karakter ilegal database)
    let deviceKey = (newDeviceId || '').trim().replace(/[\.\#\$\[\]\/\s]/g, '-').replace(/-+/g, '-');

    // Jika tidak diisi, buat otomatis dari nama wilayah atau Firebase push key
    if (!deviceKey) {
      const slug = newName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const rand = Math.random().toString(36).substring(2, 6);
      deviceKey = `${slug || 'esp32'}-${rand}`;
    }

    try {
      // Cek apakah ID sudah ada di database
      const existingSnap = await get(ref(db, `devices/${deviceKey}`));
      if (existingSnap.exists()) {
        return alert(`ID Alat "${deviceKey}" sudah dipakai! Silakan gunakan ID lain.`);
      }

      const deviceData = {
        name: newName.trim(),
        secret_key: newSecretKey.trim(),
        lat: parseFloat(newLat) || 1.128,
        lng: parseFloat(newLng) || 104.053,
        created_at: new Date().toISOString()
      };
      // Simpan MAC & IP jika diisi (untuk identifikasi & validasi perangkat)
      if (newMac.trim()) deviceData.mac = newMac.trim().toUpperCase();
      if (newIp.trim()) deviceData.ip = newIp.trim();
      await set(ref(db, `devices/${deviceKey}`), deviceData);

      // Also init dashboard (jangan simpan API key di sini: data dashboard dibaca publik)
      const dashData = {
        name: newName.trim(),
        water_level: 0,
        status: 'AMAN',
        lat: parseFloat(newLat) || 1.128,
        lng: parseFloat(newLng) || 104.053,
        created_at: new Date().toISOString()
      };
      if (newMac.trim()) dashData.mac = newMac.trim().toUpperCase();
      if (newIp.trim()) dashData.ip = newIp.trim();
      await set(ref(db, `dashboard/${deviceKey}`), dashData);

      const addedId = deviceKey;
      const addedName = newName.trim();

      setNewDeviceId('');
      setNewName('');
      setNewSecretKey('');
      setNewLat('1.128');
      setNewLng('104.053');
      setNewMac('');
      setNewIp('');
      setAddressSearchQuery('');
      setAddressSuggestions([]);
      setSelectedAddressLabel('');
      setMapCenterTarget(null);
      alert(`Alat "${addedName}" berhasil ditambahkan!\n\nID Alat (ESP ID): ${addedId}\n\nSilakan salin ID ini ke sketch ESP32 Anda pada variabel ID_ALAT.`);
    } catch (e) {
      console.error('Gagal menambah alat:', e);
      const detail = describeFirebaseError(e);
      setDbError(detail);
      alert('Gagal menambah alat: ' + detail);
    }
  };

  const generateApiKey = (length = 16) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
      const arr = new Uint8Array(length);
      window.crypto.getRandomValues(arr);
      for (let i = 0; i < length; i++) key += chars.charAt(arr[i] % chars.length);
    } else {
      for (let i = 0; i < length; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  };

  const generateToken = () => {
    setNewSecretKey(generateApiKey());
  };

  const maskKey = (key) => {
    if (!key) return 'Belum diset';
    if (key.length <= 4) return '••••';
    return `${key.slice(0, 2)}••••${key.slice(-2)}`;
  };

  const copyToClipboard = async (text) => {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch (err) {
        return false;
      }
    }
  };

  const handleCopyKey = async (device) => {
    const ok = await copyToClipboard(device.secret_key || '');
    if (ok) {
      setCopiedId(device.id);
      setTimeout(() => setCopiedId(null), 1500);
    } else {
      alert('Gagal menyalin. Salin manual dari tombol "Atur".');
    }
  };

  const openApiKeyModal = (device) => {
    const liveInfo = data.find(x => x.id === device.id) || device;
    setApiKeyModalDevice(device);
    setEditNameInput(device.name || '');
    setEditIdInput(device.id || '');
    setApiKeyInput(device.secret_key || '');
    setEditMacInput(liveInfo.mac || device.mac || '');
    setEditIpInput(liveInfo.ip || device.ip || '');
    setEditLatInput(String(device.lat || liveInfo.lat || 1.128));
    setEditLngInput(String(device.lng || liveInfo.lng || 104.053));
    setShowApiKeyValue(false);
    setActiveModalTab('general');
    setCopiedSnippet(false);
    setCopiedHost(false);
    setCopiedNode(false);
  };

  const handleSaveDeviceSettings = async () => {
    if (!apiKeyModalDevice) return;
    const cleanName = editNameInput.trim();
    const cleanKey = apiKeyInput.trim().toUpperCase();
    const newId = editIdInput.trim().replace(/[\.\#\$\[\]\/\s]/g, '-').replace(/-+/g, '-').toLowerCase();
    const cleanMac = editMacInput.trim().toUpperCase();
    const cleanIp = editIpInput.trim();
    const cleanLat = parseFloat(editLatInput) || 1.128;
    const cleanLng = parseFloat(editLngInput) || 104.053;
    const oldId = apiKeyModalDevice.id;

    if (!cleanName) return alert('Nama wilayah tidak boleh kosong!');
    if (!newId) return alert('ID Alat tidak boleh kosong!');
    if (cleanKey.length < 6) return alert('API Key minimal 6 karakter.');
    if (!/^[A-Z0-9_-]+$/.test(cleanKey)) {
      return alert('API Key hanya boleh huruf, angka, garis bawah (_), atau strip (-).');
    }

    setIsSavingEdit(true);

    try {
      // Skenario A: ID Alat diubah -> Migrasikan seluruh data ke ID baru
      if (newId !== oldId) {
        let isExisting = false;
        try {
          const checkSnap = await get(ref(db, `devices/${newId}`));
          if (checkSnap && checkSnap.exists()) isExisting = true;
        } catch (e) { }

        if (isExisting) {
          setIsSavingEdit(false);
          return alert(`ID Alat "${newId}" sudah digunakan oleh perangkat lain. Silakan pilih ID lain.`);
        }

        if (!confirm(`Konfirmasi Perubahan ID Alat:\n\nDari: "${oldId}"\nMenjadi: "${newId}"\nNama: "${cleanName}"\n\nSemua data live & histori pengukuran akan dimigrasikan ke ID baru. Lanjutkan?`)) {
          setIsSavingEdit(false);
          return;
        }

        let oldDashData = {};
        try {
          const oldDashSnap = await get(ref(db, `dashboard/${oldId}`));
          oldDashData = oldDashSnap.val() || {};
        } catch (e) { }

        let oldMeasData = null;
        try {
          const oldMeasSnap = await get(ref(db, `measurements/${oldId}`));
          oldMeasData = oldMeasSnap.val() || null;
        } catch (e) { }

        const newDeviceData = {
          name: cleanName,
          secret_key: cleanKey,
          lat: cleanLat,
          lng: cleanLng,
          created_at: apiKeyModalDevice.created_at || new Date().toISOString()
        };
        if (cleanMac) newDeviceData.mac = cleanMac;
        if (cleanIp) newDeviceData.ip = cleanIp;

        const newDashData = {
          ...oldDashData,
          name: cleanName,
          lat: cleanLat,
          lng: cleanLng,
          created_at: oldDashData.created_at || new Date().toISOString()
        };
        if (cleanMac) newDashData.mac = cleanMac;
        if (cleanIp) newDashData.ip = cleanIp;

        // 1. Simpan ke /dashboard baru (selalu diizinkan Firebase)
        let dashSaved = false;
        try {
          await set(ref(db, `dashboard/${newId}`), newDashData);
          if (oldId !== newId) {
            await remove(ref(db, `dashboard/${oldId}`));
          }
          dashSaved = true;
        } catch (dashErr) {
          console.warn('Dashboard migrate error:', dashErr?.message);
        }

        if (oldMeasData) {
          try {
            await set(ref(db, `measurements/${newId}`), oldMeasData);
            await remove(ref(db, `measurements/${oldId}`));
          } catch (e) { }
        }

        // 2. Coba update ke /devices (jika rules Firebase mengizinkan)
        try {
          await set(ref(db, `devices/${newId}`), newDeviceData);
          if (oldId !== newId) {
            await remove(ref(db, `devices/${oldId}`));
          }
        } catch (devErr) {
          console.warn('Izin tulis /devices dibatasi Firebase, data dashboard tetap tersimpan:', devErr?.message);
        }

        // 3. Simpan nama kustom di localStorage
        try {
          const localCustomNames = JSON.parse(localStorage.getItem('ukurair_custom_names') || '{}');
          delete localCustomNames[oldId];
          localCustomNames[newId] = cleanName;
          localStorage.setItem('ukurair_custom_names', JSON.stringify(localCustomNames));
        } catch (e) { }

        // 4. Update state React lokal langsung
        setDevices(prev => prev.map(d => d.id === oldId ? { ...d, ...newDeviceData, id: newId } : d));
        setData(prev => prev.map(d => d.id === oldId ? { ...d, ...newDashData, id: newId } : d));

        alert(`Alat berhasil diperbarui!\nNama: ${cleanName}\nID Baru: ${newId}\n\nPerubahan sudah tersimpan dan langsung aktif.`);
      } else {
        // Skenario B: ID Alat tetap, ubah Nama / API Key / MAC / IP / Koordinat
        const devUpdates = {
          name: cleanName,
          secret_key: cleanKey,
          lat: cleanLat,
          lng: cleanLng
        };
        if (cleanMac) devUpdates.mac = cleanMac;
        if (cleanIp) devUpdates.ip = cleanIp;

        const dashUpdates = {
          name: cleanName,
          lat: cleanLat,
          lng: cleanLng
        };
        if (cleanMac) dashUpdates.mac = cleanMac;
        if (cleanIp) dashUpdates.ip = cleanIp;

        // 1. Simpan ke /dashboard terlebih dahulu (node ini selalu diizinkan oleh Firebase)
        let dashSaved = false;
        try {
          await update(ref(db, `dashboard/${oldId}`), dashUpdates);
          dashSaved = true;
        } catch (dashErr) {
          console.warn('Simpan ke /dashboard gagal:', dashErr?.message);
        }

        // 2. Coba simpan ke /devices (jika rules Firebase mengizinkan)
        let devSaved = false;
        try {
          await update(ref(db, `devices/${oldId}`), devUpdates);
          devSaved = true;
        } catch (devErr) {
          console.warn('Izin tulis ke /devices ditolak Firebase (Rules membatasi), nama tetap aman di /dashboard:', devErr?.message);
        }

        // 3. Simpan nama alias kustom di localStorage sebagai proteksi offline / bypass
        try {
          const localCustomNames = JSON.parse(localStorage.getItem('ukurair_custom_names') || '{}');
          localCustomNames[oldId] = cleanName;
          localStorage.setItem('ukurair_custom_names', JSON.stringify(localCustomNames));
        } catch (e) { }

        // 4. Update state React lokal langsung agar UI instan berubah tanpa perlu refresh
        setDevices(prev => prev.map(d => d.id === oldId ? { ...d, ...devUpdates, name: cleanName } : d));
        setData(prev => prev.map(d => d.id === oldId ? { ...d, ...dashUpdates, name: cleanName } : d));

        if (dashSaved || devSaved) {
          alert(`Nama wilayah berhasil diubah menjadi "${cleanName}"!\n\nPerubahan sudah tersimpan dan langsung aktif di peta serta dashboard.`);
        } else {
          throw new Error('Gagal menghubungi Firebase.');
        }
      }

      setApiKeyModalDevice(null);
    } catch (e) {
      console.error('Gagal menyimpan perubahan alat:', e);
      alert('Gagal menyimpan perubahan: ' + (e?.message || 'Terjadi kesalahan.'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("SignOut error:", e);
    }
    try {
      localStorage.removeItem('ukurair_auth_user');
    } catch (e) {}
    setUser(null);
    setView('login');
  };

  const handleDeleteDevice = async (id) => {
    if (!confirm('Hapus alat ini?')) return;
    try {
      await remove(ref(db, `devices/${id}`));
      await remove(ref(db, `dashboard/${id}`));
      await remove(ref(db, `measurements/${id}`));
    } catch (e) { console.error(e); }
  };

  const handleUpdateDeviceCoords = async (deviceId, lat, lng) => {
    try {
      await update(ref(db, `devices/${deviceId}`), { lat, lng });
    } catch (e) {
      console.warn('Update devices lat/lng error:', e?.message);
    }
    try {
      await update(ref(db, `dashboard/${deviceId}`), { lat, lng });
    } catch (e) {
      console.warn('Update dashboard lat/lng error:', e?.message);
    }
    setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, lat, lng } : d));
    setData(prev => prev.map(d => d.id === deviceId ? { ...d, lat, lng } : d));
    alert(`Lokasi alat berhasil disinkronkan ke (${lat}, ${lng})!\n\nPeta di Panel Utama langsung otomatis ikut berpindah ke titik ini.`);
  };


  const handleExportAllData = async (deviceId) => {
    try {
      const historyRef = ref(db, `measurements/${deviceId}`);
      const snapshot = await get(historyRef);
      const val = snapshot.val();
      if (!val) {
        alert('Tidak ada riwayat data untuk alat ini.');
        return;
      }

      const records = Object.keys(val).map(key => normalizeReading(val[key]));

      let csv = 'Tanggal,Waktu,Ketinggian Air (cm),Status\n';
      records.forEach(item => {
        const d = new Date(parseCreatedAt(item.created_at));
        const dateStr = d.toLocaleDateString();
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        csv += `"${dateStr}","${timeStr}","${item.water_level || 0}","${item.status || 'AMAN'}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Riwayat_Lengkap_${deviceId}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error(error);
      alert('Terjadi kesalahan saat mengekspor data.');
    }
  };

  const handleExportDataFast = async (deviceId, startDate, endDate) => {
    if (!startDate || !endDate) return alert('Pilih rentang tanggal terlebih dahulu!');

    try {
      const historyRef = ref(db, `measurements/${deviceId}`);
      const snapshot = await get(historyRef);
      const val = snapshot.val();
      if (!val) {
        alert('Tidak ada riwayat data untuk alat ini.');
        return;
      }

      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const records = Object.keys(val).map(key => normalizeReading(val[key])).filter(item => {
        const ts = parseCreatedAt(item.created_at);
        return ts >= start.getTime() && ts <= end.getTime();
      });

      if (records.length === 0) {
        alert('Tidak ada riwayat data pada rentang tanggal tersebut.');
        return;
      }

      // Format CSV
      let csv = 'Tanggal,Waktu,Ketinggian Air (cm),Status\n';
      records.forEach(item => {
        const d = new Date(parseCreatedAt(item.created_at));
        const dateStr = d.toLocaleDateString();
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        csv += `"${dateStr}","${timeStr}","${item.water_level || 0}","${item.status || 'AMAN'}"\n`;
      });

      // Download
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Riwayat_${deviceId}_${startDate}_to_${endDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error(error);
      alert('Terjadi kesalahan saat mengekspor data.');
    }
  };

  const ConnectionBadge = ({ isOnline, lastSeenText, compact = false }) => {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: compact ? '2px 7px' : '3px 10px',
          borderRadius: '9999px',
          fontSize: compact ? '0.68rem' : '0.72rem',
          fontWeight: 700,
          background: isOnline ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          color: isOnline ? '#10b981' : '#ef4444',
          border: `1px solid ${isOnline ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
          boxShadow: isOnline ? '0 0 8px rgba(16, 185, 129, 0.25)' : 'none'
        }}
        title={isOnline ? `ESP32 Terhubung (${lastSeenText || 'Live'})` : `Koneksi ESP32 Terputus (${lastSeenText || 'OFF'})`}
      >
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: isOnline ? '#10b981' : '#ef4444',
            boxShadow: `0 0 6px ${isOnline ? '#10b981' : '#ef4444'}`
          }}
        />
        {isOnline ? 'Terhubung' : 'Terputus'}
      </span>
    );
  };

  const StatusBadge = ({ status, level, isOnline = true }) => {
    if (!isOnline) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 10px',
            borderRadius: '9999px',
            fontSize: '0.75rem',
            fontWeight: 700,
            background: 'rgba(239, 68, 68, 0.18)',
            color: '#ef4444',
            border: '1px solid rgba(239, 68, 68, 0.5)'
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#ef4444',
              boxShadow: '0 0 6px #ef4444'
            }}
          />
          Terputus (OFF)
        </span>
      );
    }
    const info = getWaterStatus(level, status);
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '3px 10px',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: 700,
          background: info.bg,
          color: info.color,
          border: `1px solid ${info.border}`
        }}
      >
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: info.dotColor,
            boxShadow: `0 0 6px ${info.dotColor}`
          }}
        />
        {info.label}
      </span>
    );
  };

  let filteredData = data;
  if (activeTab === 'saved') {
    filteredData = filteredData.filter(d => savedDeviceIds.includes(d.id));
  } else if (activeTab === 'recent') {
    filteredData = recentDeviceIds.map(id => data.find(d => d.id === id)).filter(Boolean);
  }
  if (searchQuery) {
    filteredData = filteredData.filter(d => d && d.name && String(d.name).toLowerCase().includes(String(searchQuery || '').toLowerCase()));
  }

  const matchingSearchDevices = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return [];
    return (data || []).filter(d => d && d.name && String(d.name).toLowerCase().includes(q));
  }, [data, searchQuery]);

  const renderNotificationSettings = (isModal = false) => (
    <div
      className={isModal ? "" : "metric-card"}
      style={{
        background: isModal ? 'transparent' : 'rgba(15, 23, 42, 0.75)',
        border: isModal ? 'none' : '1px solid #334155',
        borderRadius: '16px',
        padding: isModal ? '0' : '2rem',
        position: 'relative'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'linear-gradient(135deg, rgba(37,211,102,0.2), rgba(34,158,217,0.2))', border: '1px solid rgba(56, 189, 248, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bell size={22} color="#38bdf8" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              Pusat Notifikasi & Integrasi Peringatan Dini
              <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', fontWeight: 700 }}>
                SMS & Telegram
              </span>
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
              Kirim peringatan otomatis saat air naik atau terdeteksi anomali langsung via SMS & Telegram warga / petugas.
            </p>
          </div>
        </div>

        {isModal && (
          <button
            type="button"
            onClick={() => setShowNotificationModal(false)}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '5px' }}
            title="Tutup Modal"
          >
            <X size={24} />
          </button>
        )}
      </div>

      <form onSubmit={handleSaveNotifications}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>

          {/* 1. KOTAK SMS GATEWAY */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: smsEnabled ? '1.5px solid #38bdf8' : '1px solid #334155',
            borderRadius: '12px',
            padding: '1.25rem',
            boxShadow: smsEnabled ? '0 0 20px rgba(56, 189, 248, 0.15)' : 'none',
            transition: 'all 0.3s ease'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Smartphone size={17} color="#38bdf8" />
                </div>
                <strong style={{ color: '#f8fafc', fontSize: '0.95rem' }}>SMS Gateway</strong>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.78rem', color: smsEnabled ? '#38bdf8' : '#94a3b8', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={smsEnabled}
                  onChange={e => setSmsEnabled(e.target.checked)}
                  style={{ accentColor: '#38bdf8', cursor: 'pointer', width: '16px', height: '16px' }}
                />
                {smsEnabled ? 'Aktif' : 'Nonaktif'}
              </label>
            </div>

            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Smartphone size={14} color="#38bdf8" /> Nomor HP Penerima SMS
              </label>
              <input
                type="tel"
                value={smsPhone || waPhone}
                onChange={e => {
                  setSmsPhone(e.target.value);
                  setWaPhone(e.target.value);
                }}
                placeholder="Contoh: 08123456789 atau +628123456789"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                  color: '#f8fafc',
                  fontSize: '0.85rem',
                  outline: 'none'
                }}
              />
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
                Cukup masukkan nomor ponsel tujuan untuk menerima kiriman data & peringatan banjir via SMS langsung tanpa pihak ketiga.
              </span>
            </div>

            <button
              type="button"
              onClick={handleTestSms}
              className="btn"
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.25)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)'}
            >
              <Send size={14} /> Kirim Pesan Uji Coba SMS
            </button>
          </div>

          {/* 2. KOTAK TELEGRAM */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: tgEnabled ? '1.5px solid #229ED9' : '1px solid #334155',
            borderRadius: '12px',
            padding: '1.25rem',
            boxShadow: tgEnabled ? '0 0 20px rgba(34, 158, 217, 0.15)' : 'none',
            transition: 'all 0.3s ease'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(34, 158, 217, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Send size={17} color="#229ED9" />
                </div>
                <strong style={{ color: '#f8fafc', fontSize: '0.95rem' }}>Telegram Bot</strong>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.78rem', color: tgEnabled ? '#229ED9' : '#94a3b8', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={tgEnabled}
                  onChange={e => setTgEnabled(e.target.checked)}
                  style={{ accentColor: '#229ED9', cursor: 'pointer', width: '16px', height: '16px' }}
                />
                {tgEnabled ? 'Aktif' : 'Nonaktif'}
              </label>
            </div>

            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '6px', display: 'block' }}>
                Telegram Chat ID / Username
              </label>
              <input
                type="text"
                value={tgChatId}
                onChange={e => setTgChatId(e.target.value)}
                placeholder="Contoh: @ukurair_channel atau ID numerik"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                  color: '#f8fafc',
                  fontSize: '0.85rem',
                  outline: 'none'
                }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Bot Token (Opsional / Tempelan)</span>
                <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Dapat dari @BotFather</span>
              </label>
              <input
                type="password"
                value={tgBotToken}
                onChange={e => setTgBotToken(e.target.value)}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                  color: '#f8fafc',
                  fontSize: '0.85rem',
                  outline: 'none'
                }}
              />
            </div>

            <button
              type="button"
              onClick={handleTestTelegram}
              className="btn"
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'rgba(34, 158, 217, 0.15)',
                color: '#229ED9',
                border: '1px solid rgba(34, 158, 217, 0.35)',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(34, 158, 217, 0.25)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(34, 158, 217, 0.15)'}
            >
              <Send size={14} /> Kirim Pesan Uji Coba Telegram
            </button>
          </div>
        </div>

        {/* 3. ATURAN PEMICU NOTIFIKASI */}
        <div style={{
          background: 'rgba(30, 41, 59, 0.5)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '1.25rem',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={16} color="var(--accent)" /> Kondisi Pemicu Peringatan (Trigger Rules)
          </h4>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.2rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>Ambang Batas Siaga Air:</label>
              <select
                value={alertThreshold}
                onChange={e => setAlertThreshold(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: '#0f172a',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  outline: 'none',
                  marginTop: '4px'
                }}
              >
                <option value="SIAGA_1">Mulai Siaga 1 (&gt;= 10 cm)</option>
                <option value="SIAGA_2">Mulai Siaga 2 - Waspada (&gt;= 25 cm)</option>
                <option value="SIAGA_3">Mulai Siaga 3 - Siaga (&gt;= 50 cm)</option>
                <option value="SIAGA_4">Hanya Siaga 4 - Darurat (&gt;= 75 cm)</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={notifyOnAnomaly}
                  onChange={e => setNotifyOnAnomaly(e.target.checked)}
                  style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: '16px', height: '16px' }}
                />
                Peringatan Anomali Sensor (AI)
              </label>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8', paddingLeft: '24px' }}>
                Kirim alert jika terjadi lonjakan air ekstrem tanpa disertai hujan lokal.
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons & Feedback */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              style={{
                padding: '10px 24px',
                fontWeight: 700,
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Check size={16} /> Simpan Pengaturan Notifikasi
            </button>

            {notifSavedFeedback && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '0.8rem', fontWeight: 600, background: 'rgba(16, 185, 129, 0.15)', padding: '6px 12px', borderRadius: '6px', border: '1px solid #10b981' }}>
                <Check size={14} /> Pengaturan Tersimpan!
              </span>
            )}
          </div>

          {notifTestFeedback && (
            <div style={{ fontSize: '0.78rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
              {notifTestFeedback}
            </div>
          )}
        </div>

        {/* Info Tempelan / Dokumentasi Integrasi Backend Lanjutan */}
        <div style={{
          marginTop: '1.5rem',
          background: 'rgba(15, 23, 42, 0.6)',
          borderRadius: '8px',
          padding: '12px 14px',
          border: '1px dashed #475569',
          fontSize: '0.75rem',
          color: '#94a3b8',
          lineHeight: 1.6
        }}>
          <strong style={{ color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
            ℹ️ Catatan Pengembang (Siap Diedit / Dikembangkan Lanjutan):
          </strong>
          Struktur data tersimpan otomatis di Firebase pada node <code>/settings/notifications</code> dan <code>localStorage</code> browser. Notifikasi darurat dikirim langsung melalui SMS (langsung ke nomor HP penerima) dan Telegram Bot API (<code>https://api.telegram.org/bot&lt;token&gt;/sendMessage</code>).
        </div>
      </form>
    </div>
  );

  if (loading) return <div className="app-container"><p>Initializing Firebase...</p></div>;

  return (
    <div className="app-container">
      {/* Background Map for Dashboard/Detail */}
      {(view === 'dashboard' || view === 'device-detail') && (
        <div className="map-background">
          <MapContainer center={[1.128, 104.053]} zoom={12} style={{ height: '100%', width: '100%' }} zoomControl={false}>
            <TileLayer
              url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
              attribution="&copy; Google Maps"
            />
            <MapFlyController target={mainMapTarget} />
            <MapResizeHandler expanded={isNavSidebarOpen} />

            {/* Marker Lokasi Tujuan Pencarian Tempat di Peta */}
            {searchedDestination && (
              <Marker position={[searchedDestination.lat, searchedDestination.lng]}>
                <Popup autoPan={false}>
                  <div style={{ textAlign: 'center', padding: '0.3rem', minWidth: '160px' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0284c7', marginBottom: '2px' }}>
                      📍 {searchedDestination.title}
                    </div>
                    <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '4px 0 8px', lineHeight: 1.3 }}>
                      {searchedDestination.fullAddress}
                    </p>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                      <button
                        onClick={() => handleCalculateRoute(searchedDestination)}
                        style={{
                          background: '#0284c7',
                          border: 'none',
                          color: '#ffffff',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        🚗 Cek Rute Aman
                      </button>
                      <button
                        onClick={() => {
                          setSearchedDestination(null);
                          handleCancelRoute();
                        }}
                        style={{
                          background: '#fee2e2',
                          border: '1px solid #fca5a5',
                          color: '#dc2626',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                          fontWeight: 600
                        }}
                      >
                        Hapus Pin
                      </button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Marker Posisi Pengguna GPS (Titik Biru Radar Pulsing) */}
            {userLocation && (
              <Marker position={[userLocation.lat, userLocation.lng]} icon={userLocationIcon}>
                <Popup autoPan={false}>
                  <div style={{ textAlign: 'center', padding: '0.2rem', minWidth: '160px' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0284c7', marginBottom: '2px' }}>
                      📍 Posisi Anda Saat Ini
                    </div>
                    <div style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      color: userSafety?.status === 'danger' ? '#ef4444' : userSafety?.status === 'warning' ? '#f59e0b' : '#10b981',
                      margin: '4px 0'
                    }}>
                      {userSafety?.status === 'danger'
                        ? '🔴 Terdeteksi di Area Banjir!'
                        : userSafety?.status === 'warning'
                        ? '🟡 Waspada Dekat Titik Air'
                        : '🟢 Lokasi Anda Aman'}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                      Akurasi GPS: ±{Math.round(userLocation.accuracy || 20)} meter
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Layer Garis Rute Jalan OSRM & Analisis Keamanan */}
            <UserLocationMapLayer
              userLocation={userLocation}
              activeRoute={activeRoute}
              routeSafety={routeSafety}
            />

            {data.map(device => {
              const lat = device.lat || 1.128;
              const lng = device.lng || 104.053;
              return (
                <Marker
                  key={device.id}
                  position={[lat, lng]}
                  eventHandlers={{
                    click: () => {
                      setSelectedDevice(device);
                      setView('device-detail');
                      setIsNavSidebarOpen(true);
                      setMainMapTarget({ lat, lng, zoom: 16, _ts: Date.now() });
                    }
                  }}
                >
                  <Popup>
                    <div style={{ padding: '0.2rem', textAlign: 'center' }}>
                      <strong style={{ fontSize: '1.1rem', display: 'block', marginBottom: '0.3rem' }}>{device.name}</strong>
                      {(() => {
                        const eff = getDeviceEffectiveData(device);
                        const devRate = eff.isOnline ? calculateWaterRiseRate(chartData[device.id], null, eff.water_level) : { isFast: false, isExtreme: false, badge: 'OFF', shortBadge: 'OFF' };
                        const weather = deviceWeather[device.id] || { label: 'Cerah Berawan', icon: '⛅', isRain: false, isHeavy: false, temp: 30, humidity: 80, precipitation: 0 };
                        const aiEval = !eff.isOnline ? {
                          type: 'DISCONNECTED',
                          isAnomaly: false,
                          badge: '🔴 AI: Sensor Terputus',
                          shortBadge: '🔴 Terputus',
                          color: '#ef4444',
                          bg: 'rgba(239, 68, 68, 0.15)',
                          border: '#ef4444',
                          title: 'Peringatan: ESP32 Terputus',
                          message: `Sensor tidak terdeteksi (${eff.lastSeenText}). Ketinggian air diset ke 0 cm.`
                        } : evaluateAiSituation(eff.water_level, devRate, weather);

                        return (
                          <>
                            <div style={{ marginBottom: '0.4rem' }}>
                              <ConnectionBadge isOnline={eff.isOnline} lastSeenText={eff.lastSeenText} compact />
                            </div>
                            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.4rem' }}>
                              Tinggi: <strong style={{ color: eff.isOnline ? 'var(--accent)' : '#ef4444' }}>{eff.water_level} cm</strong>
                              {!eff.isOnline && <span style={{ color: '#ef4444', fontSize: '0.72rem', marginLeft: '4px' }}>(OFF)</span>}
                            </div>
                            <div style={{ marginTop: '0.3rem', marginBottom: '0.6rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                              <StatusBadge status={eff.status} level={eff.water_level} isOnline={eff.isOnline} />
                              <span style={{ fontSize: '0.72rem', color: '#cbd5e1', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <span>{weather.icon}</span> {weather.temp ? `${weather.temp}°C` : ''} {weather.label}
                              </span>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: '9999px',
                                  background: aiEval.bg,
                                  color: aiEval.color,
                                  border: `1px solid ${aiEval.border}`
                                }}
                                title={aiEval.message}
                              >
                                {aiEval.shortBadge}
                              </span>
                              {eff.isOnline && devRate.isFast && (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: '9999px',
                                    background: devRate.bg,
                                    color: devRate.color,
                                    border: `1px solid ${devRate.border}`,
                                    animation: devRate.isExtreme ? 'pulse-alert 1.5s infinite' : 'none'
                                  }}
                                >
                                  {devRate.badge}
                                </span>
                              )}
                            </div>
                          </>
                        );
                      })()}
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '6px', flexWrap: 'wrap' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailModalDevice(device);
                          }}
                          style={{
                            background: 'var(--accent)',
                            color: '#0f172a',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <BarChart3 size={13} /> Lihat Grafik
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const dest = { title: device.name, fullAddress: 'Titik Pantau IoT', lat: device.lat || 1.128, lng: device.lng || 104.053 };
                            setSearchedDestination(dest);
                            handleCalculateRoute(dest);
                          }}
                          title="Cek apakah jalur rute ke titik pantau ini ada banjir di jalan"
                          style={{
                            background: 'rgba(2, 132, 199, 0.2)',
                            color: '#38bdf8',
                            border: '1px solid #0284c7',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Navigation size={13} /> Cek Rute
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingRangeDevice(device);
                          }}
                          title="Atur range jangkauan jarak, warna & kontur jalan untuk titik ini"
                          style={{
                            background: 'rgba(56, 189, 248, 0.2)',
                            color: '#38bdf8',
                            border: '1px solid #0284c7',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Sliders size={13} /> Atur Range
                        </button>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {/* ─── Penangan Klik Peta Saat Mode Tandai Jalan Aktif ────────────── */}
            <MapRoadDrawHandler
              isDrawing={isDrawingRoad}
              onAddPoint={(pt) => setActiveDrawPoints(prev => [...(prev || []), pt])}
            />

            {/* ─── Badge Ketinggian Air Mengambang di Peta (Google Maps Traffic Style) ── */}
            {/* Memungkinkan pengguna di luar area melihat tinggi air tiap wilayah secara langsung */}
            <FloodTrafficBadgeLayer
              deviceData={data}
              floodZones={floodZones}
              isSimulationMode={isSimulationMode}
              simulatedValue={simulatedValue}
              onSelectDevice={(device) => {
                setSelectedDevice(device);
                setView('device-detail');
                setIsNavSidebarOpen(true);
                setMainMapTarget({ lat: device.lat, lng: device.lng, zoom: 16, _ts: Date.now() });
              }}
            />

            {/* ─── Flood Zone Overlay (Simulasi & Kontur Jalan Traffic Banjir) ─── */}
            {/* Layer ini HANYA visual. Tidak ada data IoT yang diubah. */}
            {showFloodZones && !loadingZones && (
              <FloodZoneLayer
                zones={floodZones}
                simulatedValue={simulatedValue}
                isSimulationMode={isSimulationMode}
                drawingZone={isDrawingRoad ? {
                  type: 'road',
                  road_points: activeDrawPoints,
                  road_width: 18,
                  color: '#facc15',
                  name: 'Sedang Ditandai di Peta'
                } : null}
                deviceData={data}
              />
            )}
          </MapContainer>
        </div>
      )}

      {/* ─── Banner Notifikasi Darurat Geofence (HANYA Muncul Saat Pengguna Masuk Kawasan Banjir Aktif) ─── */}
      <GeofenceEmergencyAlert
        userSafety={userSafety}
        onCenterMap={() => {
          if (userLocation) {
            setMainMapTarget({ lat: userLocation.lat, lng: userLocation.lng, zoom: 16, _ts: Date.now() });
          }
        }}
      />

      {/* ─── Ringkasan Ketinggian Air Seluruh Wilayah (Untuk Pengguna di Luar Area) ─── */}
      {(view === 'dashboard' || view === 'device-detail') && !isNavSidebarOpen && (
        <FloodOverviewDrawer
          deviceData={data}
          isSimulationMode={isSimulationMode}
          simulatedValue={simulatedValue}
          userLocation={userLocation}
          onFlyToDevice={(dev) => {
            setMainMapTarget({ lat: dev.lat, lng: dev.lng, zoom: 16, _ts: Date.now() });
            setSelectedDevice(dev);
          }}
        />
      )}

      {/* ─── Panel Kontrol Simulasi (Floating, hanya di dashboard/device-detail) */}
      {(view === 'dashboard' || view === 'device-detail') && !isNavSidebarOpen && (
        <SimulationControlPanel
          isSimulationMode={isSimulationMode}
          setIsSimulationMode={setIsSimulationMode}
          simulatedValue={simulatedValue}
          setSimulatedValue={setSimulatedValue}
          showZones={showFloodZones}
          setShowZones={setShowFloodZones}
          onOpenEditRange={() => setEditingRangeDevice(selectedDevice || data[0])}
        />
      )}

      {/* ─── Tombol Floating: Lokasi Saya (GPS Locator dengan Live Continuous Tracking) ─── */}
      {(view === 'dashboard' || view === 'device-detail') && !isNavSidebarOpen && (
        <UserLocationFloatingButton
          onLocateUser={handleLocateUser}
          isLocating={isLocating}
          isTrackingLive={isTrackingLive}
          userLocation={userLocation}
        />
      )}

      {/* ─── Floating Card: Status Deteksi Lokasi & Cek Rute Aman Banjir ── */}
      {(view === 'dashboard' || view === 'device-detail') && !isNavSidebarOpen && (
        <RouteFloodNavigationCard
          userLocation={userLocation}
          userSafety={userSafety}
          searchedDestination={searchedDestination}
          activeRoute={activeRoute}
          routeSafety={routeSafety}
          isLoadingRoute={isLoadingRoute}
          onCalculateRoute={() => handleCalculateRoute(searchedDestination)}
          onCancelRoute={handleCancelRoute}
          onLocateUser={handleLocateUser}
        />
      )}

      {/* ─── Modal: Edit Range Jarak & Kontur Jalan ─── */}
      {editingRangeDevice && (
        <EditRangeModal
          device={editingRangeDevice}
          currentZone={floodZones.find(z => z.device_id === editingRangeDevice.id || z.id === `zone-${editingRangeDevice.id}`)}
          onClose={() => {
            setEditingRangeDevice(null);
            setIsDrawingRoad(false);
          }}
          onSaveZone={saveZone}
          onDeleteZone={deleteZone}
          isDrawingRoad={isDrawingRoad}
          setIsDrawingRoad={setIsDrawingRoad}
          activeDrawPoints={activeDrawPoints}
          setActiveDrawPoints={setActiveDrawPoints}
          isAdminUser={isAdminUser}
        />
      )}

      {/* Floating Header (Only for Admin/Login now) */}
      <header className="header" style={{ display: (view === 'dashboard' || view === 'device-detail') ? 'none' : 'flex' }}>
        {/* SISI KIRI: Brand Logo & Title "IOT Banjir" */}
        <div className="header-brand" onClick={() => { setView('dashboard'); setSelectedDevice(null); }} style={{ cursor: 'pointer' }}>
          <img src="/logo.png" alt="Logo" className="header-logo-img" />
          <span className="header-brand-title">IOT Banjir</span>
        </div>

        {/* SISI TENGAH: Peta Utama dan Masuk / Admin Panel */}
        <nav className="header-nav-center">
          <button onClick={() => { setView('dashboard'); setSelectedDevice(null); }} className="btn btn-header-nav">
            Peta Utama
          </button>
          {user ? (
            isAdminUser ? (
              <button onClick={() => setView('admin')} className={`btn btn-header-nav ${view === 'admin' ? 'active-nav' : ''}`}>
                Admin Panel
              </button>
            ) : null
          ) : (
            <button onClick={() => setView('login')} className="btn btn-header-nav btn-header-login">
              Masuk
            </button>
          )}
          {user && <button onClick={handleLogout} className="btn btn-header-nav btn-header-logout">Logout</button>}
        </nav>

        {/* SISI KANAN: Menu Orang / Foto Profil User & Fitur Wallpaper */}
        <div className="header-profile-right">
          <div
            onClick={() => setIsHeaderProfileOpen(!isHeaderProfileOpen)}
            className="header-avatar-btn"
            title={user ? (user.displayName || user.email) : 'Profil Akun (Ubah Foto / Info)'}
          >
            {userPhoto ? (
              <img src={userPhoto} alt="Foto Profil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : user ? (
              <span style={{ color: '#ffffff', fontWeight: 'bold', fontSize: '1.1rem' }}>
                {getUserDisplayName(user)[0].toUpperCase()}
              </span>
            ) : (
              <User size={19} color="#ffffff" />
            )}
          </div>

          {/* Popup Profil Google Chrome Style */}
          {isHeaderProfileOpen && (
            <ProfileChromePopup
              user={user}
              userPhoto={userPhoto}
              userDisplayName={getUserDisplayName(user)}
              handlePhotoUpload={handlePhotoUpload}
              isAdminUser={isAdminUser}
              onClose={() => setIsHeaderProfileOpen(false)}
              onManageAdmin={() => { setView('admin'); setIsHeaderProfileOpen(false); }}
              onOpenNotif={() => { setShowNotificationModal(true); setIsHeaderProfileOpen(false); }}
              onSwitchAccount={() => { try { localStorage.removeItem('ukurair_auth_user'); } catch (e) {} setUser(null); setShowAccountChooser(false); setView('login'); setIsHeaderProfileOpen(false); }}
              onLogout={() => { handleLogout(); setIsHeaderProfileOpen(false); }}
              onLogin={() => { setView('login'); setIsHeaderProfileOpen(false); }}
            />
          )}
        </div>
      </header>



      {/* Floating Menu / Titik Pantau Button (Muncul ketika menu disembunyikan ke samping / diminimalkan) */}
      {(view === 'dashboard' || view === 'device-detail') && !isNavSidebarOpen && (
        <div
          className="floating-menu-btn animate-fade-in"
          onClick={() => setIsNavSidebarOpen(true)}
          title="Buka Titik Pantau"
        >
          <Menu size={20} color="var(--accent)" />
          <span>Titik Pantau</span>
        </div>
      )}

      {/* Floating Top Bar (Search & Profile/Login Berdampingan Rapi Tanpa Tabrakan) */}
      {(view === 'dashboard' || view === 'device-detail') && (
        <div className="floating-top-bar">
          <div className="floating-search-container" ref={mainSearchContainerRef}>
            <div className="floating-search-bar">
              <Search size={18} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Telusuri titik pantau atau cari peta tujuan..."
                value={searchQuery}
                onFocus={() => {
                  setShowDashboardSuggestions(true);
                }}
                onChange={handleMainSearchChange}
                onKeyDown={handleMainSearchKeyDown}
                style={{ border: 'none', background: 'transparent', color: 'white', padding: '0 8px', width: '100%', minWidth: 0, outline: 'none', fontSize: '0.86rem' }}
              />
              {isSearchingDashboardPlaces && (
                <RefreshCcw size={14} className="spin-animate" color="var(--accent)" style={{ marginRight: '6px', flexShrink: 0 }} />
              )}
              {searchQuery && (
                <X
                  size={16}
                  color="var(--text-secondary)"
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                  onClick={() => {
                    setSearchQuery('');
                    setDashboardPlaceSuggestions([]);
                    setShowDashboardSuggestions(false);
                  }}
                />
              )}
            </div>

            {/* Dropdown Hasil Pencarian Interaktif (Titik Pantau IoT + Tempat & Alamat di Peta) */}
            {showDashboardSuggestions && (
              <div className="search-suggestions-dropdown">
                {/* 0. Tampilkan semua titik pantau jika kolom pencarian belum diisi */}
                {(!searchQuery || searchQuery.trim().length === 0) && data && data.length > 0 && (
                  <div>
                    <div className="suggestion-section-header">
                      <Radio size={12} color="var(--accent)" /> Titik Pantau IoT Tersedia ({data.length})
                    </div>
                    {data.map(dev => {
                      const eff = getDeviceEffectiveData(dev);
                      return (
                        <div
                          key={`focus-dev-${dev.id}`}
                          className="suggestion-item"
                          onClick={() => handleSelectDeviceFromSearch(dev)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: eff.isOnline ? '#10b981' : '#ef4444', flexShrink: 0 }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.84rem', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {dev.name}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                Tinggi: <b style={{ color: eff.isOnline ? 'var(--accent)' : '#ef4444' }}>{eff.water_level} cm</b> • {eff.isOnline ? 'Online' : 'Terputus'}
                              </div>
                            </div>
                          </div>
                          <Navigation size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* 1. Titik Pantau IoT */}
                {matchingSearchDevices.length > 0 && (
                  <div>
                    <div className="suggestion-section-header">
                      <Radio size={12} color="var(--accent)" /> Titik Pantau IoT ({matchingSearchDevices.length})
                    </div>
                    {matchingSearchDevices.map(dev => {
                      const eff = getDeviceEffectiveData(dev);
                      return (
                        <div
                          key={`search-dev-${dev.id}`}
                          className="suggestion-item"
                          onClick={() => handleSelectDeviceFromSearch(dev)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: eff.isOnline ? '#10b981' : '#ef4444', flexShrink: 0 }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.84rem', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {dev.name}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                Tinggi: <b style={{ color: eff.isOnline ? 'var(--accent)' : '#ef4444' }}>{eff.water_level} cm</b> • {eff.isOnline ? 'Online' : 'Terputus'}
                              </div>
                            </div>
                          </div>
                          <Navigation size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 2. Tempat & Alamat di Peta */}
                {dashboardPlaceSuggestions.length > 0 && (
                  <div>
                    <div className="suggestion-section-header">
                      <MapPin size={12} color="#38bdf8" /> Lokasi & Alamat di Peta ({dashboardPlaceSuggestions.length})
                    </div>
                    {dashboardPlaceSuggestions.map((place, idx) => (
                      <div
                        key={place.id || `place-${idx}`}
                        className="suggestion-item"
                        onClick={() => handleSelectPlaceFromSearch(place)}
                      >
                        <MapPin size={15} color="#38bdf8" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.84rem', color: '#f8fafc' }}>
                            {place.title}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {place.fullAddress}
                          </div>
                        </div>
                        <Navigation size={14} color="#38bdf8" style={{ flexShrink: 0 }} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Jika Belum Ada Hasil */}
                {matchingSearchDevices.length === 0 && dashboardPlaceSuggestions.length === 0 && !isSearchingDashboardPlaces && (
                  <div style={{ padding: '12px 16px', textAlign: 'center', fontSize: '0.78rem', color: '#94a3b8' }}>
                    {searchQuery.trim().length < 2 ? 'Ketik minimal 2 karakter untuk mencari peta...' : 'Lokasi tidak ditemukan. Tekan Enter untuk mencari luas.'}
                  </div>
                )}

                {isSearchingDashboardPlaces && (
                  <div style={{ padding: '8px 16px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <RefreshCcw size={12} className="spin-animate" /> Mencari lokasi di peta...
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="floating-profile-container">

          {/* Desktop Navigation Buttons */}
          <div className="nav-action-pill animate-fade-in">
            <ArrowLeft
              size={18}
              color={view === 'dashboard' ? '#475569' : '#cbd5e1'}
              style={{ cursor: view === 'dashboard' ? 'not-allowed' : 'pointer', transition: 'color 0.2s' }}
              onMouseOver={e => { if (view !== 'dashboard') e.currentTarget.style.color = '#fff'; }}
              onMouseOut={e => { if (view !== 'dashboard') e.currentTarget.style.color = '#cbd5e1'; }}
              onClick={() => { if (view !== 'dashboard') { setView('dashboard'); setSelectedDevice(null); } }}
            />
            <RefreshCcw
              size={18}
              color="#cbd5e1"
              style={{ cursor: 'pointer', transition: 'color 0.2s' }}
              onMouseOver={e => e.currentTarget.style.color = '#fff'}
              onMouseOut={e => e.currentTarget.style.color = '#cbd5e1'}
              onClick={() => window.location.reload()}
            />
            <Home
              size={18}
              color={view === 'dashboard' && !selectedDevice ? '#38bdf8' : '#cbd5e1'}
              style={{ cursor: 'pointer', transition: 'color 0.2s' }}
              onMouseOver={e => e.currentTarget.style.color = '#fff'}
              onMouseOut={e => e.currentTarget.style.color = view === 'dashboard' && !selectedDevice ? '#38bdf8' : '#cbd5e1'}
              onClick={() => { setView('dashboard'); setSelectedDevice(null); }}
            />
          </div>

          {user ? (
            <div
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              className="profile-avatar-btn"
              title={user.email}
              style={{ overflow: 'hidden' }}
            >
              {userPhoto ? (
                <img src={userPhoto} alt="Profil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ color: '#0f172a', fontWeight: 'bold', fontSize: '1.2rem' }}>
                  {getUserDisplayName(user)[0].toUpperCase()}
                </span>
              )}
            </div>
          ) : (
            <div
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              className="profile-login-btn"
            >
              <User size={15} /> <span>Login</span>
            </div>
          )}

          {/* Profile Dropdown Menu Google Chrome Style */}
          {isProfileMenuOpen && (
            <ProfileChromePopup
              user={user}
              userPhoto={userPhoto}
              userDisplayName={getUserDisplayName(user)}
              handlePhotoUpload={handlePhotoUpload}
              isAdminUser={isAdminUser}
              onClose={() => setIsProfileMenuOpen(false)}
              onManageAdmin={() => { setView('admin'); setIsProfileMenuOpen(false); }}
              onOpenNotif={() => { setShowNotificationModal(true); setIsProfileMenuOpen(false); }}
              onSwitchAccount={() => { try { localStorage.removeItem('ukurair_auth_user'); } catch (e) {} setUser(null); setShowAccountChooser(false); setView('login'); setIsProfileMenuOpen(false); }}
              onLogout={() => { handleLogout(); setIsProfileMenuOpen(false); }}
              onLogin={() => { setView('login'); setIsProfileMenuOpen(false); }}
            />
          )}
        </div>
      </div>
      )}

      {/* Slide-out Menu (Hamburger) */}
      {isMenuOpen && (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.6)', zIndex: 199, backdropFilter: 'blur(2px)' }} onClick={() => setIsMenuOpen(false)} />
          <div style={{ position: 'absolute', top: 0, left: 0, width: '300px', maxWidth: '85vw', height: '100vh', background: 'var(--bg-primary)', zIndex: 200, padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '5px 0 25px rgba(0,0,0,0.8)' }} className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 800 }}><img src="/logo.png" alt="Logo" style={{ width: '36px', height: '36px', borderRadius: '50%' }} /> IOT Banjir</h2>
              <X size={24} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setIsMenuOpen(false)} />
            </div>
            <hr style={{ borderColor: 'var(--border)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ padding: '12px 15px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', background: activeTab === 'all' ? 'rgba(56, 189, 248, 0.1)' : 'transparent', color: activeTab === 'all' ? 'var(--accent)' : 'white' }} onClick={() => { setActiveTab('all'); setView('dashboard'); setIsMenuOpen(false); }}>
                <Map size={20} /> Semua Lokasi
              </div>
              <div style={{ padding: '12px 15px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', background: activeTab === 'saved' ? 'rgba(56, 189, 248, 0.1)' : 'transparent', color: activeTab === 'saved' ? 'var(--accent)' : 'white' }} onClick={() => { setActiveTab('saved'); setView('dashboard'); setIsMenuOpen(false); }}>
                <Bookmark size={20} /> Tempat Disimpan
              </div>
              <div style={{ padding: '12px 15px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', background: activeTab === 'recent' ? 'rgba(56, 189, 248, 0.1)' : 'transparent', color: activeTab === 'recent' ? 'var(--accent)' : 'white' }} onClick={() => { setActiveTab('recent'); setView('dashboard'); setIsMenuOpen(false); }}>
                <Clock size={20} /> Histori Pencarian
              </div>

              <hr style={{ borderColor: 'var(--border)', margin: '15px 0' }} />

              {user ? (
                <>
                  {isAdminUser && (
                    <div style={{ padding: '12px 15px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', color: 'white' }} onClick={() => { setView('admin'); setIsMenuOpen(false); }}>
                      <Settings size={20} /> Admin Panel
                    </div>
                  )}
                  <div style={{ padding: '12px 15px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', color: 'var(--danger)' }} onClick={() => { handleLogout(); setIsMenuOpen(false); }}>
                    <LogOut size={20} /> Logout
                  </div>
                </>
              ) : (
                <div style={{ padding: '12px 15px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', color: 'var(--accent)' }} onClick={() => { setView('login'); setIsMenuOpen(false); }}>
                  <LogIn size={20} /> Login
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Sidebar Navigation & Panel Wrapper dengan Animasi Slide ke Kanan */}
      {(view === 'dashboard' || view === 'device-detail') && (
        <div className={`dashboard-sidebar-wrapper ${isNavSidebarOpen ? 'open' : ''}`}>
          {/* Left Navigation Strip */}
          <div className="left-nav-strip">
            {/* Navigasi khusus smartphone / mobile */}
            <div
              className="mobile-only-nav-item"
              style={{ display: 'none', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', color: activeTab === 'all' && !selectedDevice ? 'var(--accent)' : 'var(--text-secondary)' }}
              onClick={() => {
                setActiveTab('all');
                setView('dashboard');
                setSelectedDevice(null);
                setIsNavSidebarOpen(prev => !prev);
              }}
            >
              <Home size={22} color={activeTab === 'all' && !selectedDevice ? 'var(--accent)' : 'var(--text-secondary)'} />
              <span style={{ fontSize: '10px', marginTop: '2px', fontWeight: activeTab === 'all' && !selectedDevice ? 700 : 400 }}>Peta</span>
            </div>

            {/* 1. Menu (Toggle Tutup) di paling atas sejajar persis dengan posisi tombol Menu buka */}
            <div
              className="nav-strip-menu-btn desktop-only-nav-item"
              onClick={() => setIsNavSidebarOpen(false)}
              title="Sembunyikan Menu ke Samping"
            >
              <Menu size={22} color="var(--text-primary)" />
              <span style={{ fontSize: '10px', marginTop: '2px', fontWeight: 500 }}>Titik Pantau</span>
            </div>

            {/* 2. Disimpan */}
            <div
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', color: activeTab === 'saved' ? 'var(--accent)' : 'var(--text-secondary)' }}
              onClick={() => { setActiveTab('saved'); setView('dashboard'); setSelectedDevice(null); }}
              title="Lokasi Disimpan"
            >
              <Bookmark size={22} fill={activeTab === 'saved' ? 'var(--accent)' : 'none'} />
              <span style={{ fontSize: '10px', marginTop: '2px', fontWeight: activeTab === 'saved' ? 600 : 400 }}>Disimpan</span>
            </div>

            {/* 3. Terbaru */}
            <div
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', color: activeTab === 'recent' ? 'var(--accent)' : 'var(--text-secondary)' }}
              onClick={() => { setActiveTab('recent'); setView('dashboard'); setSelectedDevice(null); }}
              title="Histori Pencarian"
            >
              <Clock size={22} />
              <span style={{ fontSize: '10px', marginTop: '2px', fontWeight: activeTab === 'recent' ? 600 : 400 }}>Terbaru</span>
            </div>
          </div>

          {/* Floating Sidebar Card */}
          <div className="dashboard-sidebar">

            {view === 'dashboard' && (
              <div className="sidebar-content">
                {/* Handle Bar Drag/Minimize di HP */}
                <div className="mobile-sheet-handle" onClick={() => setIsNavSidebarOpen(false)} title="Minimalkan Panel Titik Pantau" />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>
                    {activeTab === 'saved' ? 'Lokasi Disimpan' : activeTab === 'recent' ? 'Histori Pencarian' : 'Titik Pantau'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsNavSidebarOpen(false)}
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      borderRadius: '8px',
                      padding: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s'
                    }}
                    title="Sembunyikan Menu ke Samping"
                    onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                  >
                    <X size={18} />
                  </button>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                  {activeTab === 'saved' ? 'Daftar lokasi yang Anda tandai.' : activeTab === 'recent' ? 'Daftar lokasi yang baru saja Anda lihat.' : 'Pilih lokasi di peta atau dari daftar di bawah ini.'}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {filteredData.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-secondary)' }}>Tidak ada data ditemukan.</div>
                  ) : (
                    filteredData.map((device) => {
                      const eff = getDeviceEffectiveData(device);
                      const devRate = eff.isOnline ? calculateWaterRiseRate(chartData[device.id], null, eff.water_level) : { isFast: false, isExtreme: false, badge: 'OFF', shortBadge: 'OFF' };
                      const weather = deviceWeather[device.id] || { label: 'Cerah Berawan', icon: '⛅', isRain: false, isHeavy: false, temp: 30, humidity: 80, precipitation: 0 };
                      const aiEval = !eff.isOnline ? {
                        type: 'DISCONNECTED',
                        isAnomaly: false,
                        badge: '🔴 AI: Sensor Terputus',
                        shortBadge: '🔴 Terputus',
                        color: '#ef4444',
                        bg: 'rgba(239, 68, 68, 0.15)',
                        border: '#ef4444',
                        title: 'Peringatan: ESP32 Terputus',
                        message: `Sensor tidak terdeteksi aktif (${eff.lastSeenText}). Ketinggian air diset ke 0 cm.`
                      } : evaluateAiSituation(eff.water_level, devRate, weather);

                      return (
                        <div
                          key={device.id}
                          className="card"
                          onClick={() => handleSelectDevice(device)}
                          style={{
                            cursor: 'pointer',
                            padding: '1.2rem',
                            background: 'rgba(30, 41, 59, 0.8)',
                            border: !eff.isOnline
                              ? '1px solid rgba(239, 68, 68, 0.4)'
                              : aiEval.isAnomaly
                                ? '1.5px solid #f59e0b'
                                : aiEval.type === 'FLOOD_CONFIRMED'
                                  ? '1.5px solid #ef4444'
                                  : '1px solid rgba(255, 255, 255, 0.08)',
                            transition: 'all 0.2s ease',
                            boxShadow: !eff.isOnline
                              ? 'none'
                              : aiEval.isAnomaly ? '0 0 12px rgba(245, 158, 11, 0.25)' : 'none'
                          }}
                        >
                          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', color: 'white' }}>
                            <span style={{ fontWeight: 700 }}>{device.name}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <ConnectionBadge isOnline={eff.isOnline} lastSeenText={eff.lastSeenText} compact />
                              <Bookmark
                                size={18}
                                fill={savedDeviceIds.includes(device.id) ? 'var(--accent)' : 'none'}
                                color={savedDeviceIds.includes(device.id) ? 'var(--accent)' : 'var(--text-secondary)'}
                                onClick={(e) => { e.stopPropagation(); toggleSaveDevice(device.id); }}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.6rem' }}>
                            <div>
                              <div className="card-value" style={{ fontSize: '1.8rem', color: eff.isOnline ? 'var(--accent)' : '#ef4444', fontWeight: 800 }}>
                                {eff.water_level} <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>cm</span>
                                {!eff.isOnline && (
                                  <span style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 600, marginLeft: '6px' }}>(OFF)</span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                {eff.isOnline ? `Update: ${device.created_at ? new Date(device.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Baru saja'}` : `Terakhir aktif: ${eff.lastSeenText}`}
                              </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' }}>
                              <StatusBadge status={eff.status} level={eff.water_level} isOnline={eff.isOnline} />
                              {eff.isOnline && devRate.isFast && (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: '9999px',
                                    background: devRate.bg,
                                    color: devRate.color,
                                    border: `1px solid ${devRate.border}`,
                                    animation: devRate.isExtreme ? 'pulse-alert 1.5s infinite' : 'none'
                                  }}
                                >
                                  {devRate.shortBadge}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Baris Cuaca Satelit & AI Status Publik */}
                          <div
                            style={{
                              paddingTop: '8px',
                              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '8px',
                              flexWrap: 'wrap'
                            }}
                          >
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.72rem',
                                color: '#cbd5e1'
                              }}
                              title={`Cuaca radar di koordinat: ${weather.label}, Suhu ${weather.temp || 30}°C, Hujan ${weather.precipitation || 0} mm/j`}
                            >
                              <span>{weather.icon}</span>
                              <span>{weather.temp ? `${weather.temp}°C` : ''} {weather.label}</span>
                              {weather.precipitation > 0 && (
                                <span style={{ color: '#38bdf8', fontWeight: 600 }}>({weather.precipitation} mm)</span>
                              )}
                            </span>

                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '9999px',
                                background: aiEval.bg,
                                color: aiEval.color,
                                border: `1px solid ${aiEval.border}`
                              }}
                              title={aiEval.message}
                            >
                              {aiEval.shortBadge}
                            </span>
                          </div>

                          {/* Peringatan Anomali Langsung Jika Sensor Melonjak Ekstrem */}
                          {aiEval.isAnomaly && (
                            <div
                              style={{
                                marginTop: '8px',
                                padding: '6px 8px',
                                borderRadius: '6px',
                                background: 'rgba(245, 158, 11, 0.15)',
                                border: '1px solid #f59e0b',
                                color: '#facc15',
                                fontSize: '0.7rem',
                                lineHeight: 1.4,
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '6px'
                              }}
                            >
                              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '2px' }} />
                              <span><b>Anomali:</b> {aiEval.message}</span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {view === 'device-detail' && selectedDevice && (
              <div className="sidebar-content" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <button onClick={() => setView('dashboard')} className="btn" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.1)' }}>
                    <ArrowLeft size={16} /> Kembali ke Daftar
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsNavSidebarOpen(false)}
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      borderRadius: '8px',
                      padding: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s'
                    }}
                    title="Sembunyikan Menu ke Samping"
                    onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                  >
                    <X size={18} />
                  </button>
                </div>

                <div style={{ marginBottom: '1.5rem', textAlign: 'center', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>{selectedDevice.name}</h2>
                    <Bookmark size={24} style={{ cursor: 'pointer' }} fill={savedDeviceIds.includes(selectedDevice.id) ? 'var(--accent)' : 'none'} color={savedDeviceIds.includes(selectedDevice.id) ? 'var(--accent)' : 'var(--text-secondary)'} onClick={() => toggleSaveDevice(selectedDevice.id)} />
                  </div>
                  <div style={{ marginTop: '0.6rem', display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                    {(() => {
                      const currentDev = data.find(d => d.id === selectedDevice.id) || selectedDevice;
                      const eff = getDeviceEffectiveData(currentDev);
                      return (
                        <>
                          <ConnectionBadge isOnline={eff.isOnline} lastSeenText={eff.lastSeenText} />
                          <StatusBadge
                            status={eff.status}
                            level={eff.water_level}
                            isOnline={eff.isOnline}
                          />
                        </>
                      );
                    })()}
                    <button
                      onClick={() => setDetailModalDevice(selectedDevice)}
                      style={{
                        background: 'rgba(56, 189, 248, 0.15)',
                        border: '1px solid var(--accent)',
                        color: 'var(--accent)',
                        borderRadius: '20px',
                        padding: '4px 12px',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontWeight: 600,
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = '#0f172a'; }}
                      onMouseOut={e => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)'; e.currentTarget.style.color = 'var(--accent)'; }}
                      title="Buka Grafik Detail Layar Penuh Seperti Admin"
                    >
                      <BarChart3 size={14} /> Lihat Grafik Detail
                    </button>
                    <button
                      onClick={() => setEditingRangeDevice(selectedDevice)}
                      style={{
                        background: 'rgba(56, 189, 248, 0.2)',
                        border: '1px solid #0284c7',
                        color: '#38bdf8',
                        borderRadius: '20px',
                        padding: '4px 12px',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontWeight: 700,
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={e => { e.currentTarget.style.background = '#0284c7'; e.currentTarget.style.color = '#ffffff'; }}
                      onMouseOut={e => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)'; e.currentTarget.style.color = '#38bdf8'; }}
                      title="Sesuaikan Jarak Range & Kontur Jalan untuk titik ini"
                    >
                      <Sliders size={14} /> Atur Range & Jarak
                    </button>
                  </div>
                  {/* Informasi Jaringan Teknis (IP & MAC) khusus untuk ADMIN */}
                  {isAdminUser && (() => {
                    const currentDev = data.find(d => d.id === selectedDevice.id) || selectedDevice;
                    const devIp = currentDev?.ip;
                    const devMac = currentDev?.mac;
                    if (!devIp && !devMac) return null;
                    return (
                      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.72rem' }}>
                        {devIp && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '3px 10px', borderRadius: '6px', fontFamily: 'monospace' }} title="IP Address ESP32 (Hanya Admin)">
                            <Wifi size={12} /> {devIp}
                          </span>
                        )}
                        {devMac && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(167, 139, 250, 0.1)', color: '#a78bfa', border: '1px solid rgba(167, 139, 250, 0.25)', padding: '3px 10px', borderRadius: '6px', fontFamily: 'monospace' }} title="Physical MAC Address (Hanya Admin)">
                            <Cpu size={12} /> {devMac}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Laporan & Diagnostik AI Real-Time (Publik) */}
                {(() => {
                  const currentDev = data.find(d => d.id === selectedDevice.id) || selectedDevice;
                  const eff = getDeviceEffectiveData(currentDev);
                  const currentHistory = chartData[selectedDevice.id] || [];
                  const riseRate = eff.isOnline ? calculateWaterRiseRate(currentHistory, null, eff.water_level) : { isFast: false, isExtreme: false, badge: 'OFF', shortBadge: 'OFF' };
                  const weather = deviceWeather[selectedDevice.id] || { label: 'Cerah Berawan', icon: '⛅', isRain: false, isHeavy: false, temp: 30, humidity: 80, precipitation: 0 };
                  const aiEval = !eff.isOnline ? {
                    type: 'DISCONNECTED',
                    isAnomaly: false,
                    badge: '🔴 AI: Sensor Terputus',
                    shortBadge: '🔴 Terputus',
                    color: '#ef4444',
                    bg: 'rgba(239, 68, 68, 0.15)',
                    border: '#ef4444',
                    title: 'Peringatan: Koneksi ESP32 Terputus',
                    message: `Perangkat sensor tidak terdeteksi aktif (${eff.lastSeenText}). Sistem dinonaktifkan dan indikator diset ke 0 cm. Periksa daya listrik aki/adaptor dan jaringan Wi-Fi ESP32.`
                  } : evaluateAiSituation(eff.water_level, riseRate, weather);

                  return (
                    <div
                      style={{
                        background: 'rgba(15, 23, 42, 0.75)',
                        border: `1.5px solid ${aiEval.border}`,
                        borderRadius: '14px',
                        padding: '1.25rem',
                        marginBottom: '1.5rem',
                        boxShadow: aiEval.isAnomaly
                          ? '0 0 25px rgba(245, 158, 11, 0.25)'
                          : aiEval.type === 'FLOOD_CONFIRMED'
                            ? '0 0 25px rgba(239, 68, 68, 0.25)'
                            : '0 8px 20px rgba(0,0,0,0.3)',
                        transition: 'all 0.3s ease'
                      }}
                    >
                      {/* Header Diagnostik AI */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ background: 'rgba(56, 189, 248, 0.15)', padding: '7px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Bot size={20} color="#38bdf8" />
                          </div>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc', fontWeight: 800 }}>Diagnostik AI & Cuaca Radar</h4>
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Verifikasi korelasi sensor & satelit BMKG</span>
                          </div>
                        </div>

                        {/* AI Status Badge */}
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 12px',
                            borderRadius: '9999px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            background: aiEval.bg,
                            color: aiEval.color,
                            border: `1px solid ${aiEval.border}`,
                            animation: aiEval.isAnomaly || aiEval.type === 'FLOOD_CONFIRMED' ? 'pulse-alert 2s infinite' : 'none'
                          }}
                        >
                          {aiEval.badge}
                        </span>
                      </div>

                      {/* Grid Cuaca Mikro di Koordinat Sensor */}
                      <div
                        className="weather-micro-grid"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                          gap: '8px',
                          marginBottom: '1rem',
                          background: 'rgba(30, 41, 59, 0.6)',
                          padding: '10px 12px',
                          borderRadius: '10px',
                          border: '1px solid rgba(255,255,255,0.06)'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Cuaca Radar</span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>{weather.icon}</span> {weather.label}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Suhu Udara</span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8' }}>
                            {weather.temp !== undefined ? `${weather.temp}°C` : '-'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Curah Hujan</span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: weather.precipitation > 0 ? '#38bdf8' : '#cbd5e1' }}>
                            {weather.precipitation !== undefined ? `${weather.precipitation} mm/j` : '0 mm/j'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Kelembaban</span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1' }}>
                            {weather.humidity !== undefined ? `${weather.humidity}%` : '-'}
                          </span>
                        </div>
                      </div>

                      {/* Laporan Penjelasan untuk Warga / Publik */}
                      <div
                        style={{
                          background: aiEval.bg,
                          border: `1px solid ${aiEval.border}40`,
                          borderRadius: '10px',
                          padding: '10px 14px',
                          fontSize: '0.78rem',
                          lineHeight: 1.55,
                          color: '#f8fafc'
                        }}
                      >
                        <div style={{ fontWeight: 700, color: aiEval.color, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Sparkles size={14} /> {aiEval.title}
                        </div>
                        <div style={{ color: '#e2e8f0', fontSize: '0.75rem' }}>
                          {aiEval.message}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '1.5rem', borderRadius: '12px', border: '1px solid #1e293b', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: '#f8fafc' }}>Volume Tabung Air</h3>
                  <div style={{
                    width: '80px', height: '200px',
                    border: '3px solid #334155', borderRadius: '6px 6px 3px 3px',
                    position: 'relative', overflow: 'hidden', background: '#1e293b',
                    boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)'
                  }}>
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      height: `${(() => {
                        const currentDev = data.find(d => d.id === selectedDevice.id) || selectedDevice;
                        const eff = getDeviceEffectiveData(currentDev);
                        return eff.isOnline ? Math.min(100, Math.max(0, eff.water_level)) : 0;
                      })()}%`,
                      background: 'linear-gradient(to top, #0284c7, #38bdf8)',
                      transition: 'height 1s ease-in-out',
                      boxShadow: '0 -2px 10px rgba(56, 189, 248, 0.4)'
                    }} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, pointerEvents: 'none' }}>
                      {[100, 75, 50, 25, 0].map(tick => (
                        <div key={tick} style={{ position: 'absolute', bottom: `${tick}%`, width: '100%', borderBottom: tick !== 0 ? '1px dashed rgba(255,255,255,0.15)' : 'none' }}>
                          <span style={{ position: 'absolute', right: '4px', bottom: '2px', fontSize: '9px', color: '#94a3b8', textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>
                            {tick}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {(() => {
                    const currentDev = data.find(d => d.id === selectedDevice.id) || selectedDevice;
                    const eff = getDeviceEffectiveData(currentDev);
                    const currentHistory = chartData[selectedDevice.id] || [];
                    const riseRate = eff.isOnline ? calculateWaterRiseRate(currentHistory, null, eff.water_level) : { isFast: false, isExtreme: false, badge: 'OFF', shortBadge: 'OFF' };

                    return (
                      <div style={{ marginTop: '1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                        <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: eff.isOnline ? 'var(--accent)' : '#ef4444', lineHeight: 1 }}>
                          {eff.water_level} <span style={{ fontSize: '1rem' }}>cm</span>
                        </div>
                        {!eff.isOnline && (
                          <div style={{ fontSize: '0.78rem', color: '#ef4444', fontWeight: 700 }}>
                            🔴 Sensor Terputus (Sistem OFF - 0 cm)
                          </div>
                        )}

                        {/* Indikator Laju Kenaikan Air (Rate of Rise) */}
                        {eff.isOnline && (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '4px 12px',
                              borderRadius: '9999px',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              background: riseRate.bg,
                              color: riseRate.color,
                              border: `1px solid ${riseRate.border}`,
                              boxShadow: riseRate.isExtreme ? '0 0 12px rgba(239, 68, 68, 0.4)' : 'none',
                              animation: riseRate.isExtreme ? 'pulse-alert 1.5s infinite' : 'none'
                            }}
                            title={`Laju perubahan ketinggian air: ${riseRate.rate5m >= 0 ? '+' : ''}${riseRate.rate5m} cm per 5 menit`}
                          >
                            <span>{riseRate.badge}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '1rem', borderRadius: '12px', border: '1px solid #1e293b', height: '220px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#f8fafc' }}>Grafik Riwayat</h4>
                      <button
                        onClick={() => setDetailModalDevice(selectedDevice)}
                        style={{ background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '12px', padding: '2px 8px', fontSize: '0.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title="Buka Grafik Layar Penuh"
                      >
                        <BarChart3 size={12} /> Detail
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <input
                        type="date"
                        value={chartDateFilter}
                        onChange={e => setChartDateFilter(e.target.value)}
                        style={{ background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid #334155', borderRadius: '6px', padding: '2px 8px', fontSize: '0.75rem', outline: 'none' }}
                      />
                      <input
                        type="time"
                        value={chartTimeFilter}
                        onChange={e => setChartTimeFilter(e.target.value)}
                        style={{ background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid #334155', borderRadius: '6px', padding: '2px 8px', fontSize: '0.75rem', outline: 'none' }}
                      />
                    </div>
                  </div>
                  <div style={{ flex: 1, marginLeft: '-15px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData[selectedDevice.id] || []}>
                        <defs>
                          <linearGradient id="colorWater" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--accent, #38bdf8)" stopOpacity={0.5} />
                            <stop offset="95%" stopColor="var(--accent, #38bdf8)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickMargin={5} />
                        <YAxis stroke="#64748b" fontSize={10} domain={[0, 100]} width={35} />
                        <Tooltip content={<CustomChartTooltip history={chartData[selectedDevice.id]} />} animationDuration={80} animationEasing="ease-out" cursor={{ stroke: 'var(--accent, #38bdf8)', strokeWidth: 1, strokeDasharray: '2 2' }} />
                        <Area type="monotoneX" dataKey="water_level" stroke="var(--accent, #38bdf8)" fill="url(#colorWater)" strokeWidth={2} activeDot={<CustomActiveDot />} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Data History & Export Table */}
                <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '1rem', borderRadius: '12px', border: '1px solid #1e293b', marginTop: '1rem', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '200px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#f8fafc' }}>Riwayat Tanggal Banjir</h4>
                    <button onClick={() => handleExportAllData(selectedDevice.id)} style={{ background: '#10b981', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Download size={14} /> Ekspor Excel
                    </button>
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto', paddingRight: '5px' }}>
                    <table style={{ width: '100%', fontSize: '0.75rem', color: '#cbd5e1', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#1e293b' }}>
                        <tr>
                          <th style={{ padding: '8px 4px', textAlign: 'left', borderBottom: '1px solid #334155' }}>Tanggal</th>
                          <th style={{ padding: '8px 4px', textAlign: 'left', borderBottom: '1px solid #334155' }}>Jam</th>
                          <th style={{ padding: '8px 4px', textAlign: 'left', borderBottom: '1px solid #334155' }}>Level</th>
                          <th style={{ padding: '8px 4px', textAlign: 'left', borderBottom: '1px solid #334155' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chartData[selectedDevice.id] && [...chartData[selectedDevice.id]].reverse().map((log, idx) => {
                          const d = new Date(log.sortTs || parseCreatedAt(log.created_at));
                          return (
                            <tr key={idx}>
                              <td style={{ padding: '8px 4px', borderBottom: '1px solid #334155' }}>{d.toLocaleDateString()}</td>
                              <td style={{ padding: '8px 4px', borderBottom: '1px solid #334155' }}>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                              <td style={{ padding: '8px 4px', borderBottom: '1px solid #334155' }}>{log.water_level} cm</td>
                              <td style={{ padding: '8px 4px', borderBottom: '1px solid #334155' }}>
                                {(() => {
                                  const st = getWaterStatus(log.water_level, log.status);
                                  return (
                                    <span style={{ color: st.color, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dotColor }} />
                                      {st.label}
                                    </span>
                                  );
                                })()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {(!chartData[selectedDevice.id] || chartData[selectedDevice.id].length === 0) && (
                      <p style={{ textAlign: 'center', margin: '20px 0', color: '#64748b', fontSize: '0.8rem' }}>Belum ada riwayat data.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Main Content for Login and Admin */}
      {(view === 'login' || view === 'admin') && (
        <div className="main-wrapper animate-fade-in">
          <main className={`main-content ${view === 'login' ? 'login-page-main' : ''}`}>
            {view === 'login' && (
              <div className="login-container">

                {/* 1. POP-UP SIMULASI PESAN GMAIL MASUK (Untuk Pemulihan via Gmail) */}
                {recoverySimulatedGmail && (
                  <div style={{
                    position: 'fixed',
                    top: '24px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 99999,
                    width: '92%',
                    maxWidth: '480px',
                    background: '#0f172a',
                    border: '1px solid #ef4444',
                    borderRadius: '16px',
                    padding: '16px 20px',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.8), 0 0 30px rgba(239, 68, 68, 0.35)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    animation: 'slideDownNotification 0.35s ease-out'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: '#ea4335', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' }}>
                          <Mail size={18} />
                        </div>
                        <div>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc' }}>
                            Kotak Masuk Gmail (Google Accounts / UkurAir)
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                            Ke: {recoverySimulatedGmail.email} • {recoverySimulatedGmail.time}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRecoverySimulatedGmail(null)}
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div style={{ fontSize: '0.92rem', color: '#e2e8f0', lineHeight: 1.5, background: 'rgba(255, 255, 255, 0.05)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      Subjek: <strong>Kode verifikasi pemulihan Akun Google Anda</strong><br />
                      Kode konfirmasi Anda adalah: <strong style={{ color: '#ea4335', fontSize: '1.25rem', letterSpacing: '2px' }}>G-{recoverySimulatedGmail.code}</strong>. Masukkan kode ini pada form pemulihan web.
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <button
                        type="button"
                        id="btn-auto-fill-gmail-otp"
                        onClick={() => {
                          setRecoveryGmailOtpInput(recoverySimulatedGmail.code);
                          setError('');
                        }}
                        style={{
                          background: '#ea4335',
                          color: '#ffffff',
                          border: 'none',
                          padding: '7px 16px',
                          borderRadius: '20px',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                        }}
                      >
                        ⚡ Salin & Isi Kode Otomatis
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. POP-UP SIMULASI PESAN SMS UNTUK PEMULIHAN (Coba Cara Lain) */}
                {forgotSimulatedSms && (
                  <div style={{
                    position: 'fixed',
                    top: '24px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 99999,
                    width: '92%',
                    maxWidth: '480px',
                    background: '#0f172a',
                    border: '1px solid #3b82f6',
                    borderRadius: '16px',
                    padding: '16px 20px',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.8), 0 0 30px rgba(59, 130, 246, 0.35)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    animation: 'slideDownNotification 0.35s ease-out'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' }}>
                          <MessageSquare size={18} />
                        </div>
                        <div>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc' }}>
                            Pesan SMS Masuk (Pemulihan via Nomor HP)
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                            Ke: {forgotSimulatedSms.phone} • {forgotSimulatedSms.time}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setForgotSimulatedSms(null)}
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div style={{ fontSize: '0.92rem', color: '#e2e8f0', lineHeight: 1.5, background: 'rgba(255, 255, 255, 0.05)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      Gunakan <strong style={{ color: '#a8c7fa', fontSize: '1.2rem', letterSpacing: '2px' }}>G-{forgotSimulatedSms.code}</strong> sebagai kode verifikasi pemulihan Akun Anda.
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <button
                        type="button"
                        id="btn-auto-fill-otp"
                        onClick={() => {
                          setForgotOtpInput(forgotSimulatedSms.code);
                          setError('');
                        }}
                        style={{
                          background: '#38bdf8',
                          color: '#062e6f',
                          border: 'none',
                          padding: '7px 16px',
                          borderRadius: '20px',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        ⚡ Salin & Isi Kode Otomatis
                      </button>
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* KONDISI 1: TAMPILAN LUPA EMAIL (DEFAULT GMAIL / CARA LAIN NOMOR HP) */}
                {/* ======================================================== */}
                {isForgotEmail ? (
                  <div className="login-card login-forgot-card">

                    {/* Kolom Kiri */}
                    <div className="login-card-left">
                      <svg className="login-google-logo" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>

                      {/* Judul & Penjelasan Dinamis Sesuai Metode */}
                      <h1 className="login-title">
                        {recoveryMode === 'gmail' ? (
                          forgotStep === 1 ? 'Konfirmasi via Gmail' :
                            forgotStep === 2 ? 'Periksa Kotak Masuk Gmail' : 'Akun Ditemukan'
                        ) : (
                          forgotStep === 1 ? 'Coba Cara Lain (Nomor HP)' :
                            forgotStep === 2 ? 'Verifikasi Kode SMS/WA' : 'Akun Ditemukan'
                        )}
                      </h1>

                      <p className="login-subtitle">
                        {recoveryMode === 'gmail' ? (
                          forgotStep === 1 ? 'Google akan mengirimkan kode konfirmasi 6 digit ke alamat Gmail Anda untuk memverifikasi akun.' :
                            forgotStep === 2 ? `Masukkan kode verifikasi 6 digit yang dikirimkan ke ${recoveryEmailInput || 'Gmail Anda'}.` :
                              'Akun Google Anda berhasil diverifikasi. Lanjutkan ke langkah login berikutnya.'
                        ) : (
                          forgotStep === 1 ? 'Masukkan nomor telepon pemulihan yang terdaftar pada akun Anda saat pendaftaran.' :
                            forgotStep === 2 ? `Masukkan kode verifikasi 6 digit yang dikirimkan ke ${forgotPhone || 'nomor HP Anda'}.` :
                              'Akun Google Anda berhasil diverifikasi melalui konfirmasi nomor telepon.'
                        )}
                      </p>

                      {/* Indikator Metode Aktif */}
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '14px', padding: '5px 12px', background: recoveryMode === 'gmail' ? 'rgba(234, 67, 53, 0.15)' : 'rgba(56, 189, 248, 0.15)', border: '1px solid ' + (recoveryMode === 'gmail' ? '#ea4335' : '#38bdf8'), borderRadius: '20px', width: 'fit-content' }}>
                        {recoveryMode === 'gmail' ? <Mail size={14} color="#ea4335" /> : <Smartphone size={14} color="#38bdf8" />}
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: recoveryMode === 'gmail' ? '#fca5a5' : '#38bdf8' }}>
                          Metode Aktif: {recoveryMode === 'gmail' ? 'Verifikasi Gmail' : 'Verifikasi Nomor HP'}
                        </span>
                      </div>
                    </div>

                    {/* Kolom Kanan */}
                    <div className="login-card-right">
                      {error && (
                        <div className="error-msg" style={{ color: '#ef4444', marginBottom: '15px', fontSize: '0.9rem', padding: '10px 14px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid #ef4444', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <AlertTriangle size={16} />
                          <span>{error}</span>
                        </div>
                      )}

                      {/* ---------------------------------------------------- */}
                      {/* OPSI A: VERIFIKASI VIA GMAIL (DEFAULT)               */}
                      {/* ---------------------------------------------------- */}
                      {recoveryMode === 'gmail' && (
                        <>
                          {/* Step 1: Input Email & Kirim Kode */}
                          {forgotStep === 1 && (
                            <form onSubmit={(e) => {
                              e.preventDefault();
                              handleSendGmailRecoveryOtp();
                            }} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                              <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '8px' }}>
                                  Alamat Gmail / Email Akun Anda
                                </label>
                                <input
                                  id="input-recovery-gmail"
                                  type="email"
                                  value={recoveryEmailInput}
                                  onChange={e => setRecoveryEmailInput(e.target.value)}
                                  placeholder="Contoh: mrizkinabawi@gmail.com"
                                  required
                                  autoFocus
                                  style={{ width: '100%', padding: '16px 15px', background: 'transparent', border: '1px solid #5f6368', borderRadius: '4px', color: '#f8fafc', outline: 'none', fontSize: '1rem' }}
                                />

                                {/* Tombol Cepat Email Admin */}
                                <div
                                  onClick={() => {
                                    setRecoveryEmailInput('mrizkinabawi@gmail.com');
                                    setError('');
                                  }}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '12px', padding: '6px 14px', background: 'rgba(234, 67, 53, 0.1)', border: '1px solid rgba(234, 67, 53, 0.3)', borderRadius: '20px', color: '#fca5a5', fontSize: '0.82rem', cursor: 'pointer', transition: 'all 0.2s' }}
                                >
                                  <Mail size={13} />
                                  <span>Gunakan email admin: <strong>mrizkinabawi@gmail.com</strong></span>
                                </div>
                              </div>

                              <div style={{ flexGrow: 1, color: '#9aa0a6', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: '20px' }}>
                                Kami akan mengirimkan email konfirmasi dengan kode verifikasi 6 digit ke alamat ini.
                              </div>

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => { setIsForgotEmail(false); setError(''); }}
                                  style={{ background: 'transparent', color: '#8ab4f8', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem', padding: '10px 0' }}
                                >
                                  Batal
                                </button>
                                <button
                                  type="submit"
                                  id="btn-send-gmail-otp"
                                  style={{ background: '#a8c7fa', color: '#062e6f', border: 'none', padding: '10px 24px', borderRadius: '24px', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }}
                                >
                                  Kirim Kode ke Gmail
                                </button>
                              </div>

                              {/* LINK DI BAGIAN BAWAH: COBA CARA LAIN DENGAN NOMOR HP */}
                              <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'center' }}>
                                <span
                                  id="btn-try-phone-way"
                                  onClick={() => {
                                    setRecoveryMode('phone');
                                    setForgotStep(1);
                                    setError('');
                                  }}
                                  style={{ color: '#8ab4f8', cursor: 'pointer', fontWeight: 600, fontSize: '0.92rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                >
                                  <Smartphone size={16} /> Tidak bisa akses Gmail? Coba cara lain dengan Nomor HP
                                </span>
                              </div>
                            </form>
                          )}

                          {/* Step 2: Masukkan Kode OTP dari Gmail */}
                          {forgotStep === 2 && (
                            <form onSubmit={(e) => {
                              e.preventDefault();
                              handleVerifyGmailRecoveryOtp();
                            }} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                              <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '10px' }}>
                                  Masukkan Kode 6 Digit dari Gmail:
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: '1px solid #5f6368', borderRadius: '4px', overflow: 'hidden' }}>
                                  <div style={{ padding: '16px 14px', background: 'rgba(234, 67, 53, 0.1)', color: '#ea4335', fontWeight: 700, fontSize: '1.2rem', borderRight: '1px solid #5f6368' }}>
                                    G -
                                  </div>
                                  <input
                                    id="input-gmail-otp-code"
                                    type="text"
                                    maxLength={6}
                                    value={recoveryGmailOtpInput}
                                    onChange={e => setRecoveryGmailOtpInput(e.target.value.replace(/\D/g, ''))}
                                    placeholder="123456"
                                    autoFocus
                                    required
                                    style={{ flexGrow: 1, padding: '16px 15px', background: 'transparent', border: 'none', color: '#f8fafc', outline: 'none', fontSize: '1.3rem', letterSpacing: '6px', fontWeight: 700 }}
                                  />
                                </div>

                                <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.88rem' }}>
                                  <span style={{ color: '#94a3b8' }}>Belum ada email masuk?</span>
                                  {recoveryGmailOtpTimer > 0 ? (
                                    <span style={{ color: '#64748b' }}>Kirim ulang ({recoveryGmailOtpTimer}s)</span>
                                  ) : (
                                    <span
                                      id="btn-resend-gmail-otp"
                                      onClick={handleSendGmailRecoveryOtp}
                                      style={{ color: '#8ab4f8', cursor: 'pointer', fontWeight: 600 }}
                                    >
                                      Kirim Ulang Email
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div style={{ flexGrow: 1 }}></div>

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => { setForgotStep(1); setError(''); }}
                                  style={{ background: 'transparent', color: '#8ab4f8', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem', padding: '10px 0' }}
                                >
                                  Kembali
                                </button>
                                <button
                                  type="submit"
                                  id="btn-verify-gmail-otp"
                                  style={{ background: '#a8c7fa', color: '#062e6f', border: 'none', padding: '10px 24px', borderRadius: '24px', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }}
                                >
                                  Verifikasi Kode
                                </button>
                              </div>

                              {/* LINK DI BAGIAN BAWAH: COBA CARA LAIN DENGAN NOMOR HP */}
                              <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'center' }}>
                                <span
                                  onClick={() => {
                                    setRecoveryMode('phone');
                                    setForgotStep(1);
                                    setError('');
                                  }}
                                  style={{ color: '#8ab4f8', cursor: 'pointer', fontWeight: 600, fontSize: '0.92rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                >
                                  <Smartphone size={16} /> Tidak bisa akses email? Coba cara lain dengan Nomor HP
                                </span>
                              </div>
                            </form>
                          )}
                        </>
                      )}

                      {/* ---------------------------------------------------- */}
                      {/* OPSI B: CARA LAIN DI BAWAH (VERIFIKASI NOMOR HP)     */}
                      {/* ---------------------------------------------------- */}
                      {recoveryMode === 'phone' && (
                        <>
                          {/* Step 1: Input Nomor HP & Metode Kirim */}
                          {forgotStep === 1 && (
                            <form onSubmit={(e) => {
                              e.preventDefault();
                              handleSendRecoveryOtp();
                            }} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                              <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '8px' }}>
                                  Nomor Telepon Pemulihan Terdaftar
                                </label>
                                <input
                                  id="input-forgot-phone"
                                  type="tel"
                                  value={forgotPhone}
                                  onChange={e => setForgotPhone(e.target.value)}
                                  placeholder="Contoh: 081234567890"
                                  required
                                  autoFocus
                                  style={{ width: '100%', padding: '16px 15px', background: 'transparent', border: '1px solid #5f6368', borderRadius: '4px', color: '#f8fafc', outline: 'none', fontSize: '1.05rem' }}
                                />

                                {/* Tombol Cepat Nomor HP Terdaftar */}
                                <div
                                  onClick={() => {
                                    setForgotPhone('081234567890');
                                    setError('');
                                  }}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '10px', padding: '6px 14px', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '20px', color: '#38bdf8', fontSize: '0.82rem', cursor: 'pointer' }}
                                >
                                  <Smartphone size={13} />
                                  <span>Gunakan nomor contoh admin: <strong>0812-3456-7890</strong></span>
                                </div>
                              </div>

                              <div style={{ marginBottom: '20px' }}>
                                <div style={{ padding: '12px 14px', borderRadius: '8px', border: '1px solid #334155', background: 'rgba(56, 189, 248, 0.08)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <MessageSquare size={18} color="#38bdf8" />
                                  <span style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>Kode 6 digit akan dikirimkan via SMS ke nomor HP di atas.</span>
                                </div>
                              </div>

                              <div style={{ flexGrow: 1 }}></div>

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => { setRecoveryMode('gmail'); setForgotStep(1); setError(''); }}
                                  style={{ background: 'transparent', color: '#8ab4f8', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem', padding: '10px 0' }}
                                >
                                  Kembali
                                </button>
                                <button
                                  type="submit"
                                  id="btn-send-phone-otp"
                                  style={{ background: '#a8c7fa', color: '#062e6f', border: 'none', padding: '10px 24px', borderRadius: '24px', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }}
                                >
                                  Kirim Kode SMS
                                </button>
                              </div>

                              {/* LINK KEMBALI KE GMAIL */}
                              <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'center' }}>
                                <span
                                  onClick={() => {
                                    setRecoveryMode('gmail');
                                    setForgotStep(1);
                                    setError('');
                                  }}
                                  style={{ color: '#8ab4f8', cursor: 'pointer', fontWeight: 600, fontSize: '0.92rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                >
                                  <Mail size={16} /> ← Kembali ke konfirmasi via Gmail
                                </span>
                              </div>
                            </form>
                          )}

                          {/* Step 2: Input Kode OTP dari SMS/WA */}
                          {forgotStep === 2 && (
                            <form onSubmit={(e) => {
                              e.preventDefault();
                              handleVerifyRecoveryOtp();
                            }} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                              <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '10px' }}>
                                  Masukkan Kode 6 Digit dari Telepon:
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: '1px solid #5f6368', borderRadius: '4px', overflow: 'hidden' }}>
                                  <div style={{ padding: '16px 14px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', fontWeight: 700, fontSize: '1.2rem', borderRight: '1px solid #5f6368' }}>
                                    G -
                                  </div>
                                  <input
                                    id="input-otp-code"
                                    type="text"
                                    maxLength={6}
                                    value={forgotOtpInput}
                                    onChange={e => setForgotOtpInput(e.target.value.replace(/\D/g, ''))}
                                    placeholder="123456"
                                    autoFocus
                                    required
                                    style={{ flexGrow: 1, padding: '16px 15px', background: 'transparent', border: 'none', color: '#f8fafc', outline: 'none', fontSize: '1.3rem', letterSpacing: '6px', fontWeight: 700 }}
                                  />
                                </div>

                                <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.88rem' }}>
                                  <span style={{ color: '#94a3b8' }}>Tidak menerima pesan?</span>
                                  {forgotOtpTimer > 0 ? (
                                    <span style={{ color: '#64748b' }}>Kirim ulang ({forgotOtpTimer}s)</span>
                                  ) : (
                                    <span
                                      id="btn-resend-phone-otp"
                                      onClick={handleSendRecoveryOtp}
                                      style={{ color: '#8ab4f8', cursor: 'pointer', fontWeight: 600 }}
                                    >
                                      Kirim Ulang Kode
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div style={{ flexGrow: 1 }}></div>

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => { setForgotStep(1); setError(''); }}
                                  style={{ background: 'transparent', color: '#8ab4f8', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem', padding: '10px 0' }}
                                >
                                  Kembali
                                </button>
                                <button
                                  type="submit"
                                  id="btn-verify-otp"
                                  style={{ background: '#a8c7fa', color: '#062e6f', border: 'none', padding: '10px 24px', borderRadius: '24px', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }}
                                >
                                  Verifikasi
                                </button>
                              </div>

                              <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'center' }}>
                                <span
                                  onClick={() => {
                                    setRecoveryMode('gmail');
                                    setForgotStep(1);
                                    setError('');
                                  }}
                                  style={{ color: '#8ab4f8', cursor: 'pointer', fontWeight: 600, fontSize: '0.92rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                >
                                  <Mail size={16} /> ← Kembali ke konfirmasi via Gmail
                                </span>
                              </div>
                            </form>
                          )}
                        </>
                      )}

                      {/* Step 3 (Umum): Akun Ditemukan! */}
                      {forgotStep === 3 && recoveredAccount && (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                          <div style={{ marginBottom: '20px' }}>
                            <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '14px' }}>
                              Akun Google Anda berhasil diverifikasi:
                            </p>

                            {/* Kartu Profil Akun Google */}
                            <div
                              id="recovered-account-card"
                              onClick={() => handleSelectRecoveredAccount(recoveredAccount)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '16px',
                                padding: '20px',
                                borderRadius: '16px',
                                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.95))',
                                border: '2px solid #38bdf8',
                                cursor: 'pointer',
                                boxShadow: '0 8px 24px rgba(56, 189, 248, 0.15)',
                                transition: 'transform 0.2s, box-shadow 0.2s'
                              }}
                              onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                              onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
                            >
                              <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: 'linear-gradient(135deg, #4285F4, #34A853)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '1.5rem', fontWeight: 700, flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                                {(recoveredAccount.name || recoveredAccount.email || 'U')[0].toUpperCase()}
                              </div>
                              <div style={{ flexGrow: 1, overflow: 'hidden' }}>
                                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {recoveredAccount.name || 'M. Rizki Nabawi'}
                                </div>
                                <div style={{ fontSize: '0.95rem', color: '#8ab4f8', fontWeight: 600, marginTop: '2px', wordBreak: 'break-all' }}>
                                  {recoveredAccount.email}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: '12px' }}>
                                    <Check size={12} /> Terverifikasi
                                  </span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: '12px' }}>
                                    <Shield size={12} /> {recoveredAccount.role || 'Admin'}
                                  </span>
                                </div>
                              </div>
                              <ChevronRight size={22} color="#8ab4f8" />
                            </div>
                          </div>

                          <div style={{ flexGrow: 1 }}></div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => { setIsForgotEmail(false); setError(''); }}
                              style={{ background: 'transparent', color: '#94a3b8', border: 'none', fontWeight: 500, cursor: 'pointer', fontSize: '0.92rem' }}
                            >
                              Gunakan akun lain
                            </button>
                            <button
                              type="button"
                              id="btn-use-recovered-email"
                              onClick={() => handleSelectRecoveredAccount(recoveredAccount)}
                              style={{ background: '#a8c7fa', color: '#062e6f', border: 'none', padding: '12px 24px', borderRadius: '24px', fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem' }}
                            >
                              Lanjutkan Login dengan Email Ini
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* ======================================================== */
                  /* KONDISI 2: FORM LOGIN / REGISTER NORMAL                  */
                  /* ======================================================== */
                  <div className="login-card">

                    {/* Left Column */}
                    <div className="login-card-left">
                      <svg className="login-google-logo" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                      <h1 className="login-title">
                        {isRegister ? 'Buat Akun' : 'Masuk'}
                      </h1>
                      <p className="login-subtitle">
                        {isRegister ? 'Cukup masukkan nama, email Google, dan sandi baru' : 'Lanjutkan ke IOT Banjir'}
                      </p>
                    </div>

                    {/* Right Column */}
                    <div className="login-card-right">
                      {recoverySuccessMsg && (
                        <div style={{ color: '#34d399', marginBottom: '12px', fontSize: '0.88rem', padding: '10px 12px', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid #10b981', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Check size={16} color="#34d399" />
                          <span>{recoverySuccessMsg}</span>
                        </div>
                      )}

                      {error && <div className="error-msg" style={{ color: '#ef4444', marginBottom: '12px', fontSize: '0.88rem', padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>{error}</div>}

                      {/* FORM LOGIN ATAU REGISTER */}
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        setError('');
                        if (isRegister) {
                          handleSimpleRegister(e);
                        } else {
                          handleLogin(e);
                        }
                      }} style={{ display: 'flex', flexDirection: 'column' }}>

                        {isRegister ? (
                          <>
                            {/* FORM DAFTAR AKUN BARU */}
                            <div className="login-input-group">
                              <label style={{ display: 'block', fontSize: '0.82rem', color: '#94a3b8', marginBottom: '4px' }}>
                                Nama Lengkap / Username
                              </label>
                              <input
                                type="text"
                                className="login-input-field"
                                value={regFirstName}
                                onChange={e => setRegFirstName(e.target.value)}
                                placeholder="Contoh: Muhamad"
                                required
                                autoFocus
                              />
                            </div>

                            <div className="login-input-group">
                              <label style={{ display: 'block', fontSize: '0.82rem', color: '#94a3b8', marginBottom: '4px' }}>
                                Alamat Gmail / Akun Google
                              </label>
                              <input
                                type="email"
                                className="login-input-field"
                                value={loginEmail}
                                onChange={e => setLoginEmail(e.target.value)}
                                placeholder="nama@gmail.com"
                                required
                              />
                            </div>

                            <div className="login-input-group">
                              <label style={{ display: 'block', fontSize: '0.82rem', color: '#94a3b8', marginBottom: '4px' }}>
                                Kata Sandi Baru
                              </label>
                              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <input
                                  type={showPassword ? "text" : "password"}
                                  className="login-input-field"
                                  value={loginPass}
                                  onChange={e => setLoginPass(e.target.value)}
                                  placeholder="Minimal 6 karakter"
                                  required
                                  style={{ paddingRight: '44px' }}
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowPassword(!showPassword)}
                                  style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'transparent',
                                    border: 'none',
                                    color: showPassword ? '#8ab4f8' : '#9aa0a6',
                                    cursor: 'pointer',
                                    padding: '5px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '50%'
                                  }}
                                  title={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                                  aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                                >
                                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            {/* FORM LOGIN */}
                            <div className="login-input-group">
                              <input
                                type="email"
                                className="login-input-field"
                                value={loginEmail}
                                onChange={e => setLoginEmail(e.target.value)}
                                placeholder="Email atau nomor telepon"
                                required
                              />
                              <div
                                id="btn-forgot-email"
                                className="login-forgot-link"
                                onClick={() => {
                                  setIsForgotEmail(true);
                                  setRecoveryMode('gmail');
                                  setForgotStep(1);
                                  setRecoveryEmailInput(loginEmail || 'mrizkinabawi@gmail.com');
                                  setError('');
                                }}
                              >
                                Lupa email?
                              </div>
                            </div>

                            <div className="login-input-group">
                              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <input
                                  type={showPassword ? "text" : "password"}
                                  className="login-input-field"
                                  value={loginPass}
                                  onChange={e => setLoginPass(e.target.value)}
                                  placeholder="Kata sandi"
                                  required
                                  style={{ paddingRight: '44px' }}
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowPassword(!showPassword)}
                                  style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'transparent',
                                    border: 'none',
                                    color: showPassword ? '#8ab4f8' : '#9aa0a6',
                                    cursor: 'pointer',
                                    padding: '5px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '50%'
                                  }}
                                  title={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                                  aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                                >
                                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                              </div>
                            </div>
                          </>
                        )}

                        {!isRegister && (
                          <div className="login-guest-text">
                            Bukan komputer Anda? Gunakan mode Tamu untuk login secara pribadi.<br />
                            <span style={{ color: '#8ab4f8', cursor: 'pointer', fontWeight: 600 }}>Pelajari lebih lanjut cara menggunakan Mode tamu</span>
                          </div>
                        )}

                        {/* Navigasi Tombol Form Login / Register */}
                        <div className="login-actions-row">
                          <span onClick={() => {
                            setIsRegister(!isRegister);
                            setError('');
                          }} style={{ color: '#8ab4f8', cursor: 'pointer', fontWeight: 600, fontSize: '0.92rem' }}>
                            {isRegister ? 'Masuk' : 'Buat akun'}
                          </span>

                          <button type="submit" id="btn-auth-submit" className="login-submit-btn">
                            {isRegister ? 'Buat Akun' : 'Berikutnya'}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}



            {view === 'admin' && user && isAdminUser && (
              <div>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '2rem' }}>Admin Control Panel</h1>

                {dbError && (
                  <div style={{ marginBottom: '1.5rem', padding: '12px 16px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid #ef4444', color: '#fecaca', fontSize: '0.85rem', lineHeight: 1.6, display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <AlertTriangle size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <strong style={{ display: 'block', marginBottom: '2px' }}>Koneksi database bermasalah</strong>
                      {dbError}
                    </div>
                  </div>
                )}

                <div className="admin-panel" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '2 1 500px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* Bar Pencarian Alat di Panel Admin */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: 'rgba(15, 23, 42, 0.6)', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                      <div style={{ position: 'relative', flex: '1 1 260px' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                        <input
                          type="text"
                          value={adminTableSearch}
                          onChange={e => setAdminTableSearch(e.target.value)}
                          placeholder="Cari ID alat, wilayah, IP, atau MAC..."
                          style={{
                            width: '100%',
                            padding: '8px 34px 8px 36px',
                            background: 'rgba(30, 41, 59, 0.9)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.82rem',
                            outline: 'none'
                          }}
                        />
                        {adminTableSearch && (
                          <X
                            size={15}
                            onClick={() => setAdminTableSearch('')}
                            style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', cursor: 'pointer' }}
                            title="Hapus pencarian"
                          />
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        Total: <b style={{ color: '#38bdf8' }}>{devices.filter(d => {
                          if (!adminTableSearch.trim()) return true;
                          const q = adminTableSearch.toLowerCase().trim();
                          return String(d.name || '').toLowerCase().includes(q) ||
                            String(d.id || '').toLowerCase().includes(q) ||
                            String(d.ip || '').toLowerCase().includes(q) ||
                            String(d.mac || '').toLowerCase().includes(q);
                        }).length}</b> dari {devices.length} alat
                      </div>
                    </div>

                    <div className="admin-table-container" style={{ marginTop: 0, overflowX: 'auto' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>ID Alat (Arduino)</th>
                            <th>Wilayah</th>
                            <th>Status Koneksi</th>
                            <th>Level Air</th>
                            <th>Catu Daya (Aki & Surya)</th>
                            <th>IP Address</th>
                            <th>MAC Address</th>
                            <th>API Key</th>
                            <th>Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {devices.filter(d => {
                            if (!adminTableSearch.trim()) return true;
                            const q = adminTableSearch.toLowerCase().trim();
                            return String(d.name || '').toLowerCase().includes(q) ||
                              String(d.id || '').toLowerCase().includes(q) ||
                              String(d.ip || '').toLowerCase().includes(q) ||
                              String(d.mac || '').toLowerCase().includes(q);
                          }).map(d => {
                            const liveInfo = data.find(x => x.id === d.id) || d;
                            const eff = getDeviceEffectiveData(liveInfo);
                            const deviceIp = liveInfo.ip || d.ip || null;
                            const deviceMac = liveInfo.mac || d.mac || null;

                            return (
                              <tr key={d.id}>
                                <td style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', color: 'var(--accent)' }}>
                                      {d.id}
                                    </code>
                                    <button
                                      className="btn"
                                      title="Salin ID Alat untuk Sketch ESP32"
                                      style={{ border: '1px solid var(--border)', fontSize: '0.65rem', padding: '2px 8px' }}
                                      onClick={async () => {
                                        const ok = await copyToClipboard(d.id);
                                        if (ok) {
                                          setCopiedDevId(d.id);
                                          setTimeout(() => setCopiedDevId(null), 1500);
                                        } else {
                                          alert('Gagal menyalin ID.');
                                        }
                                      }}
                                    >
                                      {copiedDevId === d.id ? 'Tersalin' : 'Salin'}
                                    </button>
                                  </div>
                                </td>
                                <td style={{ fontWeight: 600 }}>{liveInfo.name || d.name}</td>
                                <td>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <ConnectionBadge isOnline={eff.isOnline} lastSeenText={eff.lastSeenText} />
                                    <span style={{ fontSize: '0.68rem', color: eff.isOnline ? '#94a3b8' : '#ef4444' }}>
                                      {eff.lastSeenText}
                                    </span>
                                  </div>
                                </td>
                                <td>
                                  <div style={{ fontWeight: 700, color: eff.isOnline ? 'var(--accent)' : '#ef4444', fontSize: '0.95rem' }}>
                                    {eff.water_level} cm
                                    {!eff.isOnline && (
                                      <span style={{ fontSize: '0.68rem', display: 'block', color: '#ef4444', fontWeight: 600 }}>(OFF)</span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  {(() => {
                                    const rawVolt = liveInfo.battery_volt ?? d.battery_volt;
                                    const volt = rawVolt !== undefined && rawVolt !== null ? Number(rawVolt) : 12.6;
                                    const rawPct = liveInfo.battery_pct ?? d.battery_pct;
                                    const pct = rawPct !== undefined && rawPct !== null
                                      ? Number(rawPct)
                                      : Math.min(100, Math.max(0, Math.round(((volt - 11.6) / 1.1) * 100)));
                                    const isSolar = liveInfo.solar_charging ?? (d.solar_charging !== undefined ? Boolean(d.solar_charging) : volt >= 13.0);
                                    const isMock = rawVolt === undefined && rawPct === undefined;

                                    return (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                          <Battery size={14} color={pct < 25 ? '#ef4444' : pct < 60 ? '#f59e0b' : '#10b981'} />
                                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: pct < 25 ? '#ef4444' : '#f8fafc' }}>
                                            {volt}V <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500 }}>({pct}%)</span>
                                          </span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                          {isSolar ? (
                                            <span
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                background: 'rgba(234, 179, 8, 0.15)',
                                                color: '#facc15',
                                                border: '1px solid rgba(234, 179, 8, 0.3)',
                                                padding: '1px 6px',
                                                borderRadius: '4px',
                                                fontSize: '0.68rem',
                                                fontWeight: 600
                                              }}
                                              title="Panel surya aktif mengisi daya aki"
                                            >
                                              <Sun size={10} /> Mengisi Daya
                                            </span>
                                          ) : (
                                            <span
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                background: 'rgba(56, 189, 248, 0.1)',
                                                color: '#38bdf8',
                                                border: '1px solid rgba(56, 189, 248, 0.25)',
                                                padding: '1px 6px',
                                                borderRadius: '4px',
                                                fontSize: '0.68rem',
                                                fontWeight: 600
                                              }}
                                              title="Perangkat aktif menggunakan daya aki"
                                            >
                                              <BatteryCharging size={10} /> Mode Aki
                                            </span>
                                          )}
                                          {!eff.isOnline && (
                                            <span style={{ fontSize: '0.62rem', color: '#ef4444' }} title="Sensor sedang offline">(Offline)</span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td>
                                  {deviceIp ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '3px 8px', borderRadius: '5px', fontSize: '0.78rem', fontFamily: 'monospace' }}>
                                      <Wifi size={12} /> {deviceIp}
                                    </span>
                                  ) : (
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>-</span>
                                  )}
                                </td>
                                <td>
                                  {deviceMac ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(167, 139, 250, 0.1)', color: '#a78bfa', border: '1px solid rgba(167, 139, 250, 0.25)', padding: '3px 8px', borderRadius: '5px', fontSize: '0.78rem', fontFamily: 'monospace' }}>
                                      <Cpu size={12} /> {deviceMac}
                                    </span>
                                  ) : (
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>-</span>
                                  )}
                                </td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', color: d.secret_key ? 'var(--accent)' : 'var(--danger)' }}>
                                      {maskKey(d.secret_key)}
                                    </code>
                                    <button
                                      className="btn"
                                      title="Salin API Key"
                                      style={{ border: '1px solid var(--border)', fontSize: '0.65rem', padding: '2px 8px' }}
                                      onClick={() => handleCopyKey(d)}
                                      disabled={!d.secret_key}
                                    >
                                      {copiedId === d.id ? 'Tersalin' : 'Salin'}
                                    </button>
                                  </div>
                                </td>
                                <td style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                  <button
                                    className="btn"
                                    title={eff.isOnline ? "Simulasikan sensor terputus (OFF)" : "Simulasikan sensor terhubung kembali (Online)"}
                                    style={{
                                      border: `1px solid ${eff.isOnline ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
                                      color: eff.isOnline ? '#ef4444' : '#10b981',
                                      fontSize: '0.68rem',
                                      padding: '4px 8px',
                                      whiteSpace: 'nowrap'
                                    }}
                                    onClick={() => simulateDeviceHeartbeat(d.id, !eff.isOnline)}
                                  >
                                    {eff.isOnline ? 'Putus' : 'Hubungkan'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    style={{ border: '1px solid #10b981', color: '#10b981', fontSize: '0.7rem', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                    onClick={() => {
                                      const dLat = parseFloat(d.lat) || 1.126862;
                                      const dLng = parseFloat(d.lng) || 104.052610;
                                      setMapCenterTarget({ lat: dLat, lng: dLng, zoom: 16 });
                                      setNewLat(String(dLat));
                                      setNewLng(String(dLng));
                                      setSelectedAddressLabel(`Titik Terpilih: ${d.name} (${dLat}, ${dLng})`);
                                    }}
                                    title="Pusatkan Peta ke Lokasi Perangkat Ini"
                                  >
                                    <MapPin size={12} /> Peta
                                  </button>
                                  <button className="btn" style={{ border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: '0.7rem', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px' }} onClick={() => openApiKeyModal(d)} title="Atur Nama Wilayah, ID Alat, API Key & Konfigurasi Firebase"><Settings size={12} /> Atur Key</button>
                                  <button className="btn btn-danger" style={{ whiteSpace: 'nowrap' }} onClick={() => handleDeleteDevice(d.id)}>Hapus</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="metric-card">
                      <h4 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Shield size={18} color="var(--accent)" /> Kunci API & ID Alat per Sensor
                      </h4>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 0 }}>
                        Setiap alat memiliki <b>ID Alat</b> unik dan <b>API Key</b> sendiri di <code style={{ color: 'var(--accent)' }}>devices/&lt;ID_ALAT&gt;/secret_key</code>.
                      </p>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px', lineHeight: 1.7 }}>
                        <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '6px' }}>Cara pakai di perangkat (ESP32):</div>
                        <ol style={{ margin: 0, paddingLeft: '18px' }}>
                          <li>Salin <b>ID Alat</b> dari kolom pertama tabel, tempel ke variabel <code>ID_ALAT</code> di sketch.</li>
                          <li>Salin <b>API Key</b> dari tabel di atas, tempel ke variabel <code>API_KEY_ALAT</code> di sketch.</li>
                          <li>Kirim bersama data: <code>"api_key":"KEY_ANDA"</code> ke path <code>/dashboard/&lt;ID_ALAT&gt;.json</code>.</li>
                          <li>Telemetri otomatis: IP & MAC, serta Catu Daya Aki & Surya (<code>"battery_volt": 12.6, "solar_charging": true</code>) langsung terpantau!</li>
                        </ol>
                      </div>
                      <p style={{ fontSize: '0.72rem', color: '#f59e0b', marginBottom: 0, marginTop: '10px', lineHeight: 1.6 }}>
                        Catatan: agar key benar-benar menolak perangkat asing, pasang Security Rules
                        (contoh lengkap ada di <code>docs/PANDUAN_ARDUINO_UNO.md</code>).
                      </p>
                    </div>

                    <div className="metric-card" style={{ marginTop: '1.5rem' }}>
                      <h4 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Clock size={18} color="var(--accent)" /> Interval Pengiriman Sensor & Toleransi Watchdog
                      </h4>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 0 }}>
                        Tentukan seberapa sering sensor Anda mengirim data. Jika sensor tidak melapor melebihi batas toleransi, sistem otomatis menandai koneksi <b>🔴 Terputus</b> dan mereset indikator ke <b>0 cm (OFF)</b>.
                      </p>

                      <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginTop: '12px' }}>
                        <div style={{ flex: '1 1 240px' }}>
                          <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                            Pilih Siklus Sensor & Batas Toleransi:
                          </label>
                          <select
                            value={sensorTimeoutMinutes}
                            onChange={e => handleSensorTimeoutChange(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '10px 14px',
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border)',
                              borderRadius: '8px',
                              color: '#f8fafc',
                              fontSize: '0.85rem',
                              fontWeight: 600,
                              outline: 'none',
                              cursor: 'pointer'
                            }}
                          >
                            <option value={15}>10 Menit Sekali (Batas Toleransi: 15 Menit) - Rekomendasi Anda</option>
                            <option value={8}>5 Menit Sekali (Batas Toleransi: 8 Menit)</option>
                            <option value={20}>15 Menit Sekali (Batas Toleransi: 20 Menit)</option>
                            <option value={40}>30 Menit Sekali (Batas Toleransi: 40 Menit)</option>
                            <option value={90}>1 Jam Sekali (Batas Toleransi: 90 Menit)</option>
                            <option value={2}>1 Menit Sekali (Batas Toleransi: 2 Menit)</option>
                            <option value={0.5}>Mode Uji Coba Cepat (Batas Toleransi: 30 Detik)</option>
                          </select>
                        </div>

                        <div style={{ flex: '1 1 240px', fontSize: '0.75rem', color: '#cbd5e1', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '12px 14px', borderRadius: '8px', lineHeight: 1.6 }}>
                          <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '3px' }}>💡 Status Proteksi Aktif:</strong>
                          Sensor tetap <b style={{ color: '#10b981' }}>🟢 Terhubung</b> selama <b>{sensorTimeoutMinutes >= 1 ? `${sensorTimeoutMinutes} menit` : `${sensorTimeoutMinutes * 60} detik`}</b> setelah pengiriman terakhir.
                        </div>
                      </div>
                    </div>


                  </div>

                  <div style={{ flex: '1 1 400px' }}>
                    <div className="metric-card">
                      <h4 style={{ marginBottom: '1.5rem', fontSize: '1.2rem' }}>Tambah Alat Baru</h4>
                      <form onSubmit={handleAddDevice}>
                        <div className="form-group">
                          <label>Nama Wilayah</label>
                          <input
                            value={newName}
                            onChange={e => {
                              const val = e.target.value;
                              setNewName(val);
                              // Bantu isi ID Alat otomatis jika belum diisi manual
                              if (!newDeviceId) {
                                const slug = val.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                                if (slug) setNewDeviceId(slug);
                              }
                            }}
                            placeholder="Contoh: asrama B atau Pintu Air A"
                            required
                          />
                        </div>

                        <div className="form-group">
                          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>ID Alat (ESP ID)</span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>(Bisa samakan dg sketch ESP32)</span>
                          </label>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                              value={newDeviceId}
                              onChange={e => setNewDeviceId(e.target.value)}
                              placeholder="Contoh: asrama-b, esp32-ECB9E0 (opsional)"
                            />
                            <button
                              type="button"
                              onClick={generateDeviceId}
                              className="btn"
                              style={{ padding: '0 10px', fontSize: '0.7rem', border: '1px solid var(--accent)', color: 'var(--accent)', whiteSpace: 'nowrap' }}
                              title="Buat ID Alat Otomatis"
                            >
                              AUTO
                            </button>
                          </div>
                          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', marginBottom: 0 }}>
                            ID unik yang digunakan di sketch ESP32 (variabel <code>ID_ALAT</code>).
                          </p>
                        </div>

                        <div className="form-group">
                          <label>Sensor Kunci API (API Key)</label>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                              value={newSecretKey}
                              onChange={e => setNewSecretKey(e.target.value.toUpperCase())}
                              placeholder="Klik GEN atau isi manual"
                              required
                            />
                            <button type="button" onClick={generateToken} className="btn" style={{ padding: '0 10px', fontSize: '0.7rem', border: '1px solid var(--accent)', color: 'var(--accent)' }}>GEN</button>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '0rem' }}>
                          <div className="form-group" style={{ flex: 1 }}>
                            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>MAC Address ESP32</span>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>(Opsional)</span>
                            </label>
                            <input
                              value={newMac}
                              onChange={e => {
                                let val = e.target.value.toUpperCase().replace(/[^0-9A-F:]/g, '');
                                const hex = val.replace(/:/g, '');
                                if (hex.length > 12) return;
                                const parts = [];
                                for (let i = 0; i < hex.length; i += 2) {
                                  parts.push(hex.substring(i, i + 2));
                                }
                                setNewMac(parts.join(':'));
                              }}
                              placeholder="Contoh: 4C:C3:82:EC:B9:E0"
                              maxLength={17}
                              style={{ fontFamily: 'monospace' }}
                            />
                          </div>
                          <div className="form-group" style={{ flex: 1 }}>
                            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>IP Address</span>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>(Opsional)</span>
                            </label>
                            <input
                              value={newIp}
                              onChange={e => setNewIp(e.target.value)}
                              placeholder="Contoh: 192.168.1.100"
                              style={{ fontFamily: 'monospace' }}
                            />
                          </div>
                        </div>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '-0.5rem', marginBottom: '1rem', lineHeight: 1.5 }}>
                          MAC Address unik setiap ESP32 — digunakan untuk memastikan data dari perangkat yang benar (mencegah bentrok ESP1 & ESP2). Jalankan <code style={{ color: 'var(--accent)' }}>WiFi.macAddress()</code> di Serial Monitor untuk melihat MAC ESP Anda.
                        </p>

                        <div className="form-group" style={{ marginBottom: '1.25rem', position: 'relative' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
                            <label style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>Cari Alamat &amp; Titik Lokasi di Peta</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <button
                                type="button"
                                onClick={() => setMapExpanded(!mapExpanded)}
                                style={{
                                  background: mapExpanded ? 'rgba(56, 189, 248, 0.2)' : 'rgba(56, 189, 248, 0.08)',
                                  border: '1px solid rgba(56, 189, 248, 0.35)',
                                  color: '#38bdf8',
                                  fontSize: '0.72rem',
                                  padding: '3px 10px',
                                  borderRadius: '5px',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  fontWeight: 600,
                                  transition: 'all 0.2s'
                                }}
                                title={mapExpanded ? "Perkecil ukuran peta ke mode standar" : "Perbesar ukuran peta agar lebih luas"}
                              >
                                {mapExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                                {mapExpanded ? "Perkecil Peta (Normal)" : "Perbesar View Peta (Mode Luas)"}
                              </button>
                              <span style={{ fontSize: '0.7rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Sparkles size={12} /> Sugesti Otomatis
                              </span>
                            </div>
                          </div>
                          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px', marginBottom: '8px', lineHeight: 1.4 }}>
                            Ketik alamat/tempat untuk mengarahkan peta otomatis. Jika kurang pas, <b>klik area peta</b> atau <b>geser (drag) pin</b> untuk koreksi manual.
                          </p>

                          {/* Bar Pencarian Alamat & Tempat dengan Sugesti Dropdown */}
                          <div style={{ position: 'relative', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <div style={{ position: 'relative', flex: 1 }}>
                                <input
                                  value={addressSearchQuery}
                                  onChange={e => handleAddressInputChange(e.target.value)}
                                  onFocus={() => { if (addressSuggestions.length > 0) setShowAddressSuggestions(true); }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      searchAddressGeocode(addressSearchQuery, true);
                                    }
                                  }}
                                  placeholder="Ketik alamat lengkap atau tempat (contoh: Nagoya Hill, Asrama Batam, Jl. Sudirman)..."
                                  style={{ width: '100%', paddingLeft: '32px', paddingRight: addressSearchQuery ? '28px' : '10px', fontSize: '0.8rem' }}
                                />
                                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                                {addressSearchQuery && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAddressSearchQuery('');
                                      setAddressSuggestions([]);
                                      setShowAddressSuggestions(false);
                                    }}
                                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                                    title="Bersihkan pencarian"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => searchAddressGeocode(addressSearchQuery || newName, true)}
                                disabled={isSearchingAddress}
                                style={{
                                  padding: '0 12px',
                                  fontSize: '0.72rem',
                                  border: '1px solid var(--accent)',
                                  color: 'var(--accent)',
                                  whiteSpace: 'nowrap',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '5px'
                                }}
                                title="Arahkan peta ke alamat ini"
                              >
                                {isSearchingAddress ? (
                                  <span>Mencari...</span>
                                ) : (
                                  <>
                                    <Navigation size={13} /> Arahkan Peta
                                  </>
                                )}
                              </button>
                            </div>

                            {/* Tombol pintas cepat cari berdasarkan Nama Wilayah */}
                            {Boolean(newName.trim()) && !addressSearchQuery && (
                              <div style={{ marginTop: '5px' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAddressSearchQuery(newName);
                                    searchAddressGeocode(newName, true);
                                  }}
                                  style={{
                                    background: 'rgba(56, 189, 248, 0.1)',
                                    border: '1px dashed rgba(56, 189, 248, 0.4)',
                                    color: '#38bdf8',
                                    fontSize: '0.7rem',
                                    padding: '3px 8px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                >
                                  <Search size={11} /> <span>Cari nama wilayah "{newName}" di peta</span>
                                </button>
                              </div>
                            )}

                            {/* Daftar Dropdown Hasil Sugesti Alamat */}
                            {showAddressSuggestions && addressSuggestions.length > 0 && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  right: 0,
                                  background: '#0f172a',
                                  border: '1px solid rgba(56, 189, 248, 0.35)',
                                  borderRadius: '8px',
                                  marginTop: '4px',
                                  boxShadow: '0 12px 28px rgba(0,0,0,0.7)',
                                  zIndex: 1050,
                                  maxHeight: '230px',
                                  overflowY: 'auto'
                                }}
                              >
                                <div style={{ padding: '6px 12px', fontSize: '0.68rem', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span>Hasil Saran Lokasi (Klik untuk langsung menuju titik):</span>
                                  <span style={{ cursor: 'pointer', color: '#38bdf8' }} onClick={() => setShowAddressSuggestions(false)}>Tutup ✕</span>
                                </div>
                                {addressSuggestions.map(item => (
                                  <div
                                    key={item.id}
                                    onClick={() => handleSelectAddressSuggestion(item)}
                                    style={{
                                      padding: '8px 12px',
                                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                                      cursor: 'pointer',
                                      transition: 'background 0.15s',
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      gap: '8px'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                  >
                                    <MapPin size={15} color="#38bdf8" style={{ marginTop: '2px', flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {item.title}
                                      </div>
                                      <div style={{ fontSize: '0.7rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' }}>
                                        {item.fullAddress}
                                      </div>
                                    </div>
                                    <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', padding: '2px 5px', borderRadius: '4px', flexShrink: 0, marginTop: '2px' }}>
                                      Pilih ➔
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Notifikasi Label Lokasi Terpilih / Koreksi Manual */}
                          {Boolean(selectedAddressLabel) && (
                            <div style={{ fontSize: '0.72rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.25)', padding: '4px 8px', borderRadius: '5px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Check size={13} style={{ flexShrink: 0 }} />
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedAddressLabel}</span>
                            </div>
                          )}

                          {/* Wadah Peta Interaktif Leaflet */}
                          <div style={{ height: mapExpanded ? '560px' : '400px', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(56, 189, 248, 0.3)', position: 'relative', transition: 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                            <MapContainer key="admin-sensor-map" center={[parseFloat(newLat) || 1.126862, parseFloat(newLng) || 104.052610]} zoom={13} style={{ height: '100%', width: '100%' }}>
                              <TileLayer url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}" />
                              <MapFlyController target={mapCenterTarget} />
                              <MapResizeHandler expanded={mapExpanded} />

                              {/* PIN SEMUA PERANGKAT TERDAFTAR (SINKRON OTOMATIS DENGAN PANEL UTAMA) */}
                              {devices.map(dev => {
                                const dLat = parseFloat(dev.lat) || 1.126862;
                                const dLng = parseFloat(dev.lng) || 104.052610;
                                return (
                                  <Marker
                                    key={'admin-sync-dev-' + dev.id}
                                    position={[dLat, dLng]}
                                    draggable={true}
                                    eventHandlers={{
                                      dragend: async (e) => {
                                        const pos = e.target.getLatLng();
                                        const latVal = parseFloat(pos.lat.toFixed(6));
                                        const lngVal = parseFloat(pos.lng.toFixed(6));
                                        setNewLat(String(latVal));
                                        setNewLng(String(lngVal));
                                        setSelectedAddressLabel(`Geser Lokasi "${dev.name}": ${latVal}, ${lngVal}`);
                                        if (window.confirm(`Perbarui titik koordinat "${dev.name}" menjadi (${latVal}, ${lngVal})?\n\nPosisi di PETA PANEL UTAMA juga akan langsung otomatis sinkron.`)) {
                                          await handleUpdateDeviceCoords(dev.id, latVal, lngVal);
                                        }
                                      }
                                    }}
                                  >
                                    <Popup>
                                      <div style={{ fontSize: '0.82rem', color: '#0f172a', minWidth: '190px' }}>
                                        <strong style={{ color: '#0284c7', display: 'block', fontSize: '0.92rem', marginBottom: '4px' }}>
                                          📍 {dev.name}
                                        </strong>
                                        <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.5 }}>
                                          <b>ID:</b> <code>{dev.id}</code><br />
                                          <b>Koordinat:</b> {dLat}, {dLng}
                                        </div>
                                        <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #e2e8f0', fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>
                                          👉 <b>Geser pin ini</b> untuk memindahkan lokasi langsung &amp; otomatis sinkron ke Panel Utama.
                                        </div>
                                      </div>
                                    </Popup>
                                  </Marker>
                                );
                              })}

                              {/* PIN CALON ALAT BARU / TARGET MANUAL */}
                              <Marker
                                position={[parseFloat(newLat) || 1.126862, parseFloat(newLng) || 104.052610]}
                                draggable={true}
                                eventHandlers={{
                                  dragend: (e) => {
                                    const pos = e.target.getLatLng();
                                    const latStr = pos.lat.toFixed(6);
                                    const lngStr = pos.lng.toFixed(6);
                                    setNewLat(latStr);
                                    setNewLng(lngStr);
                                    setSelectedAddressLabel(`Target Manual Pin: ${latStr}, ${lngStr}`);
                                  }
                                }}
                              >
                                <Popup>
                                  <div style={{ fontSize: '0.78rem', color: '#0f172a' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>🎯 Titik Dipilih di Peta</div>
                                    <div>Lat: <span>{newLat}</span></div>
                                    <div>Lng: <span>{newLng}</span></div>
                                    <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '4px' }}>
                                      Gunakan tombol sinkron di bawah peta untuk menerapkan ke alat aktif, atau simpan sebagai alat baru.
                                    </div>
                                  </div>
                                </Popup>
                              </Marker>
                              <LocationPicker onLocationSelect={(lat, lng) => {
                                const latStr = lat.toFixed(6);
                                const lngStr = lng.toFixed(6);
                                setNewLat(latStr);
                                setNewLng(lngStr);
                                setSelectedAddressLabel(`Target Manual Klik: ${latStr}, ${lngStr}`);
                              }} />
                            </MapContainer>
                          </div>
                          <p style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '4px', marginBottom: 0, textAlign: 'right' }}>
                            💡 Tip: Klik langsung di area peta atau geser pin merah untuk koreksi manual presisi.
                          </p>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                          <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                            <label>Latitude</label>
                            <input type="number" step="any" value={newLat} onChange={e => setNewLat(e.target.value)} required />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                            <label>Longitude</label>
                            <input type="number" step="any" value={newLng} onChange={e => setNewLng(e.target.value)} required />
                          </div>
                        </div>

                        {/* FITUR SINKRONISASI CEPAT KE PERANGKAT AKTIF */}
                        {devices && devices.length > 0 && (
                          <div style={{ marginBottom: '1.5rem', padding: '10px 14px', background: 'rgba(56, 189, 248, 0.08)', borderRadius: '10px', border: '1px solid rgba(56, 189, 248, 0.25)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.78rem', color: '#f8fafc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <RefreshCcw size={13} color="#38bdf8" /> Sinkronkan Titik Peta Ini ({newLat}, {newLng}) ke Alat:
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              {devices.map(d => (
                                <button
                                  key={'sync-quick-' + d.id}
                                  type="button"
                                  onClick={() => handleUpdateDeviceCoords(d.id, parseFloat(newLat), parseFloat(newLng))}
                                  style={{
                                    background: '#0284c7',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    transition: 'background 0.2s'
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = '#0369a1'}
                                  onMouseLeave={e => e.currentTarget.style.background = '#0284c7'}
                                  title={`Terapkan koordinat saat ini ke ${d.name} agar langsung sinkron dengan Panel Utama`}
                                >
                                  <MapPin size={12} /> Terapkan ke "{d.name}"
                                </button>
                              ))}
                            </div>
                            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                              Klik tombol di atas untuk langsung memperbarui lokasi alat di database Firebase dan menyelaraskan peta Panel Utama secara instan.
                            </span>
                          </div>
                        )}

                        <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }}>Daftar Alat Baru</button>
                      </form>
                    </div>
                  </div>
                </div>

                {/* Pusat Notifikasi & Integrasi Peringatan Dini (SMS & Telegram) */}
                <div style={{ marginTop: '2.5rem' }}>
                  {renderNotificationSettings(false)}
                </div>

                <div className="dashboard-grid" style={{ marginTop: '3rem' }}>
                  {devices.map(device => (
                    <div key={device.id} className="chart-container" style={{ height: '220px', marginTop: 0, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <p style={{ fontSize: '0.85rem', margin: 0, fontWeight: 600 }}>{device.name}</p>
                        <button
                          onClick={() => setDetailModalDevice(device)}
                          style={{ background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '12px', padding: '2px 8px', fontSize: '0.7rem', cursor: 'pointer', transition: 'all 0.2s' }}
                          onMouseOver={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = '#0f172a'; }}
                          onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--accent)'; }}
                        >
                          Lihat Lebih Detil
                        </button>
                      </div>
                      {(!chartData[device.id] || chartData[device.id].length === 0) ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.72rem', textAlign: 'center', gap: '4px', padding: '0 10px' }}>
                          <span>Belum ada riwayat pengukuran.</span>
                          <span style={{ fontSize: '0.65rem' }}>Kirim data ke <code>/measurements/{device.id}</code></span>
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" style={{ flex: 1 }}>
                          <AreaChart data={chartData[device.id]} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <XAxis dataKey="time" stroke="#64748b" fontSize={9} tickMargin={5} minTickGap={30} />
                            <YAxis stroke="#64748b" fontSize={9} />
                            <Tooltip content={<CustomChartTooltip history={chartData[device.id]} />} animationDuration={80} animationEasing="ease-out" cursor={{ stroke: 'var(--accent)', strokeWidth: 1, strokeDasharray: '2 2' }} />
                            <Area type="monotoneX" dataKey="water_level" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.1} strokeWidth={2} activeDot={{ r: 5, fill: "#fff", stroke: "var(--accent)", strokeWidth: 2, style: { transition: 'cx 0.08s ease-out, cy 0.08s ease-out' } }} isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {/* Modal Pengaturan Alat, Edit Nama, ID, Key & Link Firebase */}
      {apiKeyModalDevice && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.82)', zIndex: 1100, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(6px)', padding: '15px' }}>
          <div className="animate-fade-in" style={{ background: '#1e293b', width: '100%', maxWidth: '640px', maxHeight: '92vh', borderRadius: '16px', border: '1px solid #334155', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.85)' }}>

            {/* Header Modal */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(15, 23, 42, 0.6)' }}>
              <div>
                <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Settings size={20} color="#38bdf8" /> Atur Key &amp; Identitas Alat
                </h2>
                <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.8rem' }}>
                  Kelola nama wilayah, ID alat, kunci autentikasi, serta integrasi Firebase
                </p>
              </div>
              <X size={24} color="#94a3b8" style={{ cursor: 'pointer', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'} onClick={() => setApiKeyModalDevice(null)} />
            </div>

            {/* Navigasi Tab Modal */}
            <div style={{ display: 'flex', borderBottom: '1px solid #334155', background: '#0f172a' }}>
              <button
                type="button"
                onClick={() => setActiveModalTab('general')}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: activeModalTab === 'general' ? '#1e293b' : 'transparent',
                  border: 'none',
                  borderBottom: activeModalTab === 'general' ? '2px solid #38bdf8' : '2px solid transparent',
                  color: activeModalTab === 'general' ? '#38bdf8' : '#94a3b8',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.2s'
                }}
              >
                <Edit3 size={15} /> Atur Nama &amp; Kunci Alat
              </button>
              <button
                type="button"
                onClick={() => setActiveModalTab('firebase')}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: activeModalTab === 'firebase' ? '#1e293b' : 'transparent',
                  border: 'none',
                  borderBottom: activeModalTab === 'firebase' ? '2px solid #38bdf8' : '2px solid transparent',
                  color: activeModalTab === 'firebase' ? '#38bdf8' : '#94a3b8',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.2s'
                }}
              >
                <Database size={15} /> Integrasi &amp; Link Firebase
              </button>
            </div>

            {/* Konten Tab */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {activeModalTab === 'general' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                  {/* Edit Nama Wilayah */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                      Nama Wilayah / Lokasi Sensor
                    </label>
                    <input
                      type="text"
                      value={editNameInput}
                      onChange={e => setEditNameInput(e.target.value)}
                      placeholder="Contoh: Asrama B, Pintu Air A, Sei Ladi"
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        color: '#f8fafc',
                        outline: 'none',
                        fontSize: '0.88rem'
                      }}
                    />
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
                      Nama ini yang tampil pada kartu dashboard, daftar pemantauan, dan pin peta.
                    </span>
                  </div>

                  {/* Edit ID Alat (ESP ID) */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e2e8f0', margin: 0 }}>
                        ID Alat (ESP ID)
                      </label>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await copyToClipboard(editIdInput);
                          if (ok) {
                            setCopiedDevId(editIdInput);
                            setTimeout(() => setCopiedDevId(null), 1500);
                          }
                        }}
                        style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '0.72rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Copy size={12} /> {copiedDevId === editIdInput ? 'Tersalin!' : 'Salin ID'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={editIdInput}
                        onChange={e => setEditIdInput(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                        placeholder="Contoh: asrama-b, esp32-ECB9E0"
                        style={{
                          flex: 1,
                          padding: '10px 12px',
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          color: '#38bdf8',
                          fontFamily: 'monospace',
                          outline: 'none',
                          fontSize: '0.88rem'
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (editNameInput.trim()) {
                            const slug = editNameInput.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                            if (slug) setEditIdInput(slug);
                          }
                        }}
                        className="btn"
                        style={{ border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                        title="Bikin slug otomatis dari Nama Wilayah"
                      >
                        Ikuti Nama
                      </button>
                    </div>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
                      ID unik pada database Firebase. Jika ID diubah, data otomatis dimigrasikan ke ID baru.
                    </span>
                  </div>

                  {/* Edit API Key Sensor */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                      Sensor API Key (Kunci Autentikasi ESP32)
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div style={{ position: 'relative', flex: 1 }}>
                        <input
                          type={showApiKeyValue ? 'text' : 'password'}
                          value={apiKeyInput}
                          onChange={e => setApiKeyInput(e.target.value.toUpperCase())}
                          placeholder="Minimal 6 karakter"
                          spellCheck={false}
                          style={{
                            width: '100%',
                            padding: '10px 40px 10px 12px',
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            outline: 'none',
                            fontSize: '0.88rem',
                            fontFamily: 'monospace',
                            letterSpacing: '0.05em'
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKeyValue(!showApiKeyValue)}
                          title={showApiKeyValue ? 'Sembunyikan' : 'Tampilkan'}
                          style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '6px' }}
                        >
                          {showApiKeyValue ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        style={{ border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                        onClick={() => { setApiKeyInput(generateApiKey()); setShowApiKeyValue(true); }}
                      >
                        Acak
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ border: '1px solid var(--border)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                        onClick={async () => {
                          const ok = await copyToClipboard(apiKeyInput);
                          if (ok) { setCopiedId(apiKeyModalDevice.id); setTimeout(() => setCopiedId(null), 1500); }
                          else alert('Gagal menyalin.');
                        }}
                      >
                        {copiedId === apiKeyModalDevice.id ? 'Tersalin!' : 'Salin Key'}
                      </button>
                    </div>
                  </div>

                  {/* 2 Kolom: MAC Address & IP Address */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                        MAC Address ESP32 (Opsional)
                      </label>
                      <input
                        type="text"
                        value={editMacInput}
                        onChange={e => {
                          let val = e.target.value.toUpperCase().replace(/[^0-9A-F:]/g, '');
                          const hex = val.replace(/:/g, '');
                          if (hex.length > 12) return;
                          const parts = [];
                          for (let i = 0; i < hex.length; i += 2) {
                            parts.push(hex.substring(i, i + 2));
                          }
                          setEditMacInput(parts.join(':'));
                        }}
                        placeholder="Contoh: 4C:C3:82:EC:B9:E0"
                        maxLength={17}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          color: '#a78bfa',
                          fontFamily: 'monospace',
                          fontSize: '0.82rem'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                        IP Address ESP32 (Opsional)
                      </label>
                      <input
                        type="text"
                        value={editIpInput}
                        onChange={e => setEditIpInput(e.target.value)}
                        placeholder="Contoh: 192.168.1.100"
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          color: '#38bdf8',
                          fontFamily: 'monospace',
                          fontSize: '0.82rem'
                        }}
                      />
                    </div>
                  </div>

                  {/* 2 Kolom: Latitude & Longitude */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                        Latitude (Lintang)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={editLatInput}
                        onChange={e => setEditLatInput(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.82rem'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                        Longitude (Bujur)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={editLngInput}
                        onChange={e => setEditLngInput(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.82rem'
                        }}
                      />
                    </div>
                  </div>

                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                  {/* Link Host Firebase */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1', margin: 0 }}>
                        1. Firebase Realtime Database Host URL
                      </label>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await copyToClipboard("https://monitoring-ketinggian-air-1-default-rtdb.firebaseio.com");
                          if (ok) { setCopiedHost(true); setTimeout(() => setCopiedHost(false), 1500); }
                        }}
                        style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '0.72rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Copy size={12} /> {copiedHost ? 'Tersalin!' : 'Salin Host'}
                      </button>
                    </div>
                    <code style={{ display: 'block', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '8px 12px', color: '#38bdf8', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                      https://monitoring-ketinggian-air-1-default-rtdb.firebaseio.com
                    </code>
                  </div>

                  {/* Link Endpoint Node Alat Ini */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1', margin: 0 }}>
                        2. REST Endpoint Live Dashboard ({editIdInput || apiKeyModalDevice.id})
                      </label>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <a
                          href={`https://monitoring-ketinggian-air-1-default-rtdb.firebaseio.com/dashboard/${editIdInput || apiKeyModalDevice.id}.json`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#10b981', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '3px', textDecoration: 'none' }}
                          title="Buka data mentah Firebase di tab baru"
                        >
                          <ExternalLink size={12} /> Buka JSON
                        </a>
                        <button
                          type="button"
                          onClick={async () => {
                            const url = `https://monitoring-ketinggian-air-1-default-rtdb.firebaseio.com/dashboard/${editIdInput || apiKeyModalDevice.id}.json`;
                            const ok = await copyToClipboard(url);
                            if (ok) { setCopiedNode(true); setTimeout(() => setCopiedNode(false), 1500); }
                          }}
                          style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '0.72rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Copy size={12} /> {copiedNode ? 'Tersalin!' : 'Salin Link'}
                        </button>
                      </div>
                    </div>
                    <code style={{ display: 'block', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '8px 12px', color: '#10b981', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                      {`https://monitoring-ketinggian-air-1-default-rtdb.firebaseio.com/dashboard/${editIdInput || apiKeyModalDevice.id}.json`}
                    </code>
                  </div>

                  {/* Kode Siap Tempel untuk Arduino IDE ESP32 */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Cpu size={14} color="#facc15" /> Kode Konfigurasi untuk Arduino IDE ESP32
                      </label>
                      <button
                        type="button"
                        onClick={async () => {
                          const snippet = `// =========================================================================\n// IDENTITAS ALAT & FIREBASE (SUDAH TERDAFTAR DI WEB: ${editNameInput})\n// =========================================================================\nconst String ID_ALAT       = "${editIdInput || apiKeyModalDevice.id}";\nconst String API_KEY_ALAT  = "${apiKeyInput}";\nconst String FIREBASE_HOST = "https://monitoring-ketinggian-air-1-default-rtdb.firebaseio.com";`;
                          const ok = await copyToClipboard(snippet);
                          if (ok) { setCopiedSnippet(true); setTimeout(() => setCopiedSnippet(false), 1500); }
                        }}
                        style={{ background: 'transparent', border: 'none', color: '#facc15', fontSize: '0.72rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}
                      >
                        <Copy size={12} /> {copiedSnippet ? 'Kode Tersalin!' : 'Salin Kode Arduino'}
                      </button>
                    </div>
                    <pre style={{
                      background: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      padding: '12px 14px',
                      color: '#f8fafc',
                      fontSize: '0.78rem',
                      fontFamily: 'monospace',
                      lineHeight: 1.6,
                      margin: 0,
                      overflowX: 'auto',
                      whiteSpace: 'pre'
                    }}>
                      {`// =========================================================================
// IDENTITAS ALAT & FIREBASE (SUDAH TERDAFTAR DI WEB: ${editNameInput})
// =========================================================================
const String ID_ALAT       = "${editIdInput || apiKeyModalDevice.id}";
const String API_KEY_ALAT  = "${apiKeyInput}";
const String FIREBASE_HOST = "https://monitoring-ketinggian-air-1-default-rtdb.firebaseio.com";`}
                    </pre>
                  </div>

                  {/* Panduan Singkat Sinkronisasi */}
                  <div style={{ background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '12px 14px', borderRadius: '8px', fontSize: '0.74rem', color: '#cbd5e1', lineHeight: 1.6 }}>
                    <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '4px' }}>💡 Tips Sinkronisasi Data ESP32 ke Web:</strong>
                    ESP32 Anda cukup mengirim HTTP PUT/PATCH ke path <code style={{ color: '#38bdf8' }}>{`/dashboard/${editIdInput || apiKeyModalDevice.id}.json`}</code> dengan payload JSON:
                    <br />
                    <code style={{ display: 'block', background: '#0b1120', padding: '6px 10px', borderRadius: '6px', color: '#a78bfa', marginTop: '4px', fontFamily: 'monospace' }}>
                      {`{"water_level": 35, "status": "AMAN", "api_key": "${apiKeyInput.substring(0, 8)}..."}`}
                    </code>
                    Data ketinggian air akan langsung muncul secara *real-time* di indikator web dan marker peta wilayah <b>{editNameInput}</b>!
                  </div>

                </div>
              )}
            </div>

            {/* Footer Modal: Tombol Simpan Perubahan */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid #334155', background: 'rgba(15, 23, 42, 0.8)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn"
                style={{ border: '1px solid var(--border)', fontSize: '0.82rem', padding: '8px 18px' }}
                onClick={() => setApiKeyModalDevice(null)}
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={handleSaveDeviceSettings}
                disabled={isSavingEdit}
                className="btn btn-primary"
                style={{
                  fontSize: '0.82rem',
                  padding: '8px 22px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: isSavingEdit ? 0.7 : 1
                }}
              >
                <Save size={15} /> {isSavingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Detailed Graphic Modal (Bisa dibuka oleh Admin maupun User biasa di Peta/Dashboard) */}
      {detailModalDevice && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(5px)' }}>
          <div className="animate-fade-in modal-detail-box" style={{ background: '#1e293b', width: '92%', maxWidth: '1250px', height: '82vh', borderRadius: '16px', border: '1px solid #334155', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>
            <div style={{ padding: '20px 30px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <BarChart3 size={24} color="#38bdf8" /> Detail Grafik: {detailModalDevice.name}
                  </h2>
                  {(() => {
                    const modalDev = data.find(d => d.id === detailModalDevice.id) || detailModalDevice;
                    const modalRate = calculateWaterRiseRate(chartData[detailModalDevice.id] || [], null, modalDev?.water_level);
                    return (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '3px 10px',
                          borderRadius: '9999px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: modalRate.bg,
                          color: modalRate.color,
                          border: `1px solid ${modalRate.border}`,
                          boxShadow: modalRate.isExtreme ? '0 0 10px rgba(239, 68, 68, 0.4)' : 'none',
                          animation: modalRate.isExtreme ? 'pulse-alert 1.5s infinite' : 'none'
                        }}
                      >
                        {modalRate.badge}
                      </span>
                    );
                  })()}
                  {/* Informasi Jaringan Teknis (IP & MAC) khusus untuk ADMIN */}
                  {isAdminUser && (() => {
                    const modalDev = data.find(d => d.id === detailModalDevice.id) || detailModalDevice;
                    const devIp = modalDev?.ip;
                    const devMac = modalDev?.mac;
                    if (!devIp && !devMac) return null;
                    return (
                      <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', marginLeft: '5px' }}>
                        {devIp && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontFamily: 'monospace' }} title="IP Address ESP32 (Hanya Admin)">
                            <Wifi size={13} /> {devIp}
                          </span>
                        )}
                        {devMac && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(167, 139, 250, 0.12)', color: '#a78bfa', border: '1px solid rgba(167, 139, 250, 0.3)', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontFamily: 'monospace' }} title="MAC Address ESP32 (Hanya Admin)">
                            <Cpu size={13} /> {devMac}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {(() => {
                    const modalDev = data.find(d => d.id === detailModalDevice.id) || detailModalDevice;
                    const weather = deviceWeather[detailModalDevice.id] || { label: 'Cerah Berawan', icon: '⛅', isRain: false, isHeavy: false, temp: 30, humidity: 80, precipitation: 0 };
                    const modalRate = calculateWaterRiseRate(chartData[detailModalDevice.id] || [], null, modalDev?.water_level);
                    const aiEval = evaluateAiSituation(modalDev?.water_level, modalRate, weather);

                    return (
                      <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', marginLeft: '5px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: 'rgba(30, 41, 59, 0.8)',
                            border: '1px solid #475569',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            color: '#cbd5e1'
                          }}
                          title={`Radar: ${weather.label}, Suhu ${weather.temp || 30}°C, Hujan ${weather.precipitation || 0} mm/j`}
                        >
                          <span>{weather.icon}</span> {weather.temp ? `${weather.temp}°C` : ''} {weather.label} {weather.precipitation > 0 ? `(${weather.precipitation} mm)` : ''}
                        </span>

                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            background: aiEval.bg,
                            color: aiEval.color,
                            border: `1px solid ${aiEval.border}`,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            fontSize: '0.75rem',
                            fontWeight: 700
                          }}
                          title={aiEval.message}
                        >
                          <Bot size={13} /> {aiEval.badge}
                        </span>
                      </div>
                    );
                  })()}
                </div>
                {/* Indikator Ambang Batas Siaga 1 - 4 */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px', fontSize: '0.75rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10b981' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} /> Aman (&lt; 10 cm)
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#38bdf8' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 6px #38bdf8' }} /> Siaga 1 (10 - 24 cm)
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#f59e0b' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 6px #f59e0b' }} /> Siaga 2 (25 - 49 cm)
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#f97316' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f97316', boxShadow: '0 0 6px #f97316' }} /> Siaga 3 (50 - 74 cm)
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#ef4444' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} /> Siaga 4 (75 - 100 cm)
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                {/* Filter Tanggal & Waktu */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--bg-secondary)', padding: '5px 15px', borderRadius: '8px', border: '1px solid #475569' }}>
                  <span style={{ fontSize: '0.85rem', color: '#94a3b8', marginRight: '5px' }}>Filter:</span>
                  <button
                    onClick={() => {
                      if (!chartDateFilter) return;
                      const d = new Date(chartDateFilter);
                      d.setDate(d.getDate() - 1);
                      setChartDateFilter(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                    }}
                    style={{ background: 'transparent', color: '#38bdf8', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 5px' }}
                    title="Hari Sebelumnya"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <input
                    type="date"
                    value={chartDateFilter}
                    onChange={e => setChartDateFilter(e.target.value)}
                    style={{ background: 'transparent', color: 'white', border: 'none', outline: 'none', fontSize: '0.9rem' }}
                  />
                  <button
                    onClick={() => {
                      if (!chartDateFilter) return;
                      const d = new Date(chartDateFilter);
                      d.setDate(d.getDate() + 1);
                      setChartDateFilter(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                    }}
                    style={{ background: 'transparent', color: '#38bdf8', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 5px' }}
                    title="Hari Berikutnya"
                  >
                    <ArrowRight size={16} />
                  </button>
                  <input
                    type="time"
                    value={chartTimeFilter}
                    onChange={e => setChartTimeFilter(e.target.value)}
                    style={{ background: 'transparent', color: 'white', border: 'none', outline: 'none', fontSize: '0.9rem', borderLeft: '1px solid #475569', paddingLeft: '10px' }}
                  />
                </div>

                {/* Pengatur Rasio Skala Jam (Zoom) */}
                <div style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--bg-secondary)', padding: '3px', borderRadius: '8px', border: '1px solid #475569', gap: '3px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '0 6px', fontWeight: 600 }}>Rasio:</span>
                  <button
                    type="button"
                    onClick={() => setChartZoomMode('fit')}
                    title="Pas 1 Layar Penuh (00:00 - 24:00 langsung terlihat tanpa scroll)"
                    style={{
                      background: chartZoomMode === 'fit' ? 'var(--accent)' : 'transparent',
                      color: chartZoomMode === 'fit' ? '#0f172a' : '#cbd5e1',
                      border: 'none',
                      borderRadius: '5px',
                      padding: '4px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    Pas Layar
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartZoomMode('compact')}
                    title="Rasio 10 Menit per Titik (Nyaman discroll)"
                    style={{
                      background: chartZoomMode === 'compact' ? 'var(--accent)' : 'transparent',
                      color: chartZoomMode === 'compact' ? '#0f172a' : '#cbd5e1',
                      border: 'none',
                      borderRadius: '5px',
                      padding: '4px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    10 Menit
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartZoomMode('wide')}
                    title="Mode Lebar Renggang"
                    style={{
                      background: chartZoomMode === 'wide' ? 'var(--accent)' : 'transparent',
                      color: chartZoomMode === 'wide' ? '#0f172a' : '#cbd5e1',
                      border: 'none',
                      borderRadius: '5px',
                      padding: '4px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    Lebar
                  </button>
                </div>

                <button onClick={() => handleExportAllData(detailModalDevice.id)} style={{ background: '#10b981', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                  <Download size={18} /> Ekspor Excel
                </button>
                <X size={32} color="#94a3b8" style={{ cursor: 'pointer', marginLeft: '10px' }} onClick={() => setDetailModalDevice(null)} />
              </div>
            </div>
            <div style={{ flex: 1, padding: '20px 0', overflowX: 'auto', overflowY: 'hidden' }}>
              <div style={{
                width: chartZoomMode === 'fit' ? '100%' : chartZoomMode === 'compact' ? '1400px' : '2600px',
                minWidth: chartZoomMode === 'fit' ? '100%' : chartZoomMode === 'compact' ? '1400px' : '2600px',
                height: '100%',
                padding: '0 25px 0 10px'
              }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={detailChartData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                    <defs>
                      <linearGradient id="colorWaterDetail" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis
                      dataKey="sortTs"
                      type="number"
                      domain={[
                        new Date(chartDateFilter).setHours(0, 0, 0, 0),
                        new Date(chartDateFilter).setHours(24, 0, 0, 0)
                      ]}
                      ticks={dayTicks}
                      tickFormatter={(tick) => {
                        const d = new Date(tick);
                        return `${String(d.getHours()).padStart(2, '0')}:00`;
                      }}
                      stroke="#94a3b8"
                      fontSize={11}
                      tickMargin={12}
                    />
                    <YAxis stroke="#94a3b8" fontSize={12} tickMargin={10} domain={[0, 100]} />
                    <Tooltip
                      content={<CustomChartTooltip history={chartData[detailModalDevice.id]} />}
                      animationDuration={80}
                      animationEasing="ease-out"
                      cursor={{ stroke: '#38bdf8', strokeWidth: 1.5, strokeDasharray: '3 3' }}
                    />
                    <Area
                      type="monotoneX"
                      dataKey="water_level"
                      stroke="#38bdf8"
                      fill="url(#colorWaterDetail)"
                      strokeWidth={2}
                      activeDot={<CustomActiveDot />}
                      isAnimationActive={false}
                    />
                    {chartTimeFilter && chartDateFilter && (
                      <ReferenceLine
                        x={new Date(`${chartDateFilter}T${chartTimeFilter}`).getTime()}
                        stroke="#38bdf8"
                        strokeWidth={2}
                        strokeDasharray="3 3"
                        label={{ position: 'top', value: chartTimeFilter, fill: '#f8fafc', background: '#0f172a', padding: 4 }}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Pengaturan Notifikasi WA & Telegram (Bisa dibuka dari Profile Menu) */}
      {showNotificationModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(6px)', padding: '20px' }}>
          <div className="animate-fade-in modal-notif-box" style={{ background: '#1e293b', width: '100%', maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto', borderRadius: '16px', border: '1px solid #334155', padding: '25px', boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>
            {renderNotificationSettings(true)}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
