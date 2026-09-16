/**
 * Meu Perfil de Viés — free-tier local telemetry (spec §2 sidebar, §7 LGPD).
 *
 * Privacy contract, non-negotiable: everything lives in THIS browser's
 * localStorage. Nothing is sent to the server, ever; there is no account,
 * no cookie, no pseudonymous ID. Opt-in, and deletable in one click.
 * (The paid tier's richer, account-linked profile is a post-launch product
 * decision — §7's split-identity rules apply there, not here.)
 */
export const PERFIL_KEY = "pc.perfil.v1";

export type PerfilEvent = { b: string; t: number; id?: number };
export type PerfilState = { on: boolean; events: PerfilEvent[] };

const MAX_EVENTS = 1000;

export function loadPerfil(): PerfilState {
  if (typeof window === "undefined") return { on: false, events: [] };
  try {
    const raw = window.localStorage.getItem(PERFIL_KEY);
    if (!raw) return { on: false, events: [] };
    const parsed = JSON.parse(raw) as PerfilState;
    if (typeof parsed?.on !== "boolean" || !Array.isArray(parsed?.events)) {
      return { on: false, events: [] };
    }
    return parsed;
  } catch {
    return { on: false, events: [] };
  }
}

export function savePerfil(state: PerfilState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PERFIL_KEY, JSON.stringify(state));
  } catch {
    // Quota/private-mode failures are silent by design — the profile is a
    // convenience, never a dependency.
  }
}

/**
 * Called when the reader continues to a source. NC/unclassified is not
 * consumption of a side, and re-opening the same article never counts twice —
 * the meter measures breadth of reading, not repeat clicks.
 */
export function recordReading(articleId: number, band: string | null): void {
  if (!band || band === "NC") return;
  const state = loadPerfil();
  if (!state.on) return;
  if (state.events.some((e) => e.id === articleId)) return;
  state.events.push({ b: band, t: Date.now(), id: articleId });
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
  savePerfil(state);
}

export type PerfilSummary = {
  esquerda: number;
  centro: number;
  direita: number;
  total: number;
};

/** Aggregates the trailing N days of reading events by side. */
export function summarize(events: PerfilEvent[], days: number): PerfilSummary {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const s: PerfilSummary = { esquerda: 0, centro: 0, direita: 0, total: 0 };
  for (const e of events) {
    if (e.t < cutoff) continue;
    if (e.b.startsWith("E")) s.esquerda++;
    else if (e.b.startsWith("D")) s.direita++;
    else if (e.b === "C") s.centro++;
    else continue;
    s.total++;
  }
  return s;
}
