/**
 * VAULTRY agent store — CLIENT-SIDE ONLY, device-local.
 *
 * - Activity log: every agent cycle recorded (planned / checked / proposed /
 *   executed / blocked) with timestamps. NEVER contains secrets — only
 *   intents, verdicts, policy results, and tx hashes.
 * - Kill switches: { enabled, paused } — the executor checks these BEFORE
 *   every action. The Policy Console emergency pause is ALSO honored.
 * - Automation rules: user-defined monitoring rules. Rules can only create
 *   SUGGESTIONS — they can never auto-execute (no silent execution, ever).
 */

export type LogKind = "planned" | "checked" | "proposed" | "executed" | "blocked" | "note";

export interface AgentLogEntry {
  id: string;
  ts: string; // ISO
  kind: LogKind;
  title: string;
  detail: string;
}

export interface AgentState {
  /** master kill switch — false = the agent does nothing at all */
  enabled: boolean;
  /** soft pause — agent answers questions but prepares nothing */
  paused: boolean;
}

export interface AutomationRule {
  id: string;
  name: string;
  /** e.g. "balance_watch" | "rate_watch" */
  kind: "balance_watch" | "rate_watch";
  params: Record<string, string>;
  createdAt: string;
}

const LOG_KEY = "vaultry.agent.log.v1";
const STATE_KEY = "vaultry.agent.state.v1";
const RULES_KEY = "vaultry.agent.rules.v1";
const MAX_LOG = 200;

function isBrowser(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- activity log ---------------- */

export function appendAgentLog(kind: LogKind, title: string, detail: string): void {
  if (!isBrowser()) return;
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    const list: AgentLogEntry[] = raw ? (JSON.parse(raw) as AgentLogEntry[]) : [];
    list.unshift({ id: uid(), ts: new Date().toISOString(), kind, title, detail });
    window.localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, MAX_LOG)));
  } catch {
    /* storage full/blocked — log loss is acceptable, execution is not affected */
  }
}

export function readAgentLog(limit = 50): AgentLogEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    const list: AgentLogEntry[] = raw ? (JSON.parse(raw) as AgentLogEntry[]) : [];
    return list.slice(0, limit);
  } catch {
    return [];
  }
}

export function clearAgentLog(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(LOG_KEY);
  } catch {
    /* noop */
  }
}

/* ---------------- kill switches ---------------- */

export const DEFAULT_AGENT_STATE: AgentState = { enabled: true, paused: false };

export function loadAgentState(): AgentState {
  if (!isBrowser()) return { ...DEFAULT_AGENT_STATE };
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return { ...DEFAULT_AGENT_STATE };
    const p = JSON.parse(raw) as Partial<AgentState>;
    return { enabled: p.enabled !== false, paused: p.paused === true };
  } catch {
    return { ...DEFAULT_AGENT_STATE };
  }
}

export function saveAgentState(s: AgentState): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

/* ---------------- automation rules ---------------- */

export function loadAutomationRules(): AutomationRule[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(RULES_KEY);
    return raw ? (JSON.parse(raw) as AutomationRule[]) : [];
  } catch {
    return [];
  }
}

export function saveAutomationRule(rule: Omit<AutomationRule, "id" | "createdAt">): AutomationRule {
  const full: AutomationRule = { ...rule, id: uid(), createdAt: new Date().toISOString() };
  if (!isBrowser()) return full;
  try {
    const list = loadAutomationRules();
    list.push(full);
    window.localStorage.setItem(RULES_KEY, JSON.stringify(list));
  } catch {
    /* noop */
  }
  return full;
}

export function deleteAutomationRule(id: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      RULES_KEY,
      JSON.stringify(loadAutomationRules().filter((r) => r.id !== id))
    );
  } catch {
    /* noop */
  }
}
