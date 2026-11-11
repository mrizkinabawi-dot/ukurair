/**
 * FloodSimulation.jsx
 * 
 * Sistem Pengaturan & Simulasi Range Zona Genangan Interaktif (Multi-Zona: Zona 1, 2, 3)
 * - Zona 1: Normal mengikuti tinggi tiang (lingkaran radius sekitar sensor)
 * - Zona 2: Mengikuti kontur jalan (jalur garis tebal yang bisa diklik di peta)
 * - Zona 3: Mengikuti kontur area / cekungan hilir / pemukiman (poligon atau area)
 * - Fitur Hapus / Matikan Zona (per zona atau hapus semua sekaligus)
 * - Klik di peta langsung untuk menandai jalan ke jalan!
 * - Slider simulasi HANYA visual, tidak mengubah data sensor IoT asli
 */

import React, { useState, useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { ref, onValue, set, remove, get } from 'firebase/database';
import { db } from './firebase';
import {
  Layers, X, Save, Eye, EyeOff, ChevronDown, ChevronUp,
  Check, CircleDot, MapPin, Undo2, RotateCcw, Navigation,
  Sliders, Plus, Trash2, Edit3, AlertTriangle, Power
} from 'lucide-react';

// ─── Pilihan Warna Cepat ──────────────────────────────────────────────────
export const COLOR_OPTIONS = [
  { label: 'Biru (Normal / Air)', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.25)', border: '#0284c7' },
  { label: 'Hijau (Aman)', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.25)', border: '#16a34a' },
  { label: 'Kuning (Waspada)', color: '#facc15', bg: 'rgba(250, 204, 21, 0.3)', border: '#ca8a04' },
  { label: 'Oranye (Tinggi / Siaga)', color: '#f97316', bg: 'rgba(249, 115, 22, 0.3)', border: '#ea580c' },
  { label: 'Merah (Bahaya / Darurat)', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.35)', border: '#dc2626' },
  { label: 'Ungu (Kondisi Khusus / Perbaikan)', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.3)', border: '#9333ea' },
];

// ─── Komponen: Penangan Klik Peta Saat Mode Tandai Jalan Aktif ───────────────
export const MapRoadDrawHandler = ({ isDrawing, onAddPoint }) => {
  useMapEvents({
    click(e) {
      if (!isDrawing) return;
      if (e && e.latlng && typeof onAddPoint === 'function') {
        onAddPoint([e.latlng.lat, e.latlng.lng]);
      }
    }
  });
  return null;
};

// ─── Komponen: Render Zona (Lingkaran, Jalur Jalan, Poligon) di Peta ─────────
export const FloodZoneLayer = ({
  zones,
  simulatedValue,
  isSimulationMode,
  drawingZone,
  deviceData = []
}) => {
  const map = useMap();
  const layersRef = useRef([]);

  useEffect(() => {
    // Bersihkan layer sebelumnya
    layersRef.current.forEach(l => {
      try { map.removeLayer(l); } catch (_) {}
    });
    layersRef.current = [];

    // Helper untuk render satu zona objek
    const renderSingleZone = (z, isPreview = false, parentRecord = null) => {
      if (z.enabled === false && !isPreview) return; // Jangan render jika dinonaktifkan / dihapus

      // ─── Tentukan Ketinggian Air Efektif & Warna Traffic ala Google Maps ───
      let effectiveLevel = 0;
      if (isSimulationMode) {
        effectiveLevel = Number(simulatedValue) || 0;
      } else {
        const targetId = z.deviceId || parentRecord?.deviceId || parentRecord?.id || z.id;
        const matched = (deviceData || []).find(d => d.id === targetId);
        effectiveLevel = matched ? (Number(matched.water_level) || 0) : 0;
      }

      // Dynamic Traffic Flood Styling:
      // - Hijau: < 20 cm (Aman, jalan kering & lancar)
      // - Kuning / Oranye: 20 - 49 cm (Waspada genangan sedang)
      // - Merah: >= 50 cm (Bahaya! Jalan terendam banjir, macet total)
      let trafficColor = '#22c55e';
      let trafficBorder = '#15803d';
      let trafficLabel = 'Aman & Kering (Jalan Lancar)';
      let isHazard = false;

      if (effectiveLevel >= 50) {
        trafficColor = '#ef4444';
        trafficBorder = '#991b1b';
        trafficLabel = 'BAHAYA BANJIR (Jalan Terendam)';
        isHazard = true;
      } else if (effectiveLevel >= 20) {
        trafficColor = '#f59e0b';
        trafficBorder = '#b45309';
        trafficLabel = 'Waspada Genangan Air';
        isHazard = true;
      }

      // Bila admin menyetel warna khusus (useCustomColor), hormati preferensi admin
      const zoneColor = (z.useCustomColor && z.color) ? z.color : trafficColor;
      const zoneType = z.type || 'circle';

      let opacity = isSimulationMode && simulatedValue > 60 ? 0.6 : 0.4;
      if (isPreview) opacity = 0.55;

      // 1. Tipe Jalur Kontur Jalan (Polyline Traffic ala Google Maps)
      if (zoneType === 'road' && z.road_points && z.road_points.length >= 2) {
        const roadWidth = Number(z.road_width) || 16;
        const isRedHazard = zoneColor === '#ef4444';
        const isYellow = zoneColor === '#f59e0b';

        // Garis batas luar (casing jalan tegas)
        const outerPoly = L.polyline(z.road_points, {
          color: isRedHazard ? '#b91c1c' : (isYellow ? '#b45309' : '#15803d'),
          weight: roadWidth + (isRedHazard ? 6 : 4),
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        });

        // Garis dalam / isi jalur lalu lintas (Google Maps Traffic style)
        const innerPoly = L.polyline(z.road_points, {
          color: zoneColor,
          weight: Math.max(3, Math.floor(roadWidth / 2.5)),
          opacity: 1,
          dashArray: isRedHazard ? '6, 6' : null,
          lineCap: 'round',
        });

        const popupContent = `
          <div style="min-width: 190px; font-family: inherit; color: #f1f5f9; padding: 2px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
              <span style="font-size: 0.72rem; font-weight: 800; color: ${zoneColor}; text-transform: uppercase;">
                🛣️ ${z.name || 'Kontur Jalan'}
              </span>
              <span style="
                background: ${zoneColor}22;
                color: ${zoneColor};
                border: 1px solid ${zoneColor};
                padding: 1px 6px;
                border-radius: 9999px;
                font-size: 0.65rem;
                font-weight: 700;
              ">
                ${effectiveLevel} cm
              </span>
            </div>
            <div style="font-size: 0.76rem; font-weight: bold; color: ${zoneColor}; margin-bottom: 3px;">
              Kondisi: ${trafficLabel}
            </div>
            <div style="font-size: 0.72rem; color: #cbd5e1; margin-bottom: 5px;">
              ${z.notes || 'Menyesuaikan kontur jalan raya'}
            </div>
            <div style="font-size: 0.68rem; color: #94a3b8; border-top: 1px solid #334155; padding-top: 3px;">
              ${z.road_points.length} Titik Jalur &bull; Lebar: ${roadWidth}px
            </div>
          </div>
        `;

        outerPoly.bindPopup(popupContent, { className: 'flood-zone-popup' });
        outerPoly.addTo(map);
        innerPoly.addTo(map);
        layersRef.current.push(outerPoly, innerPoly);

        // Marker kecil pada titik-titik jalan jika sedang preview/edit
        if (isPreview) {
          z.road_points.forEach((pt) => {
            const dot = L.circleMarker(pt, {
              radius: 5,
              color: '#ffffff',
              fillColor: zoneColor,
              fillOpacity: 1,
              weight: 2
            });
            dot.addTo(map);
            layersRef.current.push(dot);
          });
        }
      } 
      // 2. Tipe Area Poligon Bebas (Zona 3 Hilir)
      else if (zoneType === 'polygon' && z.polygon_points && z.polygon_points.length >= 3) {
        const poly = L.polygon(z.polygon_points, {
          color: zoneColor,
          fillColor: zoneColor,
          fillOpacity: opacity,
          weight: 2.5,
          dashArray: isPreview ? '6, 6' : null,
        });

        const popupContent = `
          <div style="min-width: 180px; font-family: inherit; color: #f1f5f9; padding: 2px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
              <span style="font-size: 0.7rem; font-weight: 700; color: ${zoneColor}; text-transform: uppercase;">
                📐 ${z.name || 'Kontur Area'}
              </span>
              <span style="color: ${zoneColor}; font-weight: 800; font-size: 0.75rem;">
                ${effectiveLevel} cm
              </span>
            </div>
            <div style="font-size: 0.75rem; color: #cbd5e1;">
              ${z.notes || 'Area kontur tanah / pemukiman'}
            </div>
          </div>
        `;
        poly.bindPopup(popupContent, { className: 'flood-zone-popup' });
        poly.addTo(map);
        layersRef.current.push(poly);
      } 
      // 3. Tipe Lingkaran Radius (Zona 1 Normal Tiang Sensor)
      else if (zoneType === 'circle') {
        const center = z.center || (z.lat && z.lng ? [z.lat, z.lng] : null);
        if (!center) return;
        const radius = Number(z.radius_meter) || 80;

        const circle = L.circle(center, {
          radius: radius,
          color: zoneColor,
          fillColor: zoneColor,
          fillOpacity: opacity,
          weight: 2.5,
          dashArray: isPreview ? '4, 4' : null,
        });

        const popupContent = `
          <div style="min-width: 180px; font-family: inherit; color: #f1f5f9; padding: 2px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
              <span style="font-size: 0.7rem; font-weight: 700; color: ${zoneColor}; text-transform: uppercase;">
                ⭕ ${z.name || 'Zona 1 (Dekat Tiang)'}
              </span>
              <span style="color: ${zoneColor}; font-weight: 800; font-size: 0.75rem;">
                ${effectiveLevel} cm
              </span>
            </div>
            <div style="font-size: 0.78rem; font-weight: bold; margin: 2px 0;">
              Radius: ${radius} Meter &bull; ${trafficLabel}
            </div>
            <div style="font-size: 0.72rem; color: #cbd5e1;">
              ${z.notes || 'Lokasi normal mengikuti tinggi tiang'}
            </div>
          </div>
        `;
        circle.bindPopup(popupContent, { className: 'flood-zone-popup' });
        circle.addTo(map);
        layersRef.current.push(circle);
      }
    };

    // Render semua zona tersimpan
    zones.forEach(zoneRecord => {
      if (zoneRecord.sub_zones && Array.isArray(zoneRecord.sub_zones)) {
        zoneRecord.sub_zones.forEach(sz => {
          if (sz && sz.enabled !== false) {
            renderSingleZone({
              ...sz,
              center: sz.center || zoneRecord.center || [zoneRecord.lat, zoneRecord.lng],
              deviceId: zoneRecord.deviceId || zoneRecord.id
            }, false, zoneRecord);
          }
        });
      } else if (zoneRecord.enabled !== false) {
        renderSingleZone(zoneRecord, false, zoneRecord);
      }
    });

    // Render preview saat admin sedang menandai jalan/zona di peta
    if (drawingZone) {
      renderSingleZone(drawingZone, true);
    }

    return () => {
      layersRef.current.forEach(l => {
        try { map.removeLayer(l); } catch (_) {}
      });
      layersRef.current = [];
    };
  }, [zones, simulatedValue, isSimulationMode, drawingZone, deviceData, map]);

  return null;
};

// ─── Komponen: Panel Kontrol Cepat Simulasi ──────────────────────────────
export const SimulationControlPanel = ({
  isSimulationMode,
  setIsSimulationMode,
  simulatedValue,
  setSimulatedValue,
  showZones,
  setShowZones,
  onOpenEditRange,
  onOpenManualControl
}) => {
  // Pada layar ponsel (mobile), defaultkan ke tertutup (collapsed) agar tidak memenuhi layar
  const [collapsed, setCollapsed] = useState(() => {
    return typeof window !== 'undefined' && window.innerWidth <= 768;
  });

  return (
    <div
      className={`flood-sim-panel ${collapsed ? 'collapsed' : 'expanded'}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.82rem' }}>
          <Layers size={16} color="#38bdf8" />
          <span>Simulasi Range Air</span>
          {isSimulationMode && (
            <span style={{ fontSize: '0.62rem', background: '#0284c7', color: '#fff', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
              {simulatedValue}cm
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => setShowZones(!showZones)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: showZones ? '#38bdf8' : '#64748b', padding: '2px' }}
            title={showZones ? 'Sembunyikan Zona' : 'Tampilkan Zona'}
          >
            {showZones ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '2px' }}
          >
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ marginTop: '10px' }}>
          {/* Toggle Mode */}
          <div
            onClick={() => setIsSimulationMode(!isSimulationMode)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              borderRadius: '8px',
              background: isSimulationMode ? 'rgba(56,189,248,0.15)' : 'rgba(30,41,59,0.7)',
              border: `1px solid ${isSimulationMode ? '#0284c7' : '#334155'}`,
              cursor: 'pointer',
              marginBottom: '8px'
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.78rem', color: isSimulationMode ? '#38bdf8' : '#cbd5e1' }}>
                {isSimulationMode ? '🔵 Mode Simulasi Aktif' : '🟢 Data Aktual IoT'}
              </div>
              <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                {isSimulationMode ? 'Slider coba-coba (Aman)' : 'Klik untuk uji slider'}
              </div>
            </div>
            <div style={{
              width: '32px', height: '17px', borderRadius: '10px',
              background: isSimulationMode ? '#0284c7' : '#475569',
              position: 'relative'
            }}>
              <div style={{
                width: '13px', height: '13px', borderRadius: '50%',
                background: '#fff', position: 'absolute', top: '2px',
                left: isSimulationMode ? '16px' : '3px',
                transition: 'left 0.2s'
              }} />
            </div>
          </div>

          {/* Slider Saat Simulasi Aktif */}
          {isSimulationMode && (
            <div style={{ background: 'rgba(15,23,42,0.8)', padding: '8px', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.75rem' }}>
                <span style={{ color: '#94a3b8' }}>Ketinggian:</span>
                <strong style={{ color: '#38bdf8' }}>{simulatedValue} cm</strong>
              </div>
              <input
                type="range"
                min="0"
                max="300"
                value={simulatedValue}
                onChange={(e) => setSimulatedValue(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: '#64748b', marginTop: '2px' }}>
                <span>0 cm</span>
                <span>150 cm</span>
                <span>300 cm</span>
              </div>
            </div>
          )}

          {onOpenManualControl && (
            <button
              type="button"
              onClick={onOpenManualControl}
              style={{
                width: '100%',
                marginTop: '8px',
                padding: '7px 10px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.25), rgba(56, 189, 248, 0.15))',
                border: '1px solid #38bdf8',
                color: '#38bdf8',
                fontWeight: 800,
                fontSize: '0.74rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
              title="Set Ketinggian Air Manual (0 - 100 cm) langsung ke Firebase RTDB untuk Demo Dosen"
            >
              <Sliders size={13} /> 🎛️ Kontrol Ketinggian Manual (0-100cm)
            </button>
          )}

          {onOpenEditRange && (
            <button
              type="button"
              onClick={onOpenEditRange}
              style={{
                width: '100%',
                marginTop: '8px',
                padding: '6px 10px',
                borderRadius: '8px',
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid #0284c7',
                color: '#38bdf8',
                fontWeight: 700,
                fontSize: '0.74rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
            >
              <Sliders size={13} /> Sesuaikan Range & Jarak Titik Ini
            </button>
          )}

          <div style={{ marginTop: '8px', fontSize: '0.68rem', color: '#64748b', textAlign: 'center' }}>
            💡 Klik titik sensor di peta & pilih <strong>Atur Range</strong> untuk sesuaikan kontur jalan.
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Modal / Dialog: Sesuaikan Multi-Zona (Zona 1 Tiang, Zona 2 Jalan, Zona 3 Area) ───
export const EditRangeModal = ({
  device,
  currentZone,
  onClose,
  onSaveZone,
  onDeleteZone,
  isDrawingRoad,
  setIsDrawingRoad,
  activeDrawPoints,
  setActiveDrawPoints,
  isAdminUser = true
}) => {
  // Pilihan tab zona: 0 = Zona 1 (Tiang), 1 = Zona 2 (Jalan), 2 = Zona 3 (Area/Cekungan)
  const [activeTab, setActiveTab] = useState(0);

  // Buat default 3 sub-zona jika belum ada
  const initialSubZones = () => {
    if (currentZone && Array.isArray(currentZone.sub_zones) && currentZone.sub_zones.length >= 3) {
      return currentZone.sub_zones;
    }
    const center = [device.lat || 1.08455, device.lng || 103.94033];
    return [
      {
        id: 'z1',
        name: 'Zona 1 (Normal / Tiang Sensor)',
        type: 'circle',
        radius_meter: currentZone?.radius_meter || 80,
        color: '#a855f7',
        notes: 'Lokasi normal mengikuti tinggi tiang sensor alat.',
        center: center,
        enabled: true,
      },
      {
        id: 'z2',
        name: 'Zona 2 (Kontur Jalan)',
        type: 'road',
        road_width: 18,
        color: '#facc15',
        notes: 'Mengikuti ruas jalan raya & kelokan kontur jalan.',
        road_points: [
          [center[0] - 0.0012, center[1] - 0.0015],
          center,
          [center[0] + 0.0015, center[1] + 0.0018],
        ],
        enabled: true,
      },
      {
        id: 'z3',
        name: 'Zona 3 (Cekungan / Hilir)',
        type: 'circle',
        radius_meter: 150,
        color: '#f97316',
        notes: 'Area cekungan hilir / pemukiman di sekitar.',
        center: [center[0] + 0.001, center[1] + 0.001],
        enabled: false, // Default dinonaktifkan agar tidak muncul lingkaran ganda jika belum diinginkan
      }
    ];
  };

  const [subZones, setSubZones] = useState(initialSubZones);
  const [saving, setSaving] = useState(false);

  const currentSubZone = subZones[activeTab] || subZones[0];

  const updateCurrentSubZone = (updates) => {
    setSubZones(prev => {
      const next = [...prev];
      next[activeTab] = { ...next[activeTab], ...updates };
      return next;
    });
  };

  // Sinkronisasi poin ketika user selesai menandai jalan di peta
  useEffect(() => {
    if (!isDrawingRoad && activeDrawPoints && activeDrawPoints.length > 0) {
      updateCurrentSubZone({ road_points: activeDrawPoints, enabled: true });
    }
  }, [isDrawingRoad]);

  // Handler mulai gambar jalan di peta
  const handleStartDrawRoad = () => {
    const existingPoints = currentSubZone.road_points || [];
    setActiveDrawPoints(existingPoints.length > 0 ? existingPoints : [[device.lat || 1.128, device.lng || 104.053]]);
    setIsDrawingRoad(true);
  };

  // Handler menghapus / mengosongkan zona yang sedang aktif (LANGSUNG SIMPAN KE FIREBASE)
  const handleClearCurrentZone = async () => {
    const zoneName = activeTab === 0 ? 'Zona 1 (Tiang)' : activeTab === 1 ? 'Zona 2 (Jalan)' : 'Zona 3 (Hilir)';
    if (!window.confirm(`Hapus / Hilangkan ${zoneName} dari peta?\n\nZona ini akan langsung dinonaktifkan dan hilang dari peta.`)) {
      return;
    }

    setSaving(true);
    try {
      const nextSubZones = [...subZones];
      nextSubZones[activeTab] = {
        ...nextSubZones[activeTab],
        enabled: false,
        road_points: []
      };
      setSubZones(nextSubZones);
      if (activeTab === 1) setActiveDrawPoints([]);

      const center = [device.lat || 1.128, device.lng || 104.053];
      const payload = {
        id: currentZone?.id || `zone-${device.id}`,
        device_id: device.id,
        name: device.name || 'Titik Pantau',
        lat: device.lat || 1.128,
        lng: device.lng || 104.053,
        center: center,
        sub_zones: nextSubZones,
        radius_meter: nextSubZones[0]?.radius_meter || 80,
        color: nextSubZones[0]?.color || '#22c55e',
        notes: nextSubZones[1]?.notes || '',
        is_demo: false,
        updated_at: Date.now()
      };

      await onSaveZone(payload);
      alert(`✅ ${zoneName} berhasil dihapus dari peta!`);
    } catch (err) {
      alert('Gagal menghapus zona: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Handler hapus SEMUA zona titik pantau ini (LANGSUNG BERSIHKAN DI FIREBASE)
  const handleDeleteAllZones = async () => {
    if (!window.confirm(`Yakin ingin MENGHAPUS SEMUA ZONA (lingkaran & jalan) pada "${device.name}"?\n\nSemua zona pada titik ini akan langsung dibersihkan total dari peta.`)) {
      return;
    }
    setSaving(true);
    try {
      if (typeof onDeleteZone === 'function') {
        const zoneId = currentZone?.id || `zone-${device.id}`;
        await onDeleteZone(device.id, zoneId);
      }
      setIsDrawingRoad(false);
      onClose();
      alert('✅ Semua zona pada titik ini berhasil dibersihkan dari peta!');
    } catch (err) {
      alert('Gagal menghapus zona: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Handler simpan seluruh zona ke Firebase
  const handleSave = async () => {
    setSaving(true);
    try {
      const center = [device.lat || 1.128, device.lng || 104.053];
      const payload = {
        id: currentZone?.id || `zone-${device.id}`,
        device_id: device.id,
        name: device.name || 'Titik Pantau',
        lat: device.lat || 1.128,
        lng: device.lng || 104.053,
        center: center,
        // Menyimpan array sub-zona (Zona 1, 2, 3)
        sub_zones: subZones,
        // Kompatibilitas mundur
        radius_meter: subZones[0]?.radius_meter || 80,
        color: subZones[0]?.color || '#22c55e',
        notes: subZones[1]?.notes || 'Kontur jalan & tiang terkalibrasi',
        is_demo: false,
        updated_at: Date.now()
      };

      if (typeof onSaveZone === 'function') {
        await onSaveZone(payload);
      }
      setIsDrawingRoad(false);
      onClose();
      if (isAdminUser) {
        alert('✅ Konfigurasi range & kontur jalan berhasil disimpan permanen ke server database!');
      } else {
        alert('✅ Range berhasil diterapkan pada peta (Mode Demo/Tamu). Silakan login Admin jika ingin menyimpan permanen ke server.');
      }
    } catch (err) {
      alert('Gagal menyimpan zona: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Jika sedang mode klik di peta untuk menandai jalan, tampilkan floating bar ringkas di atas peta
  if (isDrawingRoad) {
    return (
      <div className="road-drawing-floating-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>🛣️</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#38bdf8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Mode Klik: Tandai Jalan
            </div>
            <div style={{ fontSize: '0.66rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Klik jalan di peta ({activeDrawPoints?.length || 0} titik)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            onClick={() => {
              if (activeDrawPoints && activeDrawPoints.length > 1) {
                setActiveDrawPoints(prev => prev.slice(0, -1));
              }
            }}
            disabled={!activeDrawPoints || activeDrawPoints.length <= 1}
            style={{
              padding: '5px 8px',
              borderRadius: '6px',
              background: '#334155',
              border: 'none',
              color: '#f8fafc',
              fontSize: '0.72rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '3px'
            }}
          >
            <Undo2 size={12} /> Undo
          </button>

          <button
            onClick={() => {
              const startPt = [device.lat || 1.128, device.lng || 104.053];
              setActiveDrawPoints([startPt]);
            }}
            style={{
              padding: '5px 8px',
              borderRadius: '6px',
              background: '#334155',
              border: 'none',
              color: '#fca5a5',
              fontSize: '0.72rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '3px'
            }}
          >
            <RotateCcw size={12} /> Reset
          </button>

          <button
            onClick={() => {
              setIsDrawingRoad(false);
            }}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              background: '#0284c7',
              border: 'none',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.74rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Check size={13} /> Selesai
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="edit-range-modal-overlay">
      <div className="edit-range-modal-card">
        {/* Header Modal */}
        <div style={{
          padding: '12px 18px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(30, 41, 59, 0.6)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CircleDot size={18} color="#38bdf8" />
            <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>Sesuaikan Range & Kontur Jalan</span>
            <span style={{ fontSize: '0.62rem', background: '#0284c7', color: '#fff', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>v2.1</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Pilihan Zona (Zona 1 Tiang, Zona 2 Jalan, Zona 3 Area) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          padding: '8px 14px',
          gap: '6px',
          background: '#090d16',
          borderBottom: '1px solid #1e293b'
        }}>
          {[
            { id: 0, title: 'Zona 1 (Tiang)', icon: '⭕', desc: 'Tinggi Tiang' },
            { id: 1, title: 'Zona 2 (Jalan)', icon: '🛣️', desc: 'Kontur Jalan' },
            { id: 2, title: 'Zona 3 (Hilir)', icon: '📐', desc: 'Area / Hilir' }
          ].map(tab => {
            const isTabEnabled = subZones[tab.id]?.enabled !== false;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '6px 4px',
                  borderRadius: '8px',
                  border: activeTab === tab.id ? '2px solid #38bdf8' : '1px solid #334155',
                  background: activeTab === tab.id ? 'rgba(56,189,248,0.15)' : 'rgba(30,41,59,0.5)',
                  color: activeTab === tab.id ? '#ffffff' : (isTabEnabled ? '#94a3b8' : '#64748b'),
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.15s',
                  position: 'relative'
                }}
              >
                <div style={{ fontSize: '0.78rem', fontWeight: 700 }}>
                  {tab.icon} {tab.title}
                </div>
                <div style={{ fontSize: '0.62rem', color: isTabEnabled ? (activeTab === tab.id ? '#38bdf8' : '#64748b') : '#ef4444' }}>
                  {isTabEnabled ? tab.desc : '(Nonaktif)'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Isi Form Sesuai Tab Aktif */}
        <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Header Info Zona & Tombol Aktif / Hapus Zona Ini */}
          <div style={{ background: '#1e293b', padding: '10px 12px', borderRadius: '10px', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Status Zona:</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Tombol Toggle Aktif/Nonaktif */}
                <button
                  type="button"
                  onClick={() => updateCurrentSubZone({ enabled: currentSubZone.enabled === false ? true : false })}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '6px',
                    border: 'none',
                    background: currentSubZone.enabled !== false ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                    color: currentSubZone.enabled !== false ? '#22c55e' : '#ef4444',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Power size={11} />
                  {currentSubZone.enabled !== false ? 'Aktif di Peta' : 'Nonaktif (Mati)'}
                </button>

                {/* Tombol Hapus Zona Ini */}
                <button
                  type="button"
                  onClick={handleClearCurrentZone}
                  title="Hapus / Kosongkan data zona ini"
                  style={{
                    padding: '3px 8px',
                    borderRadius: '6px',
                    border: '1px solid #ef4444',
                    background: 'rgba(239,68,68,0.1)',
                    color: '#ef4444',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px'
                  }}
                >
                  <Trash2 size={11} /> Hapus
                </button>
              </div>
            </div>

            <input
              type="text"
              value={currentSubZone.name || ''}
              onChange={(e) => updateCurrentSubZone({ name: e.target.value })}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid #475569',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.88rem',
                paddingBottom: '2px',
                outline: 'none'
              }}
              placeholder="Nama Zona..."
            />
          </div>

          {/* Pengaturan Khusus Zona 2 (Kontur Jalan) */}
          {activeTab === 1 && (
            <div style={{ background: 'rgba(2,132,199,0.1)', border: '1px solid #0284c7', borderRadius: '10px', padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8' }}>
                    Tandai Jalan di Peta (Jalan ke Jalan)
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                    Tersimpan: {currentSubZone.road_points?.length || 0} Titik Jalan
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={handleStartDrawRoad}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      background: '#0284c7',
                      border: 'none',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                  >
                    <Navigation size={13} /> Klik di Peta
                  </button>
                  {currentSubZone.road_points && currentSubZone.road_points.length > 0 && (
                    <button
                      onClick={() => {
                        if (window.confirm('Kosongkan semua titik jalur jalan ini?')) {
                          updateCurrentSubZone({ road_points: [], enabled: false });
                          setActiveDrawPoints([]);
                        }
                      }}
                      title="Hapus Garis Jalan"
                      style={{
                        padding: '6px 8px',
                        borderRadius: '8px',
                        background: 'rgba(239,68,68,0.2)',
                        border: '1px solid #ef4444',
                        color: '#ef4444',
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Slider Jangkauan Jarak Luapan Air dari Jalan (Meter) */}
              <div style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: '#cbd5e1', marginBottom: '3px' }}>
                  <span style={{ fontWeight: 600 }}>Jangkauan Jarak Luapan Air (Buffer Radius):</span>
                  <strong style={{ color: '#38bdf8' }}>{currentSubZone.radius_meter || 35} Meter</strong>
                </div>
                <input
                  type="range"
                  min="10"
                  max="200"
                  step="5"
                  value={currentSubZone.radius_meter || 35}
                  onChange={(e) => updateCurrentSubZone({ radius_meter: Number(e.target.value) })}
                  style={{ width: '100%', accentColor: currentSubZone.color, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: '#64748b' }}>
                  <span>10 m (Dekat Jalur)</span>
                  <span>100 m (Sedang)</span>
                  <span>200 m (Luas)</span>
                </div>
              </div>

              {/* Slider Lebar / Ketebalan Garis Jalan */}
              <div style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#cbd5e1', marginBottom: '2px' }}>
                  <span>Ketebalan / Lebar Garis Jalan:</span>
                  <strong style={{ color: '#38bdf8' }}>{currentSubZone.road_width || 18} px</strong>
                </div>
                <input
                  type="range"
                  min="8"
                  max="40"
                  value={currentSubZone.road_width || 18}
                  onChange={(e) => updateCurrentSubZone({ road_width: Number(e.target.value) })}
                  style={{ width: '100%', accentColor: currentSubZone.color, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: '#64748b' }}>
                  <span>8 px (Tipis)</span>
                  <span>20 px (Standar)</span>
                  <span>40 px (Tebal)</span>
                </div>
              </div>
            </div>
          )}

          {/* Pengaturan Radius Lingkaran (Untuk Zona 1 & Zona 3) */}
          {activeTab !== 1 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1' }}>Jangkauan Radius (Meter):</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8' }}>{currentSubZone.radius_meter || 80} Meter</span>
              </div>
              <input
                type="range"
                min="20"
                max="500"
                step="10"
                value={currentSubZone.radius_meter || 80}
                onChange={(e) => updateCurrentSubZone({ radius_meter: Number(e.target.value) })}
                style={{ width: '100%', accentColor: currentSubZone.color, cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: '#64748b' }}>
                <span>20 m</span>
                <span>150 m</span>
                <span>500 m</span>
              </div>
            </div>
          )}

          {/* Pilihan Warna Zona */}
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', display: 'block', marginBottom: '6px' }}>
              Warna Zona:
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.color}
                  type="button"
                  onClick={() => updateCurrentSubZone({ color: c.color })}
                  style={{
                    padding: '6px 4px',
                    borderRadius: '6px',
                    border: `2px solid ${currentSubZone.color === c.color ? '#ffffff' : c.border}`,
                    background: c.bg,
                    color: '#ffffff',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                >
                  <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: c.color }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label.split(' ')[0]}</span>
                  {currentSubZone.color === c.color && <Check size={11} color="#fff" />}
                </button>
              ))}
            </div>
          </div>

          {/* Catatan Lapangan / Kontur Jalan */}
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
              Catatan Lapangan & Kontur:
            </span>
            <textarea
              rows={2}
              value={currentSubZone.notes || ''}
              onChange={(e) => updateCurrentSubZone({ notes: e.target.value })}
              placeholder="Contoh: Mengikuti kelokan jalan aspal, ada turunan cekung di depan pertigaan..."
              style={{
                width: '100%',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#f8fafc',
                fontSize: '0.73rem',
                fontFamily: 'inherit',
                resize: 'none'
              }}
            />
          </div>
        </div>

        {/* Footer Tombol Simpan & Tombol Hapus */}
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid #1e293b',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          background: 'rgba(30, 41, 59, 0.7)'
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 1,
                padding: '9px',
                borderRadius: '8px',
                border: 'none',
                background: '#0284c7',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <Save size={15} />
              {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>

            {/* Tombol Hapus Zona Tab Ini */}
            <button
              type="button"
              onClick={handleClearCurrentZone}
              title="Hapus atau matikan zona yang sedang dipilih ini"
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid #ef4444',
                background: 'rgba(239,68,68,0.18)',
                color: '#f87171',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <Trash2 size={14} />
              Hapus Zona {activeTab + 1}
            </button>

            <button
              onClick={onClose}
              style={{
                padding: '9px 14px',
                borderRadius: '8px',
                border: '1px solid #475569',
                background: 'transparent',
                color: '#94a3b8',
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              Batal
            </button>
          </div>

          {/* Tombol Hapus Semua Zona Sekaligus */}
          <button
            type="button"
            onClick={handleDeleteAllZones}
            disabled={saving}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '8px',
              border: '1px solid #ef4444',
              background: 'rgba(239,68,68,0.25)',
              color: '#ffffff',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Trash2 size={14} color="#fca5a5" />
            Hapus Semua Zona Titik Ini (Bersihkan Peta)
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Hook: Manajemen Data Zona Firebase Realtime Database ───────────────────
export const useFloodZones = () => {
  const [zones, setZones] = useState([]);
  const [loadingZones, setLoadingZones] = useState(true);

  useEffect(() => {
    const zonesRef = ref(db, 'flood_zones');
    const unsub = onValue(zonesRef, (snapshot) => {
      const dataVal = snapshot.val();
      if (!dataVal) {
        setZones([]);
      } else {
        const list = Object.entries(dataVal).map(([id, item]) => ({
          id,
          ...item
        }));
        setZones(list);
      }
      setLoadingZones(false);
    }, () => {
      setLoadingZones(false);
    });

    return () => unsub();
  }, []);

  const saveZone = async (zoneData) => {
    const zoneId = zoneData.id || `zone_${Date.now()}`;
    await set(ref(db, `flood_zones/${zoneId}`), zoneData);
  };

  const deleteZone = async (deviceId, zoneId) => {
    try {
      if (zoneId) {
        await remove(ref(db, `flood_zones/${zoneId}`));
      }
      if (deviceId) {
        await remove(ref(db, `flood_zones/zone-${deviceId}`));
      }
      // Scan untuk memastikan semua record yang terkait device ini bersih
      const snap = await get(ref(db, 'flood_zones'));
      const val = snap.val();
      if (val) {
        for (const [k, v] of Object.entries(val)) {
          if (
            k === zoneId ||
            k === `zone-${deviceId}` ||
            v.device_id === deviceId ||
            (v.id && String(v.id).includes(deviceId))
          ) {
            await remove(ref(db, `flood_zones/${k}`));
          }
        }
      }
    } catch (err) {
      console.warn('Gagal deleteZone:', err);
    }
  };

  return { zones, loadingZones, saveZone, deleteZone };
};
