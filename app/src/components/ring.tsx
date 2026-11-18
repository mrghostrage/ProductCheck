// A segmented ring drawn with plain views (no SVG): each arc is a ring whose border is colored,
// rotated and clipped to one half of the circle.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

type Segment = { value: number; color: string };

// `total` defaults to the sum of the segments (a full ring); pass it to draw a partial ring, e.g. 100 for a percentage.
export function Ring({ size, stroke, segments, track, total: max, children }: { size: number; stroke: number; segments: Segment[]; track: string; total?: number; children?: ReactNode }) {
  const total = max ?? segments.reduce((s, x) => s + x.value, 0);
  const gap = segments.filter((s) => s.value > 0).length > 1 ? (stroke * 1.4) / (Math.PI * (size - stroke)) : 0;
  const frac = (v: number) => (total ? v / total : 0);
  const arcs = segments.map((s, i) => ({
    key: i,
    start: frac(segments.slice(0, i).reduce((sum, x) => sum + x.value, 0)),
    sweep: Math.max(0, frac(s.value) - gap),
    color: s.color,
  }));
  return (
    <View style={{ width: size, height: size }}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: stroke, borderColor: track }]} />
      {arcs.map((a) => (a.sweep > 0 ? <Arc key={a.key} size={size} stroke={stroke} start={a.start} sweep={a.sweep} color={a.color} /> : null))}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>{children}</View>
    </View>
  );
}

function Arc({ size, stroke, start, sweep, color }: { size: number; stroke: number; start: number; sweep: number; color: string }) {
  if (sweep >= 0.999) return <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: stroke, borderColor: color }]} />;
  const deg = sweep * 360;
  const r = (size - stroke) / 2;
  const cap = (theta: number) => {
    const t = (theta * Math.PI) / 180;
    return { left: size / 2 + r * Math.sin(t) - stroke / 2, top: size / 2 - r * Math.cos(t) - stroke / 2 };
  };
  // A right-half ring (covers 0–180°), rotated, then clipped to one half of the circle.
  const rightHalfRing = (
    <View style={{ position: 'absolute', top: 0, left: size / 2, width: size / 2, height: size, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 0, left: -size / 2, width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color }} />
    </View>
  );
  const half = (side: 'right' | 'left', rot: number) => (
    <View style={{ position: 'absolute', top: 0, left: side === 'right' ? size / 2 : 0, width: size / 2, height: size, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 0, left: side === 'right' ? -size / 2 : 0, width: size, height: size, transform: [{ rotate: `${rot}deg` }] }}>
        {rightHalfRing}
      </View>
    </View>
  );
  // Round caps only on solid colors: on a see-through color the overlap would show as a darker dot.
  const solid = color.length <= 7 || color.endsWith('ff');
  const capStyle = { position: 'absolute' as const, width: stroke, height: stroke, borderRadius: stroke / 2, backgroundColor: color };
  return (
    <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${start * 360}deg` }] }]}>
      {half('right', Math.min(deg, 180) - 180)}
      {deg > 180 && half('left', deg - 180)}
      {solid && <View style={[capStyle, cap(0)]} />}
      {solid && <View style={[capStyle, cap(deg)]} />}
    </View>
  );
}
