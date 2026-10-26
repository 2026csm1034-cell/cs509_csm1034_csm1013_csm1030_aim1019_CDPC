import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import FacultyDashboard from './pages/faculty/FacultyDashboard.jsx';
import HodDashboard from './pages/hod/HodDashboard.jsx';
import ArDashboard from './pages/accounts/ArDashboard.jsx';
import JuniorDashboard from './pages/accounts/JuniorDashboard.jsx';
import RegistrarDashboard from './pages/approvers/RegistrarDashboard.jsx';
import DeanDashboard from './pages/approvers/DeanDashboard.jsx';
import DirectorDashboard from './pages/approvers/DirectorDashboard.jsx';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import ASectionDashboard from './pages/asection/ASectionDashboard.jsx';
import ClaimForm from './pages/ClaimForm.jsx';
import ClaimDetail from './pages/ClaimDetail.jsx';
import { MyClaims, AllClaims } from './pages/ClaimLists.jsx';
import Ledger from './pages/Ledger.jsx';
import Accounts from './pages/Accounts.jsx';
import Analytics from './pages/Analytics.jsx';
import ProrataPage from './pages/ProrataPage.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const HOME = {
  FACULTY: FacultyDashboard, HOD: HodDashboard, ACCOUNTS_AR: ArDashboard, ACCOUNTS_JUNIOR: JuniorDashboard,
  REGISTRAR: RegistrarDashboard, DEAN_FAA: DeanDashboard, DIRECTOR: DirectorDashboard, ADMIN: AdminDashboard, A_SECTION: ASectionDashboard,
};

function Home() {
  const { user } = useAuth();
  const C = HOME[user.role];
  return <C />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null)).finally(() => setReady(true));
  }, []);

  const login = async (email, password) => {
    const d = await api('/auth/login', { method: 'POST', body: { email, password } });
    setUser(d.user);
  };
  const googleLogin = useCallback(async (credential) => {
    const d = await api('/auth/google', { method: 'POST', body: { credential } });
    setUser(d.user);
  }, []);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); };

  if (!ready) return <p style={{ padding: 24 }}>Loading...</p>;
  return (
    <AuthCtx.Provider value={{ user, login, googleLogin, logout }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route element={user ? <Layout /> : <Navigate to="/login" />}>
          <Route index element={user && <Home />} />
          <Route path="claims" element={<MyClaims />} />
          <Route path="claims/new" element={<ClaimForm />} />
          <Route path="claims/:id/edit" element={<ClaimForm />} />
          <Route path="claims/:id" element={<ClaimDetail />} />
          <Route path="all-claims" element={<AllClaims />} />
          <Route path="ledger" element={<Ledger />} />
          <Route path="ledger/:id" element={<Ledger />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="prorata" element={<ProrataPage />} />
          <Route path="admin" element={user && ['ADMIN', 'ACCOUNTS_AR'].includes(user.role) ? <AdminDashboard /> : <Navigate to="/" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AuthCtx.Provider>
  );
}
