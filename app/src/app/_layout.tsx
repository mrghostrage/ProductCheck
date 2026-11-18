import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useSystemColors } from '@/constants/theme';

export default function RootLayout() {
  const c = useSystemColors();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={c.dark ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="label" options={{ presentation: 'fullScreenModal', headerShown: false }} />
          <Stack.Screen name="report" options={{ title: '', headerBackTitle: 'Back' }} />
          <Stack.Screen
            name="detail"
            options={{
              presentation: 'formSheet',
              headerShown: false,
              sheetGrabberVisible: true,
              sheetAllowedDetents: 'fitToContents',
              contentStyle: { backgroundColor: c.sheet },
            }}
          />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
