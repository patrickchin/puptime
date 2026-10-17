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

function SourceLink({ id, theme, small = false }: { id: string; theme: Theme; small?: boolean }) {
  const { t } = useLocalization();
  const source = careSources[id];
  const label = `${source.publisher} · ${source.title}`;
  const content = <Text style={[styles.linkText, small && styles.referenceText, { color: small ? theme.textMuted : theme.primary }]}>{label} ↗</Text>;
  const linkStyle = ({ pressed }: { pressed: boolean }) => [styles.sourceLink, pressed && styles.pressed];
  return Platform.OS === 'web' ? (
    <WebAnchor href={source.url} accessibilityRole="link" accessibilityLabel={`${source.publisher}: ${source.title}`} style={linkStyle}>{content}</WebAnchor>
  ) : (
    <Pressable accessibilityRole="link" accessibilityLabel={`${source.publisher}: ${source.title}`} style={linkStyle}
      onPress={() => Linking.openURL(source.url).catch(() => Alert.alert(t('learn.linkError'), t('learn.linkErrorBody')))}>{content}</Pressable>
  );
}

function ArticleRow({ article, theme, onOpen, featured = false, wide = false, plain = false }: {
  article: CareArticle; theme: Theme; onOpen: (id: string) => void; featured?: boolean; wide?: boolean; plain?: boolean;
}) {
  const { t } = useLocalization();
  const { width, fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.5;
  const content = plain ? <Text style={[styles.linkText, { color: theme.primary }]}>{article.shortTitle} →</Text> : (
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
    style: ({ pressed }: { pressed: boolean }) => plain ? [styles.relatedLink, pressed && styles.pressed] : [
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

function GuideReferences({ article, theme }: { article: CareArticle; theme: Theme }) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState(false);
  const sources = [...new Set(article.sections.flatMap((section) => section.sources))];
  return <View style={[styles.references, { borderColor: theme.border }]}>
    <Pressable testID="learn.sources.toggle" accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(!expanded)} style={({ pressed }) => [styles.referencesToggle, pressed && styles.pressed]}>
      <Text style={[styles.referenceLabel, styles.rowCopy, { color: theme.textMuted }]}>{t('learn.sources')}</Text>
      <Text aria-hidden style={[styles.referenceLabel, { color: theme.textMuted }]}>{expanded ? '−' : '+'}</Text>
    </Pressable>
    {expanded && <View testID="learn.sources" style={styles.referenceContent}>
      {sources.map((id) => <SourceLink key={id} id={id} theme={theme} small />)}
      {!!article.videos?.length && <View style={styles.video}>
        <Text style={[styles.referenceLabel, { color: theme.textMuted }]}>{t('learn.watch')}</Text>
        {article.videos.map((id) => <View key={id}><SourceLink id={id} theme={theme} small /><Text style={[styles.meta, { color: theme.textMuted }]}>{careSources[id].note}</Text></View>)}
      </View>}
      <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.scope')}</Text>
      <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.checked')} {careReviewedOn}</Text>
    </View>}
  </View>;
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
  const wide = width >= 900;

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

  const results = findCareArticles(query);
  const sourceCount = Object.values(careSources).filter((source) => source.kind !== 'video').length;
  const videos = Object.keys(careSources).filter((id) => careSources[id].kind === 'video');
  const title = article?.shortTitle ?? (invalidArticle ? t('learn.notFound') : t('learn.title'));

  const content = (
    <ScrollView key={selectedId ?? 'library'} testID="screen.learn" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={[styles.content, article && styles.articleContent]}>
        {selectedId !== null && (
          <Pressable testID="learn.back" accessibilityRole="button" onPress={() => open(null)} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            {Platform.OS === 'web'
              ? <Text aria-hidden style={{ fontSize: 24, color: theme.primary }}>←</Text>
              : <MaterialCommunityIcons name="arrow-left" size={22} color={theme.primary} />}
            <Text style={[styles.linkText, { color: theme.primary }]}>{t('learn.back')}</Text>
          </Pressable>
        )}
        <View style={[styles.headingRow, fontScale > 1.5 && styles.headingLargeText]}>
          <View style={[styles.rowCopy, fontScale > 1.5 && styles.columnCopy]}>
            {!article && <Text style={[styles.eyebrow, { color: theme.primary }]}>{t('learn.eyebrow')}</Text>}
            <Text ref={heading} accessibilityRole="header" style={[styles.title, { color: theme.text, fontSize: theme.presentation.titleSize, lineHeight: theme.presentation.titleLineHeight, fontWeight: theme.presentation.titleWeight }]}>{title}</Text>
            {!article && <Text style={[styles.intro, { color: theme.textMuted }]}>{invalidArticle ? t('learn.notFoundBody') : t('learn.intro')}</Text>}
          </View>
          {article && <GuideImage article={article} style={[styles.heroImage, width < 360 && styles.smallFeaturedImage, wide && styles.heroImageWide]} />}
        </View>
        {language !== 'en' && <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.english')}</Text>}

        {article ? (
          <>
            {article.sections.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{section.title}</Text>
                {section.paragraphs.map((paragraph) => <Text key={paragraph} selectable style={[styles.body, { color: theme.text }]}>{paragraph}</Text>)}
              </View>
            ))}
            <View style={[styles.section, styles.divided, { borderColor: theme.border }]}>
              <Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: theme.text }]}>{t('learn.next')}</Text>
              <View>{article.related.map((id) => <ArticleRow key={id} article={careArticles.find((item) => item.id === id)!} theme={theme} onOpen={open} plain />)}</View>
            </View>
            <GuideReferences key={article.id} article={article} theme={theme} />
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
        {!article && <View style={[styles.section, styles.divided, { borderColor: theme.border }]}>
          <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.scope')}</Text>
          <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.checked')} {careReviewedOn}</Text>
        </View>}
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
  headingLargeText: { flexDirection: 'column-reverse', alignItems: 'stretch' },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.6, marginBottom: 8 },
  title: { marginBottom: 12 },
  intro: { fontSize: 17, lineHeight: 25, marginBottom: 8 },
  meta: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  back: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginBottom: 16 },
  heroImage: { width: 72, height: 72, borderRadius: 12 },
  imageFrame: { overflow: 'hidden', backgroundColor: lightTheme.background },
  imageFill: { width: '100%', height: '100%' },
  heroImageWide: { width: 96, height: 96 },
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
  pressed: { opacity: 0.65 },
  sourceLink: { minHeight: 48, justifyContent: 'center', paddingVertical: 8 },
  linkText: { fontSize: 15, lineHeight: 23, fontWeight: '600', textDecorationLine: 'underline' },
  relatedLink: { minHeight: 48, justifyContent: 'center', paddingVertical: 10 },
  references: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 28 },
  referencesToggle: { minHeight: 48, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  referenceLabel: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  referenceText: { fontSize: 13, lineHeight: 20, fontWeight: '400' },
  referenceContent: { gap: 8 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 24 },
  video: { marginTop: 8 },
});
