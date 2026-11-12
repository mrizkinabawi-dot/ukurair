import React, { useState } from 'react';
import {
  QrCode, X, ExternalLink, Copy, Check, Download, Smartphone, Sparkles, Radio, Share2, HelpCircle, Clock
} from 'lucide-react';

export const QrCodeDemoModal = ({
  isOpen,
  onClose,
  devices = [],
  activeDevice = null,
  onSelectDevice = null
}) => {
  const [activeTab, setActiveTab] = useState('web'); // 'web' | 'device' | 'guide'
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    return activeDevice?.id || (devices[0]?.id) || '';
  });
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Tentukan URL web publik saat ini
  const originUrl = typeof window !== 'undefined'
    ? (window.location.origin.includes('localhost') ? 'https://ukurair.vercel.app' : window.location.origin)
    : 'https://ukurair.vercel.app';

  // URL Web Utama
  const webUrl = originUrl;

  // URL Spesifik Perangkat Titik Sensor
  const currentDevice = devices.find(d => d.id === selectedDeviceId) || devices[0] || null;
  const deviceUrl = currentDevice
    ? `${originUrl}/?device=${encodeURIComponent(currentDevice.id)}`
    : originUrl;

  const currentQrUrl = activeTab === 'web'
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=15&format=png&data=${encodeURIComponent(webUrl)}`
    : `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=15&format=png&data=${encodeURIComponent(deviceUrl)}`;

  const currentUrlToCopy = activeTab === 'web' ? webUrl : deviceUrl;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrlToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      alert('Gagal menyalin link: ' + currentUrlToCopy);
    }
  };

  const handleDownloadQr = () => {
    const link = document.createElement('a');
    link.href = currentQrUrl;
    link.target = '_blank';
    link.download = activeTab === 'web'
      ? 'QR-Code-UkurAir-Web.png'
      : `QR-Stiker-IoT-${currentDevice?.id || 'alat'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div
        className="animate-fade-in"
        style={{
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '560px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
          overflow: 'hidden',
          color: '#f8fafc'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #334155',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(15, 23, 42, 0.6)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'rgba(56, 189, 248, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.3)'
            }}>
              <Share2 size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>
                Bagikan Website (Kode QR)
              </h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8' }}>
                Pindai kode QR untuk membuka website secara instan di smartphone
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Tutup"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigasi */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #334155',
          background: '#0f172a',
          padding: '4px 12px 0 12px',
          gap: '4px'
        }}>
          <button
            onClick={() => setActiveTab('web')}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: activeTab === 'web' ? '#1e293b' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'web' ? '2px solid #38bdf8' : '2px solid transparent',
              color: activeTab === 'web' ? '#38bdf8' : '#94a3b8',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              borderRadius: '6px 6px 0 0',
              transition: 'all 0.15s'
            }}
          >
            <Smartphone size={15} /> 1. Bagikan Web
          </button>

          <button
            onClick={() => setActiveTab('device')}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: activeTab === 'device' ? '#1e293b' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'device' ? '2px solid #38bdf8' : '2px solid transparent',
              color: activeTab === 'device' ? '#38bdf8' : '#94a3b8',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              borderRadius: '6px 6px 0 0',
              transition: 'all 0.15s'
            }}
          >
            <Radio size={15} /> 2. Stiker Lokasi
            <span style={{ fontSize: '0.62rem', background: 'rgba(234, 179, 8, 0.2)', color: '#facc15', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
              Soon
            </span>
          </button>

          <button
            onClick={() => setActiveTab('guide')}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: activeTab === 'guide' ? '#1e293b' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'guide' ? '2px solid #38bdf8' : '2px solid transparent',
              color: activeTab === 'guide' ? '#38bdf8' : '#94a3b8',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              borderRadius: '6px 6px 0 0',
              transition: 'all 0.15s'
            }}
          >
            <HelpCircle size={15} /> 3. Panduan Penggunaan
          </button>
        </div>

        {/* Konten Tab */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'web' && (
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: '0 0 16px 0', fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                Arahkan <b>kamera smartphone</b> ke kode QR berikut untuk langsung membuka website pemantau banjir tanpa perlu mengetik alamat tautan:
              </p>

              {/* Box Frame QR Code */}
              <div style={{
                display: 'inline-block',
                background: '#ffffff',
                padding: '14px',
                borderRadius: '16px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                marginBottom: '16px'
              }}>
                <img
                  src={currentQrUrl}
                  alt="QR Code Dashboard UkurAir"
                  style={{ width: '220px', height: '220px', display: 'block', borderRadius: '8px' }}
                />
              </div>

              {/* URL Display */}
              <div style={{
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px'
              }}>
                <code style={{ fontSize: '0.78rem', color: '#38bdf8', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                  {webUrl}
                </code>
                <div style={{ display: 'flex', gap: '6px', marginLeft: '8px' }}>
                  <button
                    onClick={handleCopyLink}
                    className="btn"
                    style={{ fontSize: '0.7rem', padding: '4px 10px', border: '1px solid #334155', color: copied ? '#22c55e' : '#cbd5e1' }}
                    title="Salin Link Website"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Tersalin' : 'Salin'}
                  </button>
                  <a
                    href={webUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn"
                    style={{ fontSize: '0.7rem', padding: '4px 10px', border: '1px solid #38bdf8', color: '#38bdf8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    title="Buka link di tab baru"
                  >
                    <ExternalLink size={12} /> Buka
                  </a>
                </div>
              </div>

              {/* Tombol Unduh QR */}
              <button
                onClick={handleDownloadQr}
                className="btn btn-primary"
                style={{ width: '100%', fontSize: '0.85rem', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', borderRadius: '8px' }}
              >
                <Download size={16} /> Unduh Gambar Kode QR
              </button>
            </div>
          )}

          {activeTab === 'device' && (
            <div>
              {/* Badge Coming Soon */}
              <div style={{
                textAlign: 'center',
                background: 'rgba(234, 179, 8, 0.08)',
                border: '1px solid rgba(234, 179, 8, 0.25)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '16px'
              }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(234, 179, 8, 0.2)', color: '#facc15', padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700, marginBottom: '8px' }}>
                  <Clock size={14} /> Fitur Segera Hadir (Coming Soon)
                </div>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.95rem', color: '#f8fafc' }}>
                  Integrasi Kode QR Stiker Fisik Tiang Sensor
                </h4>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                  Fitur ini dirancang untuk mencetak stiker akrilik / barcode fisik pada tiang sensor di sungai atau jalan. Masyarakat di lokasi dapat memindai stiker untuk langsung membuka status titik pantau tersebut.
                </p>
              </div>

              {/* Pilihan Perangkat Preview */}
              <div style={{ marginBottom: '14px', opacity: 0.85 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                  Pratinjau Titik Sensor:
                </label>
                <select
                  value={selectedDeviceId}
                  onChange={e => setSelectedDeviceId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '0.82rem'
                  }}
                >
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name || d.id} ({d.id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Mockup Stiker Fisik IoT Casing */}
              <div style={{
                border: '2px dashed rgba(56, 189, 248, 0.4)',
                borderRadius: '12px',
                padding: '16px',
                background: '#0b1120',
                textAlign: 'center',
                marginBottom: '16px',
                position: 'relative'
              }}>
                <div style={{ fontSize: '0.72rem', letterSpacing: '0.1em', fontWeight: 800, color: '#38bdf8', marginBottom: '2px' }}>
                  SISTEM DETEKSI DINI BANJIR
                </div>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: '10px' }}>
                  PINDAI KODE QR UNTUK CEK KETINGGIAN AIR TITIK INI
                </div>

                <div style={{
                  display: 'inline-block',
                  background: '#ffffff',
                  padding: '10px',
                  borderRadius: '12px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  marginBottom: '10px'
                }}>
                  <img
                    src={currentQrUrl}
                    alt="Stiker QR Titik Sensor"
                    style={{ width: '150px', height: '150px', display: 'block', borderRadius: '6px' }}
                  />
                </div>

                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f8fafc' }}>
                  📍 {currentDevice?.name || 'Titik Sensor'}
                </div>
                <div style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#94a3b8' }}>
                  ID Perangkat: {currentDevice?.id}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleDownloadQr}
                  className="btn btn-primary"
                  style={{ flex: 1, fontSize: '0.8rem', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <Download size={14} /> Unduh Pratinjau Stiker
                </button>
                <button
                  onClick={handleCopyLink}
                  className="btn"
                  style={{ fontSize: '0.8rem', padding: '8px 14px', border: '1px solid #334155', color: copied ? '#22c55e' : '#cbd5e1' }}
                >
                  {copied ? 'Tersalin!' : 'Salin URL'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'guide' && (
            <div style={{ fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.6 }}>
              <h4 style={{ margin: '0 0 12px 0', color: '#38bdf8', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <HelpCircle size={17} /> Cara Menggunakan Fitur Berbagi via Kode QR:
              </h4>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ background: '#0f172a', padding: '12px 14px', borderRadius: '10px', borderLeft: '3px solid #38bdf8' }}>
                  <b style={{ color: '#f8fafc', display: 'block', marginBottom: '3px' }}>1. Buka Kamera di Smartphone</b>
                  Buka aplikasi kamera bawaan pada HP Android atau iPhone Anda (tidak membutuhkan instalasi aplikasi pemindai tambahan).
                </div>

                <div style={{ background: '#0f172a', padding: '12px 14px', borderRadius: '10px', borderLeft: '3px solid #10b981' }}>
                  <b style={{ color: '#f8fafc', display: 'block', marginBottom: '3px' }}>2. Arahkan Lensa Kamera ke Kode QR</b>
                  Arahkan kamera HP ke gambar kode QR di layar laptop, proyektor, atau stiker pemantauan hingga muncul notifikasi tautan website.
                </div>

                <div style={{ background: '#0f172a', padding: '12px 14px', borderRadius: '10px', borderLeft: '3px solid #facc15' }}>
                  <b style={{ color: '#f8fafc', display: 'block', marginBottom: '3px' }}>3. Buka &amp; Pantau Informasi Banjir Real-Time</b>
                  Ketuk notifikasi tautan yang muncul untuk langsung membuka peta pemantauan banjir, grafik ketinggian air, dan peringatan dini secara interaktif.
                </div>
              </div>

              <div style={{ marginTop: '14px', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '12px 14px', borderRadius: '10px', fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                💡 <b>Keunggulan Fitur:</b> Mempermudah pengguna dan masyarakat mengakses sistem pemantau banjir secara cepat tanpa perlu mengetik alamat URL yang panjang atau mengunduh aplikasi tambahan.
              </div>
            </div>
          )}
        </div>

        {/* Footer Modal */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #334155',
          background: 'rgba(15, 23, 42, 0.6)',
          display: 'flex',
          justifyContent: 'flex-end'
        }}>
          <button
            onClick={onClose}
            className="btn"
            style={{ fontSize: '0.8rem', padding: '6px 16px', border: '1px solid #334155', color: '#cbd5e1' }}
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
