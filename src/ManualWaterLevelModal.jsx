import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Power,
  Check,
  X,
  Shield,
  RefreshCw,
  AlertTriangle,
  Waves,
  Database,
  Radio,
  Layers,
  Sparkles
} from 'lucide-react';
import { getWaterStatus } from './App';

/**
 * Modal Kontrol Ketinggian Air Manual (0 - 100 cm)
 * Khusus Admin — Mode Presentasi Dosen & Uji Akusisi Sensor
 *
 * Mengubah data langsung di Firebase Realtime Database (/dashboard dan /measurements)
 * sehingga anggota, dosen, dan pengunjung melihat data berubah secara real-time.
 */
export const ManualWaterLevelModal = ({
  device,
  allDevices = [],
  onClose,
  onSaveManual,
  isAdminUser = false
}) => {
  if (!isAdminUser || !device) return null;

  const [selectedDeviceId, setSelectedDeviceId] = useState(device.id);
  const currentDev = allDevices.find(d => d.id === selectedDeviceId) || device;

  const [isManualOn, setIsManualOn] = useState(() => {
    return !!currentDev?.manual_control;
  });

  const [level, setLevel] = useState(() => {
    const raw = Number(currentDev?.water_level);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.min(100, Math.max(0, Math.round(raw)));
    }
    return 35; // Default nilai uji coba yang informatif
  });

  const [applyToAll, setApplyToAll] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState('');

  // Sinkronkan state lokal saat perangkat yang dipilih berganti
  useEffect(() => {
    const target = allDevices.find(d => d.id === selectedDeviceId) || device;
    if (target) {
      setIsManualOn(!!target.manual_control);
      const raw = Number(target.water_level);
      if (Number.isFinite(raw) && raw > 0) {
        setLevel(Math.min(100, Math.max(0, Math.round(raw))));
      } else {
        setLevel(35);
      }
    }
  }, [selectedDeviceId]);

  // Kalkulasi status ketinggian air real-time
  const statusInfo = getWaterStatus(level);

  // Penanganan simpan ke Firebase RTDB
  const handleSave = async (forceOff = false) => {
    setIsSaving(true);
    setSaveFeedback('');

    const targetManualOn = forceOff ? false : isManualOn;
    const targetLevel = forceOff ? 0 : Math.min(100, Math.max(0, Math.round(Number(level) || 0)));

    try {
      if (applyToAll && allDevices.length > 0) {
        // Terapkan ke semua perangkat terdaftar
        for (const dev of allDevices) {
          await onSaveManual(dev.id, targetManualOn, targetLevel);
        }
        setSaveFeedback(
          targetManualOn
            ? `✅ Berhasil menerapkan ${targetLevel} cm ke SEMUA (${allDevices.length}) titik sensor di Firebase!`
            : `✅ Berhasil mematikan (OFF) kontrol manual untuk SEMUA titik sensor!`
        );
      } else {
        // Terapkan ke perangkat yang dipilih
        await onSaveManual(selectedDeviceId, targetManualOn, targetLevel);
        setSaveFeedback(
          targetManualOn
            ? `✅ Ketinggian ${targetLevel} cm (${statusInfo.label}) berhasil disimpan ke Firebase!`
            : `✅ Kontrol manual dimatikan. Perangkat kembali ke mode sensor fisik (OFF).`
        );
      }

      if (forceOff) {
        setIsManualOn(false);
        setLevel(0);
      }

      setTimeout(() => {
        setSaveFeedback('');
      }, 3500);
    } catch (err) {
      console.error('Error saat simpan manual:', err);
      setSaveFeedback('⚠️ Gagal menyimpan ke Firebase: ' + (err?.message || 'Error'));
    } finally {
      setIsSaving(false);
    }
  };

  // Preset skenario uji coba cepat
  const presets = [
    { label: 'Aman', level: 5, color: '#10b981', desc: '< 10 cm (Kering/Lancar)' },
    { label: 'Siaga 1', level: 18, color: '#38bdf8', desc: '10 - 24 cm (Normal)' },
    { label: 'Siaga 2', level: 38, color: '#f59e0b', desc: '25 - 49 cm (Waspada Genangan)' },
    { label: 'Siaga 3', level: 62, color: '#f97316', desc: '50 - 74 cm (Ketinggian Kritis)' },
    { label: 'Siaga 4', level: 85, color: '#ef4444', desc: '75 - 100 cm (Bahaya Banjir)' },
  ];

  return (
    <div className="manual-control-modal-overlay" onClick={onClose}>
      <div
        className="manual-control-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header Modal */}
        <div className="manual-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(2, 132, 199, 0.25))',
              border: '1px solid #0284c7',
              borderRadius: '10px',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Sliders size={18} color="#38bdf8" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#f8fafc' }}>
                  Kontrol Ketinggian Air Manual
                </h3>
                <span style={{
                  fontSize: '0.62rem',
                  fontWeight: 800,
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px'
                }}>
                  <Shield size={10} /> Khusus Admin
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8' }}>
                Mode Uji Coba &amp; Kalibrasi Sensor Manual (0 - 100 cm)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="manual-modal-close-btn"
            title="Tutup Modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Konten Scrollable */}
        <div className="manual-modal-body">
          {/* Pemilihan Perangkat Sensor */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '0.74rem', fontWeight: 700, color: '#cbd5e1', display: 'block', marginBottom: '5px' }}>
              Titik Sensor yang Diatur:
            </label>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              style={{
                width: '100%',
                background: '#1e293b',
                border: '1px solid #334155',
                color: '#f8fafc',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '0.82rem',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {allDevices.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name || d.id} {d.manual_control ? '• [Manual ON]' : '• [Sensor Fisik]'}
                </option>
              ))}
            </select>
          </div>

          {/* Toggle Switch: Kontrol Manual ON / OFF */}
          <div
            onClick={() => {
              const nextVal = !isManualOn;
              setIsManualOn(nextVal);
              if (nextVal && level === 0) setLevel(35);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: '10px',
              background: isManualOn
                ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(16, 185, 129, 0.1))'
                : 'rgba(30, 41, 59, 0.6)',
              border: `1.5px solid ${isManualOn ? '#16a34a' : '#334155'}`,
              cursor: 'pointer',
              marginBottom: '16px',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                background: isManualOn ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.15)',
                border: `1px solid ${isManualOn ? '#22c55e' : '#ef4444'}`,
                borderRadius: '8px',
                padding: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Power size={18} color={isManualOn ? '#22c55e' : '#ef4444'} />
              </div>
              <div>
                <div style={{
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  color: isManualOn ? '#22c55e' : '#f87171',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  {isManualOn ? '🟢 KONTROL MANUAL: AKTIF (ON)' : '🔴 KONTROL MANUAL: MATI (OFF)'}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '2px', lineHeight: 1.3 }}>
                  {isManualOn
                    ? 'Sensor dipaksa Online (0 - 100 cm). Panel monitoring & dashboard publik melihat data berubah secara live.'
                    : 'Kembali ke mode hardware asli. Jika alat mati, status otomatis Terputus (OFF) & 0 cm.'}
                </div>
              </div>
            </div>

            {/* Toggle Switch Visual */}
            <div style={{
              width: '44px',
              height: '24px',
              borderRadius: '12px',
              background: isManualOn ? '#22c55e' : '#475569',
              position: 'relative',
              flexShrink: 0,
              transition: 'background 0.2s ease'
            }}>
              <div style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: '#ffffff',
                position: 'absolute',
                top: '3px',
                left: isManualOn ? '23px' : '3px',
                transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
              }} />
            </div>
          </div>

          {/* Area Slider Ketinggian Air (Aktif jika isManualOn) */}
          {isManualOn ? (
            <div style={{
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid #1e293b',
              borderRadius: '12px',
              padding: '14px',
              marginBottom: '14px'
            }}>
              {/* Display Nilai & Status Real-Time */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <div>
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
                    Ketinggian Air Manual:
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '2px' }}>
                    <span style={{
                      fontSize: '2.2rem',
                      fontWeight: 900,
                      color: statusInfo.color,
                      lineHeight: 1
                    }}>
                      {level}
                    </span>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: '#94a3b8' }}>cm</span>
                  </div>
                </div>

                {/* Status Badge Live */}
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '0.76rem',
                    fontWeight: 800,
                    background: statusInfo.bg,
                    color: statusInfo.color,
                    border: `1.5px solid ${statusInfo.border}`,
                    boxShadow: `0 0 10px ${statusInfo.border}33`
                  }}>
                    <span style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: statusInfo.color
                    }} />
                    {statusInfo.label} ({statusInfo.range})
                  </span>
                  <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '4px' }}>
                    Rentang Pengaturan: 0 - 100 cm
                  </div>
                </div>
              </div>

              {/* Slider Bar */}
              <div style={{ marginBottom: '12px' }}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={level}
                  onChange={(e) => setLevel(Number(e.target.value))}
                  style={{
                    width: '100%',
                    height: '8px',
                    borderRadius: '6px',
                    appearance: 'none',
                    background: 'linear-gradient(to right, #10b981 0%, #38bdf8 20%, #f59e0b 45%, #f97316 70%, #ef4444 100%)',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                />
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.66rem',
                  color: '#64748b',
                  fontWeight: 600,
                  marginTop: '4px'
                }}>
                  <span>0 cm (Aman)</span>
                  <span>25 cm (Siaga 2)</span>
                  <span>50 cm (Siaga 3)</span>
                  <span>75 cm</span>
                  <span>100 cm (Bahaya)</span>
                </div>
              </div>

              {/* Input Nomor Langsung */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 10px',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '8px',
                marginBottom: '14px'
              }}>
                <span style={{ fontSize: '0.74rem', color: '#cbd5e1' }}>Ketik Angka Pasti (cm):</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={level}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') setLevel(0);
                    else setLevel(Math.min(100, Math.max(0, parseInt(val, 10) || 0)));
                  }}
                  style={{
                    width: '65px',
                    background: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '6px',
                    color: '#38bdf8',
                    padding: '3px 8px',
                    fontSize: '0.85rem',
                    fontWeight: 800,
                    textAlign: 'center',
                    outline: 'none'
                  }}
                />
                <span style={{ fontSize: '0.74rem', color: '#64748b' }}>cm (0 s/d 100)</span>
              </div>

              {/* Preset Tombol Cepat Skenario Banjir */}
              <div>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                  🎯 Tombol Skenario Cepat Level Air:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '6px' }}>
                  {presets.map(p => {
                    const isSelected = level === p.level;
                    return (
                      <button
                        key={p.level}
                        type="button"
                        onClick={() => {
                          setLevel(p.level);
                          setIsManualOn(true);
                        }}
                        style={{
                          background: isSelected ? `${p.color}25` : 'rgba(30, 41, 59, 0.6)',
                          border: `1.5px solid ${isSelected ? p.color : '#334155'}`,
                          color: isSelected ? p.color : '#cbd5e1',
                          padding: '6px 4px',
                          borderRadius: '8px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '2px',
                          transition: 'all 0.15s ease'
                        }}
                        title={p.desc}
                      >
                        <span>{p.level} cm</span>
                        <span style={{ fontSize: '0.62rem', opacity: 0.85 }}>{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px dashed rgba(239, 68, 68, 0.3)',
              borderRadius: '10px',
              padding: '14px',
              marginBottom: '14px',
              textAlign: 'center'
            }}>
              <AlertTriangle size={24} color="#f87171" style={{ margin: '0 auto 6px' }} />
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f87171', marginBottom: '4px' }}>
                Mode Kontrol Manual Dimatikan
              </div>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.4 }}>
                Sistem membaca data langsung dari perangkat sensor fisik ESP32. Jika perangkat sedang tidak terhubung atau belum aktif, status pada web dan peta otomatis berubah menjadi <strong>Terputus (OFF) & 0 cm</strong>.
              </p>
            </div>
          )}

          {/* Opsi Terapkan ke Semua Sensor */}
          {allDevices.length > 1 && (
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              background: 'rgba(30, 41, 59, 0.4)',
              borderRadius: '8px',
              border: '1px solid #1e293b',
              fontSize: '0.75rem',
              color: '#cbd5e1',
              cursor: 'pointer',
              marginBottom: '14px'
            }}>
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#0284c7' }}
              />
              <span>Terapkan pengaturan ini ke <strong>semua ({allDevices.length}) titik sensor</strong> sekaligus</span>
            </label>
          )}

          {/* Feedback Banner */}
          {saveFeedback && (
            <div style={{
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '0.76rem',
              fontWeight: 700,
              background: saveFeedback.includes('⚠️') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)',
              color: saveFeedback.includes('⚠️') ? '#f87171' : '#22c55e',
              border: `1px solid ${saveFeedback.includes('⚠️') ? '#ef4444' : '#16a34a'}`,
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              animation: 'fadeIn 0.2s ease'
            }}>
              <span>{saveFeedback}</span>
            </div>
          )}

          {/* Catatan untuk Dosen & Presentasi */}
          <div style={{
            background: 'rgba(2, 132, 199, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '0.7rem',
            color: '#94a3b8',
            lineHeight: 1.4
          }}>
            <strong style={{ color: '#38bdf8' }}>💡 Informasi Sinkronisasi Real-Time:</strong>
            <br />
            Data tersinkronisasi langsung ke node Firebase RTDB (<code>/dashboard</code> &amp; <code>/measurements</code>). Panel anggota, dashboard publik, atau smartphone yang membuka web akan langsung melihat indikator angka, grafik, dan lingkaran banjir di peta berubah secara otomatis.
          </div>
        </div>

        {/* Footer Modal: Tombol Aksi */}
        <div className="manual-modal-footer">
          <button
            type="button"
            onClick={onClose}
            className="manual-btn-cancel"
            disabled={isSaving}
          >
            Tutup
          </button>

          {isManualOn && (
            <button
              type="button"
              onClick={() => handleSave(true)}
              className="manual-btn-off"
              disabled={isSaving}
              title="Matikan kontrol manual dan buat sensor menjadi Terputus (OFF)"
            >
              <Power size={13} /> Matikan (Set OFF)
            </button>
          )}

          <button
            type="button"
            onClick={() => handleSave(false)}
            className="manual-btn-save"
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <RefreshCw size={14} className="spin-icon" /> Menyimpan...
              </>
            ) : (
              <>
                <Database size={14} /> Terapkan ke Database
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Widget Kontrol Manual Inline di Sidebar Detail Perangkat
 * Tampil jika Admin sedang login di view === 'device-detail'
 */
export const DeviceDetailManualControlWidget = ({
  device,
  onSaveManual,
  isAdminUser = false
}) => {
  if (!isAdminUser || !device) return null;

  const [isManualOn, setIsManualOn] = useState(() => !!device.manual_control);
  const [level, setLevel] = useState(() => {
    const raw = Number(device.water_level);
    return Number.isFinite(raw) && raw > 0 ? Math.min(100, Math.max(0, Math.round(raw))) : 35;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    setIsManualOn(!!device.manual_control);
    const raw = Number(device.water_level);
    if (Number.isFinite(raw) && raw > 0) {
      setLevel(Math.min(100, Math.max(0, Math.round(raw))));
    }
  }, [device.id, device.manual_control, device.water_level]);

  const statusInfo = getWaterStatus(level);

  const handleApply = async (manualState, targetLevel) => {
    setIsSaving(true);
    setStatusMsg('');
    try {
      await onSaveManual(device.id, manualState, targetLevel);
      setStatusMsg(manualState ? `✅ Disimpan: ${targetLevel} cm` : '✅ Mode OFF Aktif');
      setTimeout(() => setStatusMsg(''), 2500);
    } catch (e) {
      setStatusMsg('⚠️ Gagal: ' + (e?.message || 'Error'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.9)',
      border: `1.5px solid ${isManualOn ? '#0284c7' : '#334155'}`,
      borderRadius: '12px',
      padding: '12px',
      marginBottom: '1.25rem',
      boxShadow: isManualOn ? '0 0 20px rgba(56, 189, 248, 0.15)' : 'none'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sliders size={15} color="#38bdf8" />
          <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#f8fafc' }}>
            Kontrol Manual Sensor (0 - 100 cm)
          </span>
        </div>
        <span style={{
          fontSize: '0.62rem',
          fontWeight: 800,
          background: isManualOn ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
          color: isManualOn ? '#22c55e' : '#ef4444',
          border: `1px solid ${isManualOn ? '#16a34a' : '#ef4444'}`,
          padding: '1px 6px',
          borderRadius: '4px'
        }}>
          {isManualOn ? 'MANUAL ON' : 'SENSOR OFF'}
        </span>
      </div>

      {/* Switch Toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        <button
          type="button"
          onClick={() => {
            setIsManualOn(true);
            handleApply(true, level);
          }}
          style={{
            flex: 1,
            padding: '5px 8px',
            borderRadius: '6px',
            fontSize: '0.72rem',
            fontWeight: 700,
            cursor: 'pointer',
            background: isManualOn ? '#0284c7' : 'rgba(30, 41, 59, 0.6)',
            color: isManualOn ? '#ffffff' : '#94a3b8',
            border: `1px solid ${isManualOn ? '#38bdf8' : '#334155'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px'
          }}
          disabled={isSaving}
        >
          <Power size={12} /> ON (Override)
        </button>
        <button
          type="button"
          onClick={() => {
            setIsManualOn(false);
            handleApply(false, 0);
          }}
          style={{
            flex: 1,
            padding: '5px 8px',
            borderRadius: '6px',
            fontSize: '0.72rem',
            fontWeight: 700,
            cursor: 'pointer',
            background: !isManualOn ? 'rgba(239, 68, 68, 0.25)' : 'rgba(30, 41, 59, 0.6)',
            color: !isManualOn ? '#f87171' : '#94a3b8',
            border: `1px solid ${!isManualOn ? '#ef4444' : '#334155'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px'
          }}
          disabled={isSaving}
        >
          <Power size={12} /> OFF (Fisik)
        </button>
      </div>

      {isManualOn && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Ketinggian:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <strong style={{ fontSize: '1rem', color: statusInfo.color }}>{level} cm</strong>
              <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: statusInfo.bg, color: statusInfo.color, border: `1px solid ${statusInfo.border}`, fontWeight: 700 }}>
                {statusInfo.label}
              </span>
            </div>
          </div>

          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            onMouseUp={() => handleApply(true, level)}
            onTouchEnd={() => handleApply(true, level)}
            style={{ width: '100%', accentColor: statusInfo.color, cursor: 'pointer', marginBottom: '8px' }}
          />

          {/* Preset Buttons */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
            {[
              { l: 5, label: '5cm' },
              { l: 20, label: '20cm' },
              { l: 40, label: '40cm' },
              { l: 65, label: '65cm' },
              { l: 85, label: '85cm' }
            ].map(p => (
              <button
                key={p.l}
                type="button"
                onClick={() => {
                  setLevel(p.l);
                  handleApply(true, p.l);
                }}
                style={{
                  flex: 1,
                  padding: '3px 0',
                  borderRadius: '4px',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: level === p.l ? 'rgba(56, 189, 248, 0.25)' : 'rgba(30, 41, 59, 0.6)',
                  border: `1px solid ${level === p.l ? '#38bdf8' : '#334155'}`,
                  color: level === p.l ? '#38bdf8' : '#cbd5e1'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}

      {statusMsg && (
        <div style={{ fontSize: '0.7rem', color: statusMsg.includes('⚠️') ? '#f87171' : '#22c55e', fontWeight: 700, textAlign: 'center' }}>
          {statusMsg}
        </div>
      )}
    </div>
  );
};
