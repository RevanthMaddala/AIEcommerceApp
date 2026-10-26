import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { AvailabilityBadge, Badge, Button, Card, Rating, SectionTitle } from "@/components/ui";
import { api, openOffer } from "@/lib/api";
import { useStore } from "@/lib/store";
import { money, useTheme } from "@/lib/theme";
import type { Product } from "@/lib/types";

export default function ProductScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { products, userId, compareIds, toggleCompare } = useStore();
  const [product, setProduct] = useState<Product | undefined>(() => products.get(id));
  const [error, setError] = useState("");
  const [storesState, setStoresState] = useState<"idle" | "loading" | "done" | "error">("idle");

  useEffect(() => {
    if (product) return;
    api
      .product(id)
      .then((p) => {
        products.set(p.id, p);
        setProduct(p);
      })
      .catch((e: Error) => setError(e.message));
  }, [id, product, products]);

  if (!product) {
    return (
      <View style={styles.center}>
        {error ? <Text style={{ color: t.muted }}>{error}</Text> : <ActivityIndicator color={t.primary} />}
      </View>
    );
  }

  const comparing = compareIds.includes(product.id);
  const canFindStores = storesState !== "done" && Boolean(product.storesToken);
  const findStores = async () => {
    setStoresState("loading");
    try {
      const before = product.offers.length;
      const p = await api.moreStores(product.id);
      products.set(p.id, p);
      setProduct(p);
      setStoresState(p.offers.length > before || !p.offers.some((o) => o.linkToken) ? "done" : "error");
    } catch {
      setStoresState("error");
    }
  };
  const specs = Object.entries(product.specs);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: product.brand ?? "Product" }} />
      <View style={[styles.hero, { backgroundColor: t.card }]}>
        {product.image ? (
          <Image source={product.image} style={{ width: "100%", height: "100%" }} contentFit="contain" />
        ) : (
          <Ionicons name="cube-outline" size={64} color={t.muted} />
        )}
      </View>

      <View style={{ gap: 6 }}>
        <Text style={[styles.title, { color: t.text }]}>{product.title}</Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Rating value={product.rating} count={product.reviewCount} />
          {product.category ? <Badge label={product.category} tone="muted" /> : null}
        </View>
        <Text style={[styles.price, { color: t.text }]}>
          {money(product.bestPrice, product.currency)}
          <Text style={{ color: t.muted, fontSize: 14, fontWeight: "400" }}>
            {"  "}best of {product.offers.length} offer{product.offers.length > 1 ? "s" : ""}
          </Text>
        </Text>
      </View>

      <Button
        label={comparing ? "In compare list" : "Add to compare"}
        icon={comparing ? "checkmark" : "git-compare-outline"}
        variant="secondary"
        onPress={() => toggleCompare(product.id)}
      />

      <Card style={{ gap: 0, padding: 0 }}>
        <View style={{ padding: 14, paddingBottom: 4 }}>
          <SectionTitle>Where to buy</SectionTitle>
        </View>
        {canFindStores ? (
          <View style={{ paddingHorizontal: 14, paddingBottom: 8, gap: 6 }}>
            <Button
              label={storesState === "loading" ? "Checking stores…" : "Find more stores"}
              icon="storefront-outline"
              variant="secondary"
              compact
              disabled={storesState === "loading"}
              onPress={findStores}
            />
            <Text style={{ color: t.muted, fontSize: 12 }}>
              {storesState === "error"
                ? "Couldn't find more stores for this product right now."
                : "Checks every store that sells this item (e.g. Flipkart, Croma) for its price and direct link."}
            </Text>
          </View>
        ) : null}
        {product.offers.map((o, i) => (
          <View key={o.id} style={[styles.offer, { borderColor: t.border }, i === 0 && { borderTopWidth: 0 }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Text style={{ color: t.text, fontWeight: "700" }}>{o.platform}</Text>
                {i === 0 && product.offers.length > 1 && !o.suspect ? <Badge label="Best pick" tone="success" /> : null}
                {o.trusted ? <Badge label="Trusted store" tone="muted" /> : null}
              </View>
              {o.suspect ? <Text style={{ color: t.warning, fontSize: 12 }}>{o.suspect}</Text> : null}
              {o.title && o.title !== product.title ? (
                <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={2}>
                  {o.title}
                </Text>
              ) : null}
              <View style={{ flexDirection: "row", gap: 6, alignItems: "baseline" }}>
                <Text style={{ color: t.text, fontSize: 17, fontWeight: "800" }}>{money(o.price, o.currency)}</Text>
                {o.originalPrice ? (
                  <Text style={{ color: t.muted, textDecorationLine: "line-through", fontSize: 12 }}>{money(o.originalPrice, o.currency)}</Text>
                ) : null}
              </View>
              <Text style={{ color: t.muted, fontSize: 12 }}>
                {[
                  o.condition,
                  o.shipping,
                  o.seller && o.seller !== o.platform ? (o.seller.startsWith("Price") ? o.seller : `Sold by ${o.seller}`) : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <AvailabilityBadge value={o.availability} />
            </View>
            <Button label="Buy" icon="open-outline" compact onPress={() => userId && openOffer(o.id, userId)} />
          </View>
        ))}
      </Card>

      {product.description ? (
        <Card>
          <SectionTitle>About</SectionTitle>
          <Text style={{ color: t.text, lineHeight: 21 }}>{product.description}</Text>
        </Card>
      ) : null}

      {specs.length ? (
        <Card style={{ gap: 6 }}>
          <SectionTitle>Specs</SectionTitle>
          {specs.map(([k, v]) => (
            <View key={k} style={{ flexDirection: "row", gap: 12 }}>
              <Text style={{ color: t.muted, width: 110, fontSize: 13 }}>{k}</Text>
              <Text style={{ color: t.text, flex: 1, fontSize: 13 }}>{v}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Text style={{ color: t.muted, fontSize: 11, textAlign: "center" }}>
        Prices fetched {new Date(product.offers[0].fetchedAt).toLocaleTimeString()} — confirm on the store before buying.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  content: { padding: 16, gap: 14, width: "100%", maxWidth: 720, alignSelf: "center" },
  hero: { height: 260, borderRadius: 16, alignItems: "center", justifyContent: "center", padding: 16 },
  title: { fontSize: 21, fontWeight: "800" },
  price: { fontSize: 26, fontWeight: "800" },
  offer: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
});
