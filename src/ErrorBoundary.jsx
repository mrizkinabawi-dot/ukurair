import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
    try {
      sessionStorage.setItem('last_app_error', JSON.stringify({
        message: error?.message || String(error),
        stack: error?.stack || '',
        time: new Date().toISOString()
      }));
    } catch (e) {}
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    try {
      sessionStorage.clear();
    } catch (e) {}
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          color: '#f8fafc',
          padding: '20px',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <div style={{
            background: '#1e293b',
            border: '1px solid #ef4444',
            borderRadius: '16px',
            padding: '28px',
            maxWidth: '560px',
            width: '100%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontSize: '20px', fontWeight: 'bold' }}>
                ⚠️
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#f8fafc' }}>Terjadi Kendala pada Halaman</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Sistem menangkap kesalahan tampilan otomatis</p>
              </div>
            </div>

            <div style={{ background: '#0b1120', border: '1px solid #334155', borderRadius: '8px', padding: '12px 14px', fontSize: '0.8rem', color: '#fca5a5', fontFamily: 'monospace', marginBottom: '20px', wordBreak: 'break-word', maxHeight: '160px', overflowY: 'auto' }}>
              {this.state.error?.message || 'Terjadi kesalahan saat memuat komponen.'}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid #38bdf8',
                  background: 'rgba(56, 189, 248, 0.1)',
                  color: '#38bdf8',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Muat Ulang Halaman
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#38bdf8',
                  color: '#0f172a',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Kembali ke Beranda
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;

