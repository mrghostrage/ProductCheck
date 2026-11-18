// The sheet that opens when a card on the report is tapped. Built from the same report, by key.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Group, IconTile, Row, Sym } from '@/components/ui';
import { useSystemColors } from '@/constants/theme';
import { getCurrentReport } from '@/lib/current-report';
import { detailFor, type DetailRow } from '@/lib/report-view';
import { loadRuleResults, type RuleResult } from '@/lib/rules';

export default function DetailSheet() {
  const c = useSystemColors();
  const insets = useSafeAreaInsets();
  const { item: key } = useLocalSearchParams<{ item: string }>();
  const current = getCurrentReport();
  const [rules, setRules] = useState<RuleResult[] | null>(null);

  useEffect(() => {
    if (key === 'rules' && current) loadRuleResults(current.report).then(setRules);
  }, [key, current]);

  const d = current && key ? detailFor(key, current.report, rules) : null;
  if (!d) return <View style={{ height: 200, backgroundColor: c.sheet }} />;
  const color = c[d.tone];

  return (
    <View style={{ backgroundColor: c.sheet, paddingBottom: Math.max(24, insets.bottom - 10) }}>
      <View style={styles.top}>
        <IconTile symbol={d.symbol} color={color} size={44} style={{ boxShadow: `0 6px 14px -6px ${color}` }} />
        <Text numberOfLines={2} style={[styles.title, { color: c.label }]}>{d.title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => router.back()} style={[styles.close, { backgroundColor: c.fill }]}>
          <Sym name="xmark" color={c.sec} size={13} weight="bold" />
        </Pressable>
      </View>

      <View style={styles.body}>
        <Text style={[styles.lead, { color: c.label }]}>
          {d.lead.map((s, i) => (
            <Text key={i} style={[s.bold && { fontWeight: '700' }, s.tone && { color: c[s.tone] }]}>{s.t}</Text>
          ))}
        </Text>

        {d.groups.map((g, i) => (
          <Rows key={i} label={g.label} rows={g.rows} />
        ))}

        {d.notes.map((n, i) => (
          <Text key={i} style={[styles.note, { color: c.sec }]}>{n}</Text>
        ))}

        {d.source && <Rows label="Source" rows={[{ k: d.source }]} />}

        {d.action === 'rules' && (
          <Button
            title="Edit Rules"
            kind="tinted"
            onPress={() => {
              router.back();
              router.navigate('/rules');
            }}
          />
        )}
      </View>
    </View>
  );
}

function Rows({ label, rows }: { label?: string; rows: DetailRow[] }) {
  const c = useSystemColors();
  return (
    <View>
      {label && <Text style={[styles.label, { color: c.sec }]}>{label}</Text>}
      <Group bg={c.cell2}>
        {rows.map((row, i) => (
          <Row
            key={i}
            separator={i > 0}
            title={row.k}
            sub={row.sub}
            right={
              row.v && (
                <Text style={[styles.value, { color: row.vTone ? c[row.vTone] : row.bold ? c.label : c.sec, fontWeight: row.bold || row.vTone ? '600' : '400' }]}>{row.v}</Text>
              )
            }
          />
        ))}
      </Group>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 26, paddingBottom: 16 },
  title: { flex: 1, fontSize: 22, fontWeight: '700', letterSpacing: 0.35 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 16, gap: 22 },
  lead: { fontSize: 17, lineHeight: 23, paddingHorizontal: 4 },
  label: { fontSize: 13, textTransform: 'uppercase', paddingHorizontal: 16, paddingBottom: 6 },
  value: { fontSize: 17, textAlign: 'right', maxWidth: '50%' },
  note: { fontSize: 15, lineHeight: 21, paddingHorizontal: 16 },
});
