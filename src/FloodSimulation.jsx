/**
 * FloodSimulation.jsx
 * 
 * Komponen Simulasi Zona Genangan untuk UkurAir.
 * 
 * PENTING:
 * - Slider simulasi HANYA mengubah tampilan. Tidak menulis ke Firebase.
 * - Edit zona hanya untuk Admin (isAdminUser === true).
 * - Data demo diberi label "⚠️ DEMO / CONTOH" secara eksplisit.
 * - Estimasi zona BUKAN pengukuran nyata; selalu diberi label "Estimasi".
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { ref, onValue, push, set, remove, update } from 'firebase/database';
import { db } from './firebase';
import {
  Layers, X, Plus, Trash2, Edit3, Save, AlertTriangle, 
  Sliders, Eye, EyeOff, Info, ChevronDown, ChevronUp,
  MapPin, Activity
} from 'lucide-react';

// ─── Konstanta Warna Status ───────────────────────────────────────────────────
export const STATUS_CONFIG = {
  aman:         { label: 'Aman',         color: '#22c55e', bg: 'rgba(34,197,94,0.18)',   border: '#22c55e', fillOpacity: 0.15 },
  waspada:      { label: 'Waspada',      color: '#facc15', bg: 'rgba(250,204,21,0.18)',  border: '#ca8a04', fillOpacity: 0.22 },
  tinggi:       { label: 'Tinggi',       color: '#f97316', bg: 'rgba(249,115,22,0.22)',  border: '#ea580c', fillOpacity: 0.28 },
  sangat_tinggi:{ label: 'Sangat Tinggi',color: '#ef4444', bg: 'rgba(239,68,68,0.28)',   border: '#dc2626', fillOpacity: 0.35 },
  belum_data:   { label: 'Belum ada data',color: '#94a3b8',bg: 'rgba(148,163,184,0.12)', border: '#64748b', fillOpacity: 0.1  },
};

// ─── Data Demo Bawaan (Bukan data nyata) ─────────────────────────────────────
// Koordinat ini adalah contoh fiktif untuk pengujian antarmuka.
// Admin WAJIB mengganti dengan poligon hasil survei lapangan.
export const DEMO_ZONES = [
  {
    id: 'demo-zone-a',
    name: 'Zona A – Contoh Jalan Utama',
    is_demo: true,
    linked_sensor_id: null, // Admin harus hubungkan ke sensor nyata
    confidence: 'rendah',
    calibration_status: 'belum',
    field_notes: '⚠️ DEMO: Poligon ini adalah contoh fiktif. Ganti dengan hasil survei lapangan.',
    polygon: [
      [1.1310, 104.0470],
      [1.1310, 104.0510],
      [1.1290, 104.0510],
      [1.1290, 104.0470],
    ],
    rules: [
      { id: 'dr-a1', min_sensor_cm: 0,   max_sensor_cm: 49,  estimated_depth_cm: 0,  status: 'aman',    is_demo: true },
      { id: 'dr-a2', min_sensor_cm: 50,  max_sensor_cm: 79,  estimated_depth_cm: 5,  status: 'waspada', is_demo: true },
      { id: 'dr-a3', min_sensor_cm: 80,  max_sensor_cm: 119, estimated_depth_cm: 20, status: 'tinggi',  is_demo: true },
      { id: 'dr-a4', min_sensor_cm: 120, max_sensor_cm: 300, estimated_depth_cm: 40, status: 'sangat_tinggi', is_demo: true },
    ]
  },
  {
    id: 'demo-zone-b',
    name: 'Zona B – Contoh Kawasan Hunian',
    is_demo: true,
    linked_sensor_id: null,
    confidence: 'rendah',
    calibration_status: 'belum',
    field_notes: '⚠️ DEMO: Angka estimasi adalah contoh untuk pengujian UI. Bukan data lapangan.',
    polygon: [
      [1.1340, 104.0490],
      [1.1340, 104.0530],
      [1.1315, 104.0530],
      [1.1315, 104.0490],
    ],
    rules: [
      { id: 'dr-b1', min_sensor_cm: 0,   max_sensor_cm: 79,  estimated_depth_cm: 0,  status: 'aman',    is_demo: true },
      { id: 'dr-b2', min_sensor_cm: 80,  max_sensor_cm: 109, estimated_depth_cm: 10, status: 'waspada', is_demo: true },
      { id: 'dr-b3', min_sensor_cm: 110, max_sensor_cm: 300, estimated_depth_cm: 25, status: 'tinggi',  is_demo: true },
    ]
  },
  {
    id: 'demo-zone-c',
    name: 'Zona C – Contoh Saluran Hilir',
    is_demo: true,
    linked_sensor_id: null,
    confidence: 'rendah',
    calibration_status: 'belum',
    field_notes: '⚠️ DEMO: Ambang dan estimasi perlu diisi setelah survei dan kalibrasi lapangan.',
    polygon: [
      [1.1265, 104.0500],
      [1.1265, 104.0540],
      [1.1245, 104.0540],
      [1.1245, 104.0500],
    ],
    rules: [] // Belum ada aturan — perlu data lapangan
  },
];

// ─── Fungsi Pembantu ──────────────────────────────────────────────────────────

/** Cari aturan yang berlaku untuk nilai sensor tertentu */
export const findApplicableRule = (rules, sensorValue) => {
  if (!rules || rules.length === 0) return null;
  for (const rule of rules) {
    if (sensorValue >= rule.min_sensor_cm && sensorValue <= rule.max_sensor_cm) {
      return rule;
    }
  }
  return null;
};

