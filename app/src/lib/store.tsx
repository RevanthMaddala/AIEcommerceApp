import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, streamAssistant } from "./api";
import type { AgentEvent, Health, Intent, PipelineResult, Product, Stage } from "./types";

export interface Step {
  kind: "tool" | "thought" | "notice";
  text: string;
}

export interface Turn {
  id: string;
  query: string;
  status: "running" | "done" | "error";
  stages: Partial<Record<Stage, { status: "start" | "done"; detail?: string }>>;
  steps: Step[];
  intent?: Intent;
  result?: PipelineResult;
  error?: string;
}

interface Store {
  userId: string | null;
  health: Health | null;
  turns: Turn[];
  busy: boolean;
  ask: (query: string) => void;
  stop: () => void;
  clear: () => void;
  products: Map<string, Product>;
  compareIds: string[];
  toggleCompare: (id: string) => void;
  clearCompare: () => void;
}

const Ctx = createContext<Store | null>(null);
const MAX_COMPARE = 4;

function newId() {
  return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const products = useRef(new Map<string, Product>()).current;
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      let id: string | null = null;
      try {
        id = await AsyncStorage.getItem("shopmind.userId");
        if (!id) {
          id = newId();
          await AsyncStorage.setItem("shopmind.userId", id);
        }
      } catch {
        id = newId();
      }
      setUserId(id);
    })();
  }, []);

  // A phone may not reach the server at first (Wi-Fi waking up, firewall prompt), so keep trying while offline.
  useEffect(() => {
    if (health) return;
    let cancelled = false;
    const check = () => api.health().then((h) => !cancelled && setHealth(h)).catch(() => {});
    check();
    const timer = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [health]);

  const update = (id: string, fn: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));

  const ask = useCallback(
    (query: string) => {
      if (!userId || abortRef.current) return;
      const id = newId();
      const history = turns
        .filter((t) => t.status === "done")
        .slice(-5)
        .map((t) => ({ query: t.query, summary: t.intent?.summary }));
      setTurns((all) => [...all, { id, query, status: "running", stages: {}, steps: [] }]);

      const controller = new AbortController();
      abortRef.current = controller;
      const onEvent = (e: AgentEvent) => {
        switch (e.type) {
          case "stage":
            update(id, (t) => ({ ...t, stages: { ...t.stages, [e.stage]: { status: e.status, detail: e.detail } } }));
            break;
          case "intent":
            update(id, (t) => ({ ...t, intent: e.intent }));
            break;
          case "tool":
            update(id, (t) => ({ ...t, steps: [...t.steps, { kind: "tool", text: e.summary }] }));
            break;
          case "thought":
            update(id, (t) => ({ ...t, steps: [...t.steps, { kind: "thought", text: e.text }] }));
            break;
          case "notice":
            update(id, (t) => ({ ...t, steps: [...t.steps, { kind: "notice", text: e.message }] }));
            break;
          case "result":
            for (const p of e.result.products) products.set(p.id, p);
            update(id, (t) => ({ ...t, status: "done", result: e.result }));
            break;
          case "error":
            update(id, (t) => ({ ...t, status: "error", error: e.message }));
            break;
        }
      };

      streamAssistant({ query, userId, history }, onEvent, controller.signal)
        .catch((err: unknown) => {
          const message = controller.signal.aborted
            ? "Stopped."
            : err instanceof Error
              ? err.message
              : "Could not reach the server.";
          update(id, (t) => (t.status === "running" ? { ...t, status: "error", error: message } : t));
        })
        .finally(() => {
          update(id, (t) => (t.status === "running" ? { ...t, status: "error", error: "Connection closed early." } : t));
          abortRef.current = null;
        });
    },
    [userId, turns, products],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
  }, []);

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_COMPARE ? [...ids.slice(1), id] : [...ids, id],
    );
  }, []);
  const clearCompare = useCallback(() => setCompareIds([]), []);

  const busy = turns.some((t) => t.status === "running");
  const value = useMemo(
    () => ({ userId, health, turns, busy, ask, stop, clear, products, compareIds, toggleCompare, clearCompare }),
    [userId, health, turns, busy, ask, stop, clear, products, compareIds, toggleCompare, clearCompare],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
