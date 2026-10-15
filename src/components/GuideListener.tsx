import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { audioSeek, audioTime, guideNarration } from '../guide-audio';
import { guideRecordings, type GuideRecording } from '../guide-recordings';
import { useLocalization } from '../localization-context';
import type { CareArticle } from '../puppy-care';
import type { Theme } from '../theme';

function RecordingPlayer({ article, recording, theme }: { article: CareArticle; recording: GuideRecording; theme: Theme }) {
  const { t } = useLocalization();
  const player = useAudioPlayer(recording.source, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const [failed, setFailed] = useState(false);
  const [rate, setRate] = useState(1);
  const duration = status.duration || recording.duration;
  const mediaError = (status as typeof status & { error?: string }).error;
  const error = failed || !!mediaError;
  const loading = !error && (!status.isLoaded || status.isBuffering);
  const title = `${article.shortTitle}${recording.attribution ? ' · elevenlabs.io' : ''}`;

  useEffect(() => {
    if (error) player.pause();
  }, [error, player]);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setFailed(true), 20_000);
    return () => clearTimeout(timer);
  }, [loading]);

  const seek = async (delta: number) => {
    try { await player.seekTo(audioSeek(player.currentTime, delta, duration)); } catch { setFailed(true); }
  };
  const play = async () => {
    try {
      if (error) { setFailed(false); player.replace(recording.source); player.setPlaybackRate(1); setRate(1); return; }
      if (status.playing) { player.pause(); return; }
      if (Platform.OS !== 'web') {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
      }
      if (status.didJustFinish || player.currentTime >= duration - 0.1) await player.seekTo(0);
      player.setActiveForLockScreen(true, { title, artist: 'Puptime · ElevenLabs', albumTitle: 'Puppy care guides' }, { showSeekBackward: true, showSeekForward: true });
      player.play();
    } catch { setFailed(true); }
  };
  const label = error ? t('learn.audioRetry') : loading ? t('learn.audioLoading') : status.playing ? t('learn.audioPause') : t('learn.audioPlay');
  const disabled = loading || error;
  return <View testID="learn.audio" style={[styles.panel, { borderColor: theme.border, backgroundColor: theme.surface, borderRadius: theme.presentation.controlRadius }]}>
    <View style={styles.row}>
      <Text accessibilityRole="header" aria-level={2} style={[styles.title, { color: theme.text }]}>{t('learn.audioTitle')}</Text>
      <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.audioCredit')}</Text>
    </View>
    {recording.attribution && <Text style={[styles.meta, { color: theme.textMuted }]}>{title}</Text>}
    <View style={styles.row}>
      <Pressable testID="learn.audio.play" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: loading }} disabled={loading} onPress={() => void play()}
        style={({ pressed }) => [styles.button, { backgroundColor: theme.primary, borderColor: theme.primary, borderRadius: theme.presentation.controlRadius, opacity: loading || pressed ? 0.65 : 1 }]}>
        <Text style={[styles.buttonText, { color: theme.onPrimary }]}>{status.playing ? 'Ⅱ' : '▶'} {label}</Text>
      </Pressable>
      <Pressable testID="learn.audio.back" accessibilityRole="button" accessibilityLabel={t('learn.audioBack')} accessibilityState={{ disabled }} disabled={disabled} onPress={() => void seek(-15)} style={({ pressed }) => [styles.button, { borderColor: theme.border, borderRadius: theme.presentation.controlRadius, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
        <Text style={[styles.buttonText, { color: theme.primary }]}>−15 s</Text>
      </Pressable>
      <Pressable testID="learn.audio.forward" accessibilityRole="button" accessibilityLabel={t('learn.audioForward')} accessibilityState={{ disabled }} disabled={disabled} onPress={() => void seek(15)} style={({ pressed }) => [styles.button, { borderColor: theme.border, borderRadius: theme.presentation.controlRadius, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
        <Text style={[styles.buttonText, { color: theme.primary }]}>+15 s</Text>
      </Pressable>
      <Text testID="learn.audio.time" style={[styles.meta, { color: theme.textMuted }]}>{audioTime(status.currentTime)} / {audioTime(duration)}</Text>
    </View>
    <View accessibilityRole="progressbar" accessibilityLabel={t('learn.audioProgress')} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.min(status.currentTime, duration)} aria-valuetext={`${audioTime(status.currentTime)} / ${audioTime(duration)}`} style={[styles.track, { backgroundColor: theme.border }]}>
      <View style={[styles.progress, { backgroundColor: theme.primary, width: `${duration ? Math.min(100, status.currentTime / duration * 100) : 0}%` }]} />
    </View>
    <View style={styles.row}>
      <Text style={[styles.meta, { color: theme.textMuted }]}>{t('learn.audioSpeed')}</Text>
      {[0.75, 1, 1.25, 1.5].map((speed) => <Pressable key={speed} testID={`learn.audio.speed.${speed}`} accessibilityRole="button" accessibilityLabel={t('learn.audioSpeedValue', { rate: speed })} accessibilityState={{ selected: rate === speed }} aria-pressed={rate === speed} onPress={() => {
        try { player.setPlaybackRate(speed); setRate(speed); } catch { setFailed(true); }
      }} style={({ pressed }) => [styles.speed, { borderColor: rate === speed ? theme.primary : theme.border, backgroundColor: rate === speed ? theme.primarySoft : theme.surface, opacity: pressed ? 0.65 : 1 }]}>
        <Text style={[styles.buttonText, { color: rate === speed ? theme.primary : theme.text }]}>{speed}×</Text>
      </Pressable>)}
    </View>
    {error && <Text accessibilityRole="alert" style={[styles.meta, { color: theme.danger }]}>{t('learn.audioError')}</Text>}
  </View>;
}

export function GuideListener({ article, theme }: { article: CareArticle; theme: Theme }) {
  const recording = guideRecordings[article.id];
  // An edited guide must never play an older version of its care advice.
  if (!recording || recording.script !== guideNarration(article)) return null;
  return <RecordingPlayer key={article.id} article={article} recording={recording} theme={theme} />;
}

const styles = StyleSheet.create({
  panel: { marginTop: 20, borderWidth: 1, padding: 16, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { fontSize: 19, lineHeight: 26, fontWeight: '700', marginRight: 'auto' },
  meta: { fontSize: 13, lineHeight: 20 },
  button: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progress: { height: '100%' },
  speed: { minWidth: 48, minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center', alignItems: 'center' },
});
