import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Ring } from '@/components/ring';
import { alpha, BusyOverlay, Button, ErrorNote, Group, IconTile, Row, SectionTitle, Sym, TapCard, tintBackground } from '@/components/ui';
import { useSystemColors } from '@/constants/theme';
import { getHealth, lookupBarcode, readListing, type Health } from '@/lib/api';
import { openReport } from '@/lib/current-report';
import { loadHistory, timeAgo, type HistoryEntry } from '@/lib/history';
import { pickImage, readPhoto } from '@/lib/photo';
import { productName, summarize } from '@/lib/report-view';
import type { Report } from '@/lib/types';

const DEMOS = [
  { code: '2000000000046', name: 'Leather Tote', teaser: 'Italy or China?', symbol: 'bag.fill', color: '#ff9500' },
  { code: '2000000000022', name: 'Everyday Tee', teaser: '100% cotton?', symbol: 'tshirt.fill', color: '#007aff' },
  { code: '2000000000039', name: 'Gold Necklace', teaser: 'Real gold?', symbol: 'sparkles', color: '#ffcc00' },
  { code: '2000000000015', name: 'Knit Sweater', teaser: 'Cashmere-feel?', symbol: 'cloud.fill', color: '#5856d6' },
];

const CAMERA_BG = '#1f2322';
const SHEET_RADIUS = 34;
const SPRING = { damping: 32, stiffness: 320, mass: 1 };
const GLASS = isLiquidGlassAvailable();

// What the screen is busy with: looking up a barcode, reading a photo, or reading a link.
type Work = 'lookup' | 'photo' | 'link';