/** Format waktu terakhir update sensor */
const formatAge = (ms) => {
  if (!ms) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} dtk lalu`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} mnt lalu`;
  return `${Math.floor(min / 60)} jam lalu`;
};

// ─── Komponen: Layer GeoJSON di dalam MapContainer ───────────────────────────
export const FloodZoneLayer = ({ zones, simulatedValue, selectedSensorId, deviceData, isSimulationMode }) => {
  const map = useMap();
  const layersRef = useRef([]);

  const getSensorReading = useCallback((zone) => {
    // Jika mode simulasi aktif, pakai nilai slider
    if (isSimulationMode) return simulatedValue;
    // Cari data sensor yang terhubung
    if (!zone.linked_sensor_id || !deviceData) return null;
    const device = deviceData.find(d => d.id === zone.linked_sensor_id);
    if (!device) return null;
    // Jika sensor offline, jangan tampilkan estimasi
    const ageMs = device.last_updated ? Date.now() - device.last_updated : null;
    const isStale = ageMs !== null && ageMs > 15 * 60 * 1000; // > 15 menit
    if (isStale || !device.isOnline) return null;
    return device.water_level ?? null;
  }, [isSimulationMode, simulatedValue, deviceData]);

  useEffect(() => {
    // Hapus layer lama
    layersRef.current.forEach(l => { try { map.removeLayer(l); } catch (_) {} });
    layersRef.current = [];

    zones.forEach(zone => {
      if (!zone.polygon || zone.polygon.length < 3) return;

      const sensorVal = getSensorReading(zone);
      const rule = sensorVal !== null ? findApplicableRule(zone.rules, sensorVal) : null;
      const statusKey = rule?.status || 'belum_data';
      const cfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.belum_data;
      const isDemo = zone.is_demo;

      // Buat polygon Leaflet
      const poly = L.polygon(zone.polygon, {
        color: cfg.border,
        fillColor: cfg.color,
        fillOpacity: cfg.fillOpacity,
        weight: isDemo ? 2 : 2.5,
        dashArray: isDemo ? '6, 4' : null, // Garis putus-putus untuk zona demo
      });

      // Popup zona
      const demoWarning = isDemo
        ? `<div style="background:#78350f;color:#fef3c7;border:1px solid #d97706;border-radius:4px;padding:4px 8px;font-size:0.68rem;font-weight:700;margin-bottom:6px;">
            ⚠️ DEMO / CONTOH — Bukan data lapangan nyata
           </div>`
        : '';

      const estimasiInfo = sensorVal !== null && rule
        ? `<div style="margin:4px 0 2px;font-size:0.78rem;color:#cbd5e1;">
             Estimasi genangan: <strong style="color:${cfg.color}">${rule.estimated_depth_cm} cm</strong>
             <span style="font-size:0.65rem;color:#94a3b8;display:block;">Keyakinan: ${zone.confidence || 'rendah'} · ${zone.calibration_status === 'terkalibrasi' ? '✅ Terkalibrasi' : '⚠️ Belum dikalibrasi'}</span>
           </div>
           <div style="font-size:0.68rem;color:#94a3b8;border-top:1px solid #334155;padding-top:4px;margin-top:4px;">
             📐 Estimasi zona — Bukan pengukuran langsung.<br/>Bacaan sensor aktual hanya di titik alat.
           </div>`
        : sensorVal !== null
          ? `<div style="font-size:0.78rem;color:#94a3b8;margin:4px 0;">
               Belum ada aturan untuk nilai sensor ${sensorVal} cm.<br/>
               <span style="font-size:0.68rem;">Tambahkan aturan ambang di Admin Panel.</span>
             </div>`
          : `<div style="font-size:0.78rem;color:#94a3b8;margin:4px 0;">
               ${zone.linked_sensor_id ? '⚠️ Sensor offline atau data kadaluarsa. Estimasi tidak ditampilkan.' : 'Belum ada sensor terhubung. Hubungkan sensor di Admin Panel.'}
             </div>`;

      const sensorLine = isSimulationMode
        ? `<div style="font-size:0.72rem;color:#38bdf8;background:rgba(56,189,248,0.1);border:1px solid #0284c7;border-radius:3px;padding:2px 6px;display:inline-block;margin-bottom:4px;">🔵 Mode Simulasi · Sensor: ${sensorVal} cm</div>`
        : sensorVal !== null
          ? `<div style="font-size:0.72rem;color:#22c55e;margin-bottom:4px;">🟢 Sensor aktual: ${sensorVal} cm</div>`
          : '';

      const popupHtml = `
        <div style="min-width:200px;font-family:inherit;">
          ${demoWarning}
          <strong style="font-size:0.9rem;color:#f1f5f9;">${zone.name}</strong>
          <div style="margin:4px 0 2px;">
            <span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:0.68rem;font-weight:700;background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border};">
              ${cfg.label}
            </span>
          </div>
          ${sensorLine}
          ${estimasiInfo}
          ${zone.field_notes ? `<div style="font-size:0.65rem;color:#64748b;margin-top:4px;font-style:italic;">${zone.field_notes}</div>` : ''}
        </div>
      `;

      poly.bindPopup(popupHtml, { maxWidth: 260, className: 'flood-zone-popup' });
      poly.addTo(map);
      layersRef.current.push(poly);
    });

    return () => {
      layersRef.current.forEach(l => { try { map.removeLayer(l); } catch (_) {} });
      layersRef.current = [];
    };
  }, [zones, simulatedValue, getSensorReading, isSimulationMode, map]);

  return null;
};

