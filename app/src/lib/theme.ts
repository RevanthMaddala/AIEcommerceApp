import { useColorScheme } from "react-native";

const light = {
  bg: "#F6F7FB",
  card: "#FFFFFF",
  text: "#14161F",
  muted: "#666B7A",
  border: "#E4E6EE",
  primary: "#4F46E5",
  primaryText: "#FFFFFF",
  primarySoft: "#EEF0FF",
  success: "#15803D",
  successSoft: "#E7F6EC",
  warning: "#B45309",
  warningSoft: "#FDF3E3",
  danger: "#B91C1C",
  star: "#F59E0B",
};

const dark: typeof light = {
  bg: "#0E1016",
  card: "#171A23",
  text: "#F1F2F6",
  muted: "#9AA0B0",
  border: "#262A36",
  primary: "#818CF8",
  primaryText: "#0E1016",
  primarySoft: "#22264A",
  success: "#4ADE80",
  successSoft: "#14301F",
  warning: "#FBBF24",
  warningSoft: "#33270F",
  danger: "#F87171",
  star: "#FBBF24",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

// Indian prices read naturally as ₹1,20,000 (en-IN grouping), with no paise shown.
const LOCALES: Record<string, string> = { INR: "en-IN", USD: "en-US" };

export function money(value: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(LOCALES[currency] ?? "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "INR" ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
