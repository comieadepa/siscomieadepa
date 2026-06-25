export type EquipeSession = {
  eventoId: string;
  equipeId: string;
  tipo: 'operador' | 'checkin' | 'checkin_refeitorio' | 'hospedagem' | 'checkin_hospedagem';
  expiraEm: string;
  /** E-mail do operador que autenticou (disponível quando login por e-mail) */
  email?: string;
  /** Nome do operador (se cadastrado na equipe) */
  nome?: string;
};

const STORAGE_KEY = 'evento_equipe_session';

export function setEquipeSession(session: EquipeSession) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getEquipeSession(): EquipeSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      eventoId?: string;
      equipeId?: string;
      tipo?: string;
      expiraEm?: string;
      email?: string;
      nome?: string;
    };
    if (parsed.tipo === 'admin') parsed.tipo = 'operador';
    if (!parsed?.eventoId || !parsed?.equipeId || !parsed?.tipo || !parsed?.expiraEm) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    if (!['operador', 'checkin', 'checkin_refeitorio', 'hospedagem', 'checkin_hospedagem'].includes(parsed.tipo)) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const expiraMs = Date.parse(parsed.expiraEm);
    if (!expiraMs || expiraMs < Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed as EquipeSession;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearEquipeSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