// ─── Komponen: Panel Kontrol Simulasi (Floating di atas peta) ─────────────────
export const SimulationControlPanel = ({
  zones,
  isSimulationMode,
  setIsSimulationMode,
  simulatedValue,
  setSimulatedValue,
  showZones,
  setShowZones,
  isAdminUser,
  onOpenAdminZone,
  deviceData,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  // Hitung ringkasan status dari semua zona
  const zoneSummary = zones.map(zone => {
    const sensorVal = isSimulationMode ? simulatedValue : (() => {
      if (!zone.linked_sensor_id || !deviceData) return null;
      const d = deviceData.find(x => x.id === zone.linked_sensor_id);
      return d?.isOnline ? (d.water_level ?? null) : null;
    })();
    const rule = sensorVal !== null ? findApplicableRule(zone.rules, sensorVal) : null;
    return { zone, rule, sensorVal };
  });

  return (
    <div
      className="flood-sim-panel"
      style={{
        position: 'absolute',
        bottom: '80px',
        right: '12px',
        zIndex: 1000,
        background: 'rgba(15,23,42,0.96)',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: collapsed ? '10px 14px' : '14px',
        minWidth: collapsed ? 'auto' : '240px',
        maxWidth: '260px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        fontFamily: 'inherit',
        color: '#f1f5f9',
        fontSize: '0.82rem',
      }}
    >
      {/* Header panel */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: collapsed ? 0 : '10px' }}>
        <Layers size={15} color="#38bdf8" />
        <span style={{ fontWeight: 700, flex: 1, fontSize: '0.83rem' }}>Simulasi Zona</span>
        <button
          onClick={() => setShowZones(!showZones)}
          title={showZones ? 'Sembunyikan zona' : 'Tampilkan zona'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', color: showZones ? '#38bdf8' : '#64748b' }}
        >
          {showZones ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', color: '#94a3b8' }}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Toggle mode simulasi */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: isSimulationMode ? 'rgba(56,189,248,0.1)' : 'rgba(30,41,59,0.6)',
            border: `1px solid ${isSimulationMode ? '#0284c7' : '#334155'}`,
            borderRadius: '8px',
            padding: '6px 10px',
            marginBottom: '10px',
            cursor: 'pointer',
          }} onClick={() => setIsSimulationMode(!isSimulationMode)}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.78rem', color: isSimulationMode ? '#38bdf8' : '#94a3b8' }}>
                {isSimulationMode ? '🔵 Mode Simulasi' : '⚫ Data Aktual'}
              </div>
              {isSimulationMode && (
                <div style={{ fontSize: '0.63rem', color: '#94a3b8', marginTop: '1px' }}>
                  Slider tidak mengubah data IoT
                </div>
              )}
            </div>
            {/* Toggle switch visual */}
            <div style={{
              width: '32px', height: '17px', borderRadius: '999px',
              background: isSimulationMode ? '#0284c7' : '#475569',
              position: 'relative', transition: 'background 0.2s',
              flexShrink: 0,
            }}>
              <div style={{
                position: 'absolute', top: '2px',
                left: isSimulationMode ? '16px' : '2px',
                width: '13px', height: '13px', borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
              }} />
            </div>
          </div>

          {/* Slider simulasi (hanya tampil saat mode simulasi aktif) */}
          {isSimulationMode && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '4px'
              }}>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                  <Sliders size={11} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
                  Simulasi bacaan sensor
                </span>
                <span style={{
                  fontWeight: 700, fontSize: '0.88rem', color: '#38bdf8',
                  background: 'rgba(56,189,248,0.1)', padding: '1px 7px', borderRadius: '4px'
                }}>
                  {simulatedValue} cm
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={300}
                value={simulatedValue}
                onChange={e => setSimulatedValue(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: '#475569' }}>
                <span>0 cm</span><span>300 cm</span>
              </div>
              <div style={{
                marginTop: '6px', padding: '4px 8px', borderRadius: '5px',
                background: '#78350f', border: '1px solid #d97706',
                fontSize: '0.63rem', color: '#fef3c7', textAlign: 'center',
              }}>
                ⚠️ SIMULASI — Angka ini tidak dikirim ke sensor
              </div>
            </div>
          )}

          {/* Ringkasan zona */}
          {showZones && zoneSummary.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Zona ({zoneSummary.length})
              </div>
              {zoneSummary.map(({ zone, rule }) => {
                const statusKey = rule?.status || 'belum_data';
                const cfg = STATUS_CONFIG[statusKey];
                return (
                  <div key={zone.id} style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '3px 0', borderBottom: '1px solid #1e293b'
                  }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: cfg.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: '0.72rem', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {zone.name}
                      {zone.is_demo && <span style={{ color: '#d97706', fontSize: '0.6rem', marginLeft: '3px' }}>[DEMO]</span>}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: cfg.color, fontWeight: 600, flexShrink: 0 }}>
                      {cfg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Legenda */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: '3px' }}>Legenda</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
              {[
                { key: 'aman', label: 'Aman' },
                { key: 'waspada', label: 'Waspada' },
                { key: 'tinggi', label: 'Tinggi' },
                { key: 'sangat_tinggi', label: 'Sangat Tinggi' },
                { key: 'belum_data', label: 'Belum Data' },
              ].map(({ key, label }) => {
                const cfg = STATUS_CONFIG[key];
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.63rem', color: '#94a3b8' }}>
                    <div style={{ width: '8px', height: '8px', background: cfg.color, borderRadius: '2px', border: `1px solid ${cfg.border}` }} />
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: '4px' }}>
              🔵 = Terukur di sensor · Lainnya = Estimasi zona
            </div>
          </div>

          {/* Tombol admin */}
          {isAdminUser && (
            <button
              onClick={onOpenAdminZone}
              style={{
                width: '100%', padding: '6px', borderRadius: '7px',
                background: 'rgba(56,189,248,0.1)', border: '1px solid #0284c7',
                color: '#38bdf8', fontSize: '0.75rem', fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '5px',
              }}
            >
              <Edit3 size={13} /> Kelola Zona (Admin)
            </button>
          )}
        </>
      )}
    </div>
  );
};

