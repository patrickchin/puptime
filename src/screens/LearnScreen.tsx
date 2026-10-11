import { MaterialCommunityIcons } from '@expo/vector-icons';
import { type ComponentProps, type ComponentType, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { useLocalization } from '../localization-context';
import { careArticles, careReviewedOn, careSources, findCareArticles, type CareArticle } from '../puppy-care';
import { type Theme } from '../theme';

const WebAnchor = Pressable as ComponentType<ComponentProps<typeof Pressable> & { href: string }>;

function SourceLink({ id, theme, compact = false }: { id: string; theme: Theme; compact?: boolean }) {
  const { t } = useLocalization();
  const source = careSources[id];
  const label = compact ? source.publisher : `${source.publisher} · ${source.title}`;
  const content = <Text style={[styles.linkText, compact && styles.citationText, { color: theme.primary }]}>{label} ↗</Text>;
  const linkStyle = ({ pressed }: { pressed: boolean }) => [styles.sourceLink, pressed && styles.pressed];
  return Platform.OS === 'web' ? (
    <WebAnchor href={source.url} accessibilityRole="link" accessibilityLabel={`${source.publisher}: ${source.title}`} style={linkStyle}>{content}</WebAnchor>
  ) : (
    <Pressable accessibilityRole="link" accessibilityLabel={`${source.publisher}: ${source.title}`} style={linkStyle}
      onPress={() => Linking.openURL(source.url).catch(() => Alert.alert(t('learn.linkError'), t('learn.linkErrorBody')))}>{content}</Pressable>
  );
}

function ArticleRow({ article, theme, onOpen }: { article: CareArticle; theme: Theme; onOpen: (id: string) => void }) {
  const { t } = useLocalization();
  const content = (
    <>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.text }]}>{article.title}</Text>
        <Text style={[styles.rowSummary, { color: theme.textMuted }]}>{article.summary}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={theme.primary} />
    </>
  );
  const props = {
    testID: `learn.article.${article.id}`,
    accessibilityLabel: `${t('learn.read')}: ${article.title}`,
    style: ({ pressed }: { pressed: boolean }) => [styles.articleRow, { borderColor: theme.border }, pressed && styles.pressed],
  };
  return Platform.OS === 'web' ? (
    <WebAnchor {...props} href={`#puppy-care/${article.id}`} accessibilityRole="link">{content}</WebAnchor>
  ) : (
    <Pressable {...props} accessibilityRole="button" onPress={() => onOpen(article.id)}>{content}</Pressable>
  );
}

