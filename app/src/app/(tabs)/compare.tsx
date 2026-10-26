import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AvailabilityBadge, Button, Rating } from "@/components/ui";
import { openOffer } from "@/lib/api";
import { useStore } from "@/lib/store";
import { money, useTheme } from "@/lib/theme";
import type { Product } from "@/lib/types";

const COL = 180;
const LABEL = 110;

export default function CompareScreen() {
  const t = useTheme();
  const { compareIds, products, toggleCompare, clearCompare, userId } = useStore();
  const items = compareIds.map((id) => products.get(id)).filter((p): p is Product => Boolean(p));

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="git-compare-outline" size={40} color={t.muted} />
        <Text style={{ color: t.text, fontSize: 17, fontWeight: "700" }}>Nothing to compare yet</Text>
        <Text style={{ color: t.muted, textAlign: "center", maxWidth: 320 }}>
          Tap “Compare” on up to 4 products from your search results to see them side by side.
        </Text>
        <Button label="Go to search" icon="search" variant="secondary" onPress={() => router.navigate("/")} />
      </View>
    );
  }

  const cheapest = Math.min(...items.map((p) => p.bestPrice));
  const topRated = Math.max(...items.map((p) => p.rating ?? 0));
  const specKeys = [...new Set(items.flatMap((p) => Object.keys(p.specs)))].slice(0, 8);

  const Row = ({ label, render }: { label: string; render: (p: Product) => ReactNode }) => (
    <View style={[styles.row, { borderColor: t.border }]}>
      <Text style={[styles.label, { color: t.muted }]}>{label}</Text>
      {items.map((p) => (
        <View key={p.id} style={styles.cell}>
          {render(p)}
        </View>
      ))}
    </View>
  );
  const value = (text: string | undefined, highlight = false) => (
    <Text style={{ color: highlight ? t.success : t.text, fontWeight: highlight ? "700" : "400", fontSize: 13 }}>{text ?? "—"}</Text>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ color: t.muted, flex: 1 }}>{items.length} of 4 products</Text>
        <Button label="Clear" variant="ghost" compact onPress={clearCompare} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={[styles.table, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={[styles.row, { borderColor: t.border }]}>
            <View style={{ width: LABEL }} />
            {items.map((p) => (
              <View key={p.id} style={[styles.cell, { gap: 6 }]}>
                <Pressable onPress={() => toggleCompare(p.id)} style={styles.remove} accessibilityLabel={`Remove ${p.title}`}>
                  <Ionicons name="close-circle" size={20} color={t.muted} />
                </Pressable>
                <Pressable onPress={() => router.push({ pathname: "/product/[id]", params: { id: p.id } })}>
                  <View style={[styles.imageWrap, { backgroundColor: t.bg }]}>
                    {p.image ? <Image source={p.image} style={{ width: "100%", height: "100%" }} contentFit="contain" /> : null}
                  </View>
                  <Text numberOfLines={3} style={{ color: t.text, fontWeight: "700", fontSize: 13, marginTop: 6 }}>
                    {p.title}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
          <Row label="Best price" render={(p) => value(money(p.bestPrice, p.currency), p.bestPrice === cheapest)} />
          <Row label="Best buy at" render={(p) => value(p.offers[0]?.platform)} />
          <Row
            label="Price range"
            render={(p) => {
              // Offers are ordered by store preference, not price.
              const prices = p.offers.filter((o) => !o.suspect).map((o) => o.price);
              return value(
                prices.length > 1
                  ? `${money(Math.min(...prices), p.currency)} – ${money(Math.max(...prices), p.currency)}`
                  : `${p.offers.length} offer${p.offers.length > 1 ? "s" : ""}`,
              );
            }}
          />
          <Row
            label="Rating"
            render={(p) => (
              <View style={{ gap: 2 }}>
                <Rating value={p.rating} count={p.reviewCount} />
                {p.rating && p.rating === topRated && items.length > 1 ? (
                  <Text style={{ color: t.success, fontSize: 11, fontWeight: "700" }}>Top rated</Text>
                ) : null}
              </View>
            )}
          />
          <Row label="Availability" render={(p) => <AvailabilityBadge value={p.offers[0]?.availability ?? "unknown"} />} />
          <Row label="Brand" render={(p) => value(p.brand)} />
          <Row label="Stores" render={(p) => value(p.platforms.join(", "))} />
          <Row label="Shipping" render={(p) => value(p.offers[0]?.shipping)} />
          {specKeys.map((k) => (
            <Row key={k} label={k} render={(p) => value(p.specs[k])} />
          ))}
          <Row
            label=""
            render={(p) => (
              <Button
                label="Buy best"
                icon="open-outline"
                compact
                onPress={() => userId && p.offers[0] && openOffer(p.offers[0].id, userId)}
              />
            )}
          />
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  table: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center" },
  label: { width: LABEL, fontSize: 12, fontWeight: "600" },
  cell: { width: COL, paddingRight: 12 },
  imageWrap: { height: 100, borderRadius: 8 },
  remove: { position: "absolute", top: -4, right: 4, zIndex: 1 },
});
