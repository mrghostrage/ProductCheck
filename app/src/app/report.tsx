import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ring } from '@/components/ring';
import { alpha, Chevron, Dashes, Group, IconTile, meshBackground, Row, SectionTitle, Sym, TapCard, tintBackground } from '@/components/ui';
import { useSystemColors, type Tone } from '@/constants/theme';
import { getCurrentReport } from '@/lib/current-report';
import {
  cap, categorySymbol, countryCode, gradeTone, materialKind, materialTone, originView, productName, rulesSummary, SHORT, sortedClaims, sourceLine, STAGE_SYMBOL, summarize, VERDICT_SYMBOL, VERDICT_TONE, WORDING,
} from '@/lib/report-view';
import { loadRuleResults, type RuleResult } from '@/lib/rules';
import type { Report } from '@/lib/types';

const HERO_FADE = 96;

export default function ReportScreen() {
  const c = useSystemColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cell = { width: (width - 32 - 12) / 2 }; // two cards per row
  const current = getCurrentReport();
  const [rules, setRules] = useState<RuleResult[] | null>(null);
  const [heroH, setHeroH] = useState(460);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (current) loadRuleResults(current.report).then(setRules);
  }, [current]);

  if (!current) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: c.sec, fontSize: 17 }}>No report to show.</Text>
      </View>
    );
  }

  const r = current.report;
  const name = productName(r);
  const sum = summarize(r);
  const hasLabel = r.sources.some((s) => s.type === 'label');
  const open = (key: string) => router.push({ pathname: '/detail', params: { item: key } });

  const share = () =>
    Share.share({ message: `${r.product.brand ? r.product.brand + ' ' : ''}${name}: ${sum.issues ? `${sum.issues} ${sum.word.toLowerCase()} found` : sum.word}.` });

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          title: scrolled ? name : '',
          headerTransparent: true,
          // iOS draws the glass header buttons with label-colored glyphs, so match that.
          headerTintColor: c.label,
          headerBackButtonDisplayMode: 'minimal',
          statusBarStyle: scrolled ? 'auto' : 'light',
          headerRight: () => (
            <Pressable onPress={share} accessibilityLabel="Share" hitSlop={8} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Sym name="square.and.arrow.up" color={c.label} size={19} weight="medium" />
            </Pressable>
          ),
        }}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="never"
        scrollEventThrottle={32}
        onScroll={(e) => {
          const s = e.nativeEvent.contentOffset.y > heroH - HERO_FADE - insets.top - 60;
          if (s !== scrolled) setScrolled(s);
        }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}>
        <Hero r={r} onLayout={setHeroH} />

        <View style={{ paddingHorizontal: 16 }}>
          <SectionTitle first>Origin</SectionTitle>
          <OriginCard r={r} onPress={() => open('origin')} />

          {r.claims.length + r.wording.length > 0 && (
            <>
              <SectionTitle>Claims</SectionTitle>
              <View style={styles.grid}>
                {sortedClaims(r).map((x, i) => (
                  <ClaimTile key={`c${i}`} cell={cell} tone={VERDICT_TONE[x.verdict]} symbol={VERDICT_SYMBOL[x.verdict]} title={`“${x.quote}”`} verdict={SHORT[x.verdict]} onPress={() => open(`claim:${i}`)} />
                ))}
                {r.wording.map((w, i) => {
                  const { tone, symbol, short } = WORDING[w.verdict];
                  return <ClaimTile key={`w${i}`} cell={cell} tone={tone} symbol={symbol} title={w.title} verdict={short} onPress={() => open(`wording:${i}`)} />;
                })}
              </View>
            </>
          )}

          {rules && rules.length > 0 && (
            <>
              <SectionTitle>For You</SectionTitle>
              <RulesBanner rules={rules} onPress={() => open('rules')} />
            </>
          )}

          <SectionTitle>Materials</SectionTitle>
          {r.materials.length > 0 ? (
            <View style={styles.grid}>
              {r.materials.flatMap((p, i) =>
                p.components.map((m, j) => {
                  const color = c[materialTone(m)];
                  return (
                    <TapCard key={`${i}.${j}`} label={m.label} onPress={() => open(`mat:${i}:${j}`)} cell={cell} style={[styles.card, styles.gauge, { backgroundColor: c.cell }]}>
                      <View style={styles.corner}><Chevron /></View>
                      <Ring size={104} stroke={12} track={c.fill} total={100} segments={[{ value: m.percent ?? 0, color }]}>
                        <Text style={[styles.pct, { color: c.label }]}>
                          {m.percent != null ? m.percent : '—'}
                          {m.percent != null && <Text style={{ fontSize: 14 }}>%</Text>}
                        </Text>
                      </Ring>
                      <View style={{ alignItems: 'center' }}>
                        <Text numberOfLines={1} style={[styles.gName, { color: c.label }]}>{m.label}</Text>
                        <Text numberOfLines={1} style={{ color: c.sec, fontSize: 13 }}>{`${cap(p.part)} · ${materialKind(m)}`}</Text>
                      </View>
                    </TapCard>
                  );
                }),
              )}
            </View>
          ) : (
            <View style={[styles.card, styles.empty, { backgroundColor: c.cell }]}>
              <Sym name="tag" color={c.sec} size={28} weight="regular" />
              <Text style={{ color: c.sec, fontSize: 15 }}>No material list yet</Text>
            </View>
          )}
          {r.jewelryMarks.length > 0 && <Text style={[styles.foot, { color: c.sec, marginTop: 10 }]}>{`Stamps: ${r.jewelryMarks.join(', ')}`}</Text>}

          <SectionTitle>Supply Chain</SectionTitle>
          <ChainCard r={r} onPress={() => open('chain')} />

          {r.certifications.length > 0 && (
            <>
              <SectionTitle>Certifications</SectionTitle>
              <Group style={styles.card}>
                {r.certifications.map((x, i) => (
                  <Row key={i} separator={i > 0} title={x.name} right={<Text style={{ color: c.sec, fontSize: 15 }}>{x.status}</Text>} />
                ))}
              </Group>
            </>
          )}

          {r.care.length > 0 && (
            <>
              <SectionTitle>Care</SectionTitle>
              <Group style={styles.card}>
                {r.care.map((x, i) => (
                  <Row key={i} separator={i > 0} title={x} />
                ))}
              </Group>
            </>
          )}

          <View style={{ marginTop: 28, gap: 4 }}>
            {[sourceLine(r), r.sampleMode && 'Sample data', ...r.notes, !current.saved && r.product.gtin == null && 'Not saved: no barcode found.']
              .filter(Boolean)
              .map((line, i) => (
                <Text key={i} style={[styles.foot, { color: c.sec }]}>{line}</Text>
              ))}
          </View>
        </View>
      </ScrollView>

      <View pointerEvents="box-none" style={[styles.dock, { bottom: insets.bottom + 8 }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => (hasLabel ? router.back() : router.push({ pathname: '/label', params: { gtin: r.product.gtin ?? undefined } }))}
          style={({ pressed }) => [styles.dockBtn, { backgroundColor: c.label, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
          <Sym name={hasLabel ? 'barcode.viewfinder' : 'camera.viewfinder'} color={c.bg} size={20} />
          <Text style={{ color: c.bg, fontSize: 17, fontWeight: '600' }}>{hasLabel ? 'Scan Another' : 'Add Care Label'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------- Hero ----------

function Hero({ r, onLayout }: { r: Report; onLayout: (h: number) => void }) {
  const c = useSystemColors();
  const { top } = useSafeAreaInsets();
  const sum = summarize(r);
  const mesh = meshBackground(sum.tone, c.dark);
  const bg = c.bg.slice(0, 7);

  return (
    <View onLayout={(e) => onLayout(e.nativeEvent.layout.height)} style={[styles.hero, mesh, { paddingTop: top + 52, paddingBottom: HERO_FADE - 8 }]}>
      {/* Covers the pull-down bounce above the hero. */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: -1000, height: 1000, backgroundColor: mesh.backgroundColor }} />
      {/* Fades the color into the page. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: HERO_FADE, backgroundImage: `linear-gradient(to bottom, ${bg}00 0%, ${bg} 100%)` }} />
      <IconTile symbol={categorySymbol(r.product.category)} color="#ffffff38" size={56} weight="medium" style={styles.prod} />
      {r.product.brand && <Text style={styles.brand}>{r.product.brand}</Text>}
      <Text style={styles.title} numberOfLines={2}>{productName(r)}</Text>

      <View style={{ marginTop: 22, marginBottom: 6 }}>
        <Ring size={196} stroke={18} track="#ffffff38" segments={sum.segments.map((s) => ({ value: s.value, color: s.strong ? '#ffffff' : '#ffffff8c' }))}>
          {sum.issues > 0 ? (
            <Text style={styles.big}>{sum.issues}</Text>
          ) : (
            <Sym name={sum.tone === 'green' ? 'checkmark' : 'questionmark'} color="#fff" size={64} weight="bold" />
          )}
          <Text style={styles.word}>{sum.word}</Text>
        </Ring>
      </View>

      {sum.keys.length > 0 && (
        <View style={styles.keys}>
          {sum.keys.map((k) => (
            <View key={k.label} style={styles.key}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k.strong ? '#fff' : '#ffffff8c' }} />
              <Text style={styles.keyText}>{k.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------- Origin (boarding pass) ----------

function OriginCard({ r, onPress }: { r: Report; onPress: () => void }) {
  const c = useSystemColors();
  const o = originView(r);
  const grade = c[gradeTone(r.origin.grade)];
  return (
    <TapCard label="Origin details" onPress={onPress} style={[styles.card, { backgroundColor: c.cell, overflow: 'hidden' }]}>
      <View style={{ padding: 20, paddingBottom: 18 }}>
        {o.mismatch ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
            <Stop caption="Listing" country={o.listing} struck />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 30 }}>
              <Dashes color={c.fill} count={6} style={{ flex: 1 }} />
              <Sym name="arrow.right" color={c.red} size={18} weight="bold" />
            </View>
            <Stop caption="Care Label" country={o.label} end />
          </View>
        ) : (
          <Stop caption={r.origin.text ? 'Care Label' : o.listing ? 'Listing' : 'Origin'} country={o.label ?? o.listing} />
        )}
      </View>
      <View>
        <Dashes color={c.sep} count={30} style={{ marginHorizontal: 16 }} />
        <View style={[styles.notch, { left: -11, backgroundColor: c.bg }]} />
        <View style={[styles.notch, { right: -11, backgroundColor: c.bg }]} />
      </View>
      <View style={styles.stub}>
        <Text numberOfLines={1} style={{ color: c.sec, fontSize: 15, flex: 1 }}>{r.origin.text ? `“${r.origin.text}”` : 'No origin on the label'}</Text>
        <View style={[styles.tag, { backgroundColor: alpha(grade, 0.14) }]}>
          <Text style={{ color: grade, fontSize: 13, fontWeight: '600' }}>{o.mismatch ? 'Mismatch' : r.origin.gradeLabel}</Text>
        </View>
        <Chevron />
      </View>
    </TapCard>
  );
}

function Stop({ caption, country, struck, end }: { caption: string; country: string | null; struck?: boolean; end?: boolean }) {
  const c = useSystemColors();
  return (
    <View style={{ alignItems: end ? 'flex-end' : 'flex-start' }}>
      <Text style={[styles.caption, { color: c.sec }]}>{caption}</Text>
      <View>
        <Text style={[styles.code, { color: struck ? c.ter : c.label }]}>{country ? countryCode(country) : '—'}</Text>
        {struck && <View style={[styles.strike, { backgroundColor: c.red }]} />}
      </View>
      <Text style={{ color: c.sec, fontSize: 15, marginTop: 2 }}>{country ?? 'Not disclosed'}</Text>
    </View>
  );
}

// ---------- Claims ----------

function ClaimTile({ cell, tone, symbol, title, verdict, onPress }: { cell: { width: number }; tone: Tone; symbol: string; title: string; verdict: string; onPress: () => void }) {
  const c = useSystemColors();
  const color = c[tone];
  return (
    <TapCard label={`${title}: ${verdict}`} onPress={onPress} cell={cell} style={[styles.card, styles.tile, { backgroundColor: c.cell }, tintBackground(color)]}>
      <View style={styles.corner}><Chevron /></View>
      <IconTile symbol={symbol} color={color} size={34} round weight="bold" />
      <Text numberOfLines={4} style={[styles.quote, { color: c.label }]}>{title}</Text>
      <Text style={{ color, fontSize: 15, fontWeight: '600' }}>{verdict}</Text>
    </TapCard>
  );
}

// ---------- Rules ----------

function RulesBanner({ rules, onPress }: { rules: RuleResult[]; onPress: () => void }) {
  const c = useSystemColors();
  const s = rulesSummary(rules);
  return (
    <TapCard label={s.title} onPress={onPress} style={[styles.card, styles.banner, { backgroundColor: c.cell }]}>
      <IconTile symbol={s.symbol} color={c[s.tone]} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.label, fontSize: 17, fontWeight: '600' }}>{s.title}</Text>
        <Text numberOfLines={1} style={{ color: c.sec, fontSize: 15 }}>{s.sub}</Text>
      </View>
      <Chevron />
    </TapCard>
  );
}

// ---------- Supply chain ----------

function ChainCard({ r, onPress }: { r: Report; onPress: () => void }) {
  const c = useSystemColors();
  const o = originView(r);
  return (
    <TapCard label="Supply chain details" onPress={onPress} style={[styles.card, { backgroundColor: c.cell, padding: 18, paddingTop: 22, gap: 16 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {r.origin.ladder.map((s, i) => (
          <View key={s.stage} style={{ flexDirection: 'row', alignItems: 'center', flex: i === 0 ? 0 : 1 }}>
            {i > 0 && <View style={{ flex: 1, height: 2, backgroundColor: c.fill }} />}
            <IconTile
              symbol={STAGE_SYMBOL[s.stage] ?? 'circle'}
              size={42}
              round
              color={s.country ? c.blue : c.fill}
              fg={s.country ? '#fff' : c.ter}
              style={s.country && { boxShadow: `0 6px 14px -6px ${c.blue}` }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: c.sec, fontSize: 15 }}>
          <Text style={{ color: c.label, fontSize: 17, fontWeight: '700' }}>{`${o.known} of ${o.total}`}</Text> steps known
        </Text>
        <Chevron />
      </View>
    </TapCard>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingHorizontal: 20 },
  prod: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff66' },
  brand: { color: '#ffffffcc', fontSize: 15, fontWeight: '600', marginTop: 12 },
  title: { color: '#fff', fontSize: 34, fontWeight: '700', letterSpacing: 0.37, textAlign: 'center' },
  big: { color: '#fff', fontSize: 72, fontWeight: '700', letterSpacing: -2, lineHeight: 76, fontVariant: ['tabular-nums'] },
  word: { color: '#ffffffd9', fontSize: 15, fontWeight: '600' },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 10 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: '#ffffff33', borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff59' },
  keyText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  card: { borderRadius: 26, borderCurve: 'continuous' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  corner: { position: 'absolute', top: 14, right: 14, zIndex: 1 },

  caption: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  code: { fontSize: 46, fontWeight: '700', letterSpacing: -0.5, marginTop: 4, fontVariant: ['tabular-nums'] },
  strike: { position: 'absolute', left: -3, right: -3, top: '50%', height: 4, borderRadius: 2, transform: [{ rotate: '-8deg' }] },
  notch: { position: 'absolute', top: -11, width: 22, height: 22, borderRadius: 11 },
  stub: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },

  tile: { minHeight: 150, padding: 16, gap: 10 },
  quote: { flex: 1, fontSize: 19, fontWeight: '700', lineHeight: 22, letterSpacing: -0.3 },

  banner: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, paddingHorizontal: 16 },

  gauge: { alignItems: 'center', gap: 12, paddingTop: 18, paddingBottom: 16, paddingHorizontal: 12 },
  pct: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  gName: { fontSize: 17, fontWeight: '600' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 28 },

  foot: { fontSize: 13, textAlign: 'center' },

  dock: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  dockBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 54, paddingHorizontal: 28, borderRadius: 27, boxShadow: '0 10px 30px -10px rgba(0,0,0,0.45)' },
});
