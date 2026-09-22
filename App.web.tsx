import { useEffect } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

const releaseUrl = 'https://github.com/patrickchin/puptime/releases/latest';
const sourceUrl = 'https://github.com/patrickchin/puptime';
const privacyUrl = 'https://github.com/patrickchin/puptime/blob/master/PRIVACY.md';

const colors = {
  paper: '#F6F4ED',
  white: '#FFFEFA',
  ink: '#17231E',
  muted: '#5C6962',
  green: '#176B52',
  greenDark: '#0E4E3A',
  greenSoft: '#DCEFE7',
  line: '#D6DED8',
  coral: '#D94D3F',
};

const day = [
  ['06:55', 'Potty trip'],
  ['08:10', 'Breakfast'],
  ['13:00', 'Nap'],
  ['17:40', 'Walk'],
];

const details = [
  ['Log', 'Log pee, poop, meals, trips, walks and naps with one tap.'],
  ['Look back', 'Review your activity log, routine and timing patterns.'],
  ['Keep private', 'Everything stays on your device. No account, ads or tracking.'],
];

const previews = [
  ['Today', require('./assets/screenshots/today.png')],
  ['History', require('./assets/screenshots/activity.png')],
  ['Patterns', require('./assets/screenshots/insights-summary.png')],
];

function LinkButton({
  children,
  href,
  quiet = false,
}: {
  children: string;
  href: string;
  quiet?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => Linking.openURL(href)}
      style={({ pressed }) => [
        styles.button,
        quiet && styles.buttonQuiet,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, quiet && styles.buttonQuietText]}>{children}</Text>
    </Pressable>
  );
}

