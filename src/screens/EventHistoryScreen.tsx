import {MaterialCommunityIcons} from '@expo/vector-icons';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,FlatList,Pressable,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import type {CloudHandle} from '../cloud/use-cloud';
import {AccountButton} from '../components/AccountSignIn';
import {EventHistoryPanel,HistoryVersionRow} from '../components/EventHistoryPanel';
import type {PuppyEvent} from '../domain';
import type {EventHistoryData,EventHistoryEntry} from '../event-history';
import {historyChangedFields} from '../event-history-view';
import {useLocalization} from '../localization-context';
import {spacing,type Theme} from '../theme';

type Props={data:EventHistoryData;cloud?:CloudHandle;theme:Theme;onBack:()=>void;onRestored:(event:PuppyEvent)=>void;refreshToken?:number};
export function EventHistoryScreen({data,cloud,theme,onBack,onRestored,refreshToken}:Props) {
 const {t,locale}=useLocalization();
 const [entries,setEntries]=useState<EventHistoryEntry[]>([]),[next,setNext]=useState<number|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[eventId,setEventId]=useState<string|null>(null);
 const request=useRef(0),failedMore=useRef(false),nextRef=useRef(next),loadingRef=useRef(false);
 nextRef.current=next;
 const load=useCallback(async(more=false)=>{
  if(more&&(!nextRef.current||loadingRef.current))return;
  const before=more?nextRef.current:undefined,id=++request.current;loadingRef.current=true;setLoading(true);setError(false);
  try {
   const page=await data.recentPage({...(before?{before}:{}),limit:50});
   if(id!==request.current)return;
   setEntries(previous=>more?[...previous,...page.entries]:page.entries);setNext(page.next);
  }catch {if(id===request.current){failedMore.current=more;setError(true);}}
  finally {if(id===request.current){loadingRef.current=false;setLoading(false);}}
 },[data]);
 useEffect(()=>{void load();return()=>{request.current++;};},[load,refreshToken]);
 const date=(value:number)=>new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(value);
 const renderItem=({item}:{item:EventHistoryEntry})=><HistoryVersionRow theme={theme} testID={`history.recent.${item.sequence}`} event={item.after??item.before} title={date(item.createdAt)} detail={`${t(`history.source.${item.source}`)} · ${historyChangedFields(item.before,item.after).map(field=>t(`history.field.${field}`)).join(', ')}`} deleted={!item.after} onPress={()=>setEventId(item.eventId)}/>;
 return <SafeAreaView testID="screen.eventHistory" style={[styles.root,{backgroundColor:theme.background}]} edges={['top','bottom']}>
  <View style={[styles.root,eventId!==null&&styles.hidden]} pointerEvents={eventId!==null?'none':'auto'} accessibilityElementsHidden={eventId!==null} importantForAccessibility={eventId!==null?'no-hide-descendants':'auto'}>
   <View style={styles.header}>
    <Pressable testID="history.recent.back" accessibilityRole="button" accessibilityLabel={t('onboarding.back')} onPress={onBack} style={({pressed})=>[styles.back,{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised,borderRadius:theme.presentation.controlRadius}]}><MaterialCommunityIcons name="arrow-left" size={24} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no"/></Pressable>
    <Text accessibilityRole="header" maxFontSizeMultiplier={1.5} style={[styles.title,{color:theme.text,fontFamily:theme.presentation.headingFont}]}>{t('history.recentTitle')}</Text>
   </View>
   <FlatList testID="history.recent.list" data={entries} renderItem={renderItem} keyExtractor={entry=>String(entry.sequence)} contentContainerStyle={styles.content}
    ListHeaderComponent={error?<View style={styles.stack}><Text testID="history.recent.error" accessibilityRole="alert" style={[styles.body,{color:theme.danger}]}>{t('history.readError')}</Text><AccountButton theme={theme} testID="history.recent.retry" label={t('account.retry')} disabled={loading} onPress={()=>{void load(failedMore.current);}}/></View>:null}
    ListEmptyComponent={loading?<View style={styles.loading}><ActivityIndicator color={theme.primary}/><Text style={[styles.body,{color:theme.textMuted}]}>{t('history.loading')}</Text></View>:!error?<Text testID="history.recent.empty" style={[styles.body,{color:theme.textMuted}]}>{t('history.empty')}</Text>:null}
    ListFooterComponent={next?<AccountButton theme={theme} testID="history.recent.more" label={t('history.more')} loading={loading} disabled={loading} onPress={()=>{void load(true);}}/>:null}/>
  </View>
  {eventId!==null?<EventHistoryPanel key={eventId} data={data} eventId={eventId} cloud={cloud} theme={theme} refreshToken={refreshToken} onBack={()=>{setEventId(null);void load();}} onRestored={onRestored}/>:null}
 </SafeAreaView>;
}
const styles=StyleSheet.create({root:{flex:1},hidden:{display:'none'},header:{padding:spacing.md,flexDirection:'row',alignItems:'flex-start',gap:12},back:{width:48,height:48,alignItems:'center',justifyContent:'center'},title:{flex:1,fontSize:20,lineHeight:28,fontWeight:'700'},content:{paddingHorizontal:spacing.md,paddingBottom:spacing.xl,gap:12},stack:{gap:12},body:{fontSize:16,lineHeight:24},loading:{flexDirection:'row',gap:12,alignItems:'center'}});
