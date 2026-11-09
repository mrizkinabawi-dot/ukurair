/**
 * FloodSimulation.jsx
 * 
 * Sistem Pengaturan & Simulasi Range Zona Genangan Interaktif (Multi-Zona: Zona 1, 2, 3)
 * - Zona 1: Normal mengikuti tinggi tiang (lingkaran radius sekitar sensor)
 * - Zona 2: Mengikuti kontur jalan (jalur garis tebal yang bisa diklik di peta)
 * - Zona 3: Mengikuti kontur area / cekungan hilir / pemukiman (poligon atau area)
 * - Klik di peta langsung untuk menandai jalan ke jalan!
 * - Slider simulasi HANYA visual, tidak mengubah data sensor IoT asli
 */

import React, { useState, useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { ref, onValue, set, remove } from 'firebase/database';
import { db } from './firebase';
import {
  Layers, X, Save, Eye, EyeOff, ChevronDown, ChevronUp,
  Check, CircleDot, MapPin, Undo2, RotateCcw, Navigation,
  Sliders, Plus, Trash2, Edit3, Compass
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
  drawingZone
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
    const renderSingleZone = (z, isPreview = false) => {
      const zoneColor = z.color || '#38bdf8';
      const zoneType = z.type || 'circle';

      let opacity = isSimulationMode && simulatedValue > 60 ? 0.6 : 0.35;
      if (isPreview) opacity = 0.5;

      // 1. Tipe Jalur Kontur Jalan (Polyline dengan lebar jalan)
      if (zoneType === 'road' && z.road_points && z.road_points.length >= 2) {
        const roadWidth = Number(z.road_width) || 16;
        
        // Garis batas luar (casing)
        const outerPoly = L.polyline(z.road_points, {
          color: zoneColor,
          weight: roadWidth + 4,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        });

        // Garis dalam / isi jalan
        const innerPoly = L.polyline(z.road_points, {
          color: '#ffffff',
          weight: Math.max(2, Math.floor(roadWidth / 4)),
          opacity: 0.8,
          dashArray: '8, 8',
          lineCap: 'round',
        });

        const popupContent = `
          <div style="min-width: 180px; font-family: inherit; color: #f1f5f9; padding: 2px;">
            <div style="font-size: 0.7rem; font-weight: 700; color: ${zoneColor}; text-transform: uppercase;">
              🛣️ ${z.name || 'Kontur Jalan'}
            </div>
            <div style="font-size: 0.78rem; font-weight: bold; margin: 3px 0;">
              Tipe: Mengikuti Kontur Jalan (${z.road_points.length} Titik)
            </div>
            <div style="font-size: 0.72rem; color: #cbd5e1; margin-bottom: 4px;">
              ${z.notes || 'Menyesuaikan kontur jalan raya'}
            </div>
            ${isSimulationMode ? `
              <div style="background: rgba(56,189,248,0.15); border: 1px solid #0284c7; border-radius: 4px; padding: 3px 6px; font-size: 0.7rem; color: #38bdf8;">
                Simulasi Air: <strong>${simulatedValue} cm</strong>
              </div>
            ` : ''}
          </div>
        `;

        outerPoly.bindPopup(popupContent, { className: 'flood-zone-popup' });
        outerPoly.addTo(map);
        innerPoly.addTo(map);
        layersRef.current.push(outerPoly, innerPoly);

        // Marker kecil pada titik-titik jalan jika sedang preview
        if (isPreview) {
          z.road_points.forEach((pt, idx) => {
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
      // 2. Tipe Area Poligon Bebas
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
            <div style="font-size: 0.7rem; font-weight: 700; color: ${zoneColor}; text-transform: uppercase;">
              📐 ${z.name || 'Kontur Area'}
            </div>
            <div style="font-size: 0.75rem; color: #cbd5e1; margin-top: 2px;">
              ${z.notes || 'Area kontur tanah / pemukiman'}
            </div>
          </div>
        `;
        poly.bindPopup(popupContent, { className: 'flood-zone-popup' });
        poly.addTo(map);
        layersRef.current.push(poly);
      } 
      // 3. Tipe Lingkaran Radius (Zona Normal Tiang Sensor)
      else {
        const center = z.center || (z.lat && z.lng ? [z.lat, z.lng] : null);
        if (!center) return;
        const radius = Number(z.radius_meter) || 80;

        const circle = L.circle(center, {
          radius: radius,
          color: zoneColor,
          fillColor: zoneColor,
          fillOpacity: opacity,
          weight: 2,
          dashArray: isPreview ? '4, 4' : null,
        });

        const popupContent = `
          <div style="min-width: 180px; font-family: inherit; color: #f1f5f9; padding: 2px;">
            <div style="font-size: 0.7rem; font-weight: 700; color: ${zoneColor}; text-transform: uppercase;">
              ⭕ ${z.name || 'Zona 1 (Dekat Tiang)'}
            </div>
            <div style="font-size: 0.78rem; font-weight: bold; margin: 2px 0;">
              Radius: ${radius} Meter
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
      // Jika memiliki sub-zona (Zona 1, Zona 2, Zona 3)
      if (zoneRecord.sub_zones && Array.isArray(zoneRecord.sub_zones)) {
        zoneRecord.sub_zones.forEach(sz => {
          if (sz && sz.enabled !== false) {
            renderSingleZone({
              ...sz,
              center: sz.center || zoneRecord.center || [zoneRecord.lat, zoneRecord.lng]
            });
          }
        });
      } else {
        renderSingleZone(zoneRecord);
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
  }, [zones, simulatedValue, isSimulationMode, drawingZone, map]);

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
}) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className="flood-sim-panel"
      style={{
        position: 'absolute',
        bottom: '85px',
        right: '14px',
        zIndex: 999,
        background: 'rgba(15,23,42,0.95)',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: collapsed ? '8px 12px' : '12px 14px',
        minWidth: collapsed ? 'auto' : '230px',
        maxWidth: '260px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        color: '#f1f5f9',
        fontSize: '0.8rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.82rem' }}>
          <Layers size={16} color="#38bdf8" />
          <span>Simulasi Range Air</span>
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
  isDrawingRoad,
  setIsDrawingRoad,
  activeDrawPoints,
  setActiveDrawPoints
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
        color: '#22c55e',
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
        // Titik awal contoh jalan jika baru
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
        enabled: true,
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
      updateCurrentSubZone({ road_points: activeDrawPoints });
    }
  }, [isDrawingRoad]);

  // Handler mulai gambar jalan di peta
  const handleStartDrawRoad = () => {
    const existingPoints = currentSubZone.road_points || [];
    setActiveDrawPoints(existingPoints.length > 0 ? existingPoints : [[device.lat || 1.128, device.lng || 104.053]]);
    setIsDrawingRoad(true);
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

      await onSaveZone(payload);
      setIsDrawingRoad(false);
      onClose();
    } catch (err) {
      alert('Gagal menyimpan zona: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Jika sedang mode klik di peta untuk menandai jalan, tampilkan floating bar ringkas di atas peta
  if (isDrawingRoad) {
    return (
      <div style={{
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99999,
        background: 'rgba(15, 23, 42, 0.96)',
        border: '2px solid #38bdf8',
        borderRadius: '16px',
        padding: '12px 18px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
        color: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        backdropFilter: 'blur(10px)',
        maxWidth: '92vw',
        animation: 'fadeIn 0.2s'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.2rem' }}>🛣️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#38bdf8' }}>
              Mode Klik Peta: Tandai Kontur Jalan
            </div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
              Klik langsung pada jalan di peta untuk menambah titik kelokan ({activeDrawPoints?.length || 0} titik)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => {
              if (activeDrawPoints && activeDrawPoints.length > 1) {
                setActiveDrawPoints(prev => prev.slice(0, -1));
              }
            }}
            disabled={!activeDrawPoints || activeDrawPoints.length <= 1}
            style={{
              padding: '6px 10px',
              borderRadius: '8px',
              background: '#334155',
              border: 'none',
              color: '#f8fafc',
              fontSize: '0.75rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Undo2 size={13} /> Undo
          </button>

          <button
            onClick={() => {
              const startPt = [device.lat || 1.128, device.lng || 104.053];
              setActiveDrawPoints([startPt]);
            }}
            style={{
              padding: '6px 10px',
              borderRadius: '8px',
              background: '#334155',
              border: 'none',
              color: '#fca5a5',
              fontSize: '0.75rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <RotateCcw size={13} /> Reset
          </button>

          <button
            onClick={() => {
              setIsDrawingRoad(false);
            }}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              background: '#0284c7',
              border: 'none',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <Check size={14} /> Selesai Tandai
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '14px'
    }}>
      <div style={{
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '460px',
        maxHeight: '92vh',
        boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
        color: '#f8fafc',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
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
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '6px 4px',
                borderRadius: '8px',
                border: activeTab === tab.id ? '2px solid #38bdf8' : '1px solid #334155',
                background: activeTab === tab.id ? 'rgba(56,189,248,0.15)' : 'rgba(30,41,59,0.5)',
                color: activeTab === tab.id ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.15s'
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: 700 }}>
                {tab.icon} {tab.title}
              </div>
              <div style={{ fontSize: '0.62rem', color: activeTab === tab.id ? '#38bdf8' : '#64748b' }}>
                {tab.desc}
              </div>
            </button>
          ))}
        </div>

        {/* Isi Form Sesuai Tab Aktif */}
        <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Header Info Zona */}
          <div style={{ background: '#1e293b', padding: '10px 12px', borderRadius: '10px', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Konfigurasi:</span>
              <span style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                color: currentSubZone.color,
                background: 'rgba(255,255,255,0.08)',
                padding: '2px 8px',
                borderRadius: '6px'
              }}>
                {activeTab === 0 ? '⭕ Mengikuti Tiang Sensor' : activeTab === 1 ? '🛣️ Menyesuaikan Kontur Jalan' : '📐 Area Sekitar / Hilir'}
              </span>
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
                marginTop: '4px',
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
              </div>

              {/* Slider Lebar Jalan */}
              <div style={{ marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#cbd5e1', marginBottom: '2px' }}>
                  <span>Ketebalan / Lebar Jalan:</span>
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
              </div>
            </div>
          )}

          {/* Pengaturan Radius Lingkaran (Untuk Zona 1 & Zona 3) */}
          {activeTab !== 1 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1' }}>Jangkauan Radius (Meter)</span>
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

        {/* Footer Tombol Simpan */}
        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid #1e293b',
          display: 'flex',
          gap: '8px',
          background: 'rgba(30, 41, 59, 0.4)'
        }}>
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
            {saving ? 'Menyimpan...' : 'Simpan Semua Zona'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '9px 16px',
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

  const deleteZone = async (zoneId) => {
    await remove(ref(db, `flood_zones/${zoneId}`));
  };

  return { zones, loadingZones, saveZone, deleteZone };
};
