/**
 * FloodSimulation.jsx
 * 
 * Sistem Pengaturan & Simulasi Range Zona Genangan Interaktif
 * - Langsung diatur per sensor/titik pantau melalui popup atau peta
 * - Bisa atur radius range (meter) / klik titik di peta
 * - Bisa pilih warna zona dan catatan kondisi (perbaikan jalan, kontur, dll)
 * - Slider simulasi HANYA visual, tidak mengubah data sensor IoT asli
 */

import React, { useState, useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { ref, onValue, set, remove } from 'firebase/database';
import { db } from './firebase';
import {
  Layers, X, Save,
  Eye, EyeOff, ChevronDown, ChevronUp,
  Check, CircleDot
} from 'lucide-react';

// ─── Pilihan Warna Cepat ──────────────────────────────────────────────────
export const COLOR_OPTIONS = [
  { label: 'Biru (Air / Normal)', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.25)', border: '#0284c7' },
  { label: 'Hijau (Aman)', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.25)', border: '#16a34a' },
  { label: 'Kuning (Waspada)', color: '#facc15', bg: 'rgba(250, 204, 21, 0.3)', border: '#ca8a04' },
  { label: 'Oranye (Tinggi / Siaga)', color: '#f97316', bg: 'rgba(249, 115, 22, 0.3)', border: '#ea580c' },
  { label: 'Merah (Bahaya / Darurat)', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.35)', border: '#dc2626' },
  { label: 'Ungu (Kondisi Khusus / Perbaikan)', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.3)', border: '#9333ea' },
];

// ─── Komponen: Render Lingkaran Range / Zona di Peta ──────────────────────
export const FloodZoneLayer = ({
  zones,
  simulatedValue,
  isSimulationMode,
  editingDevice,
  editingRangeSettings
}) => {
  const map = useMap();
  const layersRef = useRef([]);

  useEffect(() => {
    // Bersihkan layer sebelumnya
    layersRef.current.forEach(l => {
      try { map.removeLayer(l); } catch (_) {}
    });
    layersRef.current = [];

    // 1. Tampilkan zona tersimpan
    zones.forEach(zone => {
      const center = zone.center || (zone.lat && zone.lng ? [zone.lat, zone.lng] : null);
      if (!center) return;

      const radius = Number(zone.radius_meter) || 150;
      const zoneColor = zone.color || '#38bdf8';

      // Hitung simulasi jika mode aktif
      let currentDepth = zone.estimated_depth || 20;
      if (isSimulationMode) {
        const factor = Math.min(1.5, Math.max(0, simulatedValue / 100));
        currentDepth = Math.round(currentDepth * factor);
      }

      const circle = L.circle(center, {
        radius: radius,
        color: zoneColor,
        fillColor: zoneColor,
        fillOpacity: isSimulationMode && simulatedValue > 60 ? 0.45 : 0.25,
        weight: 2,
        dashArray: zone.is_demo ? '6, 6' : null,
      });

      const popupContent = `
        <div style="min-width: 190px; font-family: inherit; color: #f1f5f9; padding: 2px;">
          <div style="font-size: 0.68rem; font-weight: 700; color: ${zoneColor}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px;">
            📍 Zona: ${zone.name || 'Titik Pantau'}
          </div>
          <div style="font-size: 0.8rem; font-weight: bold; margin-bottom: 4px;">
            Jangkauan: ${radius} Meter
          </div>
          <div style="font-size: 0.75rem; color: #cbd5e1; margin-bottom: 6px;">
            Kondisi: <strong>${zone.notes || 'Normal / Standar'}</strong>
          </div>
          ${isSimulationMode ? `
            <div style="background: rgba(56,189,248,0.15); border: 1px solid #0284c7; border-radius: 6px; padding: 4px 8px; font-size: 0.72rem; color: #38bdf8;">
              Simulasi Air: <strong>${simulatedValue} cm</strong><br/>
              Estimasi Genangan: <strong>~${currentDepth} cm</strong>
            </div>
          ` : `
            <div style="font-size: 0.7rem; color: #94a3b8; border-top: 1px solid #334155; padding-top: 4px;">
              ${zone.is_demo ? '⚠️ DEMO / CONTOH - Silakan sesuaikan range titik ini.' : '✅ Range zona aktif dikalibrasi.'}
            </div>
          `}
        </div>
      `;

      circle.bindPopup(popupContent, { className: 'flood-zone-popup' });
      circle.addTo(map);
      layersRef.current.push(circle);
    });

    // 2. Jika sedang dalam mode edit range langsung dari popup
    if (editingDevice && editingRangeSettings) {
      const editCenter = [editingDevice.lat || 1.128, editingDevice.lng || 104.053];
      const previewCircle = L.circle(editCenter, {
        radius: Number(editingRangeSettings.radius_meter) || 150,
        color: editingRangeSettings.color || '#38bdf8',
        fillColor: editingRangeSettings.color || '#38bdf8',
        fillOpacity: 0.35,
        weight: 3,
        dashArray: '4, 4',
      });
      previewCircle.addTo(map);
      layersRef.current.push(previewCircle);
    }

    return () => {
      layersRef.current.forEach(l => {
        try { map.removeLayer(l); } catch (_) {}
      });
      layersRef.current = [];
    };
  }, [zones, simulatedValue, isSimulationMode, editingDevice, editingRangeSettings, map]);

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
            💡 Klik titik sensor di peta & pilih <strong>Atur Range</strong> untuk ubah warna & jangkauan.
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Modal / Dialog: Edit Range & Warna Titik Pantau (Sederhana & Cepat) ───
export const EditRangeModal = ({
  device,
  currentZone,
  onClose,
  onSaveZone
}) => {
  const [radiusMeter, setRadiusMeter] = useState(currentZone?.radius_meter || 150);
  const [selectedColor, setSelectedColor] = useState(currentZone?.color || '#38bdf8');
  const [notes, setNotes] = useState(currentZone?.notes || 'Struktur tanah normal, jalan aspal.');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const zoneData = {
        id: currentZone?.id || `zone-${device.id}`,
        device_id: device.id,
        name: device.name || 'Titik Pantau',
        lat: device.lat || 1.128,
        lng: device.lng || 104.053,
        center: [device.lat || 1.128, device.lng || 104.053],
        radius_meter: Number(radiusMeter),
        color: selectedColor,
        notes: notes.trim(),
        is_demo: false,
        updated_at: Date.now()
      };

      await onSaveZone(zoneData);
      onClose();
    } catch (err) {
      alert('Gagal menyimpan range: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

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
      padding: '16px'
    }}>
      <div style={{
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '420px',
        boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
        color: '#f8fafc',
        overflow: 'hidden'
      }}>
        {/* Header Modal */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(30, 41, 59, 0.5)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CircleDot size={18} color="#38bdf8" />
            <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>Sesuaikan Range & Warna</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Isi Form */}
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Info Titik */}
          <div style={{ background: '#1e293b', padding: '10px 12px', borderRadius: '8px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Titik Pantau Terpilih:</div>
            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#38bdf8' }}>{device.name}</div>
            <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>
              Koordinat: {device.lat?.toFixed(5)}, {device.lng?.toFixed(5)}
            </div>
          </div>

          {/* 1. Pengaturan Jangkauan / Radius */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1' }}>Jangkauan Area (Radius)</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8' }}>{radiusMeter} Meter</span>
            </div>
            <input
              type="range"
              min="30"
              max="600"
              step="10"
              value={radiusMeter}
              onChange={(e) => setRadiusMeter(Number(e.target.value))}
              style={{ width: '100%', accentColor: selectedColor, cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#64748b', marginTop: '2px' }}>
              <span>30 m (Dekat)</span>
              <span>150 m (Sedang)</span>
              <span>600 m (Luas)</span>
            </div>
          </div>

          {/* 2. Pilihan Warna Range */}
          <div>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1', display: 'block', marginBottom: '6px' }}>
              Pilih Warna Range Wilayah:
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.color}
                  type="button"
                  onClick={() => setSelectedColor(c.color)}
                  style={{
                    padding: '6px 4px',
                    borderRadius: '6px',
                    border: `2px solid ${selectedColor === c.color ? '#ffffff' : c.border}`,
                    background: c.bg,
                    color: '#ffffff',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    transition: 'all 0.15s'
                  }}
                >
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: c.color }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label.split(' ')[0]}</span>
                  {selectedColor === c.color && <Check size={12} color="#fff" />}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Catatan Kondisi (Perbaikan Jalan / Kontur Tanah) */}
          <div>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1', display: 'block', marginBottom: '4px' }}>
              Catatan Kondisi Lapangan (Opsional):
            </span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Ada galian gorong-gorong, perbaikan jalan baru diaspal, tanah cekung..."
              style={{
                width: '100%',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '8px 10px',
                color: '#f8fafc',
                fontSize: '0.75rem',
                fontFamily: 'inherit',
                resize: 'none'
              }}
            />
          </div>
        </div>

        {/* Footer Tombol */}
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
            {saving ? 'Menyimpan...' : 'Simpan Range Titik Ini'}
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
