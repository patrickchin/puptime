import {useRef, useState} from 'react';
import {Alert, StyleSheet, Text, View} from 'react-native';
import {useLocalization} from '../localization-context';
import {loadEvents} from '../storage';
import {shareEventsCsv} from '../share-export';
import {surfaceTreatment, type Theme} from '../theme';
import {SettingsRow} from './SettingsRow';

export function ActivityCsvSettings({theme, eventCount, onImport}: {
  theme: Theme;
  eventCount: number;
  onImport: () => Promise<void>;
}) {
  const {t} = useLocalization();
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const locked = useRef(false);
  async function transfer(kind: 'export' | 'import') {
    if (locked.current) return;
    locked.current = true;
    setBusy(kind);
    try {
      if (kind === 'export') await shareEventsCsv(await loadEvents());
      else await onImport();
    } catch {
      Alert.alert(t(`insights.${kind}ErrorTitle`), t(`insights.${kind}ErrorBody`));
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  return <View style={[styles.card, surfaceTreatment(theme), {backgroundColor: theme.surfaceRaised, borderColor: theme.border}]}>
    <SettingsRow testID="settings.export" icon="file-export-outline" label={t('insights.exportButton')}
      detail={t(busy === 'export' ? 'settings.exporting' : eventCount ? 'insights.exportHint' : 'insights.noExport')}
      disabled={busy !== null || !eventCount} onPress={() => void transfer('export')} theme={theme} wrap />
    <View style={[styles.divider, {backgroundColor: theme.border}]} />
    <SettingsRow testID="settings.import" icon="file-import-outline" label={t('insights.importButton')}
      detail={t(busy === 'import' ? 'insights.importing' : 'insights.importHint')}
      disabled={busy !== null} onPress={() => void transfer('import')} theme={theme} wrap />
    <Text style={[styles.caption, {color: theme.textMuted}]}>{t('settings.csvDetail')}</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 22, padding: 8, marginBottom: 8},
  divider: {height: StyleSheet.hairlineWidth, marginHorizontal: 8},
  caption: {fontSize: 12, lineHeight: 18, padding: 8},
});
