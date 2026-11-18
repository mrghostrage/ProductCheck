import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { alpha, Group, meshBackground, Row, SectionTitle, Sym } from '@/components/ui';
import { useSystemColors } from '@/constants/theme';
import { correctionsUrl, methodologyUrl } from '@/lib/api';
import { sameCountry } from '@/lib/report-view';
import { AVOIDABLE, DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from '@/lib/rules';

type Flag = 'naturalOnly' | 'vegan' | 'noPlasticLeather' | 'nickelAllergy';
const FLAGS: { key: Flag; title: string; sub: string; symbol: string; color: string }[] = [
  { key: 'naturalOnly', title: 'Natural Fibers Only', sub: 'Cotton, linen, wool, silk', symbol: 'leaf.fill', color: '#34c759' },
  { key: 'vegan', title: 'Vegan', sub: 'No leather, wool, silk or down', symbol: 'hare.fill', color: '#30b0c7' },
  { key: 'noPlasticLeather', title: 'No Plastic Leather', sub: 'Flags PU and PVC', symbol: 'drop.fill', color: '#ff9500' },
  { key: 'nickelAllergy', title: 'Nickel Allergy', sub: 'Checks jewelry and metals', symbol: 'allergens', color: '#ff2d55' },
];

// Personal rules. Every report checks the product against them; they never leave the phone.
export default function RulesScreen() {
  const c = useSystemColors();
  const insets = useSafeAreaInsets();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [country, setCountry] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadPrefs().then(setPrefs);
    }, []),
  );

  function update(next: Prefs) {
    setPrefs(next);
    savePrefs(next);
  }

  // Takes the text from the input's own event: the state copy can lag a fast typist by a render.
  function addCountry(value: string) {
    const name = value.trim();
    setCountry('');
    if (!name || prefs.countries.some((x) => sameCountry(x, name))) return;
    update({ ...prefs, countries: [...prefs.countries, name] });
  }

  const active = prefs.avoid.length + FLAGS.filter((f) => prefs[f.key]).length + (prefs.countries.length ? 1 : 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: insets.bottom + 110 }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      <Text style={[styles.largeTitle, { color: c.label }]}>My Rules</Text>

      <Summary active={active} />

      <SectionTitle>Preferences</SectionTitle>
      <Group>
        {FLAGS.map((f, i) => (
          <Row
            key={f.key}
            separator={i > 0}
            icon={f}
            title={f.title}
            sub={f.sub}
            right={<Switch value={prefs[f.key]} onValueChange={(v) => update({ ...prefs, [f.key]: v })} accessibilityLabel={f.title} />}
          />
        ))}
      </Group>

      <SectionTitle>Avoid</SectionTitle>
      <View style={styles.chips}>
        {AVOIDABLE.map((a) => {
          const on = prefs.avoid.includes(a.key);
          return (
            <Pressable
              key={a.key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => update({ ...prefs, avoid: on ? prefs.avoid.filter((k) => k !== a.key) : [...prefs.avoid, a.key] })}
              style={({ pressed }) => [styles.chip, { backgroundColor: on ? c.blue : c.cell, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
              {on && <Sym name="checkmark" color="#fff" size={13} weight="bold" />}
              <Text style={{ color: on ? '#fff' : c.label, fontSize: 15, fontWeight: on ? '600' : '400' }}>{a.label.replace(/ \(.*\)$/, '')}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.footnote, { color: c.sec }]}>Tap to flag a material on every report.</Text>

      <SectionTitle>Made In</SectionTitle>
      <Group>
        {prefs.countries.length > 0 && (
          <View style={[styles.tokens, { borderBottomColor: c.sep }]}>
            {prefs.countries.map((name) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${name}`}
                onPress={() => update({ ...prefs, countries: prefs.countries.filter((x) => x !== name) })}
                style={({ pressed }) => [styles.token, { backgroundColor: alpha(c.blue, 0.12), opacity: pressed ? 0.6 : 1 }]}>
                <Text style={{ color: c.blue, fontSize: 15, fontWeight: '600' }}>{name}</Text>
                <Sym name="xmark.circle.fill" color={alpha(c.blue, 0.55)} size={15} />
              </Pressable>
            ))}
          </View>
        )}
        <Row
          icon={{ symbol: 'globe.americas.fill', color: c.blue }}
          right={
            country.trim().length > 0 && (
              <Pressable onPress={() => addCountry(country)} accessibilityRole="button" accessibilityLabel="Add country" hitSlop={8}>
                <Sym name="plus.circle.fill" color={c.blue} size={24} />
              </Pressable>
            )
          }>
          <TextInput
            value={country}
            onChangeText={setCountry}
            onSubmitEditing={(e) => addCountry(e.nativeEvent.text)}
            onEndEditing={(e) => addCountry(e.nativeEvent.text)}
            returnKeyType="done"
            submitBehavior="submit"
            placeholder="Add a country"
            placeholderTextColor={c.ter}
            autoCapitalize="words"
            autoCorrect={false}
            style={[styles.input, { color: c.label }]}
            accessibilityLabel="Add an allowed country"
          />
        </Row>
      </Group>
      <Text style={[styles.footnote, { color: c.sec }]}>
        {prefs.countries.length ? 'Tap a country to remove it.' : 'Leave empty to allow any country.'}
      </Text>

      <SectionTitle>About</SectionTitle>
      <Group>
        <Row role="link" chevron icon={{ symbol: 'checkmark.seal.fill', color: '#5856d6' }} title="How We Check" onPress={() => WebBrowser.openBrowserAsync(methodologyUrl)} />
        <Row role="link" chevron separator icon={{ symbol: 'list.bullet.clipboard.fill', color: '#8e8e93' }} title="Corrections Log" onPress={() => WebBrowser.openBrowserAsync(correctionsUrl)} />
      </Group>
    </ScrollView>
  );
}

function Summary({ active }: { active: number }) {
  const { dark } = useSystemColors();
  return (
    <View style={[styles.summary, meshBackground('blue', dark)]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.big}>{active}</Text>
        <Text style={styles.bigLabel}>{active === 1 ? 'Rule On' : active ? 'Rules On' : 'No Rules Yet'}</Text>
        <Text style={styles.summarySub}>{active ? 'Checked on every report.' : 'Turn some on below.'}</Text>
      </View>
      <View style={styles.lock}>
        <Sym name="lock.shield.fill" color="#fff" size={30} />
        <Text style={styles.lockText}>{'Only on\nthis phone'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.37, marginHorizontal: 4, marginBottom: 16 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 26, borderCurve: 'continuous', overflow: 'hidden' },
  big: { color: '#fff', fontSize: 56, fontWeight: '700', letterSpacing: -1.5, lineHeight: 60, fontVariant: ['tabular-nums'] },
  bigLabel: { color: '#fff', fontSize: 20, fontWeight: '700' },
  summarySub: { color: '#ffffffcc', fontSize: 15, marginTop: 2 },
  lock: { width: 92, height: 92, borderRadius: 22, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#ffffff2e', borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff59' },
  lockText: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 15 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 20 },
  footnote: { fontSize: 13, marginTop: 8, marginHorizontal: 16 },

  tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  token: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingLeft: 14, paddingRight: 10, borderRadius: 17 },
  input: { flex: 1, fontSize: 17, height: 44 },
});