export default function MarketingSite() {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const narrow = width < 1040;

  useEffect(() => {
    document.title = 'Puptime — Puppy routine tracker';
  }, []);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <View style={[styles.header, compact && styles.headerCompact]}>
        <View style={styles.brand}>
          <Image source={require('./assets/puptime-icon.png')} style={styles.logo} />
          <Text style={styles.brandName}>Puptime</Text>
        </View>
        <View style={styles.headerLinks}>
          {!compact && (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(privacyUrl)}>
              <Text style={styles.textLink}>Privacy</Text>
            </Pressable>
          )}
          <LinkButton href={releaseUrl}>Get the app</LinkButton>
        </View>
      </View>

      <View style={[styles.hero, compact && styles.heroCompact]}>
        <View style={[styles.heroCopy, compact && styles.heroCopyCompact]}>
          <Text style={styles.eyebrow}>PRIVATE · OFFLINE · NO ACCOUNT</Text>
          <Text
            accessibilityRole="header"
            style={[styles.title, narrow && styles.titleNarrow, compact && styles.titleCompact]}
          >
            Keep track of your puppy’s day.
          </Text>
          <Text style={[styles.intro, compact && styles.introCompact]}>
            Log potty breaks, meals, walks and naps with one tap. Your activity history stays on
            your phone.
          </Text>
          <View style={[styles.actions, compact && styles.actionsCompact]}>
            <LinkButton href={releaseUrl}>Download for Android</LinkButton>
            <LinkButton href={sourceUrl} quiet>View the source</LinkButton>
          </View>
          <Text style={styles.note}>Free and open source · iPhone and Android</Text>
        </View>

        <View style={[styles.dayCard, compact && styles.dayCardCompact]}>
          <View style={[styles.dayRail, compact && styles.dayRailCompact]}>
            <Text style={styles.dayLabel}>A DAY WITH YOUR PUP</Text>
            {day.map(([time, label], index) => (
              <View key={time} style={styles.dayEvent}>
                <View style={[styles.dot, index === 2 && styles.dotCoral]} />
                <Text style={styles.dayTime}>{time}</Text>
                <Text style={styles.dayEventLabel}>{label}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.phone, compact && styles.phoneCompact]}>
            <Image
              accessibilityLabel="Puptime Today screen"
              resizeMode="cover"
              source={require('./assets/screenshots/today.png')}
              style={styles.phoneImage}
            />
          </View>
        </View>
      </View>

      <View style={[styles.mainSection, compact && styles.mainSectionCompact]}>
        <View style={[styles.sectionIntro, compact && styles.sectionIntroCompact]}>
          <Text
            accessibilityRole="header"
            style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}
          >
            Log activities and review the history.
          </Text>
          <Text style={styles.sectionCopy}>
            Use the home-screen widget for common logs, adjust the routine as your puppy changes,
            and export the full history.
          </Text>
        </View>

        <View style={[styles.detailGrid, compact && styles.detailGridCompact]}>
          {details.map(([label, copy]) => (
            <View key={label} style={[styles.detail, compact && styles.detailCompact]}>
              <Text style={styles.detailLabel}>{label}</Text>
              <Text style={styles.detailCopy}>{copy}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.previewGrid, compact && styles.previewGridCompact]}>
          {previews.map(([label, source], index) => (
            <View
              key={label as string}
              style={[
                styles.preview,
                compact && styles.previewCompact,
                index === 1 && styles.previewLift,
              ]}
            >
              <Text style={styles.previewLabel}>{label as string}</Text>
              <View style={styles.previewFrame}>
                <Image
                  accessibilityLabel={`Puptime ${label as string} screen`}
                  resizeMode="cover"
                  source={source}
                  style={styles.previewImage}
                />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.footer, compact && styles.footerCompact]}>
        <Text style={styles.footerLine}>Puptime</Text>
        <View style={[styles.footerLinks, compact && styles.footerLinksCompact]}>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(sourceUrl)}>
            <Text style={styles.textLink}>GitHub</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(privacyUrl)}>
            <Text style={styles.textLink}>Privacy</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.paper,
  },
  pageContent: {
    minHeight: '100%',
  },
  header: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingTop: 24,
    paddingBottom: 18,
  },
  headerCompact: {
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 12,
  },
  brandName: {
    color: colors.ink,
    fontFamily: 'Arial Rounded MT Bold, ui-rounded, system-ui, sans-serif',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  headerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  textLink: {
    color: colors.greenDark,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 15,
    fontWeight: '700',
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
  },
  hero: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 48,
    paddingHorizontal: 40,
    paddingTop: 52,
    paddingBottom: 96,
  },
  heroCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 48,
    paddingHorizontal: 20,
    paddingTop: 46,
    paddingBottom: 64,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
  },
  heroCopyCompact: {
    width: '100%',
  },
  eyebrow: {
    color: colors.green,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.2,
    marginBottom: 20,
  },
  title: {
    maxWidth: 620,
    color: colors.ink,
    fontFamily: 'Arial Rounded MT Bold, ui-rounded, system-ui, sans-serif',
    fontSize: 72,
    fontWeight: '800',
    letterSpacing: -3.6,
    lineHeight: 76,
  },
  titleNarrow: {
    fontSize: 58,
    lineHeight: 63,
    letterSpacing: -2.8,
  },
  titleCompact: {
    fontSize: 47,
    lineHeight: 51,
    letterSpacing: -2.2,
  },
  intro: {
    maxWidth: 560,
    color: colors.muted,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 20,
    lineHeight: 31,
    marginTop: 26,
  },
  introCompact: {
    fontSize: 18,
    lineHeight: 28,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 32,
  },
  actionsCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.green,
    borderColor: colors.green,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  buttonQuiet: {
    backgroundColor: 'transparent',
    borderColor: colors.line,
  },
  buttonPressed: {
    opacity: 0.72,
    transform: [{ translateY: 1 }],
  },
  buttonText: {
    color: colors.white,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 15,
    fontWeight: '800',
  },
  buttonQuietText: {
    color: colors.greenDark,
  },
  note: {
    color: colors.muted,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 13,
    marginTop: 18,
  },
  dayCard: {
    flex: 1,
    minWidth: 0,
    height: 650,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.greenSoft,
    borderRadius: 44,
    padding: 28,
  },
  dayCardCompact: {
    width: '100%',
    height: 580,
    borderRadius: 32,
    paddingHorizontal: 12,
    paddingVertical: 22,
  },
  dayRail: {
    width: 156,
    alignSelf: 'stretch',
    justifyContent: 'space-around',
    paddingVertical: 42,
    zIndex: 2,
  },
  dayRailCompact: {
    width: 104,
    paddingVertical: 32,
  },
  dayLabel: {
    color: colors.greenDark,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    lineHeight: 15,
  },
  dayEvent: {
    position: 'relative',
    borderTopColor: '#A7CCBC',
    borderTopWidth: 1,
    paddingTop: 11,
    paddingLeft: 1,
  },
  dot: {
    position: 'absolute',
    top: -5,
    left: -5,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.green,
  },
  dotCoral: {
    backgroundColor: colors.coral,
  },
  dayTime: {
    color: colors.greenDark,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 12,
    fontWeight: '800',
  },
  dayEventLabel: {
    color: colors.muted,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  phone: {
    width: 270,
    maxHeight: 588,
    aspectRatio: 430 / 932,
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderRadius: 38,
    borderWidth: 8,
    transform: [{ rotate: '2.5deg' }],
  },
  phoneCompact: {
    width: 238,
    borderRadius: 34,
    borderWidth: 7,
    marginLeft: -8,
  },
  phoneImage: {
    width: '100%',
    height: '100%',
  },
  mainSection: {
    width: '100%',
    backgroundColor: colors.white,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingHorizontal: 40,
    paddingTop: 100,
    paddingBottom: 112,
  },
  mainSectionCompact: {
    paddingHorizontal: 20,
    paddingTop: 68,
    paddingBottom: 72,
  },
  sectionIntro: {
    width: '100%',
    maxWidth: 1160,
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 56,
  },
  sectionIntroCompact: {
    flexDirection: 'column',
    gap: 20,
  },
  sectionTitle: {
    flex: 1,
    color: colors.ink,
    fontFamily: 'Arial Rounded MT Bold, ui-rounded, system-ui, sans-serif',
    fontSize: 46,
    fontWeight: '800',
    letterSpacing: -2,
    lineHeight: 52,
  },
  sectionTitleCompact: {
    fontSize: 37,
    lineHeight: 43,
    letterSpacing: -1.5,
  },
  sectionCopy: {
    flex: 1,
    maxWidth: 520,
    color: colors.muted,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 18,
    lineHeight: 29,
  },
  detailGrid: {
    width: '100%',
    maxWidth: 1160,
    alignSelf: 'center',
    flexDirection: 'row',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    marginTop: 64,
  },
  detailGridCompact: {
    flexDirection: 'column',
    marginTop: 48,
  },
  detail: {
    flex: 1,
    minHeight: 162,
    borderRightColor: colors.line,
    borderRightWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  detailCompact: {
    minHeight: 0,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    borderRightWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 24,
  },
  detailLabel: {
    color: colors.green,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  detailCopy: {
    color: colors.ink,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 17,
    lineHeight: 26,
  },
  previewGrid: {
    width: '100%',
    maxWidth: 1160,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 24,
    overflow: 'hidden',
    marginTop: 84,
    paddingTop: 24,
  },
  previewGridCompact: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 48,
    marginTop: 52,
  },
  preview: {
    width: '31%',
    maxWidth: 330,
  },
  previewCompact: {
    width: '100%',
    maxWidth: 310,
  },
  previewLift: {
    transform: [{ translateY: -24 }],
  },
  previewLabel: {
    color: colors.muted,
    fontFamily: 'Avenir Next, Avenir, system-ui, sans-serif',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  previewFrame: {
    width: '100%',
    aspectRatio: 430 / 932,
    overflow: 'hidden',
    backgroundColor: colors.paper,
    borderColor: colors.ink,
    borderRadius: 34,
    borderWidth: 6,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  footer: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingVertical: 36,
  },
  footerCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 30,
  },
  footerLine: {
    color: colors.ink,
    fontFamily: 'Arial Rounded MT Bold, ui-rounded, system-ui, sans-serif',
    fontSize: 16,
    fontWeight: '800',
  },
  footerLinks: {
    flexDirection: 'row',
    gap: 24,
  },
  footerLinksCompact: {
    width: '100%',
  },
});
