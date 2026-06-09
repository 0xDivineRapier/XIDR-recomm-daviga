// Admin SPA — React Router v6, JWT auth guard, sidebar navigation
const { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } = ReactRouterDOM;
const API_BASE = 'http://localhost:3001';

// ── Auth context ──────────────────────────────────────────────────────────────
const AuthContext = React.createContext(null);

function AuthProvider({ children }) {
  const [token, setToken] = React.useState(() => localStorage.getItem('xidr_admin_token'));
  const [role, setRole] = React.useState(() => localStorage.getItem('xidr_admin_role'));

  const login = (t, r) => {
    localStorage.setItem('xidr_admin_token', t);
    localStorage.setItem('xidr_admin_role', r);
    setToken(t); setRole(r);
  };
  const logout = () => {
    localStorage.removeItem('xidr_admin_token');
    localStorage.removeItem('xidr_admin_role');
    setToken(null); setRole(null);
  };

  return (
    <AuthContext.Provider value={{ token, role, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() { return React.useContext(AuthContext); }

// ── Login page ────────────────────────────────────────────────────────────────
function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Login failed');
      if (data.role !== 'admin') throw new Error('Access denied — admin only');
      login(data.token, data.role);
      navigate('/dashboard');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">X</span>
          </div>
          <h1 className="text-lg font-bold text-gray-800">XIDR Compliance Admin</h1>
        </div>
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Email</label>
            <input
              type="email" required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Password</label>
            <input
              type="password" required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Protected route ───────────────────────────────────────────────────────────
function RequireAuth({ children }) {
  const { token } = useAuth();
  if (!token) return React.createElement(Navigate, { to: '/login', replace: true });
  return children;
}

// ── Sidebar layout ────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/kyc', label: 'KYC Queue' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/reserves', label: 'Reserves' },
  { to: '/blocklist', label: 'Blocklist' },
];

function Layout({ children }) {
  const { logout, role } = useAuth();
  const activeClass = 'bg-blue-50 text-blue-700 font-semibold';
  const inactiveClass = 'text-gray-600 hover:bg-gray-100';

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-52 bg-white border-r border-gray-100 flex flex-col py-6 px-3 shrink-0">
        <div className="flex items-center gap-2 px-3 mb-8">
          <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-xs">X</span>
          </div>
          <span className="font-bold text-gray-800 text-sm">Compliance</span>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV_ITEMS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? activeClass : inactiveClass}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 mt-4 space-y-1">
          <p className="text-xs text-gray-300 uppercase tracking-wide px-0 mb-2">{role}</p>
          <button
            onClick={logout}
            className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={React.createElement(LoginPage)} />
      <Route
        path="/*"
        element={
          React.createElement(RequireAuth, null,
            React.createElement(Layout, null,
              React.createElement(Routes, null,
                React.createElement(Route, { path: '/dashboard', element: React.createElement(Dashboard, { token }) }),
                React.createElement(Route, { path: '/kyc', element: React.createElement(KycQueue, { token }) }),
                React.createElement(Route, { path: '/transactions', element: React.createElement(Transactions, { token }) }),
                React.createElement(Route, { path: '/alerts', element: React.createElement(Alerts, { token }) }),
                React.createElement(Route, { path: '/reserves', element: React.createElement(ReserveManagement, { token }) }),
                React.createElement(Route, { path: '/blocklist', element: React.createElement(Blocklist, { token }) }),
                React.createElement(Route, { path: '/', element: React.createElement(Navigate, { to: '/dashboard', replace: true }) }),
              )
            )
          )
        }
      />
    </Routes>
  );
}
