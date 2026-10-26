import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Badge, Button, Card, Chip, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { money, useTheme } from "@/lib/theme";
import { AI_NAMES, type Priority, type UserProfile } from "@/lib/types";

const PRIORITIES: { key: Priority; label: string }[] = [
  { key: "balanced", label: "Balanced" },
  { key: "price", label: "Lowest price" },
  { key: "rating", label: "Best reviews" },
  { key: "premium", label: "Premium" },
];

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export default function ProfileScreen() {
  const t = useTheme();
  const { userId, health } = useStore();
  const currency = health?.region.currency ?? "USD";
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [priority, setPriority] = useState<Priority>("balanced");
  const [budget, setBudget] = useState("");
  const [preferred, setPreferred] = useState("");
  const [avoid, setAvoid] = useState("");
  const [status, setStatus] = useState("");

  // Reload when the tab gains focus so learned signals from recent clicks show up.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      api
        .profile(userId)
        .then((p) => {
          setProfile(p);
          setPriority(p.priority);
          setBudget(p.maxBudget ? String(p.maxBudget) : "");
          setPreferred(p.preferredBrands.join(", "));
          setAvoid(p.avoidBrands.join(", "));
        })
        .catch(() => setStatus("Couldn't load preferences — is the server running?"));
    }, [userId]),
  );

  const save = async () => {
    if (!userId) return;
    try {
      const max = Number(budget);
      const p = await api.savePreferences(userId, {
        priority,
        maxBudget: budget && Number.isFinite(max) && max > 0 ? max : null,
        preferredBrands: list(preferred),
        avoidBrands: list(avoid),
      });
      setProfile(p);
      setStatus("Saved. Your next searches will use these preferences.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    }
  };

  const learnedBrands = profile
    ? Object.entries(profile.brandAffinity)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : [];

  return (
    <ScrollView contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 14 }}>
        <View>
          <SectionTitle>What matters most</SectionTitle>
          <View style={styles.wrap}>
            {PRIORITIES.map((p) => (
              <Chip key={p.key} label={p.label} active={priority === p.key} onPress={() => setPriority(p.key)} />
            ))}
          </View>
        </View>
        <Field
          label={`Usual max budget (${currency})`}
          value={budget}
          onChange={setBudget}
          placeholder={currency === "INR" ? "e.g. 50000" : "e.g. 500"}
          numeric
        />
        <Field label="Favorite brands" value={preferred} onChange={setPreferred} placeholder="Sony, Apple, Nike" />
        <Field label="Brands to avoid" value={avoid} onChange={setAvoid} placeholder="Comma separated" />
        <Button label="Save preferences" icon="save-outline" onPress={save} />
        {status ? <Text style={{ color: t.muted, fontSize: 13 }}>{status}</Text> : null}
      </Card>

      <Card style={{ gap: 10 }}>
        <SectionTitle>Learned from your activity</SectionTitle>
        {learnedBrands.length ? (
          <View style={styles.wrap}>
            {learnedBrands.map(([brand, n]) => (
              <Badge key={brand} label={`${brand} · ${n}`} />
            ))}
          </View>
        ) : (
          <Text style={{ color: t.muted, fontSize: 13 }}>Open a store link from your results and SmartShop will learn what you like.</Text>
        )}
        {profile?.recentClicks.length ? (
          <View style={{ gap: 4 }}>
            {profile.recentClicks.slice(0, 5).map((c) => (
              <Text key={c.productId} style={{ color: t.text, fontSize: 13 }} numberOfLines={1}>
                • {c.title} — {money(c.price, currency)}
              </Text>
            ))}
          </View>
        ) : null}
        {profile?.recentQueries.length ? (
          <Text style={{ color: t.muted, fontSize: 12 }}>Recent: {profile.recentQueries.slice(0, 5).join(" · ")}</Text>
        ) : null}
      </Card>

      <Card style={{ gap: 8 }}>
        <SectionTitle>Connected stores</SectionTitle>
        {health?.providers.map((p) => (
          <View key={p.platform} style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: t.text }}>{p.platform}</Text>
            <Badge label={p.enabled ? "Connected" : "Add API key"} tone={p.enabled ? "success" : "muted"} />
          </View>
        )) ?? <Text style={{ color: t.muted }}>Server offline</Text>}
        <Text style={{ color: t.muted, fontSize: 12 }}>
          AI:{" "}
          {health && health.ai.mode !== "heuristic"
            ? `${AI_NAMES[health.ai.mode]} (${health.ai.model})`
            : "quick mode — add GEMINI_API_KEY or ANTHROPIC_API_KEY to server/.env"}
        </Text>
      </Card>
    </ScrollView>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder: string; numeric?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <SectionTitle>{props.label}</SectionTitle>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor={t.muted}
        keyboardType={props.numeric ? "numeric" : "default"}
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
        accessibilityLabel={props.label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, width: "100%", maxWidth: 640, alignSelf: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
});
