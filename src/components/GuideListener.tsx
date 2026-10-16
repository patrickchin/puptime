import { MaterialCommunityIcons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { audioSeek, audioTime, guideSourceText } from '../guide-audio';
import { guideRecordings, type GuideRecording } from '../guide-recordings';
import { useLocalization } from '../localization-context';
import type { CareArticle } from '../puppy-care';
import type { Theme } from '../theme';

function RecordingPlayer({ article, recording, theme }: { article: CareArticle; recording: GuideRecording; theme: Theme }) {
  const { t } = useLocalization();
  const { width } = useWindowDimensions();
  const player = useAudioPlayer(Platform.OS === 'web' ? null : recording.source, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const previousVolume = useRef(1);
  const [scrub, setScrub] = useState<number | null>(null);
  const [speedPickerOpen, setSpeedPickerOpen] = useState(false);
  const seekWidth = useRef(1);
  const duration = status.duration || recording.duration;
  const mediaError = (status as typeof status & { error?: string }).error;
  const error = failed || !!mediaError;
  const loading = !error && (!status.isLoaded || status.isBuffering);
  const title = `${article.shortTitle}${recording.attribution ? ' · elevenlabs.io' : ''}`;
  const narrator = recording.voice.split(' - ')[0];

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    // Pages returns full responses to range requests. A complete local blob keeps seeking reliable.
    void (async () => {
      try {
        const response = await fetch(Asset.fromModule(recording.source).uri, { signal: controller.signal });
        if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        player.replace({ uri: objectUrl });
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [player, recording.source, loadAttempt]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !status.isLoaded) return;
    player.volume = volume;
    player.muted = muted;
  }, [player, status.isLoaded, volume, muted]);

  useEffect(() => {
    if (error) player.pause();
  }, [error, player]);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setFailed(true), 20_000);
    return () => clearTimeout(timer);
  }, [loading]);

  const seekTo = async (seconds: number) => {
    try { await player.seekTo(audioSeek(seconds, 0, duration)); } catch { setFailed(true); }
  };
  const seek = (delta: number) => seekTo(player.currentTime + delta);
  const play = async () => {
    try {
      if (error) {
        setFailed(false);
        player.replace(Platform.OS === 'web' ? null : recording.source);
        if (Platform.OS === 'web') setLoadAttempt((attempt) => attempt + 1);
        if (volume !== 1) player.volume = volume;
        player.muted = muted;
        player.setPlaybackRate(1);
        setRate(1);
        return;
      }
      if (status.playing) { player.pause(); return; }
      if (Platform.OS !== 'web') {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
      }
      if (status.didJustFinish || player.currentTime >= duration - 0.1) await player.seekTo(0);
      player.setActiveForLockScreen(true, { title, artist: `Puptime · ${narrator} · ElevenLabs`, albumTitle: 'Puppy care guides' }, { showSeekBackward: true, showSeekForward: true });
      player.play();
    } catch { setFailed(true); }
  };
  const label = error ? t('learn.audioRetry') : loading ? t('learn.audioLoading') : status.playing ? t('learn.audioPause') : t('learn.audioPlay');
  const disabled = loading || error;
  const changeRate = (speed: number) => {
    try { player.setPlaybackRate(speed); setRate(speed); } catch { setFailed(true); }
  };
  if (Platform.OS === 'web') {
    const changeVolume = (value: number) => {
      if (value > 0) previousVolume.current = value;
      player.volume = value;
      setVolume(value);
      player.muted = false;
      setMuted(false);
    };
    const silent = muted || volume === 0;
    return <section className="puptime-listener" data-testid="learn.audio" aria-label={t('learn.audioTitle')} style={{ background: theme.surface, borderColor: theme.border, color: theme.text, '--audio-accent': theme.primary } as React.CSSProperties}>
      <style>{webPlayerStyles}</style>
      <div className="puptime-listener-inner">
        <button className="puptime-listener-play" data-testid="learn.audio.play" aria-label={label} title={label} disabled={loading} aria-busy={loading} onClick={() => void play()} style={{ background: theme.primary, color: theme.onPrimary }}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">{status.playing ? <path d="M6 4h4v16H6zm8 0h4v16h-4z" /> : <path d="m7 3 15 9-15 9z" />}</svg>
        </button>
        <div className="puptime-listener-copy">
          <div className="puptime-listener-title" title={title}>{title}</div>
          <div className="puptime-listener-credit" style={{ color: theme.textMuted }}>{loading ? t('learn.audioLoading') : t('learn.audioCredit', { voice: narrator })}</div>
        </div>
        <button className="puptime-listener-skip puptime-listener-back" data-testid="learn.audio.back" aria-label={t('learn.audioBack')} title={t('learn.audioBack')} disabled={disabled} onClick={() => void seek(-15)}>−15</button>
        <button className="puptime-listener-skip puptime-listener-forward" data-testid="learn.audio.forward" aria-label={t('learn.audioForward')} title={t('learn.audioForward')} disabled={disabled} onClick={() => void seek(15)}>+15</button>
        <input className="puptime-listener-progress" data-testid="learn.audio.seek" type="range" min="0" max={duration} step="0.1" value={scrub ?? status.currentTime} disabled={disabled} aria-label={t('learn.audioProgress')} aria-valuetext={`${audioTime(scrub ?? status.currentTime)} / ${audioTime(duration)}`} onChange={(event) => {
          const value = Number(event.currentTarget.value);
          setScrub(value);
          void seekTo(value);
        }} onPointerUp={() => setScrub(null)} onPointerCancel={() => setScrub(null)} onKeyUp={() => setScrub(null)} onBlur={() => setScrub(null)} />
        <output className="puptime-listener-time" data-testid="learn.audio.time">{audioTime(scrub ?? status.currentTime)} / {audioTime(duration)}</output>
        <select className="puptime-listener-speed" data-testid="learn.audio.speed" aria-label={t('learn.audioSpeed')} value={rate} disabled={disabled} onChange={(event) => {
          changeRate(Number(event.currentTarget.value));
        }}>{[0.75, 1, 1.25, 1.5].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select>
        <div className="puptime-listener-volume">
          <button aria-label={silent ? t('learn.audioUnmute') : t('learn.audioMute')} title={silent ? t('learn.audioUnmute') : t('learn.audioMute')} onClick={() => {
            if (silent) { if (volume === 0) changeVolume(previousVolume.current); player.muted = false; setMuted(false); }
            else { player.muted = true; setMuted(true); }
          }}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4 5 9H2v6h3l6 5z" />{!silent ? <><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></> : <path d="m16 9 6 6m0-6-6 6" />}</svg>
          </button>
          <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label={t('learn.audioVolume')} onChange={(event) => changeVolume(Number(event.currentTarget.value))} />
        </div>
        {error && <div className="puptime-listener-error" role="alert" style={{ color: theme.danger }}>{t('learn.audioError')}</div>}
      </div>
    </section>;
  }
  const currentTime = scrub ?? status.currentTime;
  const progress = `${duration ? Math.min(100, currentTime / duration * 100) : 0}%` as const;
  const scrubPosition = (event: GestureResponderEvent) => audioSeek((event.nativeEvent.locationX - 8) / Math.max(1, seekWidth.current - 16) * duration, 0, duration);
  const wide = width >= 700;
  const copy = (<View style={[styles.copy, wide && styles.copyWide]}>
        <Text numberOfLines={wide ? 2 : undefined} style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Text numberOfLines={wide ? 1 : undefined} style={[styles.meta, { color: theme.textMuted }]}>{loading ? t('learn.audioLoading') : t('learn.audioCredit', { voice: narrator })}</Text>
      </View>);
  const playControl = (<Pressable testID="learn.audio.play" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: loading }} disabled={loading} onPress={() => void play()}
        style={({ pressed }) => [styles.control, styles.play, { backgroundColor: theme.primary, opacity: loading || pressed ? 0.65 : 1 }]}>
        {loading ? <ActivityIndicator color={theme.onPrimary} /> : <MaterialCommunityIcons name={error ? 'reload' : status.playing ? 'pause' : 'play'} size={26} color={theme.onPrimary} accessible={false} />}
      </Pressable>);
  const back = (<Pressable testID="learn.audio.back" accessibilityRole="button" accessibilityLabel={t('learn.audioBack')} accessibilityState={{ disabled }} disabled={disabled} onPress={() => void seek(-15)} style={({ pressed }) => [styles.control, { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
        <Text style={[styles.controlText, { color: theme.text }]}>−15</Text>
      </Pressable>);
  const forward = (<Pressable testID="learn.audio.forward" accessibilityRole="button" accessibilityLabel={t('learn.audioForward')} accessibilityState={{ disabled }} disabled={disabled} onPress={() => void seek(15)} style={({ pressed }) => [styles.control, { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
        <Text style={[styles.controlText, { color: theme.text }]}>+15</Text>
      </Pressable>);
  const speed = (<Pressable testID="learn.audio.speed" accessibilityRole="button" accessibilityLabel={t('learn.audioSpeedValue', { rate })} accessibilityState={{ disabled, expanded: speedPickerOpen }} disabled={disabled} onPress={() => setSpeedPickerOpen(true)} style={({ pressed }) => [styles.control, styles.speed, { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
        <Text style={[styles.controlText, { color: theme.text }]}>{rate}×</Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color={theme.textMuted} accessible={false} />
      </Pressable>);
  const mute = (<Pressable testID="learn.audio.mute" accessibilityRole="button" accessibilityLabel={t(muted ? 'learn.audioUnmute' : 'learn.audioMute')} accessibilityState={{ selected: muted }} onPress={() => { player.muted = !muted; setMuted(!muted); }} style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
        <MaterialCommunityIcons name={muted ? 'volume-off' : 'volume-high'} size={21} color={theme.text} accessible={false} />
      </Pressable>);
  const time = (<Text testID="learn.audio.time" style={[styles.time, wide && styles.timeWide, { color: theme.textMuted }]}>{audioTime(currentTime)} / {audioTime(duration)}</Text>);
  const seekTrack = (<View testID="learn.audio.seek" accessible accessibilityRole="adjustable" accessibilityLabel={t('learn.audioProgress')}
      accessibilityState={{ disabled }} accessibilityValue={{ min: 0, max: duration, now: Math.min(currentTime, duration), text: `${audioTime(currentTime)} / ${audioTime(duration)}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(event) => { if (!disabled) void seek(event.nativeEvent.actionName === 'increment' ? 15 : -15); }}
      onLayout={(event) => { seekWidth.current = event.nativeEvent.layout.width; }}
      onStartShouldSetResponder={() => !disabled}
      onResponderGrant={(event) => setScrub(scrubPosition(event))}
      onResponderMove={(event) => setScrub(scrubPosition(event))}
      onResponderRelease={(event) => { const value = scrubPosition(event); void seekTo(value).finally(() => setScrub(null)); }}
      onResponderTerminate={() => setScrub(null)} style={[styles.seek, wide && styles.seekWide, { opacity: disabled ? 0.4 : 1 }]}>
      <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.border }]}>
        <View style={[styles.progress, { backgroundColor: theme.primary, width: progress }]} />
        <View style={[styles.thumb, { backgroundColor: theme.primary, left: progress }]} />
      </View>
    </View>);
  return <SafeAreaView edges={['left', 'right']} testID="learn.audio" accessibilityLabel={t('learn.audioTitle')} style={[styles.bar, wide && styles.barWide, { borderColor: theme.border, backgroundColor: theme.surface }]}>
    {wide ? <View style={styles.wideRow}>{playControl}{copy}{back}{forward}{seekTrack}{time}{speed}{mute}</View> : <>
      <View style={styles.copyRow}>{copy}{mute}</View>
      <View style={styles.controls}>{playControl}{back}{forward}{time}{speed}</View>
      {seekTrack}
    </>}
    {error && <Text accessibilityRole="alert" style={[styles.meta, { color: theme.danger }]}>{t('learn.audioError')}</Text>}
    <Modal visible={speedPickerOpen} transparent animationType="fade" onRequestClose={() => setSpeedPickerOpen(false)}>
      <View style={styles.modal}>
        <Pressable accessible={false} style={[StyleSheet.absoluteFill, styles.scrim]} onPress={() => setSpeedPickerOpen(false)} />
        <SafeAreaView edges={['bottom']} accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <View style={styles.copyRow}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.text }]}>{t('learn.audioSpeed')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('settings.closePicker')} onPress={() => setSpeedPickerOpen(false)} style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="close" size={22} color={theme.text} accessible={false} />
            </Pressable>
          </View>
          {[0.75, 1, 1.25, 1.5].map((speed) => <Pressable key={speed} testID={`learn.audio.speed.${speed}`} accessibilityRole="radio" accessibilityLabel={t('learn.audioSpeedValue', { rate: speed })} accessibilityState={{ checked: rate === speed }} onPress={() => { changeRate(speed); setSpeedPickerOpen(false); }} style={({ pressed }) => [styles.option, { backgroundColor: pressed || rate === speed ? theme.primarySoft : theme.surface }]}>
            <Text style={[styles.controlText, { color: theme.text }]}>{speed}×</Text>
            {rate === speed && <MaterialCommunityIcons name="check" size={22} color={theme.primary} accessible={false} />}
          </Pressable>)}
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

export function GuideListener({ article, theme }: { article: CareArticle; theme: Theme }) {
  const recording = guideRecordings[article.id];
  // An edited guide must never play an older version of its care advice.
  if (!recording || recording.sourceText !== guideSourceText(article)) return null;
  return <RecordingPlayer key={article.id} article={article} recording={recording} theme={theme} />;
}

const styles = StyleSheet.create({
  bar: { flexShrink: 0, borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 8 },
  barWide: { paddingBottom: 8 },
  wideRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  copyWide: { minWidth: 120, maxWidth: 220 },
  seekWide: { flex: 1, minWidth: 120 },
  timeWide: { flex: 0, width: 76 },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, lineHeight: 21, fontWeight: '700' },
  meta: { fontSize: 12, lineHeight: 19 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 4 },
  control: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  play: { borderRadius: 24, width: 48, height: 48 },
  controlText: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  time: { flex: 1, minWidth: 68, fontSize: 12, lineHeight: 20, textAlign: 'center', fontVariant: ['tabular-nums'] },
  speed: { flexDirection: 'row', gap: 2, paddingHorizontal: 4 },
  seek: { height: 48, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, marginHorizontal: 8 },
  progress: { height: '100%' },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, top: -5, marginLeft: -7 },
  pressed: { opacity: 0.65 },
  modal: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { width: '100%', maxWidth: 480, padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetTitle: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: '700' },
  option: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 8 },
});

const webPlayerStyles = `
.puptime-listener{flex-shrink:0;border-top:1px solid;padding:14px 24px max(14px,env(safe-area-inset-bottom));font-family:Avenir Next,Avenir,system-ui,sans-serif;z-index:2}
.puptime-listener-inner{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:44px minmax(130px,220px) 44px 44px minmax(140px,1fr) auto 64px 104px;align-items:center;gap:12px}
.puptime-listener button,.puptime-listener select{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent;min-height:44px;border-radius:8px}
.puptime-listener button:hover:not(:disabled){opacity:.8}
.puptime-listener button:disabled,.puptime-listener input:disabled,.puptime-listener select:disabled{opacity:.45;cursor:default}
.puptime-listener button:focus-visible,.puptime-listener input:focus-visible,.puptime-listener select:focus-visible{outline:2px solid var(--audio-accent);outline-offset:3px}
.puptime-listener .puptime-listener-play{width:44px;border-radius:50%;display:grid;place-items:center}
.puptime-listener-copy{min-width:0}.puptime-listener-title{font-size:14px;line-height:21px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.puptime-listener-credit{font-size:12px;line-height:19px}.puptime-listener-skip{font-size:13px!important;font-weight:600!important}
.puptime-listener input{accent-color:var(--audio-accent);cursor:pointer;min-width:0;margin:0;min-height:24px}
.puptime-listener-progress{width:100%}.puptime-listener-time{font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}
.puptime-listener-speed{font-size:13px!important;width:64px}.puptime-listener-volume{display:flex;align-items:center;gap:4px}.puptime-listener-volume button{width:44px;display:grid;place-items:center}.puptime-listener-volume input{width:56px}
@media(pointer:coarse){.puptime-listener-volume input{display:none}}
.puptime-listener-error{grid-column:1/-1;font-size:13px;line-height:20px}
@media(max-width:900px){.puptime-listener{padding:10px 16px max(10px,env(safe-area-inset-bottom))}.puptime-listener-inner{grid-template-columns:44px 44px 44px 1fr 52px;gap:6px}.puptime-listener-copy{order:0;grid-column:1/5;grid-row:1}.puptime-listener-play{order:1}.puptime-listener-back{order:2}.puptime-listener-forward{order:3}.puptime-listener-time{order:4;text-align:center}.puptime-listener-speed{order:5;width:52px}.puptime-listener-progress{order:6;grid-column:1/-1}.puptime-listener-volume{order:0;grid-column:5;grid-row:1;justify-content:flex-end}.puptime-listener-volume input{display:none}.puptime-listener-error{order:7}}
`;
