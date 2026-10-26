import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentTimeline } from "@/components/AgentTimeline";
import { PickCard } from "@/components/PickCard";
import { ProductCard } from "@/components/ProductCard";
import { Badge, Card, Chip, SectionTitle } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { useStore, type Turn } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { AI_NAMES } from "@/lib/types";

const SUGGESTIONS: Record<string, string[]> = {
  US: [
    "Noise cancelling headphones under $300",
    "Best laptop for students around $1000",
    "Compare iPhone vs Samsung Galaxy",
    "Gift ideas for a coffee lover under $50",
  ],
  IN: [
    "Noise cancelling headphones under ₹20,000",
    "Best laptop for college students under 60k",
    "Compare iPhone 15 vs Samsung Galaxy S24",
    "Air fryer under ₹8,000 with good reviews",
  ],
};
const PLACEHOLDERS: Record<string, string> = {
  US: "e.g. waterproof running shoes under $120",
  IN: "e.g. running shoes under ₹5,000",
};

export default function AssistantScreen() {
  const t = useTheme();
  const { turns, busy, ask, stop, clear, health } = useStore();
  const region = health?.region.code ?? "US";
  const [text, setText] = useState("");
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [turns]);

  const submit = (q = text) => {
    const query = q.trim();
    if (!query || busy) return;
    ask(query);
    setText("");
  };

  return (
    // The offset is the header's height (status bar + 44pt bar), so the input lands right above the keyboard.
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
    >
      <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.statusRow}>
          {health ? (
            <>
              <Badge
                label={health.ai.mode === "heuristic" ? "Quick mode (no AI key)" : `AI agent: ${AI_NAMES[health.ai.mode]}`}
                tone={health.ai.mode === "heuristic" ? "warning" : "primary"}
              />
              <Text style={{ color: t.muted, fontSize: 12 }}>
                {health.providers
                  .filter((p) => p.enabled)
                  .map((p) => p.platform)
                  .join(" · ")}
              </Text>
            </>
          ) : (
            <Badge label={`Can't reach the server at ${API_URL}, retrying…`} tone="warning" />
          )}
          {turns.length ? (
            <Pressable onPress={clear} style={{ marginLeft: "auto" }} accessibilityRole="button">
              <Text style={{ color: t.primary, fontSize: 13 }}>New chat</Text>
            </Pressable>
          ) : null}
        </View>

        {turns.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="sparkles" size={36} color={t.primary} />
            <Text style={[styles.hero, { color: t.text }]}>What are you shopping for?</Text>
            <Text style={{ color: t.muted, textAlign: "center", maxWidth: 420 }}>
              Describe it in your own words. I'll search multiple stores, compare live prices, and pick the best options for you.
            </Text>
            <View style={styles.chips}>
              {(SUGGESTIONS[region] ?? SUGGESTIONS.US).map((s) => (
                <Chip key={s} label={s} onPress={() => submit(s)} />
              ))}
            </View>
          </View>
        ) : (
          turns.map((turn) => <TurnView key={turn.id} turn={turn} onFollowUp={submit} />)
        )}
      </ScrollView>

      <View style={[styles.inputBar, { backgroundColor: t.card, borderColor: t.border }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => submit()}
          placeholder={turns.length ? "Refine: cheaper, different brand, compare…" : PLACEHOLDERS[region] ?? PLACEHOLDERS.US}
          placeholderTextColor={t.muted}
          style={[styles.input, { color: t.text, backgroundColor: t.bg }]}
          returnKeyType="search"
          editable={!busy}
          accessibilityLabel="Search request"
        />
        <Pressable
          onPress={busy ? stop : () => submit()}
          style={[styles.send, { backgroundColor: t.primary }]}
          accessibilityRole="button"
          accessibilityLabel={busy ? "Stop" : "Send"}
        >
          <Ionicons name={busy ? "stop" : "arrow-up"} size={20} color={t.primaryText} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function TurnView({ turn, onFollowUp }: { turn: Turn; onFollowUp: (q: string) => void }) {
  const t = useTheme();
  const r = turn.result;
  const pickIds = new Set(r?.picks.map((p) => p.product.id));
  const others = r?.products.filter((p) => !pickIds.has(p.id)).slice(0, 20) ?? [];

  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.bubble, { backgroundColor: t.primary }]}>
        <Text style={{ color: t.primaryText, fontSize: 15 }}>{turn.query}</Text>
      </View>

      <AgentTimeline turn={turn} />

      {turn.status === "error" ? (
        <Card style={{ borderColor: t.danger }}>
          <Text style={{ color: t.danger }}>{turn.error}</Text>
        </Card>
      ) : null}

      {r ? (
        <>
          <Text style={[styles.headline, { color: t.text }]}>{r.headline}</Text>

          {r.picks.map((pick, i) => (
            <PickCard key={pick.product.id} pick={pick} rank={i + 1} />
          ))}

          {r.comparison ? (
            <Card>
              <SectionTitle>How they compare</SectionTitle>
              <Text style={{ color: t.text, lineHeight: 21 }}>{r.comparison}</Text>
            </Card>
          ) : null}

          {others.length ? (
            <View>
              <SectionTitle>More results ({r.products.length})</SectionTitle>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }}>
                {others.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {r.followUps.length ? (
            <View style={styles.chips}>
              {r.followUps.map((f) => (
                <Chip key={f} label={f} onPress={() => onFollowUp(f)} />
              ))}
            </View>
          ) : null}

          <Text style={{ color: t.muted, fontSize: 11 }}>
            {r.providers
              .map((p) => `${p.platform}: ${p.ok ? `${p.count} results${p.cached ? " (cached)" : ` in ${p.ms}ms`}` : "unavailable"}`)
              .join(" · ")}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 20, paddingBottom: 32, width: "100%", maxWidth: 760, alignSelf: "center" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  empty: { alignItems: "center", gap: 12, paddingTop: 40 },
  hero: { fontSize: 24, fontWeight: "800", textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  bubble: { alignSelf: "flex-end", borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 9, maxWidth: "85%" },
  headline: { fontSize: 17, fontWeight: "700", lineHeight: 23 },
  inputBar: { flexDirection: "row", gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  input: { flex: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
