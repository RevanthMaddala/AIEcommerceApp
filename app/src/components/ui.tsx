import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme";
import type { Availability } from "@/lib/types";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

export function Badge({ label, tone = "primary" }: { label: string; tone?: "primary" | "success" | "warning" | "muted" }) {
  const t = useTheme();
  const colors = {
    primary: [t.primarySoft, t.primary],
    success: [t.successSoft, t.success],
    warning: [t.warningSoft, t.warning],
    muted: [t.bg, t.muted],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors[0] }]}>
      <Text style={[styles.badgeText, { color: colors[1] }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Rating({ value, count }: { value?: number; count?: number }) {
  const t = useTheme();
  if (!value) return <Text style={{ color: t.muted, fontSize: 12 }}>No ratings</Text>;
  return (
    <View style={styles.row}>
      <Ionicons name="star" size={12} color={t.star} />
      <Text style={{ color: t.text, fontSize: 12, fontWeight: "600", marginLeft: 3 }}>{value.toFixed(1)}</Text>
      {count ? <Text style={{ color: t.muted, fontSize: 12, marginLeft: 3 }}>({count.toLocaleString()})</Text> : null}
    </View>
  );
}

const AVAILABILITY: Record<Availability, { label: string; tone: "success" | "warning" | "muted" }> = {
  in_stock: { label: "In stock", tone: "success" },
  limited: { label: "Low stock", tone: "warning" },
  out_of_stock: { label: "Out of stock", tone: "muted" },
  unknown: { label: "Check site", tone: "muted" },
};

export function AvailabilityBadge({ value }: { value: Availability }) {
  const a = AVAILABILITY[value];
  return <Badge label={a.label} tone={a.tone} />;
}

type IconName = ComponentProps<typeof Ionicons>["name"];

export function Button({
  label,
  onPress,
  icon,
  variant = "primary",
  disabled,
  compact,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useTheme();
  const bg = variant === "primary" ? t.primary : variant === "secondary" ? t.primarySoft : "transparent";
  const fg = variant === "primary" ? t.primaryText : t.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={compact ? 14 : 16} color={fg} style={{ marginRight: 6 }} /> : null}
      <Text style={{ color: fg, fontWeight: "600", fontSize: compact ? 13 : 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: active ? t.primary : t.border,
          backgroundColor: active ? t.primarySoft : t.card,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={{ color: active ? t.primary : t.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.section, { color: t.muted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  buttonCompact: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 },
});
