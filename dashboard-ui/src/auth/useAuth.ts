import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  patientContext: string | null;
  setTokens: (tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    patientContext?: string;
  }) => void;
  clear: () => void;
  isAuthenticated: () => boolean;
}

// sessionStorage (not localStorage) — tokens cleared on tab close.
// Pragmatic compromise: the access token is in memory + sessionStorage,
// the refresh token rides along; documented as a tradeoff in
// PATIENT_DASHBOARD_MIGRATION.md. A production deployment would use
// silent renewal via an iframe + httpOnly cookies for the refresh token.
export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      patientContext: null,
      setTokens: ({ accessToken, refreshToken, expiresIn, patientContext }) =>
        set({
          accessToken,
          refreshToken: refreshToken ?? get().refreshToken,
          expiresAt: Date.now() + expiresIn * 1000,
          patientContext: patientContext ?? get().patientContext,
        }),
      clear: () =>
        set({ accessToken: null, refreshToken: null, expiresAt: null, patientContext: null }),
      isAuthenticated: () => {
        const { accessToken, expiresAt } = get();
        return !!accessToken && !!expiresAt && expiresAt > Date.now();
      },
    }),
    {
      name: 'oe-dashboard-auth',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