export function LearnScreen({ theme, articleId, onArticleChange }: {
  theme: Theme;
  articleId?: string | null;
  onArticleChange?: (id: string | null) => void;
}) {
  const { language, t } = useLocalization();
  const { width } = useWindowDimensions();
  const [localArticleId, setLocalArticleId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const selectedId = articleId === undefined ? localArticleId : articleId;
  const article = careArticles.find((item) => item.id === selectedId);
  const invalidArticle = selectedId !== null && !article;
  const open = (id: string | null) => onArticleChange ? onArticleChange(id) : setLocalArticleId(id);
  const heading = useRef<Text>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !heading.current) return;
    // React Native Web exposes the DOM node; move keyboard focus with page navigation.
    const node = heading.current as unknown as HTMLElement;
    node.setAttribute('tabindex', '-1');
    node.focus?.();
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || Platform.OS === 'web') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setLocalArticleId(null);
      return true;
    });
    return () => subscription.remove();
  }, [selectedId]);

  const sources = article ? [...new Set(article.sections.flatMap((section) => section.sources))] : [];
  const results = findCareArticles(query);
  const sourceCount = Object.values(careSources).filter((source) => source.kind !== 'video').length;
  const videos = Object.keys(careSources).filter((id) => careSources[id].kind === 'video');
  const title = article?.title ?? (invalidArticle ? t('learn.notFound') : t('learn.title'));

  return (
    <ScrollView key={selectedId ?? 'library'} testID="screen.learn" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={[styles.content, article && styles.articleContent]}>
        {selectedId !== null && (
          <Pressable testID="learn.back" accessibilityRole="button" onPress={() => open(null)} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={theme.primary} />
            <Text style={[styles.linkText, { color: theme.primary }]}>{t('learn.back')}</Text>
          </Pressable>
        )}
        <Text style={[styles.eyebrow, { color: theme.primary }]}>{article ? article.category.toUpperCase() : t('learn.eyebrow')}</Text>
        <Text ref={heading} accessibilityRole="header" style={[styles.title, { color: theme.text, fontSize: theme.presentation.titleSize, lineHeight: theme.presentation.titleLineHeight, fontWeight: theme.presentation.titleWeight }]}>{title}</Text>
        <Text style={[styles.intro, { color: theme.textMuted }]}>{article?.summary ?? (invalidArticle ? t('learn.notFoundBody') : t('learn.intro'))}</Text>
        {language !== 'en' && <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.english')}</Text>}

        {article ? (
          <>
            <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.checked')} {careReviewedOn}</Text>
            {article.sections.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{section.title}</Text>
                {section.paragraphs.map((paragraph) => <Text key={paragraph} selectable style={[styles.body, { color: theme.text }]}>{paragraph}</Text>)}
                <View style={styles.citations}>{section.sources.map((id) => <SourceLink key={id} id={id} theme={theme} compact />)}</View>
              </View>
            ))}
            <View style={[styles.section, styles.divided, { borderColor: theme.border }]}>
              <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{t('learn.sources')}</Text>
              {sources.map((id) => <SourceLink key={id} id={id} theme={theme} />)}
            </View>
            {!!article.videos?.length && (
              <View style={styles.section}>
                <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{t('learn.watch')}</Text>
                {article.videos.map((id) => <View key={id}><SourceLink id={id} theme={theme} /><Text style={[styles.rowSummary, { color: theme.textMuted }]}>{careSources[id].note}</Text></View>)}
              </View>
            )}
            <View style={styles.section}>
              <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{t('learn.next')}</Text>
              {article.related.map((id) => <ArticleRow key={id} article={careArticles.find((item) => item.id === id)!} theme={theme} onOpen={open} />)}
            </View>
          </>
        ) : !invalidArticle ? (
          <>
            <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.counts', { guides: careArticles.length, sources: sourceCount, videos: videos.length })}</Text>
            <View style={[styles.startCard, { backgroundColor: theme.primarySoft, borderRadius: theme.presentation.cardRadius }]}>
              <Text style={[styles.eyebrow, { color: theme.primary }]}>{t('learn.start')}</Text>
              <ArticleRow article={careArticles[0]} theme={theme} onOpen={open} />
            </View>
            <TextInput testID="learn.search" value={query} onChangeText={setQuery} accessibilityLabel={t('learn.search')} placeholder={t('learn.search')} placeholderTextColor={theme.textMuted} autoCorrect={false} clearButtonMode="while-editing" style={[styles.search, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border, borderRadius: theme.presentation.controlRadius }]} />
            {results.filter((item) => item.id !== 'getting-started' || query.trim()).length === 0 ? (
              <View style={styles.section}>
                <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{t('learn.noResults')}</Text>
                <Text style={[styles.body, { color: theme.textMuted }]}>{t('learn.tryAnother')}</Text>
                <Pressable accessibilityRole="button" onPress={() => setQuery('')} style={styles.back}><Text style={[styles.linkText, { color: theme.primary }]}>{t('learn.clear')}</Text></Pressable>
              </View>
            ) : (
              <View style={[styles.groups, Platform.OS === 'web' && width >= 900 && styles.groupsWide]}>
                {(Platform.OS === 'web' && width >= 900
                  ? [['Basics', 'Training'], ['Daily care', 'Health']]
                  : [['Basics', 'Daily care', 'Training', 'Health']]).map((categories) => (
                  <View key={categories.join('-')} style={[styles.column, Platform.OS === 'web' && width >= 900 && styles.columnWide]}>
                    {categories.map((category) => {
                      const group = results.filter((item) => item.category === category && (item.id !== 'getting-started' || query.trim()));
                      if (!group.length) return null;
                      return <View key={category} style={styles.group}>
                        <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{category}</Text>
                        {group.map((item) => <ArticleRow key={item.id} article={item} theme={theme} onOpen={open} />)}
                      </View>;
                    })}
                  </View>
                ))}
              </View>
            )}
            {!query.trim() && <View style={[styles.section, styles.divided, { borderColor: theme.border }]}>
              <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{t('learn.watch')}</Text>
              <Text style={[styles.body, { color: theme.textMuted }]}>{t('learn.videoIntro')}</Text>
              {videos.map((id) => <View key={id} style={styles.video}><SourceLink id={id} theme={theme} /><Text style={[styles.rowSummary, { color: theme.textMuted }]}>{careSources[id].note}</Text></View>)}
            </View>}
          </>
        ) : null}
        <View style={[styles.section, styles.divided, { borderColor: theme.border }]}>
          <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.scope')}</Text>
          {!article && <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.checked')} {careReviewedOn}</Text>}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 20, paddingBottom: 40 },
  content: { width: '100%', maxWidth: 940, alignSelf: 'center' },
  articleContent: { maxWidth: 700 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6, marginBottom: 8 },
  title: { marginBottom: 12 },
  intro: { fontSize: 17, lineHeight: 25, marginBottom: 8 },
  meta: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginBottom: 16 },
  startCard: { padding: 16, marginTop: 16, marginBottom: 20 },
  search: { minHeight: 48, borderWidth: 1, paddingHorizontal: 14, fontSize: 16, marginBottom: 28 },
  groups: { gap: 28 },
  groupsWide: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 36 },
  group: { width: '100%' },
  column: { width: '100%', gap: 28 },
  columnWide: { width: '47%' },
  section: { marginTop: 28, gap: 12 },
  sectionTitle: { fontSize: 21, fontWeight: '700', lineHeight: 28 },
  body: { fontSize: 16, lineHeight: 26 },
  articleRow: { minHeight: 64, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1 },
  rowTitle: { fontSize: 17, fontWeight: '600', lineHeight: 24, marginBottom: 5 },
  rowSummary: { fontSize: 14, lineHeight: 22 },
  pressed: { opacity: 0.65 },
  sourceLink: { minHeight: 44, justifyContent: 'center', paddingVertical: 8 },
  linkText: { fontSize: 15, lineHeight: 23, fontWeight: '600', textDecorationLine: 'underline' },
  citationText: { fontSize: 13, lineHeight: 20 },
  citations: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 24 },
  video: { marginTop: 8 },
});
