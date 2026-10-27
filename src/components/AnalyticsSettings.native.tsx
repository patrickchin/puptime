import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { initializeAppTelemetry, setAppTelemetryEnabled, appTelemetryConfigured } from '../telemetry';
import { useLocalization } from '../localization-context';
import { surfaceTreatment, type Theme } from '../theme';

export function AnalyticsSettings({ theme }: { theme: Theme }) {
  const { t } = useLocalization();
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(true);
  const locked = useRef(true);
  useEffect(() => {
    let mounted = true;
    void initializeAppTelemetry().then(value => {
      if (mounted) { setEnabled(value); setBusy(false); locked.current = false; }
    });
    return () => { mounted = false; };
  }, []);
  async function change(value: boolean) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { await setAppTelemetryEnabled(value); setEnabled(value); }
    catch { Alert.alert(t('settings.saveErrorTitle'), t('settings.saveErrorBody')); }
    finally { locked.current = false; setBusy(false); }
  }
  return <View style={[styles.card, surfaceTreatment(theme), { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
    <View style={styles.row}>
      <Text style={[styles.label, { color: theme.text }]}>{t('telemetry.title')}</Text>
      <Switch testID="settings.analytics" accessibilityLabel={t('telemetry.title')} accessibilityHint={t('telemetry.detail')}
        value={enabled} disabled={busy || (!appTelemetryConfigured && !enabled)} onValueChange={value => { void change(value); }}
        trackColor={{ false: theme.border, true: theme.primary }} thumbColor={theme.isDark ? theme.text : theme.surfaceRaised} ios_backgroundColor={theme.border} />
    </View>
    <Text style={[styles.detail, { color: theme.textMuted }]}>{t('telemetry.detail')}</Text>
    {!appTelemetryConfigured && <Text style={[styles.detail, { color: theme.textMuted }]}>{t('telemetry.unavailable')}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 22, padding: 16, marginBottom: 8 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  detail: { fontSize: 14, lineHeight: 21, marginTop: 6 },
});
