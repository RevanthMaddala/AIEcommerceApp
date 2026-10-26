import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Turn } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { AI_NAMES, type Stage } from "@/lib/types";

const STAGES: { key: Stage; label: string }[] = [
  { key: "understand", label: "Understanding your request" },
  { key: "research", label: "Searching stores & comparing" },
  { key: "recommend", label: "Picking the best options" },
];

/** Live view of the agent's pipeline: stages, tool calls, and its notes. Collapses once done. */
export function AgentTimeline({ turn }: { turn: Turn }) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  const running = turn.status === "running";
  const open = running || expanded;

  return (
    <View style={[styles.box, { borderColor: t.border, backgroundColor: t.card }]}>
      <Pressable onPress={() => setExpanded((e) => !e)} disabled={running} style={styles.header}>
        <Ionicons name="sparkles" size={14} color={t.primary} />
        <Text style={{ color: t.text, fontWeight: "600", fontSize: 13, flex: 1, marginLeft: 6 }}>
          {running ? "Working on it…" : `Agent steps${turn.result ? ` · ${AI_NAMES[turn.result.mode]}` : ""}`}
        </Text>
        {!running ? <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={t.muted} /> : null}
      </Pressable>
      {open ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          {STAGES.map(({ key, label }) => {
            const s = turn.stages[key];
            return (
              <View key={key} style={styles.row}>
                {s?.status === "done" ? (
                  <Ionicons name="checkmark-circle" size={16} color={t.success} />
                ) : s?.status === "start" && running ? (
                  <ActivityIndicator size="small" color={t.primary} style={{ width: 16, height: 16 }} />
                ) : (
                  <Ionicons name="ellipse-outline" size={16} color={t.border} />
                )}
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={{ color: s ? t.text : t.muted, fontSize: 13 }}>{label}</Text>
                  {s?.detail ? <Text style={{ color: t.muted, fontSize: 12 }}>{s.detail}</Text> : null}
                </View>
              </View>
            );
          })}
          {turn.steps.length ? (
            <View style={[styles.steps, { borderColor: t.border }]}>
              {turn.steps.map((step, i) => (
                <View key={i} style={styles.row}>
                  <Ionicons
                    name={step.kind === "tool" ? "search" : step.kind === "notice" ? "information-circle" : "chatbubble-ellipses-outline"}
                    size={13}
                    color={step.kind === "notice" ? t.warning : t.muted}
                  />
                  <Text style={{ color: t.muted, fontSize: 12, flex: 1, marginLeft: 6 }} numberOfLines={step.kind === "thought" ? 4 : 2}>
                    {step.text}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12 },
  header: { flexDirection: "row", alignItems: "center" },
  row: { flexDirection: "row", alignItems: "flex-start" },
  steps: { borderLeftWidth: 2, paddingLeft: 10, marginLeft: 7, gap: 6 },
});
