import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { LangProvider } from './i18n';
import { AccountProvider } from './account';
import { AccountPage } from './pages/AccountPage';
import { GuidePage } from './pages/GuidePage';
import { MatchDetail } from './pages/MatchDetail';
import { MatchList } from './pages/MatchList';
import { PlayerShell } from './pages/PlayerShell';
import { MePage, PlayersPage } from './pages/Players';
import { ProfileHome } from './pages/ProfileHome';
import { Records } from './pages/Records';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <AccountProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<MePage />} />
            <Route path="matches" element={<MatchList />} />
            <Route path="matches/:id" element={<MatchDetail />} />
            <Route path="players" element={<PlayersPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="guide" element={<GuidePage />} />
            <Route path="players/:uuid" element={<PlayerShell />}>
              <Route index element={<ProfileHome />} />
              <Route path="records" element={<Records />} />
              <Route path="records/:matchId" element={<Records />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
      </AccountProvider>
    </LangProvider>
  </StrictMode>,
);