// ─── Komponen: Panel Admin Kelola Zona ────────────────────────────────────────
export const AdminZonePanel = ({ zones, onClose, deviceList, onSave, onDelete }) => {
  const [selectedZone, setSelectedZone] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showNewZone, setShowNewZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');

  const openEdit = (zone) => {
    setSelectedZone(zone.id);
    setEditForm(JSON.parse(JSON.stringify(zone))); // Deep copy
    setShowNewZone(false);
    setError('');
  };

  const handleSaveZone = async () => {
    if (!editForm) return;
    setError('');
    setSaving(true);
    try {
      // Validasi rentang aturan (tidak boleh tumpang tindih atau ada celah)
      const rules = [...(editForm.rules || [])].sort((a, b) => a.min_sensor_cm - b.min_sensor_cm);
      for (let i = 0; i < rules.length - 1; i++) {
        if (rules[i].max_sensor_cm >= rules[i + 1].min_sensor_cm) {
          setError(`Rentang aturan ke-${i + 1} dan ke-${i + 2} tumpang tindih. Perbaiki dulu.`);
          setSaving(false);
          return;
        }
        if (rules[i].max_sensor_cm + 1 < rules[i + 1].min_sensor_cm) {
          setError(`Ada celah rentang antara aturan ke-${i + 1} (maks ${rules[i].max_sensor_cm} cm) dan ke-${i + 2} (min ${rules[i + 1].min_sensor_cm} cm).`);
          setSaving(false);
          return;
        }
      }
      await onSave({ ...editForm, rules, is_demo: false });
      setSelectedZone(null);
      setEditForm(null);
    } catch (e) {
      setError('Gagal menyimpan: ' + (e?.message || 'Error tidak dikenal'));
    }
    setSaving(false);
  };

  const handleAddNewZone = async () => {
    if (!newZoneName.trim()) { setError('Nama zona tidak boleh kosong.'); return; }
    setError('');
    setSaving(true);
    try {
      await onSave({
        name: newZoneName.trim(),
        polygon: [],
        linked_sensor_id: null,
        confidence: 'rendah',
        calibration_status: 'belum',
        field_notes: '',
        is_demo: false,
        rules: [],
      });
      setNewZoneName('');
      setShowNewZone(false);
    } catch (e) {
      setError('Gagal membuat zona: ' + (e?.message || ''));
    }
    setSaving(false);
  };

  const handleUpdateRule = (idx, field, value) => {
    setEditForm(prev => {
      const rules = [...(prev.rules || [])];
      rules[idx] = { ...rules[idx], [field]: field.endsWith('_cm') ? Number(value) : value };
      return { ...prev, rules };
    });
  };

  const handleAddRule = () => {
    setEditForm(prev => ({
      ...prev,
      rules: [
        ...(prev.rules || []),
        { id: 'new-' + Date.now(), min_sensor_cm: 0, max_sensor_cm: 50, estimated_depth_cm: 0, status: 'aman', is_demo: false }
      ]
    }));
  };

  const handleRemoveRule = (idx) => {
    setEditForm(prev => {
      const rules = [...(prev.rules || [])];
      rules.splice(idx, 1);
      return { ...prev, rules };
    });
  };

  const inputStyle = {
    background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9',
    borderRadius: '5px', padding: '4px 8px', fontSize: '0.78rem', width: '100%',
  };
  const labelStyle = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: '2px', display: 'block' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0f172a', border: '1px solid #334155', borderRadius: '12px',
        width: '90%', maxWidth: '640px', maxHeight: '90vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      }}>
        {/* Header modal */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={18} color="#38bdf8" />
          <span style={{ fontWeight: 700, color: '#f1f5f9', flex: 1 }}>Kelola Zona Genangan (Admin)</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          {/* Peringatan data demo */}
          <div style={{
            margin: '12px 18px 0', padding: '8px 12px',
            background: 'rgba(120,53,15,0.3)', border: '1px solid #d97706',
            borderRadius: '7px', fontSize: '0.72rem', color: '#fef3c7',
          }}>
            <strong>⚠️ Penting:</strong> Poligon dan aturan yang sudah ada (<span style={{ color: '#fbbf24' }}>berlabel DEMO</span>) adalah data contoh fiktif.
            Ganti dengan hasil survei dan kalibrasi lapangan sebelum digunakan untuk peringatan nyata.
          </div>

          {error && (
            <div style={{
              margin: '10px 18px 0', padding: '7px 12px',
              background: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444',
              borderRadius: '6px', fontSize: '0.75rem', color: '#fca5a5',
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Daftar zona */}
          <div style={{ padding: '12px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
              <span style={{ fontWeight: 600, color: '#94a3b8', fontSize: '0.78rem' }}>Daftar Zona ({zones.length})</span>
              <button
                onClick={() => { setShowNewZone(true); setSelectedZone(null); setEditForm(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px',
                  background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e',
                  borderRadius: '5px', color: '#22c55e', fontSize: '0.73rem',
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                <Plus size={12} /> Zona Baru
              </button>
            </div>

            {/* Form zona baru */}
            {showNewZone && (
              <div style={{ background: '#1e293b', borderRadius: '8px', padding: '10px', marginBottom: '8px', border: '1px solid #334155' }}>
                <span style={labelStyle}>Nama zona baru</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={newZoneName}
                    onChange={e => setNewZoneName(e.target.value)}
                    placeholder="Contoh: Jalan Sudirman Depan Pasar"
                  />
                  <button onClick={handleAddNewZone} disabled={saving}
                    style={{ padding: '4px 12px', background: '#22c55e', border: 'none', borderRadius: '5px', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}>
                    {saving ? '...' : 'Buat'}
                  </button>
                  <button onClick={() => setShowNewZone(false)}
                    style={{ padding: '4px 8px', background: '#374151', border: 'none', borderRadius: '5px', color: '#94a3b8', fontSize: '0.75rem', cursor: 'pointer' }}>
                    Batal
                  </button>
                </div>
                <div style={{ fontSize: '0.63rem', color: '#64748b', marginTop: '4px' }}>
                  Setelah dibuat, tambahkan koordinat poligon dan aturan ambang di formulir edit zona.
                </div>
              </div>
            )}

            {zones.map(zone => (
              <div key={zone.id} style={{
                background: selectedZone === zone.id ? '#1e293b' : '#0f172a',
                border: `1px solid ${selectedZone === zone.id ? '#38bdf8' : '#1e293b'}`,
                borderRadius: '8px', marginBottom: '6px', overflow: 'hidden',
              }}>
                <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MapPin size={14} color="#64748b" />
                  <span style={{ flex: 1, fontWeight: 600, fontSize: '0.8rem', color: '#f1f5f9' }}>
                    {zone.name}
                    {zone.is_demo && (
                      <span style={{ marginLeft: '6px', fontSize: '0.62rem', color: '#d97706', background: 'rgba(217,119,6,0.15)', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>DEMO</span>
                    )}
                  </span>
                  <span style={{ fontSize: '0.65rem', color: '#64748b' }}>{(zone.rules || []).length} aturan</span>
                  <button onClick={() => selectedZone === zone.id ? setSelectedZone(null) : openEdit(zone)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.72rem' }}>
                    <Edit3 size={12} /> Edit
                  </button>
                  <button onClick={() => { if (window.confirm(`Hapus zona "${zone.name}"? Tindakan ini tidak bisa dibatalkan.`)) onDelete(zone.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* Form edit zona */}
                {selectedZone === zone.id && editForm && (
                  <div style={{ padding: '10px 12px', borderTop: '1px solid #1e293b' }}>
                    {/* Info kalibrasi */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                      <div>
                        <span style={labelStyle}>Sensor Terhubung</span>
                        <select style={inputStyle} value={editForm.linked_sensor_id || ''} onChange={e => setEditForm(p => ({ ...p, linked_sensor_id: e.target.value || null }))}>
                          <option value="">— Belum ada —</option>
                          {deviceList.map(d => (
                            <option key={d.id} value={d.id}>{d.name || d.id}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <span style={labelStyle}>Keyakinan Estimasi</span>
                        <select style={inputStyle} value={editForm.confidence || 'rendah'} onChange={e => setEditForm(p => ({ ...p, confidence: e.target.value }))}>
                          <option value="rendah">Rendah — belum dikalibrasi</option>
                          <option value="sedang">Sedang — kalibrasi parsial</option>
                          <option value="tinggi">Tinggi — terkalibrasi survei</option>
                        </select>
                      </div>
                      <div>
                        <span style={labelStyle}>Status Kalibrasi</span>
                        <select style={inputStyle} value={editForm.calibration_status || 'belum'} onChange={e => setEditForm(p => ({ ...p, calibration_status: e.target.value }))}>
                          <option value="belum">Belum dikalibrasi</option>
                          <option value="dalam_proses">Dalam proses</option>
                          <option value="terkalibrasi">Terkalibrasi</option>
                        </select>
                      </div>
                      <div>
                        <span style={labelStyle}>Catatan Survei</span>
                        <input style={inputStyle} value={editForm.field_notes || ''} onChange={e => setEditForm(p => ({ ...p, field_notes: e.target.value }))} placeholder="Catatan lapangan..." />
                      </div>
                    </div>

                    {/* Koordinat poligon (input teks JSON) */}
                    <div style={{ marginBottom: '10px' }}>
                      <span style={labelStyle}>Koordinat Poligon (JSON array: [[lat,lng], ...] min 3 titik)</span>
                      <textarea
                        style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.68rem' }}
                        value={JSON.stringify(editForm.polygon || [])}
                        onChange={e => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            if (Array.isArray(parsed)) setEditForm(p => ({ ...p, polygon: parsed }));
                          } catch (_) {}
                        }}
                        placeholder="[[lat, lng], [lat, lng], ...]"
                      />
                      <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: '2px' }}>
                        Contoh titik Batam: [1.1310, 104.0470]. Dapatkan koordinat dari Google Maps.
                      </div>
                    </div>

                    {/* Aturan ambang per zona */}
                    <div style={{ marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', gap: '6px' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.75rem', color: '#94a3b8' }}>Aturan Ambang Sensor</span>
                        <button onClick={handleAddRule}
                          style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '2px 8px', background: 'rgba(56,189,248,0.1)', border: '1px solid #0284c7', borderRadius: '4px', color: '#38bdf8', fontSize: '0.68rem', cursor: 'pointer' }}>
                          <Plus size={10} /> Tambah
                        </button>
                      </div>
                      {(editForm.rules || []).length === 0 && (
                        <div style={{ fontSize: '0.72rem', color: '#64748b', fontStyle: 'italic' }}>Belum ada aturan. Tambahkan aturan ambang setelah survei lapangan.</div>
                      )}
                      {(editForm.rules || []).map((rule, idx) => (
                        <div key={rule.id || idx} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', padding: '8px', marginBottom: '4px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '6px', alignItems: 'end' }}>
                            <div>
                              <span style={labelStyle}>Min (cm)</span>
                              <input type="number" style={inputStyle} value={rule.min_sensor_cm} onChange={e => handleUpdateRule(idx, 'min_sensor_cm', e.target.value)} min={0} max={300} />
                            </div>
                            <div>
                              <span style={labelStyle}>Maks (cm)</span>
                              <input type="number" style={inputStyle} value={rule.max_sensor_cm} onChange={e => handleUpdateRule(idx, 'max_sensor_cm', e.target.value)} min={0} max={300} />
                            </div>
                            <div>
                              <span style={labelStyle}>Est. (cm)</span>
                              <input type="number" style={inputStyle} value={rule.estimated_depth_cm} onChange={e => handleUpdateRule(idx, 'estimated_depth_cm', e.target.value)} min={0} max={500} />
                            </div>
                            <div>
                              <span style={labelStyle}>Status</span>
                              <select style={inputStyle} value={rule.status} onChange={e => handleUpdateRule(idx, 'status', e.target.value)}>
                                <option value="aman">Aman</option>
                                <option value="waspada">Waspada</option>
                                <option value="tinggi">Tinggi</option>
                                <option value="sangat_tinggi">Sangat Tinggi</option>
                              </select>
                            </div>
                            <button onClick={() => handleRemoveRule(idx)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', paddingBottom: '4px' }}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Tombol simpan */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={handleSaveZone} disabled={saving}
                        style={{ flex: 1, padding: '7px', background: '#0284c7', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                        <Save size={13} /> {saving ? 'Menyimpan...' : 'Simpan Zona'}
                      </button>
                      <button onClick={() => { setSelectedZone(null); setEditForm(null); setError(''); }}
                        style={{ padding: '7px 14px', background: '#374151', border: 'none', borderRadius: '6px', color: '#94a3b8', fontSize: '0.78rem', cursor: 'pointer' }}>
                        Batal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Hook Utama: Kelola Zona dari Firebase ────────────────────────────────────
export const useFloodZones = () => {
  const [zones, setZones] = useState([]);
  const [loadingZones, setLoadingZones] = useState(true);
  const [usingDemo, setUsingDemo] = useState(false);

  useEffect(() => {
    const zonesRef = ref(db, 'flood_zones');
    const rulesRef = ref(db, 'zone_rules');

    let zonesData = {};
    let rulesData = {};
    let loadedCount = 0;

    const merge = () => {
      if (loadedCount < 2) return;

      // Jika tidak ada zona di Firebase, tampilkan data demo
      if (Object.keys(zonesData).length === 0) {
        setZones(DEMO_ZONES);
        setUsingDemo(true);
        setLoadingZones(false);
        return;
      }

      // Gabungkan zona dengan aturannya
      const merged = Object.entries(zonesData).map(([id, zoneData]) => {
        const zoneRules = Object.entries(rulesData)
          .filter(([, r]) => r.zone_id === id)
          .map(([ruleId, r]) => ({ id: ruleId, ...r }))
          .sort((a, b) => a.min_sensor_cm - b.min_sensor_cm);
        return { id, ...zoneData, rules: zoneRules };
      });

      setZones(merged);
      setUsingDemo(false);
      setLoadingZones(false);
    };

    const unsubZones = onValue(zonesRef, snap => {
      zonesData = snap.val() || {};
      loadedCount = loadedCount < 1 ? 1 : loadedCount;
      if (loadedCount >= 2) merge();
    });

    const unsubRules = onValue(rulesRef, snap => {
      rulesData = snap.val() || {};
      loadedCount = loadedCount < 2 ? loadedCount + 1 : 2;
      merge();
    });

    return () => { unsubZones(); unsubRules(); };
  }, []);

  const saveZone = async (zone) => {
    if (zone.id && !zone.id.startsWith('demo-')) {
      // Update zona yang sudah ada
      const { rules, id, ...zoneData } = zone;
      await update(ref(db, `flood_zones/${id}`), zoneData);
      // Update aturan: hapus lama, tulis baru
      const oldRulesSnap = await get(ref(db, 'zone_rules'));
      const oldRules = oldRulesSnap.val() || {};
      const toDelete = Object.entries(oldRules).filter(([, r]) => r.zone_id === id).map(([k]) => k);
      await Promise.all(toDelete.map(k => remove(ref(db, `zone_rules/${k}`))));
      await Promise.all((rules || []).map(r => {
        const { id: rId, ...rData } = r;
        return push(ref(db, 'zone_rules'), { ...rData, zone_id: id, updated_at: Date.now() });
      }));
    } else {
      // Zona baru
      const { rules, id: _id, ...zoneData } = zone;
      const newZoneRef = await push(ref(db, 'flood_zones'), { ...zoneData, created_at: Date.now() });
      const newId = newZoneRef.key;
      await Promise.all((rules || []).map(r => {
        const { id: rId, ...rData } = r;
        return push(ref(db, 'zone_rules'), { ...rData, zone_id: newId, updated_at: Date.now() });
      }));
    }
  };

  const deleteZone = async (zoneId) => {
    await remove(ref(db, `flood_zones/${zoneId}`));
    // Hapus semua aturan zona ini
    const snap = await get(ref(db, 'zone_rules'));
    const allRules = snap.val() || {};
    const toDelete = Object.entries(allRules).filter(([, r]) => r.zone_id === zoneId).map(([k]) => k);
    await Promise.all(toDelete.map(k => remove(ref(db, `zone_rules/${k}`))));
  };

  return { zones, loadingZones, usingDemo, saveZone, deleteZone };
};
