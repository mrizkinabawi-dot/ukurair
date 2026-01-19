import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import {
  Activity, Database, AlertTriangle, Shield, Settings, LogOut, ChevronRight, BarChart3, Map, LayoutDashboard, Radio, RefreshCcw, ArrowLeft
} from 'lucide-react';
import './index.css';

// Flexible local detection
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocal ? 'http://localhost:5000/api' : 'https://ukurairpblrizki.vercel.app/api';

const App = () => {
  const [view, setView] = useState('dashboard'); // 'dashboard', 'admin', 'login', 'device-detail'
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')) || null);

  const [data, setData] = useState([]); // Latest measurements for all devices
  const [devices, setDevices] = useState([]); // Device list
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState({}); // Stores history for each device
  const [loading, setLoading] = useState(true);

  // Form states
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newGlobalKey, setNewGlobalKey] = useState('');

  // 1. Polling for Dashboard Data (Global)
  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch(`${API_BASE}/dashboard`);
      const json = await res.json();
      setData(json);
      setLoading(false);
    } catch (e) {
      console.error("Fetch Error:", e);
      setLoading(false);
    }
  };

  // 2. Admin Data
  const fetchAdminData = async () => {
    if (!token) return;
    try {
      const [devRes, setRes, statRes] = await Promise.all([
        fetch(`${API_BASE}/devices`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE}/settings`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_BASE}/admin/stats`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      const devJson = await devRes.json();
      const setJson = await setRes.json();
      const statJson = await statRes.json();

      setDevices(devJson);
      setNewGlobalKey(setJson.global_api_key);
      setStats(statJson);

      // Fetch history for all devices if in admin view
      if (view === 'admin') {
        devJson.forEach(device => fetchDeviceHistory(device.id));
      }
    } catch (e) {
      if (e?.status === 403 || e?.status === 401) handleLogout();
    }
  };

  const fetchDeviceHistory = async (deviceId) => {
    try {
      const res = await fetch(`${API_BASE}/devices/${deviceId}/history`);
      const json = await res.json();
      setChartData(prev => ({
        ...prev,
        [deviceId]: json.reverse().map(item => ({
          ...item,
          time: new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        }))
      }));
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (view === 'admin' && token) {
      fetchAdminData();
      const aInt = setInterval(fetchAdminData, 5000);
      return () => clearInterval(aInt);
    }
    if (view === 'device-detail' && selectedDevice) {
      fetchDeviceHistory(selectedDevice.id);
      const dInt = setInterval(() => fetchDeviceHistory(selectedDevice.id), 3000);
      return () => clearInterval(dInt);
    }
  }, [view, token, selectedDevice]);

  // Actions
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass })
      });
      if (res.status === 401) { setError('Username atau Password salah.'); return; }
      const json = await res.json();
      if (json.token) {
        setToken(json.token);
        setUser(json.user);
        localStorage.setItem('token', json.token);
        localStorage.setItem('user', JSON.stringify(json.user));
        setView('admin');
      }
    } catch (e) { setError('Koneksi gagal.'); }
  };

  const handleLogout = () => {
    setToken(''); setUser(null);
    localStorage.removeItem('token'); localStorage.removeItem('user');
    setView('dashboard');
  };

  const openDetail = (device) => {
    setSelectedDevice(device);
    setView('device-detail');
  };

  const StatusBadge = ({ status }) => (
    <span className={`card-status status-${(status || 'AMAN').toLowerCase()}`}>
      {status || 'AMAN'}
    </span>
  );

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo" onClick={() => setView('dashboard')} style={{ cursor: 'pointer' }}>
          <Radio size={24} color="var(--accent)" /> UKURAIR
        </div>
        <nav style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <button onClick={() => setView('dashboard')} className={`btn ${view === 'dashboard' || view === 'device-detail' ? 'active-nav' : ''}`} style={{ background: 'transparent', border: 'none', color: (view === 'dashboard' || view === 'device-detail') ? 'var(--accent)' : 'white' }}>
            Dashboard
          </button>
          {token ? (
            <button onClick={() => setView('admin')} className={`btn ${view === 'admin' ? 'active-nav' : ''}`} style={{ background: 'transparent', border: 'none', color: view === 'admin' ? 'var(--accent)' : 'white' }}>
              Admin Panel
            </button>
          ) : (
            <button onClick={() => setView('login')} className="btn" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>Login Admin</button>
          )}
          {token && <button onClick={handleLogout} className="btn" style={{ border: '1px solid var(--border)', fontSize: '0.75rem' }}>Logout</button>}
        </nav>
      </header>

      <main className="main-content">
        {/* --- VIEW: LOGIN --- */}
        {view === 'login' && !token && (
          <div className="login-container animate-fade-in">
            <div className="login-card">
              <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>Admin Access</h2>
              {error && <div className="error-msg">{error}</div>}
              <form onSubmit={handleLogin}>
                <div className="form-group"><label>Username</label><input value={loginUser} onChange={e => setLoginUser(e.target.value)} required /></div>
                <div className="form-group"><label>Password</label><input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} required /></div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px', marginTop: '1rem' }}>Login</button>
              </form>
            </div>
          </div>
        )}

        {/* --- VIEW: PUBLIC DASHBOARD --- */}
        {view === 'dashboard' && (
          <>
            <div style={{ marginBottom: '2.5rem' }}>
              <h1 style={{ fontSize: '2.5rem', fontWeight: 800 }}>Monitoring Air Real-time</h1>
              <p style={{ color: 'var(--text-secondary)' }}>Status ketinggian air di berbagai titik pantau wilayah. Klik kartu untuk detail grafik.</p>
            </div>
            {loading ? <p>Menghubungkan...</p> : (
              <div className="dashboard-grid">
                {data.map((device) => (
                  <div key={device.id} className="card animate-fade-in" onClick={() => openDetail(device)} style={{ cursor: 'pointer' }}>
                    <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      {device.name}
                      <ChevronRight size={16} color="var(--text-secondary)" />
                    </div>
                    <div className="card-value">{device.water_level || 0} <span style={{ fontSize: '1rem' }}>cm</span></div>
                    <div style={{ margin: '1rem 0' }}><StatusBadge status={device.status} /></div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Update: {device.created_at ? new Date(device.created_at).toLocaleTimeString() : '-'}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* --- VIEW: DEVICE DETAIL (CHART) --- */}
        {view === 'device-detail' && selectedDevice && (
          <div className="animate-fade-in">
            <button onClick={() => setView('dashboard')} className="btn" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <ArrowLeft size={16} /> Kembali ke Dashboard
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
              <div>
                <h1 style={{ fontSize: '3rem', fontWeight: 800 }}>{selectedDevice.name}</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Data fluktuasi ketinggian air dalam 24 jam terakhir.</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '4rem', fontWeight: 800, lineHeight: 1 }}>{data.find(d => d.id === selectedDevice.id)?.water_level || 0} <span style={{ fontSize: '1.5rem' }}>cm</span></div>
                <StatusBadge status={data.find(d => d.id === selectedDevice.id)?.status} />
              </div>
            </div>

            <div className="chart-container" style={{ height: '450px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData[selectedDevice.id] || []}>
                  <defs>
                    <linearGradient id="colorLevel" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: '#1e293b', border: 'none', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="water_level" stroke="var(--accent)" fill="url(#colorLevel)" strokeWidth={3} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* --- VIEW: ADMIN PANEL --- */}
        {view === 'admin' && token && (
          <div className="animate-fade-in">
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '2rem' }}>Administrative Panel</h1>
            <div className="metrics-grid">
              <div className="metric-card"><div className="metric-label">Unit Aktif</div><div className="metric-value">{stats?.total_devices || 0}</div></div>
              <div className="metric-card"><div className="metric-label">Total Transmisi</div><div className="metric-value">{stats?.total_measurements || 0}</div></div>
              <div className="metric-card"><div className="metric-label">Status Siaga/Darurat</div><div className="metric-value" style={{ color: 'var(--danger)' }}>{(stats?.status_counts?.find(s => s.status === 'DARURAT')?.count || 0) + (stats?.status_counts?.find(s => s.status === 'SIAGA')?.count || 0)}</div></div>
            </div>

            <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={20} color="var(--accent)" /> Monitoring Real-time Semua Titik</h2>
            <div className="dashboard-grid" style={{ marginBottom: '3rem' }}>
              {devices.map(device => (
                <div key={device.id} className="chart-container" style={{ height: '250px', padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{device.name}</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--accent)', fontWeight: 700 }}>{data.find(d => d.id === device.id)?.water_level || 0} cm</span>
                  </div>
                  <ResponsiveContainer width="100%" height="85%">
                    <AreaChart data={chartData[device.id] || []}>
                      <XAxis dataKey="time" hide /><YAxis domain={[0, 100]} hide />
                      <Area type="monotone" dataKey="water_level" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
