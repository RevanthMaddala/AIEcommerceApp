import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { openOffer } from "@/lib/api";
import { useStore } from "@/lib/store";
import { money, useTheme } from "@/lib/theme";
import type { Pick } from "@/lib/types";
import { AvailabilityBadge, Badge, Button, Card, Rating } from "./ui";

/** Best-known retailers, in the order their buttons appear (India first, then US). */
const MAJOR_STORES = ["amazon", "flipkart", "croma", "reliance digital", "vijay sales", "tata cliq", "myntra", "walmart", "best buy", "target"];

/** A recommended product with the agent's reasoning and a direct buy button. */
export function PickCard({ pick, rank }: { pick: Pick; rank: number }) {
  const t = useTheme();
  const { userId, compareIds, toggleCompare } = useStore();
  const p = pick.product;
  // The server lists the offer to buy from first (big stores before small sellers and deal sites).
  const best = p.offers[0];
  // Shoppers look for the big stores first, so surface them even when a smaller seller is cheaper.
  const majors = MAJOR_STORES.flatMap((name) => {
    const o = p.offers.find((x) => x.id !== best.id && !x.suspect && x.platform.toLowerCase().startsWith(name));
    return o ? [o] : [];
  }).slice(0, 3);
  const comparing = compareIds.includes(p.id);
  const open = () => router.push({ pathname: "/product/[id]", params: { id: p.id } });

  return (
    <Card style={{ gap: 10 }}>
      <Pressable onPress={open} style={styles.top} accessibilityRole="button" accessibilityLabel={`View ${p.title}`}>
        <View style={[styles.imageWrap, { backgroundColor: t.bg }]}>
          {p.image ? (
            <Image source={p.image} style={styles.image} contentFit="contain" />
          ) : (
            <Ionicons name="cube-outline" size={32} color={t.muted} />
          )}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Badge label={`#${rank} ${pick.label}`} />
            {p.platforms.length > 1 ? <Badge label={`${p.platforms.length} stores`} tone="muted" /> : null}
          </View>
          <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>
            {p.title}
          </Text>
          <Rating value={p.rating} count={p.reviewCount} />
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
            <Text style={[styles.price, { color: t.text }]}>{money(best.price, best.currency)}</Text>
            {best.originalPrice ? (
              <Text style={{ color: t.muted, textDecorationLine: "line-through", fontSize: 13 }}>
                {money(best.originalPrice, best.currency)}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>

      <Text style={{ color: t.text, fontSize: 14, lineHeight: 20 }}>{pick.reason}</Text>

      {pick.pros.length || pick.cons.length ? (
        <View style={{ gap: 3 }}>
          {pick.pros.map((x) => (
            <Line key={`+${x}`} icon="checkmark-circle" color={t.success} text={x} />
          ))}
          {pick.cons.map((x) => (
            <Line key={`-${x}`} icon="remove-circle" color={t.warning} text={x} />
          ))}
        </View>
      ) : null}

      <View style={[styles.offerRow, { borderColor: t.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.muted, fontSize: 12 }}>{best.trusted ? "Best price from a trusted store" : "Best price at"}</Text>
          <Text style={{ color: t.text, fontWeight: "700" }}>{best.platform}</Text>
          {best.suspect ? <Text style={{ color: t.warning, fontSize: 12 }}>{best.suspect}</Text> : null}
          {!best.suspect && best.seller?.startsWith("Price tracked") ? (
            <Text style={{ color: t.muted, fontSize: 12 }}>{best.seller} — confirm on {best.platform}</Text>
          ) : null}
        </View>
        <AvailabilityBadge value={best.availability} />
      </View>

      {majors.length ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: t.muted, fontSize: 12 }}>Also at</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {majors.map((o) => (
              <Button
                key={o.id}
                label={`${o.platform} ${money(o.price, o.currency)}`}
                icon="open-outline"
                variant="secondary"
                compact
                onPress={() => userId && openOffer(o.id, userId)}
                disabled={!userId}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            label={`Buy on ${best.platform}`}
            icon="open-outline"
            onPress={() => userId && openOffer(best.id, userId)}
            disabled={!userId}
          />
        </View>
        <Button
          label={comparing ? "Added" : "Compare"}
          icon={comparing ? "checkmark" : "git-compare-outline"}
          variant="secondary"
          onPress={() => toggleCompare(p.id)}
        />
      </View>
    </Card>
  );
}

function Line({ icon, color, text }: { icon: "checkmark-circle" | "remove-circle"; color: string; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
      <Ionicons name={icon} size={15} color={color} style={{ marginTop: 1 }} />
      <Text style={{ color: t.text, fontSize: 13, flex: 1 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", gap: 12 },
  imageWrap: { width: 96, height: 96, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  title: { fontSize: 15, fontWeight: "700" },
  price: { fontSize: 20, fontWeight: "800" },
  offerRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
});