// Every way to check a product lives here: barcodes are looked up as soon as they're in view,
// the shutter reads a care label, and online shoppers can paste a link or pick a screenshot.
// If a scanned barcode is new, the same camera asks for its label.
// The sheet rests half open over the camera; drag it up for everything else.
export default function ScanScreen() {
  const c = useSystemColors();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [focused, setFocused] = useState(true);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [working, setWorking] = useState<Work | null>(null);
  const [newGtin, setNewGtin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [link, setLink] = useState('');
  const [linkFocused, setLinkFocused] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const busy = useRef(false);

  // ---------- sheet ----------
  // Collapsed, the sheet shows the link field and the recent cards above the tab bar.
  const collapsedTop = Math.round(screenH * 0.46);
  const expandedTop = insets.top + 8;
  const sheetY = useSharedValue(collapsedTop);
  const dragStart = useSharedValue(0);

  const snapTo = useCallback(
    (open: boolean) => {
      sheetY.set(withSpring(open ? expandedTop : collapsedTop, SPRING));
      setExpanded(open);
      if (!open) scroll.current?.scrollTo({ y: 0, animated: false });
    },
    [sheetY, expandedTop, collapsedTop],
  );

  // Shared by both drag gestures. Passed by name: the worklets plugin can't take a spread config.
  const dragBegin = () => {
    'worklet';
    dragStart.set(sheetY.get());
  };
  const dragMove = (e: { translationY: number }) => {
    'worklet';
    // A little give past either end, like a native sheet.
    sheetY.set(Math.min(collapsedTop + 50, Math.max(expandedTop - 24, dragStart.get() + e.translationY)));
  };
  const dragEnd = (e: { velocityY: number }) => {
    'worklet';
    const open = e.velocityY < -500 ? true : e.velocityY > 500 ? false : sheetY.get() < (expandedTop + collapsedTop) / 2;
    sheetY.set(withSpring(open ? expandedTop : collapsedTop, SPRING));
    scheduleOnRN(setExpanded, open);
  };
  // The grabber always drags. The rest of the sheet drags while collapsed; once open it scrolls,
  // and pulling down past the top closes it (see onScrollEndDrag).
  const grabberPan = usePanGesture({ onActivate: dragBegin, onUpdate: dragMove, onDeactivate: dragEnd, activeOffsetY: [-4, 4] });
  const bodyPan = usePanGesture({ onActivate: dragBegin, onUpdate: dragMove, onDeactivate: dragEnd, enabled: !expanded, activeOffsetY: [-8, 8], failOffsetX: [-12, 12] });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.get() - expandedTop }] }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheetY.get(), [expandedTop, collapsedTop], [0.6, 0], Extrapolation.CLAMP) }));

  const live = !!permission?.granted && focused;

  useEffect(() => {
    getHealth().then(setHealth).catch((e) => setError(e.message));
  }, []);

  // Light status bar over the dark camera, the normal one on the camera intro. iOS takes the
  // status bar from the screen, so set it on the stack screen that holds the tabs.
  const navigation = useNavigation();
  useEffect(() => {
    const style = !focused ? 'auto' : permission?.granted || c.dark ? 'light' : 'dark';
    navigation.getParent()?.setOptions({ statusBarStyle: style });
  }, [navigation, focused, permission?.granted, c.dark]);

  // Only run the camera while this tab is on screen, and start fresh when we come back.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      busy.current = false;
      setWorking(null);
      setNewGtin(null);
      loadHistory().then(setHistory);
      return () => {
        setFocused(false);
        setReady(false);
        setTorch(false);
      };
    }, []),
  );

  // Runs one check at a time: on success the report opens, on failure the error shows and scanning resumes.
  const attempt = useCallback(async (kind: Work, work: () => Promise<{ report: Report; saved: boolean } | null>) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setWorking(kind);
    let pause = 0;
    try {
      const res = await work();
      if (res) {
        openReport(res.report, res.saved);
        return;
      }
    } catch (e) {
      setError((e as Error).message);
      // Don't read the same failing barcode again straight away.
      if (kind === 'lookup') pause = 1500;
    }
    setWorking(null);
    setTimeout(() => (busy.current = false), pause);
  }, []);

  const lookup = useCallback(
    (code: string) =>
      attempt('lookup', async () => {
        const res = await lookupBarcode(code);
        if (res.found) return { report: res.report, saved: true };
        // Stay on this camera and ask for the label; the barcode rides along with the photo.
        setNewGtin(res.gtin);
        snapTo(false);
        return null;
      }),
    [attempt, snapTo],
  );

  const gtin = newGtin ?? undefined;

  function snap() {
    if (!ready) return;
    attempt('photo', async () => {
      const pic = await camera.current?.takePictureAsync({ quality: 0.9 });
      if (!pic?.uri) throw new Error('Could not take the photo. Try again.');
      return readPhoto('label', pic.uri, gtin);
    });
  }

  async function pickPhoto(kind: 'label' | 'screenshot') {
    if (busy.current) return;
    busy.current = true; // no scanning behind the picker
    const uri = await pickImage().catch(() => null);
    busy.current = false;
    if (uri) attempt('photo', () => readPhoto(kind, uri, gtin));
  }

  function checkLink(value = link) {
    const raw = value.trim();
    if (raw) attempt('link', () => readListing(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`));
  }

  // Most people arrive with a link already copied: one tap pastes it and checks it.
  async function pasteAndCheck() {
    const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (!text) {
      setError('Nothing to paste. Copy a product link first.');
      return;
    }
    setLink(text);
    checkLink(text);
  }

  const denied = permission && !permission.granted;
  const showDemos = !newGtin && (__DEV__ || health?.mode === 'sample');
  const sampleMode = health?.mode === 'sample';
  const cameraH = collapsedTop + SHEET_RADIUS;
  const showWelcome = history.length === 0 && !linkFocused && !!permission?.granted;
  const hint =
    working === 'lookup' ? 'Barcode found. Looking it up…' : working ? null : newGtin ? 'Fill the frame with the care label' : 'Point at a barcode or care label';

  return (
    <View style={{ flex: 1, backgroundColor: permission?.granted ? CAMERA_BG : c.sheet }}>
      {/* ---------- camera ---------- */}
      <View style={[styles.camera, { height: cameraH, backgroundColor: permission?.granted ? CAMERA_BG : c.bg }]}>
        {live ? (
          <>
            <CameraView
              ref={camera}
              style={StyleSheet.absoluteFill}
              facing="back"
              active={!expanded}
              enableTorch={torch}
              onCameraReady={() => setReady(true)}
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
              onBarcodeScanned={newGtin || working || expanded ? undefined : (r) => lookup(r.data)}
            />
            <Viewfinder kind={newGtin ? 'label' : 'barcode'} />

            <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
              {newGtin ? (
                <Pressable onPress={() => setNewGtin(null)} accessibilityRole="button" accessibilityLabel="Cancel adding this product">
                  <Glass style={styles.capsule} interactive>
                    <Text style={styles.glassText}>Cancel</Text>
                  </Glass>
                </Pressable>
              ) : sampleMode ? (
                <Glass style={styles.capsule}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#ffd60a' }} />
                  <Text style={styles.glassText}>Sample Data</Text>
                </Glass>
              ) : (
                <View />
              )}
              <Pressable onPress={() => setTorch((t) => !t)} accessibilityRole="button" accessibilityLabel={torch ? 'Turn off flashlight' : 'Turn on flashlight'}>
                <Glass style={styles.circle} tint={torch ? '#ffffff' : undefined} interactive>
                  <Sym name={torch ? 'flashlight.on.fill' : 'flashlight.off.fill'} color={torch ? '#000' : '#fff'} size={19} />
                </Glass>
              </Pressable>
            </View>

            <View pointerEvents="box-none" style={[styles.bottom, { bottom: SHEET_RADIUS + 18 }]}>
              {hint && (
                <Glass style={styles.capsule}>
                  <Text style={styles.glassText}>{hint}</Text>
                </Glass>
              )}
              <View style={styles.controls}>
                <Pressable onPress={() => pickPhoto('label')} disabled={!!working} accessibilityRole="button" accessibilityLabel="Read a label from your photos">
                  <Glass style={styles.circleLg} interactive>
                    <Sym name="photo.on.rectangle" color="#fff" size={20} />
                  </Glass>
                </Pressable>
                <Pressable
                  onPress={snap}
                  disabled={!ready || !!working}
                  style={({ pressed }) => [styles.shutter, { opacity: !ready ? 0.5 : pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
                  accessibilityRole="button"
                  accessibilityLabel="Read the care label">
                  <View style={styles.shutterInner} />
                </Pressable>
                <View style={{ width: 50 }} />
              </View>
            </View>

            {working === 'photo' && <BusyOverlay label="Reading…" />}
          </>
        ) : denied ? (
          <View style={[styles.center, { paddingTop: insets.top, paddingBottom: SHEET_RADIUS }]}>
            <IconTile symbol="barcode.viewfinder" color={alpha(c.blue, 0.14)} fg={c.blue} size={76} />
            <Text style={[styles.introTitle, { color: c.label }]}>Scan Barcodes{'\n'}and Care Labels</Text>
            <Text style={{ color: c.sec, fontSize: 15, textAlign: 'center', maxWidth: 280 }}>Photos are read once and never stored.</Text>
            <Button title={permission.canAskAgain ? 'Allow Camera' : 'Open Settings'} onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()} />
          </View>
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </View>

      {/* Dims the camera as the sheet opens. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, dimStyle]} />

      {/* ---------- sheet ---------- */}
      <Animated.View
        style={[
          styles.sheet,
          { top: expandedTop, height: screenH - expandedTop, backgroundColor: c.sheet },
          // A faint edge so the dark sheet stands off a dark camera.
          c.dark && { borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
          sheetStyle,
        ]}>
        <GestureDetector gesture={grabberPan}>
          <Pressable onPress={() => snapTo(!expanded)} accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse' : 'Expand'} style={styles.grabberArea}>
            <View style={[styles.grabber, { backgroundColor: c.ter }]} />
          </Pressable>
        </GestureDetector>

        <GestureDetector gesture={bodyPan}>
          <ScrollView
            ref={scroll}
            scrollEnabled={expanded}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            showsVerticalScrollIndicator={false}
            onScrollEndDrag={(e) => {
              if (expanded && e.nativeEvent.contentOffset.y < -60) snapTo(false);
            }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 110 }}>
            {error && <ErrorNote style={{ marginBottom: 16 }}>{error}</ErrorNote>}

            {newGtin ? (
              <>
                <SectionTitle first>New Product</SectionTitle>
                <Text style={[styles.para, { color: c.sec }]}>{"We haven't seen this barcode yet. Snap its care label to check it and add it for the next shopper."}</Text>
              </>
            ) : (
              <>
                {showWelcome && (
                  <View style={[styles.welcome, { backgroundColor: c.cell2 }]}>
                    <IconTile symbol="barcode.viewfinder" color={c.blue} size={48} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.label, fontSize: 17, fontWeight: '600' }}>Scan Your First Product</Text>
                      <Text style={{ color: c.sec, fontSize: 15 }}>Point at a barcode or care label.</Text>
                    </View>
                  </View>
                )}

                <SectionTitle first={!showWelcome}>Shopping Online?</SectionTitle>
                <View style={[styles.field, { backgroundColor: c.cell2 }, linkFocused && { borderColor: c.blue }]}>
                  <Sym name="link" color={c.sec} size={17} weight="medium" />
                  <TextInput
                    value={link}
                    onChangeText={setLink}
                    onFocus={() => {
                      setLinkFocused(true);
                      snapTo(true);
                    }}
                    onBlur={() => setLinkFocused(false)}
                    placeholder="Paste a product link"
                    placeholderTextColor={c.ter}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="go"
                    onSubmitEditing={() => checkLink()}
                    editable={working !== 'link'}
                    style={[styles.input, { color: c.label }]}
                    accessibilityLabel="Product link"
                  />
                  <Pressable
                    onPress={link.trim() ? () => checkLink() : pasteAndCheck}
                    disabled={!!working}
                    style={({ pressed }) => [styles.fieldBtn, { backgroundColor: c.blue, opacity: pressed ? 0.8 : 1 }]}
                    accessibilityRole="button">
                    {working === 'link' ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>{link.trim() ? 'Check' : 'Paste'}</Text>}
                  </Pressable>
                </View>
                <Text style={[styles.alt, { color: c.sec }]}>
                  {"Store won't load? "}
                  <Text onPress={() => pickPhoto('screenshot')} style={{ color: c.blue }} accessibilityRole="button">
                    Use a Screenshot
                  </Text>
                </Text>

                {!linkFocused && history.length > 0 && (
                  <>
                    <SectionTitle>Recent</SectionTitle>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
                      {history.map((e) => (
                        <RecentCard key={e.id} entry={e} onPress={() => openReport(e.report, e.saved, { fresh: false })} />
                      ))}
                    </ScrollView>
                  </>
                )}

                {!linkFocused && showDemos && (
                  <>
                    <SectionTitle>Try a Demo</SectionTitle>
                    <Group bg={c.cell2}>
                      {DEMOS.map((d, i) => (
                        <Row key={d.code} separator={i > 0} icon={d} title={d.name} sub={d.teaser} chevron onPress={() => lookup(d.code)} />
                      ))}
                    </Group>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </GestureDetector>
      </Animated.View>
    </View>
  );
}

// ---------- pieces ----------

// Liquid Glass where the system has it, a dark translucent fill otherwise.
function Glass({ style, tint, interactive, children }: { style: StyleProp<ViewStyle>; tint?: string; interactive?: boolean; children: ReactNode }) {
  if (GLASS) {
    return (
      <GlassView glassEffectStyle="regular" colorScheme="dark" tintColor={tint} isInteractive={interactive} style={style}>
        {children}
      </GlassView>
    );
  }
  return <View style={[style, { backgroundColor: tint ?? 'rgba(0,0,0,0.45)' }]}>{children}</View>;
}

function RecentCard({ entry, onPress }: { entry: HistoryEntry; onPress: () => void }) {
  const c = useSystemColors();
  const s = summarize(entry.report);
  const color = c[s.tone];
  const name = productName(entry.report);
  return (
    <TapCard label={name} onPress={onPress} style={[styles.recent, { backgroundColor: c.cell2 }, tintBackground(color)]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Ring size={52} stroke={6} track={c.fill} segments={s.segments.map((x) => ({ value: x.value, color: x.strong ? color : alpha(color, 0.4) }))}>
          {s.issues > 0 ? (
            <Text style={{ color: c.label, fontSize: 20, fontWeight: '700' }}>{s.issues}</Text>
          ) : (
            <Sym name={s.tone === 'green' ? 'checkmark' : 'questionmark'} color={color} size={20} weight="bold" />
          )}
        </Ring>
        <Text style={{ color: c.sec, fontSize: 12 }}>{timeAgo(entry.checkedAt)}</Text>
      </View>
      <Text numberOfLines={2} style={[styles.recentName, { color: c.label }]}>{name}</Text>
      <Text style={{ color, fontSize: 13, fontWeight: '600' }}>{s.issues ? `${s.issues} ${s.word}` : s.word}</Text>
    </TapCard>
  );
}

// Corner brackets instead of a full box: they frame the target without hiding it.
function Viewfinder({ kind }: { kind: 'barcode' | 'label' }) {
  const frame = kind === 'barcode' ? styles.barcodeFrame : styles.labelFrame;
  return (
    <View pointerEvents="none" style={[styles.frame, frame]}>
      <View style={[styles.corner, { top: 0, left: 0, borderTopWidth: 3.5, borderLeftWidth: 3.5, borderTopLeftRadius: 14 }]} />
      <View style={[styles.corner, { top: 0, right: 0, borderTopWidth: 3.5, borderRightWidth: 3.5, borderTopRightRadius: 14 }]} />
      <View style={[styles.corner, { bottom: 0, left: 0, borderBottomWidth: 3.5, borderLeftWidth: 3.5, borderBottomLeftRadius: 14 }]} />
      <View style={[styles.corner, { bottom: 0, right: 0, borderBottomWidth: 3.5, borderRightWidth: 3.5, borderBottomRightRadius: 14 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  frame: { position: 'absolute', left: '16%', right: '16%' },
  barcodeFrame: { top: '28%', height: '22%' },
  labelFrame: { top: '16%', bottom: '38%' },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: '#fff' },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 18, paddingHorizontal: 16 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: 28 },
  capsule: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingHorizontal: 14, borderRadius: 18, overflow: 'hidden' },
  glassText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  circleLg: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  introTitle: { fontSize: 28, fontWeight: '700', lineHeight: 33, textAlign: 'center', letterSpacing: 0.36 },

  sheet: { position: 'absolute', left: 0, right: 0, borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS, borderCurve: 'continuous', overflow: 'hidden', boxShadow: '0 -8px 30px rgba(0,0,0,0.18)' },
  grabberArea: { height: 26, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 36, height: 5, borderRadius: 3 },
  para: { fontSize: 15, lineHeight: 21, marginHorizontal: 4 },
  welcome: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 22, borderCurve: 'continuous' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 50, paddingLeft: 14, paddingRight: 6, borderRadius: 14, borderCurve: 'continuous', borderWidth: 1, borderColor: 'transparent' },
  input: { flex: 1, fontSize: 17, height: '100%' },
  fieldBtn: { height: 38, minWidth: 72, paddingHorizontal: 16, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  alt: { fontSize: 15, marginTop: 10, marginHorizontal: 4 },
  recent: { width: 148, borderRadius: 22, borderCurve: 'continuous', padding: 14, gap: 10 },
  recentName: { fontSize: 15, fontWeight: '600', lineHeight: 19, minHeight: 38 },
});
