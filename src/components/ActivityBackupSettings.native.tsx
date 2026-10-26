import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getLocalRuntime } from '../local/runtime.native';
import type { BackupSummary } from '../local/activity-backups';
import { useLocalization } from '../localization-context';
import { shareEventsCsv } from '../share-export';
import { spacing, surfaceTreatment, type Theme } from '../theme';
import { SettingsRow } from './SettingsRow';

export function ActivityBackupSettings({ theme, onRestored }: { theme: Theme; onRestored?: () => Promise<void> }) {
  const { t, language } = useLocalization();
  const [visible, setVisible] = useState(false), [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<BackupSummary[]>([]), [failed, setFailed] = useState(false);
  const [selectedPet,setSelectedPet]=useState<string|null>(null);
  const [unreadable, setUnreadable] = useState(0);
  const locked = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function reload() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setFailed(false);
    try {
      const { backups: service } = await getLocalRuntime();
      let captureFailed = false;
      try { await service.capture(); } catch { captureFailed = true; }
      const result = await service.list();
      if (mounted.current) { setBackups(result.backups); setUnreadable(result.unreadable); setFailed(captureFailed); }
    } catch { if (mounted.current) setFailed(true); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function recover(backup: BackupSummary, exporting: boolean) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try {
      const { backups: service } = await getLocalRuntime();
      if (exporting) await shareEventsCsv((await service.read(backup.id)).events);
      else {
        const result = await service.restore(backup.id);
        await onRestored?.();
        Alert.alert(t('backup.recovered'), t('backup.result', { ...result, name: backup.puppyName }));
      }
    } catch { Alert.alert(t('backup.errorTitle'), t(exporting ? 'backup.exportError' : 'backup.restoreError')); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  const timestamp = (value: number) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  function select(backup: BackupSummary) {
    Alert.alert(timestamp(backup.createdAt), t('backup.confirm', { count: backup.count, name: backup.puppyName }), [
      { text: t('app.cancel'), style: 'cancel' },
      { text: t('backup.export'), onPress: () => void recover(backup, true) },
      { text: t('backup.restore'), onPress: () => void recover(backup, false) },
    ]);
  }
  const pets=[...new Map(backups.map(backup=>[backup.petId,backup.puppyName])).entries()];
  const visibleBackups=selectedPet?backups.filter(backup=>backup.petId===selectedPet):backups;
  return <>
    <View style={[styles.card, surfaceTreatment(theme), { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
      <SettingsRow testID="settings.backups.open" icon="backup-restore" label={t('backup.title')} detail={t('backup.detail')} wrap theme={theme}
        onPress={() => { setSelectedPet(null);setVisible(true); void reload(); }} />
    </View>
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!busy) setVisible(false); }}>
      <SafeAreaView style={[styles.page, { backgroundColor: theme.surface }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{t('backup.title')}</Text>
          <Pressable testID="backups.close" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => setVisible(false)} style={({ pressed }) => [styles.button, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}>
            <Text style={{ color: theme.primary }}>{t('backup.done')}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.body, { color: theme.textMuted }]}>{t('backup.deviceOnly')}</Text>
          {failed ? <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>{t('backup.readError')}</Text> : null}
          {unreadable ? <Text accessibilityRole="alert" style={[styles.body, { color: theme.danger }]}>{t('backup.damaged')}</Text> : null}
          {busy ? <ActivityIndicator accessibilityLabel={t('backup.working')} color={theme.primary} /> : null}
          {!busy && !backups.length && !failed ? <Text style={[styles.body, { color: theme.text }]}>{t('backup.empty')}</Text> : null}
          {pets.length>1?<ScrollView horizontal accessibilityRole="radiogroup" contentContainerStyle={{gap:8}}>{[[null,t('backup.allPets')],...pets].map(([id,name])=><Pressable key={id??'all'} testID={`backups.filter.${id??'all'}`} accessibilityRole="radio" accessibilityLabel={name!} accessibilityState={{checked:selectedPet===id}} onPress={()=>setSelectedPet(id)} style={({pressed})=>({minHeight:48,paddingHorizontal:12,justifyContent:'center',borderRadius:theme.presentation.controlRadius,backgroundColor:selectedPet===id||pressed?theme.primarySoft:theme.surfaceRaised})}><Text style={{color:theme.primary,fontSize:15}}>{name}</Text></Pressable>)}</ScrollView>:null}
          {visibleBackups.map((backup, index) => <View key={backup.id} style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
            <SettingsRow testID={`backups.entry.${index}`} icon="file-restore-outline" label={timestamp(backup.createdAt)}
              detail={`${t(`backup.reason.${backup.reason}`)} · ${t('backup.entry', { name: backup.puppyName, count: backup.count, size: Math.max(1, Math.ceil(backup.bytes / 1024)) })}`}
              disabled={busy} wrap theme={theme} onPress={() => select(backup)} />
          </View>)}
          <Text style={[styles.body, { color: theme.textMuted }]}>{t('backup.explanation')}</Text>
          <Pressable testID="backups.retry" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy, busy }} onPress={() => void reload()}
            style={({ pressed }) => [styles.button, { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.controlRadius, opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}>
            <Text style={{ color: theme.primary }}>{t('backup.refresh')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, card: { borderWidth: 1, borderRadius: 22, padding: 8, marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md },
  title: { flex: 1, fontSize: 22, fontWeight: '700' }, button: { minHeight: 48, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.md, width: '100%', maxWidth: 720, alignSelf: 'center', gap: 8 }, body: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
});
