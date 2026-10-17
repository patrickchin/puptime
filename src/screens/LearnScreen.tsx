import { MaterialCommunityIcons } from '@expo/vector-icons';
import { type ComponentProps, type ComponentType, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { useLocalization } from '../localization-context';
import { GuideListener } from '../components/GuideListener';
import { careArticles, careReviewedOn, careSources, findCareArticles, type CareArticle } from '../puppy-care';
import { lightTheme, type Theme } from '../theme';

const careImages = {
  home: require('../../assets/puppy-care/home.jpg'),
  potty: require('../../assets/puppy-care/potty.jpg'),
  feeding: require('../../assets/puppy-care/feeding.jpg'),
  sleep: require('../../assets/puppy-care/sleep.jpg'),
  play: require('../../assets/puppy-care/play.jpg'),
  social: require('../../assets/puppy-care/social.jpg'),
  training: require('../../assets/puppy-care/training.jpg'),
  chewing: require('../../assets/puppy-care/chewing.jpg'),
  alone: require('../../assets/puppy-care/alone.jpg'),
  grooming: require('../../assets/puppy-care/grooming.jpg'),
  vet: require('../../assets/puppy-care/vet.jpg'),
  urgent: require('../../assets/puppy-care/urgent.jpg'),
};

function GuideImage({ article, style }: { article: CareArticle; style: ComponentProps<typeof Image>['style'] }) {
  return <View style={[style, styles.imageFrame]} pointerEvents="none" aria-hidden>
    <Image source={careImages[article.image]} style={styles.imageFill} resizeMode="contain" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
  </View>;
}

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

function ArticleRow({ article, theme, onOpen, featured = false, wide = false }: {
  article: CareArticle; theme: Theme; onOpen: (id: string) => void; featured?: boolean; wide?: boolean;
}) {
  const { t } = useLocalization();
  const { width, fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.5;
  const content = (
    <>
      <GuideImage article={article} style={featured ? [styles.featuredImage, width < 360 && styles.smallFeaturedImage] : [styles.cardImage, largeText && styles.cardImageLargeText]} />
      <View style={featured ? [styles.rowCopy, largeText && styles.columnCopy] : undefined}>
        {featured && article.id === 'getting-started' && <Text style={[styles.eyebrow, { color: theme.primary }]}>{t('learn.start')}</Text>}
        <Text style={[styles.rowTitle, featured && styles.featuredTitle, { color: theme.text }]}>{article.shortTitle}</Text>
        {featured
          ? <Text style={[styles.rowSummary, { color: theme.textMuted }]}>{article.summary}</Text>
          : <><Text style={[styles.cardTakeaway, { color: article.image === 'urgent' ? theme.danger : theme.primary }]}>{article.glance[0].value}</Text>
              <Text style={[styles.cardContext, { color: theme.textMuted }]}>{article.glance[0].label}</Text></>}
      </View>
      {featured && <Text aria-hidden style={[styles.chevron, { color: theme.primary }]}>›</Text>}
    </>
  );
  const props = {
    testID: `learn.article.${article.id}`,
    accessibilityLabel: `${t('learn.read')}: ${article.shortTitle}`,
    style: ({ pressed }: { pressed: boolean }) => [
      styles.articleCard, featured ? styles.featured : wide ? styles.cardWide : styles.cardSmall,
      largeText && (featured ? styles.featuredLargeText : styles.cardLargeText),
      { borderColor: theme.border, backgroundColor: featured ? theme.primarySoft : theme.surface, borderRadius: theme.presentation.controlRadius },
      pressed && styles.pressed,
    ],
  };
  return Platform.OS === 'web'
    ? <WebAnchor {...props} href={`#puppy-care/${article.id}`} accessibilityRole="link">{content}</WebAnchor>
    : <Pressable {...props} accessibilityRole="button" onPress={() => onOpen(article.id)}>{content}</Pressable>;
}

export function LearnScreen({ theme, articleId, onArticleChange }: {
  theme: Theme;
  articleId?: string | null;
  onArticleChange?: (id: string | null) => void;
}) {
  const { language, t } = useLocalization();
  const { width, fontScale } = useWindowDimensions();
  const [localArticleId, setLocalArticleId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const selectedId = articleId === undefined ? localArticleId : articleId;
  const article = careArticles.find((item) => item.id === selectedId);
  const invalidArticle = selectedId !== null && !article;
  const open = (id: string | null) => onArticleChange ? onArticleChange(id) : setLocalArticleId(id);
  const heading = useRef<Text>(null);
  const scroll = useRef<ScrollView>(null);
  const sectionOffsets = useRef<number[]>([]);
  const sectionHeadings = useRef<Array<Text | null>>([]);
  const wide = width >= 900;
  const jumpToSection = (index: number) => {
    scroll.current?.scrollTo({ y: (sectionOffsets.current[index] ?? 0) + 20, animated: false });
    if (Platform.OS === 'web') {
      const node = sectionHeadings.current[index] as unknown as HTMLElement | null;
      node?.setAttribute('tabindex', '-1');
      node?.focus({ preventScroll: true });
    }
  };

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
  const title = article?.shortTitle ?? (invalidArticle ? t('learn.notFound') : t('learn.title'));

  const content = (
    <ScrollView ref={scroll} key={selectedId ?? 'library'} testID="screen.learn" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={[styles.content, article && styles.articleContent]}>
        {selectedId !== null && (
          <Pressable testID="learn.back" accessibilityRole="button" onPress={() => open(null)} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            {Platform.OS === 'web'
              ? <Text aria-hidden style={{ fontSize: 24, color: theme.primary }}>←</Text>
              : <MaterialCommunityIcons name="arrow-left" size={22} color={theme.primary} />}
            <Text style={[styles.linkText, { color: theme.primary }]}>{t('learn.back')}</Text>
          </Pressable>
        )}
        <View style={[styles.headingRow, article && styles.articleHeading, fontScale > 1.5 && styles.headingLargeText]}>
          <View style={[styles.rowCopy, fontScale > 1.5 && styles.columnCopy]}>
            <Text style={[styles.eyebrow, { color: theme.primary }]}>{article ? article.category.toUpperCase() : t('learn.eyebrow')}</Text>
            <Text ref={heading} accessibilityRole="header" style={[styles.title, { color: theme.text, fontSize: theme.presentation.titleSize, lineHeight: theme.presentation.titleLineHeight, fontWeight: theme.presentation.titleWeight }]}>{title}</Text>
            {!article && <Text style={[styles.intro, { color: theme.textMuted }]}>{invalidArticle ? t('learn.notFoundBody') : t('learn.intro')}</Text>}
          </View>
          {article && <GuideImage article={article} style={[styles.heroImage, width < 360 && styles.smallFeaturedImage, wide && styles.heroImageWide]} />}
        </View>
        {article && <Text style={[styles.intro, { color: theme.textMuted }]}>{article.summary}</Text>}
        {language !== 'en' && <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.english')}</Text>}

        {article ? (
          <>
            <View testID="learn.glance" style={[styles.glance, { backgroundColor: article.image === 'urgent' ? theme.dangerSoft : theme.primarySoft, borderRadius: theme.presentation.controlRadius }]}>
              <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{t('learn.glance')}</Text>
              <View style={styles.glancePoints}>{article.glance.map((point) => <View key={point.label} style={[styles.glancePoint, { borderColor: theme.border, width: fontScale > 1.5 ? '100%' : article.glance.length === 4 ? '47.5%' : wide ? '31%' : '100%' }]}>
                <Text style={[styles.glanceLabel, { color: theme.textMuted }]}>{point.label}</Text>
                <Text style={[styles.glanceValue, { color: article.image === 'urgent' ? theme.danger : theme.primary }]}>{point.value}</Text>
                <Text style={[styles.glanceDetail, { color: theme.text }]}>{point.detail}</Text>
              </View>)}</View>
              <Pressable testID="learn.viewSources" accessibilityRole="button" onPress={() => jumpToSection(article.sections.length)} style={({ pressed }) => [styles.sourceLink, pressed && styles.pressed]}><Text style={[styles.linkText, { color: theme.primary }]}>{t('learn.viewSources')} ↓</Text></Pressable>
            </View>
            <View style={styles.section}>
              <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{t('learn.contents')}</Text>
              <View style={styles.contents}>{article.sections.map((section, index) => <Pressable key={section.title} testID={`learn.section.${index}`} accessibilityRole="button" onPress={() => jumpToSection(index)} style={({ pressed }) => [styles.contentsLink, { borderColor: theme.border, backgroundColor: theme.surface }, pressed && styles.pressed]}>
                <Text style={[styles.linkText, { color: theme.primary }]}>{section.title} ↓</Text>
              </Pressable>)}</View>
            </View>
            {article.sections.map((section, index) => (
              <View key={section.title} onLayout={(event) => { sectionOffsets.current[index] = event.nativeEvent.layout.y; }} style={styles.section}>
                <Text ref={(node) => { sectionHeadings.current[index] = node; }} accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{section.title}</Text>
                {section.paragraphs.map((paragraph) => <Text key={paragraph} selectable style={[styles.body, { color: theme.text }]}>{paragraph}</Text>)}
                <View style={styles.citations}>{section.sources.map((id) => <SourceLink key={id} id={id} theme={theme} compact />)}</View>
              </View>
            ))}
            <View onLayout={(event) => { sectionOffsets.current[article.sections.length] = event.nativeEvent.layout.y; }} style={[styles.section, styles.divided, { borderColor: theme.border }]}>
              <Text ref={(node) => { sectionHeadings.current[article.sections.length] = node; }} accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{t('learn.sources')}</Text>
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
              <View style={styles.cards}>{article.related.map((id) => <ArticleRow key={id} article={careArticles.find((item) => item.id === id)!} theme={theme} onOpen={open} wide={false} />)}</View>
            </View>
          </>
        ) : !invalidArticle ? (
          <>
            <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.counts', { guides: careArticles.length, sources: sourceCount, videos: videos.length })}</Text>
            {!query.trim() && <ArticleRow article={careArticles[0]} theme={theme} onOpen={open} featured />}
            <Text style={[styles.searchLabel, { color: theme.text }]}>{t('learn.search')}</Text>
            <TextInput testID="learn.search" value={query} onChangeText={setQuery} accessibilityLabel={t('learn.search')} placeholder={t('learn.searchHint')} placeholderTextColor={theme.textMuted} autoCorrect={false} clearButtonMode="while-editing" style={[styles.search, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border, borderRadius: theme.presentation.controlRadius }]} />
            {results.filter((item) => item.id !== 'getting-started' || query.trim()).length === 0 ? (
              <View style={styles.section}>
                <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{t('learn.noResults')}</Text>
                <Text style={[styles.body, { color: theme.textMuted }]}>{t('learn.tryAnother')}</Text>
                <Pressable accessibilityRole="button" onPress={() => setQuery('')} style={styles.back}><Text style={[styles.linkText, { color: theme.primary }]}>{t('learn.clear')}</Text></Pressable>
              </View>
            ) : (
              <View style={styles.groups}>
                {['Daily care', 'Training', 'Health', 'Basics'].map((category) => {
                  const group = results.filter((item) => item.category === category && (item.id !== 'getting-started' || query.trim()));
                  if (!group.length) return null;
                  return <View key={category} style={styles.group}>
                    <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{category}</Text>
                    <View style={styles.cards}>{group.map((item) => <ArticleRow key={item.id} article={item} theme={theme} onOpen={open} wide={wide} featured={category === 'Basics'} />)}</View>
                  </View>;
                })}
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
          <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.checked')} {careReviewedOn}</Text>
        </View>
      </View>
    </ScrollView>
  );
  return <View style={{ flex: 1, minHeight: 0 }}>{content}{article && <GuideListener key={`audio:${article.id}`} article={article} theme={theme} />}</View>;
}

const styles = StyleSheet.create({
  scrollContent: { padding: 20, paddingBottom: 40 },
  content: { width: '100%', maxWidth: 1100, alignSelf: 'center' },
  articleContent: { maxWidth: 760 },
  headingRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  articleHeading: { marginBottom: 12 },
  headingLargeText: { flexDirection: 'column-reverse', alignItems: 'stretch' },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6, marginBottom: 8 },
  title: { marginBottom: 12 },
  intro: { fontSize: 17, lineHeight: 25, marginBottom: 8 },
  meta: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  back: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginBottom: 16 },
  heroImage: { width: 104, height: 104, borderRadius: 16 },
  imageFrame: { overflow: 'hidden', backgroundColor: lightTheme.background },
  imageFill: { width: '100%', height: '100%' },
  heroImageWide: { width: 160, height: 160 },
  featuredImage: { width: 100, height: 100, borderRadius: 12 },
  smallFeaturedImage: { width: 68, height: 68 },
  featuredTitle: { fontSize: 21, lineHeight: 28 },
  chevron: { fontSize: 28 },
  searchLabel: { fontSize: 14, fontWeight: '600', marginTop: 24, marginBottom: 8 },
  search: { minHeight: 48, borderWidth: 1, paddingHorizontal: 14, fontSize: 16, marginBottom: 28 },
  groups: { gap: 32 },
  group: { width: '100%', gap: 12 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  section: { marginTop: 28, gap: 12 },
  sectionTitle: { fontSize: 21, fontWeight: '700', lineHeight: 28 },
  body: { fontSize: 16, lineHeight: 26 },
  articleCard: { borderWidth: 1, padding: 10, gap: 8 },
  cardSmall: { width: '47.5%' },
  cardWide: { width: '23.5%' },
  cardLargeText: { width: '100%' },
  featured: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, marginTop: 12 },
  featuredLargeText: { flexDirection: 'column', alignItems: 'stretch' },
  cardImage: { width: '100%', aspectRatio: 1.25, borderRadius: 10 },
  cardImageLargeText: { height: 160 },
  rowCopy: { flex: 1 },
  columnCopy: { flex: 0 },
  rowTitle: { fontSize: 17, fontWeight: '700', lineHeight: 24, marginBottom: 5 },
  rowSummary: { fontSize: 14, lineHeight: 22 },
  cardTakeaway: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  cardContext: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  glance: { padding: 20, marginTop: 20 },
  glancePoints: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  glancePoint: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, marginTop: 16, gap: 4 },
  glanceLabel: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  glanceValue: { fontSize: 23, lineHeight: 30, fontWeight: '800' },
  glanceDetail: { fontSize: 15, lineHeight: 23 },
  contents: { gap: 8 },
  contentsLink: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  sourceLink: { minHeight: 48, justifyContent: 'center', paddingVertical: 8 },
  linkText: { fontSize: 15, lineHeight: 23, fontWeight: '600', textDecorationLine: 'underline' },
  citationText: { fontSize: 13, lineHeight: 20 },
  citations: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 24 },
  video: { marginTop: 8 },
});
