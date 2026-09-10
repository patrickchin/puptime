import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SectionList, StyleSheet, Text, View } from 'react-native';

import { QuickActions } from '../components/QuickActions';
import { EventRow } from '../components/EventRow';
import { dateKey, type EventType, type PuppyEvent } from '../domain';
import { spacing, type Theme } from '../theme';

function sectionTitle(key: string): string {
  const date = new Date(`${key}T12:00:00`);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (key === dateKey(today)) return 'Today';
  if (key === dateKey(yesterday)) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date);
}

export function LogScreen({
  events,
  onLog,
  onDelete,
  theme,
}: {
  events: PuppyEvent[];
  onLog: (type: EventType) => void;
  onDelete: (event: PuppyEvent) => void;
  theme: Theme;
}) {
  const byDay = new Map<string, PuppyEvent[]>();
  events.forEach((event) => {
    const key = dateKey(event.at);
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  });
  const sections = [...byDay.entries()].map(([key, data]) => ({ key, title: sectionTitle(key), data }));

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <>
          <View style={styles.titleBlock}>
            <View style={[styles.mark, { backgroundColor: theme.primary }]}>
              <MaterialCommunityIcons name="paw" size={23} color="#FFFFFF" />
            </View>
            <View style={styles.titleCopy}>
              <Text style={[styles.eyebrow, { color: theme.primary }]}>PUPTIME</Text>
              <Text style={[styles.title, { color: theme.text }]}>What just happened?</Text>
            </View>
          </View>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>One tap saves the current time.</Text>
          <QuickActions events={events} onLog={onLog} theme={theme} />
          <View style={styles.activityHeading}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Activity</Text>
            <Text style={[styles.count, { color: theme.textMuted }]}>{events.length} total</Text>
          </View>
        </>
      }
      renderSectionHeader={({ section }) => (
        <Text style={[styles.dayHeading, { color: theme.textMuted }]}>{section.title.toUpperCase()}</Text>
      )}
      renderItem={({ item }) => <EventRow event={item} onDelete={() => onDelete(item)} theme={theme} />}
      ListEmptyComponent={
        <View style={[styles.empty, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <MaterialCommunityIcons name="paw-outline" size={28} color={theme.textMuted} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>Your log starts here</Text>
          <Text style={[styles.emptyBody, { color: theme.textMuted }]}>Tap an action above when it happens.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xl },
  titleBlock: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  titleCopy: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  title: { fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: spacing.md },
  activityHeading: { marginTop: spacing.xl, marginBottom: 12, flexDirection: 'row', alignItems: 'baseline' },
  sectionTitle: { flex: 1, fontSize: 21, fontWeight: '800' },
  count: { fontSize: 13, fontWeight: '600' },
  dayHeading: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 8, marginBottom: 8 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 20, padding: spacing.lg, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 4 },
});
