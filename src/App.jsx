import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import {
  Activity, Database, AlertTriangle, Shield, Settings, LogOut, ChevronRight, BarChart3, Map, LayoutDashboard, Radio, RefreshCcw, ArrowLeft
} from 'lucide-react';
import { auth, db } from './firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import {
  ref,
  onValue,
  set,
  push,
  remove,
  query,
  limitToLast,
  get
} from "firebase/database";
import './index.css';

const App = () => {
  const [view, setView] = useState('dashboard'); // 'dashboard', 'admin', 'login', 'device-detail'
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [user, setUser] = useState(null);

  const [data, setData] = useState([]); // Latest measurements from /dashboard
  const [devices, setDevices] = useState([]); // Device list from /devices
  const [stats, setStats] = useState({ total_devices: 0, total_measurements: 0, critical_count: 0, avg_level: 0 });
  const [chartData, setChartData] = useState({}); // Stores history for each device
  const [loading, setLoading] = useState(true);

  // Login states
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [error, setError] = useState('');

  // Form states
  const [newName, setNewName] = useState('');
  const [newSecretKey, setNewSecretKey] = useState('');
  const [newGlobalKey, setNewGlobalKey] = useState('');

  // 1. Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u && view === 'admin') setView('login');
      setLoading(false);
    });
    return () => unsubscribe();
  }, [view]);

  // 2. Real-time Dashboard Listener
  useEffect(() => {
    const dashboardRef = ref(db, 'dashboard');
    const unsubscribe = onValue(dashboardRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        const list = Object.keys(val)
          .map(key => ({
            id: key,
            ...val[key]
          }))
          .filter(d => d.name); // Hanya tampilkan yang punya nama (menghindari ghost devices)
        setData(list);
      } else {
        setData([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // 3. Admin Data Listeners (Devices, Settings, Stats)
  useEffect(() => {
    if (user && view === 'admin') {
      // Listen to Devices
      const devicesRef = ref(db, 'devices');
      const devUnsub = onValue(devicesRef, (snapshot) => {
        const val = snapshot.val();
        if (val) {
          const list = Object.keys(val).map(key => ({
            id: key,
            ...val[key]
          }));
          setDevices(list);
          // Fetch history for each device for charts
          list.forEach(d => listenToDeviceHistory(d.id));
        } else {
          setDevices([]);
        }
      });

      // Listen to Settings
      const settingsRef = ref(db, 'settings');
      const setUnsub = onValue(settingsRef, (snapshot) => {
        const val = snapshot.val();
        if (val) setNewGlobalKey(val.global_api_key || '');
      });

      return () => { devUnsub(); setUnsub(); };
    }
  }, [user, view]);

  const listenToDeviceHistory = (deviceId) => {
    const historyRef = query(ref(db, `measurements/${deviceId}`), limitToLast(50));
    onValue(historyRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        const list = Object.keys(val).map(key => ({
          ...val[key],
          time: new Date(val[key].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        })).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        setChartData(prev => ({ ...prev, [deviceId]: list }));
      }
    });
  };

  // Special listener for detail view
  useEffect(() => {
    if (view === 'device-detail' && selectedDevice) {
      listenToDeviceHistory(selectedDevice.id);
    }
  }, [view, selectedDevice]);

  // Auth Actions
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      // Firebase uses email, we'll assume the user uses an email like admin@ukurair.com
      // or we can just ask the user to create an account in Firebase Console.
      await signInWithEmailAndPassword(auth, loginEmail, loginPass);
      setView('admin');
    } catch (e) {
      setError('Login gagal. Periksa Email/Password.');
    }
  };

  const handleAddDevice = async (e) => {
    e.preventDefault();
    if (!newSecretKey) return alert('Silakan isi atau generate token!');
    try {
      const devicesRef = ref(db, 'devices');
      const newDevRef = push(devicesRef);
      await set(newDevRef, {
        name: newName,
        secret_key: newSecretKey,
        created_at: new Date().toISOString()
      });
      // Also init dashboard
      await set(ref(db, `dashboard/${newDevRef.key}`), {
        name: newName,
        secret_key: newSecretKey,
        water_level: 0,
        status: 'AMAN',
        created_at: new Date().toISOString()
      });
      setNewName('');
      setNewSecretKey('');
    } catch (e) { console.error(e); }
  };

  const generateToken = () => {
    const key = Math.random().toString(36).substring(2, 10).toUpperCase();
    setNewSecretKey(key);
  };

  const handleLogout = async () => {
    await signOut(auth);
    setView('dashboard');
  };

  const handleDeleteDevice = async (id) => {
    if (!confirm('Hapus alat ini?')) return;
    try {
      await remove(ref(db, `devices/${id}`));
      await remove(ref(db, `dashboard/${id}`));
      await remove(ref(db, `measurements/${id}`));
    } catch (e) { console.error(e); }
  };

  const handleResetToken = async (id) => {
    if (!confirm('Ganti token rahasia untuk alat ini? ESP32 harus diupdate dengan token baru.')) return;
    try {
      const newKey = Math.random().toString(36).substring(2, 10).toUpperCase();
      await set(ref(db, `devices/${id}/secret_key`), newKey);
      await set(ref(db, `dashboard/${id}/secret_key`), newKey);
      alert('Token baru: ' + newKey);
    } catch (e) { console.error(e); }
  };

  const handleUpdateSettings = async (e) => {
    e.preventDefault();
    try {
      await set(ref(db, 'settings'), { global_api_key: newGlobalKey });
      alert('Key sinkron!');
    } catch (e) { console.error(e); }
  };

  const StatusBadge = ({ status }) => (
    <span className={`card-status status-${(status || 'AMAN').toLowerCase()}`}>
      {status || 'AMAN'}
    </span>
  );

  if (loading) return <div className="app-container"><p>Initializing Firebase...</p></div>;

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
          {user ? (
            <button onClick={() => setView('admin')} className={`btn ${view === 'admin' ? 'active-nav' : ''}`} style={{ background: 'transparent', border: 'none', color: view === 'admin' ? 'var(--accent)' : 'white' }}>
              Admin Panel
            </button>
          ) : (
            <button onClick={() => setView('login')} className="btn" style={{ border: '1px solid var(--accent)', color: 'var(--accent)' }}>Login Admin</button>
          )}
          {user && <button onClick={handleLogout} className="btn" style={{ border: '1px solid var(--border)', fontSize: '0.75rem' }}>Logout</button>}
        </nav>
      </header>

      <main className="main-content">
        {/* --- VIEW: LOGIN --- */}
        {view === 'login' && !user && (
          <div className="login-container animate-fade-in">
            <div className="login-card">
              <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>Firebase Admin</h2>
              {error && <div className="error-msg" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}
              <form onSubmit={handleLogin}>
                <div className="form-group"><label>Email</label><input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="admin@ukurair.com" required /></div>
                <div className="form-group"><label>Password</label><input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} required /></div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px', marginTop: '1rem' }}>Login</button>
              </form>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '1rem', textAlign: 'center' }}>Pastikan akun email sudah terdaftar di Firebase Console Auth.</p>
            </div>
          </div>
        )}

        {/* --- VIEW: PUBLIC DASHBOARD --- */}
        {view === 'dashboard' && (
          <>
            <div style={{ marginBottom: '2.5rem' }}>
              <h1 style={{ fontSize: '2.5rem', fontWeight: 800 }}>Monitoring Air (Firebase)</h1>
              <p style={{ color: 'var(--text-secondary)' }}>Data real-time disinkronkan langsung dari satelit Firebase.</p>
            </div>
            <div className="dashboard-grid">
              {data.map((device) => (
                <div key={device.id} className="card animate-fade-in" onClick={() => { setSelectedDevice(device); setView('device-detail'); }} style={{ cursor: 'pointer' }}>
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
          </>
        )}

        {/* --- VIEW: DEVICE DETAIL (CHART) --- */}
        {view === 'device-detail' && selectedDevice && (
          <div className="animate-fade-in">
            <button onClick={() => setView('dashboard')} className="btn" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <ArrowLeft size={16} /> Dashboard Utama
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
              <div>
                <h1 style={{ fontSize: '3rem', fontWeight: 800 }}>{selectedDevice.name}</h1>
                <StatusBadge status={data.find(d => d.id === selectedDevice.id)?.status} />
              </div>
            </div>

            <div className="chart-container" style={{ height: '450px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData[selectedDevice.id] || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                  <YAxis stroke="#94a3b8" fontSize={10} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: '#1e293b', border: 'none' }} />
                  <Area type="monotone" dataKey="water_level" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.1} strokeWidth={3} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* --- VIEW: ADMIN PANEL --- */}
        {view === 'admin' && user && (
          <div className="animate-fade-in">
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '2rem' }}>Admin Control Panel</h1>

            <div className="admin-panel">
              <div style={{ flex: 1 }}>
                <div className="admin-table-container">
                  <table>
                    <thead><tr><th>ID Alat (Arduino)</th><th>Wilayah</th><th>Secret Token</th><th>Aksi</th></tr></thead>
                    <tbody>
                      {devices.map(d => (
                        <tr key={d.id}>
                          <td style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)' }}>{d.id}</td>
                          <td style={{ fontWeight: 600 }}>{d.name}</td>
                          <td>
                            <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', color: 'var(--accent)' }}>
                              {d.secret_key || 'NO_TOKEN'}
                            </code>
                          </td>
                          <td style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn" style={{ border: '1px solid var(--border)', fontSize: '0.7rem' }} onClick={() => handleResetToken(d.id)}>Reset</button>
                            <button className="btn btn-danger" onClick={() => handleDeleteDevice(d.id)}>Hapus</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ width: '300px' }}>
                <div className="metric-card" style={{ marginBottom: '1rem' }}>
                  <h4 style={{ marginBottom: '1rem' }}>Global Sync</h4>
                  <form onSubmit={handleUpdateSettings}>
                    <div className="form-group"><label>API Key ESP32</label><input value={newGlobalKey} onChange={e => setNewGlobalKey(e.target.value)} /></div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Simpan</button>
                  </form>
                </div>
                <div className="metric-card">
                  <h4 style={{ marginBottom: '1rem' }}>Tambah Alat</h4>
                  <form onSubmit={handleAddDevice}>
                    <div className="form-group">
                      <label>Nama Wilayah</label>
                      <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Contoh: Pintu Air B" required />
                    </div>
                    <div className="form-group">
                      <label>Secret Token (API Key)</label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                          value={newSecretKey}
                          onChange={e => setNewSecretKey(e.target.value)}
                          placeholder="8 Karakter"
                          required
                        />
                        <button type="button" onClick={generateToken} className="btn" style={{ padding: '0 10px', fontSize: '0.7rem', border: '1px solid var(--accent)', color: 'var(--accent)' }}>GEN</button>
                      </div>
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Daftar Alat Baru</button>
                  </form>
                </div>
              </div>
            </div>

            <div className="dashboard-grid" style={{ marginTop: '3rem' }}>
              {devices.map(device => (
                <div key={device.id} className="chart-container" style={{ height: '200px' }}>
                  <p style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>{device.name}</p>
                  <ResponsiveContainer width="100%" height="80%">
                    <AreaChart data={chartData[device.id] || []}>
                      <Area type="monotone" dataKey="water_level" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.05} strokeWidth={2} isAnimationActive={false} />
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
