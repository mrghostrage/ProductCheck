import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BusyOverlay, Button, ErrorNote } from '@/components/ui';
import { useSystemColors } from '@/constants/theme';
import { openReport } from '@/lib/current-report';
import { pickImage, readPhoto } from '@/lib/photo';

// Adds a care label to a product whose report has none yet. The photo is read once and never stored.
export default function LabelScreen() {
  const c = useSystemColors();
  const { gtin } = useLocalSearchParams<{ gtin?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(getUri: () => Promise<string | null | undefined>) {
    setError(null);
    try {
      const uri = await getUri();
      if (!uri) return;
      setBusy(true);
      const res = await readPhoto('label', uri, gtin);
      openReport(res.report, res.saved, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.title, { color: c.label }]}>Snap the Care Label</Text>
            <Text style={[styles.para, { color: c.sec }]}>Fill the frame with the label so the text is sharp. Include the materials and the &quot;Made in&quot; line.</Text>
          </View>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
            <Text style={{ color: c.blue, fontSize: 17, fontWeight: '600' }}>Close</Text>
          </Pressable>
        </View>

        {error && <ErrorNote>{error}</ErrorNote>}

        <View style={[styles.cameraBox, { backgroundColor: c.cell }]}>
          {permission?.granted ? (
            <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />
          ) : (
            <View style={styles.center}>
              <Text style={[styles.para, { color: c.sec, textAlign: 'center' }]}>Camera access is needed to photograph the label.</Text>
              {permission && <Button title="Allow Camera" onPress={requestPermission} />}
            </View>
          )}
          {busy && <BusyOverlay label="Reading the label…" />}
        </View>

        <View style={{ gap: 10 }}>
          <Button title="Take Photo" onPress={() => send(async () => (await camera.current?.takePictureAsync({ quality: 0.9 }))?.uri)} disabled={!ready || busy} />
          <Button title="Choose from Photos" kind="tinted" onPress={() => send(pickImage)} disabled={busy} />
          <Text style={{ color: c.sec, fontSize: 13, textAlign: 'center' }}>Photos are read once and never stored.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 14 },
  header: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: 0.36 },
  para: { fontSize: 15, lineHeight: 21 },
  cameraBox: { flex: 1, borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden', minHeight: 280 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
});
