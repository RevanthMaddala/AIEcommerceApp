import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useStore } from "@/lib/store";
import { money, useTheme } from "@/lib/theme";
import type { Product } from "@/lib/types";
import { Rating } from "./ui";

/** Compact tile used in the "all results" strip. */
export function ProductCard({ product }: { product: Product }) {
  const t = useTheme();
  const { compareIds, toggleCompare } = useStore();
  const comparing = compareIds.includes(product.id);
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/product/[id]", params: { id: product.id } })}
      style={({ pressed }) => [styles.card, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.85 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`${product.title}, ${money(product.bestPrice, product.currency)}`}
    >
      <View style={[styles.imageWrap, { backgroundColor: t.bg }]}>
        {product.image ? (
          <Image source={product.image} style={styles.image} contentFit="contain" transition={150} />
        ) : (
          <Ionicons name="cube-outline" size={36} color={t.muted} />
        )}
        <Pressable
          onPress={() => toggleCompare(product.id)}
          hitSlop={8}
          style={[styles.compare, { backgroundColor: comparing ? t.primary : t.card, borderColor: t.border }]}
          accessibilityLabel={comparing ? "Remove from compare" : "Add to compare"}
        >
          <Ionicons name={comparing ? "checkmark" : "git-compare-outline"} size={14} color={comparing ? t.primaryText : t.text} />
        </Pressable>
      </View>
      <Text numberOfLines={2} style={[styles.title, { color: t.text }]}>
        {product.title}
      </Text>
      <Rating value={product.rating} count={product.reviewCount} />
      <Text style={[styles.price, { color: t.text }]}>{money(product.bestPrice, product.currency)}</Text>
      <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11 }}>
        {product.platforms.length > 1 ? `${product.platforms.length} stores` : product.platforms[0]}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: 160, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 4 },
  imageWrap: { height: 110, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  image: { width: "100%", height: "100%" },
  compare: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 13, fontWeight: "600", minHeight: 34 },
  price: { fontSize: 16, fontWeight: "800" },
});
