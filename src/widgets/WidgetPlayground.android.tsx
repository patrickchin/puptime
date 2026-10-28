import { useState } from 'react';
import { ScrollView, Switch, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WidgetPreview } from 'react-native-android-widget';
import { QuickLogWidget } from './QuickLogWidget.android';
import { type WidgetLayout } from './widget-layouts';
import { resolveTheme } from '../theme';
import type { QuickEventTimes, ActivityKey } from '../domain';

// Compile-time-only design gallery. Enable with EXPO_PUBLIC_WIDGET_PLAYGROUND=1.
// Samples use the same Android renderer and measured hit areas as the launcher.
export default function WidgetPlayground() {
  const [dark, setDark] = useState(false);
  const [now] = useState(Date.now);
  const [message, setMessage] = useState('Sample day · Mochi');
  const [openNapAt, setNap] = useState<number>();
  const [lastEventAt, setTimes] = useState<QuickEventTimes>({
    pee: now - 12 * 60_000, poop: now - 47 * 60_000, meal: now - 28 * 60_000,
    pottyTrip: now - 12 * 60_000, walk: now - 65 * 60_000, nap: now - 95 * 60_000,
  });
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth - 32, 440);
  const theme = resolveTheme('system', dark ? 'dark' : 'light');
  const caption = { color: theme.textMuted, fontSize: 12, fontWeight: '700' as const, marginBottom: 4 };
  const preview = (layout: WidgetLayout, width: number, height: number) => (
    <WidgetPreview width={width} height={height} renderWidget={() => <QuickLogWidget layout={layout} compact={height < 90} activeNap={openNapAt !== undefined} openNapAt={openNapAt} lastEventAt={lastEventAt} nextPottyAt={now + 18 * 60_000} previewAt={now} themePreference={dark ? 'dark' : 'light'} />}
      onClick={({ clickActionData }) => {
        const type = clickActionData?.type as ActivityKey;
        if (type) { if (type === 'nap') setNap(previous => previous === undefined ? now : undefined); setTimes(previous => ({ ...previous, [type]: now })); setMessage(`Sample · ${type === 'meal' ? 'Meal' : type[0].toUpperCase() + type.slice(1)} logged`); }
      }} />
  );
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: theme.isDark ? theme.background : theme.border }}>
    <StatusBar style={dark ? 'light' : 'dark'} />
    <ScrollView contentContainerStyle={{ padding: 16, alignItems: 'center', gap: 8 }}>
      <View style={{ width, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View><Text style={{ color: theme.text, fontSize: 25, fontWeight: '800' }}>Widget layouts</Text><Text accessibilityLiveRegion="polite" style={{ color: theme.textMuted, fontSize: 12, marginTop: 3 }}>{message}</Text></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ color: theme.text, fontSize: 12 }}>Dark</Text><Switch testID="widget-playground.dark" accessibilityLabel="Dark appearance" style={{ minWidth: 48, minHeight: 48 }} value={dark} onValueChange={setDark} /></View>
      </View>
      <View><Text style={caption}>01  QUICK LOG · 4 × 1 · DEFAULT</Text>{preview('row', width, 104)}</View>
      <View><Text style={caption}>02  ALL ACTIVITIES · 4 × 2</Text>{preview('grid', width, 208)}</View>
      <View><Text style={caption}>03  AT A GLANCE · 4 × 2</Text>{preview('overview', width, 208)}</View>
      <View style={{ width, flexDirection: 'row', gap: 20 }}>
        <View><Text style={caption}>04  SINGLE · 1 × 1</Text>{preview('single', 80, 104)}</View>
        <View><Text style={caption}>05  PAIR · 2 × 1</Text>{preview('pair', 172, 104)}</View>
      </View>
    </ScrollView>
  </SafeAreaView></SafeAreaProvider>;
}
