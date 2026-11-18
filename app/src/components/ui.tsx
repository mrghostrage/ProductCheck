// Shared iOS-style building blocks. Each reads the system colors itself, so screens don't pass them around.
import { SymbolView, type SymbolWeight } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useSystemColors, type Tone } from '@/constants/theme';

// Adds an alpha channel to a #rrggbb color.
export function alpha(hex: string, a: number) {
  return hex.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, '0');
}

// A soft wash of `color` from the top-left corner, for tinted cards.
export function tintBackground(color: string) {
  return { backgroundImage: `linear-gradient(160deg, ${alpha(color, 0.14)} 0%, ${alpha(color, 0)} 70%)` };
}

// A vivid base color with three soft blobs, behind white text on hero cards.
const MESH: Record<Tone, { light: string[]; dark: string[] }> = {
  red: { light: ['#ff453a', '#ff6b3d', '#ff2d55', '#ff9f0a'], dark: ['#8c1f17', '#c2361b', '#b0153f', '#b86a00'] },
  orange: { light: ['#ff9500', '#ffb340', '#ff6a00', '#ffcc00'], dark: ['#7a4300', '#b86a00', '#a3400c', '#8a6d00'] },
  green: { light: ['#30c26a', '#5ad97f', '#00b3a4', '#a6e05a'], dark: ['#0f5c2e', '#1b7a42', '#00695f', '#4b6b12'] },
  blue: { light: ['#007aff', '#409cff', '#5856d6', '#32ade6'], dark: ['#0a3d7a', '#0f5fb8', '#3a2f8f', '#0e6c8a'] },
  gray: { light: ['#8e8e93', '#a1a1aa', '#636366', '#b0b0b8'], dark: ['#3a3a3c', '#48484a', '#2c2c2e', '#545456'] },
};
const BLOBS = ['60% 50% at 15% 10%', '55% 45% at 90% 20%', '70% 60% at 50% 75%'];

export function meshBackground(tone: Tone, dark: boolean) {
  const [base, ...blobs] = MESH[tone][dark ? 'dark' : 'light'];
  return { backgroundColor: base, backgroundImage: blobs.map((b, i) => `radial-gradient(${BLOBS[i]}, ${b} 0%, ${b}00 70%)`).join(', ') };
}

export function Sym({ name, color, size = 17, weight = 'semibold' }: { name: string; color: string; size?: number; weight?: SymbolWeight }) {
  return (
    <SymbolView
      name={name as never}
      tintColor={color}
      size={size}
      weight={weight}
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
      fallback={<View style={{ width: size * 0.5, height: size * 0.5, borderRadius: size, backgroundColor: color }} />}
    />
  );
}

// A colored rounded square (or circle) holding a symbol, like the icons in iOS Settings.
export function IconTile({ symbol, color, size = 30, round, fg = '#fff', weight, style }: { symbol: string; color: string; size?: number; round?: boolean; fg?: string; weight?: SymbolWeight; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.center, { width: size, height: size, borderRadius: round ? size / 2 : size * 0.27, borderCurve: 'continuous', backgroundColor: color }, style]}>
      <Sym name={symbol} color={fg} size={Math.round(size * 0.5)} weight={weight} />
    </View>
  );
}

// A card that shrinks a little while pressed, like iOS widgets.
// `cell` sizes the card inside a grid; `style` is the card itself.
export function TapCard({ onPress, style, cell, children, label }: { onPress: () => void; style?: StyleProp<ViewStyle>; cell?: StyleProp<ViewStyle>; children: ReactNode; label?: string }) {
  const [scale] = useState(() => new Animated.Value(1));
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: v === 1 ? 6 : 0 }).start();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={() => to(0.97)} onPressOut={() => to(1)} style={cell}>
      <Animated.View style={[style, cell ? { flexGrow: 1 } : null, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Chevron() {
  const c = useSystemColors();
  return (
    <View style={[styles.chev, { backgroundColor: c.fill }]}>
      <Sym name="chevron.right" color={c.sec} size={10} weight="bold" />
    </View>
  );
}

export function Dashes({ color, count = 24, height = 2, style }: { color: string; count?: number; height?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', overflow: 'hidden' }, style]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: 6, height, borderRadius: height / 2, backgroundColor: color }} />
      ))}
    </View>
  );
}

export function SectionTitle({ children, first }: { children: string; first?: boolean }) {
  const c = useSystemColors();
  return <Text style={[styles.section, { color: c.label }, first && { marginTop: 0 }]}>{children}</Text>;
}

// A capsule button: filled for the main action, tinted for the others.
export function Button({ title, onPress, kind = 'filled', disabled }: { title: string; onPress: () => void; kind?: 'filled' | 'tinted'; disabled?: boolean }) {
  const c = useSystemColors();
  const filled = kind === 'filled';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, { backgroundColor: filled ? c.blue : alpha(c.blue, 0.14), opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
      <Text style={{ color: filled ? '#fff' : c.blue, fontSize: 17, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

export function ErrorNote({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useSystemColors();
  return (
    <View style={[styles.error, { backgroundColor: alpha(c.red, 0.12) }, style]}>
      <Sym name="exclamationmark.triangle.fill" color={c.red} size={17} />
      <Text style={{ color: c.red, fontSize: 15, flex: 1 }}>{children}</Text>
    </View>
  );
}

// Dims a camera while a photo is being read.
export function BusyOverlay({ label }: { label: string }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, { gap: 12, backgroundColor: 'rgba(0,0,0,0.55)' }]}>
      <ActivityIndicator color="#fff" size="large" />
      <Text style={{ color: '#fff', fontSize: 17, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

// ---------- Inset grouped list ----------

export function Group({ children, bg, style }: { children: ReactNode; bg?: string; style?: StyleProp<ViewStyle> }) {
  const c = useSystemColors();
  return <View style={[styles.group, { backgroundColor: bg ?? c.cell }, style]}>{children}</View>;
}

// One row of a Group. Pass `separator` on every row but the first. `children` replace the title and subtitle.
export function Row({ icon, title, sub, right, chevron, separator, onPress, role = 'button', children }: {
  icon?: { symbol: string; color: string };
  title?: string;
  sub?: string;
  right?: ReactNode;
  chevron?: boolean;
  separator?: boolean;
  onPress?: () => void;
  role?: 'button' | 'link';
  children?: ReactNode;
}) {
  const c = useSystemColors();
  const body = (
    <>
      {separator && <View style={[styles.sep, { left: icon ? 58 : 16, backgroundColor: c.sep }]} />}
      {icon && <IconTile symbol={icon.symbol} color={icon.color} />}
      {children ?? (
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.label, fontSize: 17 }}>{title}</Text>
          {sub && <Text style={{ color: c.sec, fontSize: 13, marginTop: 1 }}>{sub}</Text>}
        </View>
      )}
      {right}
      {chevron && <Sym name="chevron.right" color={c.ter} size={13} />}
    </>
  );
  const rowStyle = [styles.row, icon && styles.iconRow];
  if (!onPress) return <View style={rowStyle}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole={role} style={({ pressed }) => [rowStyle, pressed && { backgroundColor: c.fill }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  chev: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 22, fontWeight: '700', letterSpacing: 0.35, marginTop: 28, marginBottom: 12, marginHorizontal: 4 },
  button: { height: 50, paddingHorizontal: 26, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  error: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderCurve: 'continuous' },
  group: { borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 16, paddingVertical: 12 },
  iconRow: { minHeight: 58, paddingVertical: 8 },
  sep: { position: 'absolute', top: 0, right: 0, height: StyleSheet.hairlineWidth },
});
