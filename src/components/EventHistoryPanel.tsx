import {MaterialCommunityIcons} from '@expo/vector-icons';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,FlatList,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {CloudApiError} from '../cloud/api';
import {eventDataSchema,type Revision} from '../cloud/protocol';
import {useAccountSnapshot} from '../cloud/use-account-snapshot';
import type {CloudHandle} from '../cloud/use-cloud';
import type {PuppyEvent} from '../domain';
import {EventHistoryError,type EventHistoryData,type EventHistoryEntry,type EventHistoryHead,type EventHistoryPage,type EventHistorySelection} from '../event-history';
import {historyChangedFields,historyRestorePreview} from '../event-history-view';
import type {MessageKey} from '../localization';
import {useLocalization} from '../localization-context';
import {spacing,type Theme} from '../theme';
import {AccountButton} from './AccountSignIn';
import {ActivityIcon} from './ActivityIcon';

type Version={selection:EventHistorySelection;before:PuppyEvent|null;after:PuppyEvent|null;createdAt:number;label:MessageKey;head:EventHistoryHead};
type HistoryRow={kind:'local';entry:EventHistoryEntry}|{kind:'local-more'}|{kind:'cloud-controls'}|{kind:'cloud';revision:Revision}|{kind:'cloud-more'};
export type EventHistoryPanelProps={data:EventHistoryData;eventId:string;cloud?:CloudHandle;theme:Theme;onBack:()=>void;onRestored:(event:PuppyEvent)=>void;refreshToken?:number;onBusyChange?:(busy:boolean)=>void};

export function EventHistoryPanel({data,eventId,cloud,theme,onBack,onRestored,refreshToken,onBusyChange}:EventHistoryPanelProps) {
 const {t,locale}=useLocalization(),account=useAccountSnapshot(cloud?.controller??null);
 const [page,setPage]=useState<EventHistoryPage|null>(null),[loading,setLoading]=useState(true),[readError,setReadError]=useState(false);
 const [selected,setSelected]=useState<Version|null>(null),[confirm,setConfirm]=useState(false),[restored,setRestored]=useState<PuppyEvent|null>(null),[changed,setChanged]=useState(false);
 const [saving,setSaving]=useState(false),[restoreError,setRestoreError]=useState<MessageKey|null>(null);
 const [cloudVersions,setCloudVersions]=useState<Revision[]>([]),[cloudRequested,setCloudRequested]=useState(false),[cloudNext,setCloudNext]=useState<number|null>(null),[cloudLoading,setCloudLoading]=useState(false),[cloudError,setCloudError]=useState<MessageKey|null>(null);
 const localRequest=useRef(0),remoteRequest=useRef(0),remoteAbort=useRef<AbortController|null>(null),cloudLoadingRef=useRef(false),failedLocalMore=useRef(false),failedCloudMore=useRef(false),headCheck=useRef(0),pageRef=useRef(page),selectedRef=useRef(selected),restoredRef=useRef(restored),savingRef=useRef(false);
 pageRef.current=page;selectedRef.current=selected;restoredRef.current=restored;
 const identityKey=[account?.account?.user.id,account?.sync?.accountId,account?.sync?.generation,account?.sync?.state].join(':');
 const previousIdentity=useRef(identityKey),previousRefresh=useRef(refreshToken);
 const cancelCloud=useCallback(()=>{remoteAbort.current?.abort();remoteAbort.current=null;remoteRequest.current++;cloudLoadingRef.current=false;setCloudLoading(false);},[]);
 const loadLocal=useCallback(async(more=false)=>{
  const previous=pageRef.current,before=more?previous?.next:undefined;
  if(more&&!before)return;
  const request=++localRequest.current;setLoading(true);setReadError(false);
  try {
   const result=await data.eventPage(eventId,{...(before?{before}:{}),limit:50});
   if(request!==localRequest.current)return;
   setPage(more&&previous?{...previous,entries:[...previous.entries,...result.entries],next:result.next}:result);
  }catch {if(request===localRequest.current){failedLocalMore.current=more;setReadError(true);}}
  finally {if(request===localRequest.current)setLoading(false);}
 },[data,eventId]);
 useEffect(()=>{
  setPage(null);pageRef.current=null;setSelected(null);setConfirm(false);setRestored(null);restoredRef.current=null;setChanged(false);setRestoreError(null);
  setCloudVersions([]);setCloudRequested(false);setCloudNext(null);setCloudError(null);cancelCloud();void loadLocal();
  return()=>{localRequest.current++;remoteRequest.current++;headCheck.current++;remoteAbort.current?.abort();};
 },[loadLocal,cancelCloud]);
 useEffect(()=>{
  if(previousRefresh.current===refreshToken)return;previousRefresh.current=refreshToken;
  if(restoredRef.current)return;
  const captured=selectedRef.current,request=++headCheck.current;
  if(!captured){if(!savingRef.current)void loadLocal();return;}
  void data.eventPage(eventId,{limit:1}).then(({head})=>{
   if(request!==headCheck.current||selectedRef.current!==captured||restoredRef.current||savingRef.current)return;
   if(JSON.stringify(head)!==JSON.stringify(captured.head))setChanged(true);
  }).catch(()=>{if(request===headCheck.current&&selectedRef.current===captured&&!restoredRef.current&&!savingRef.current)setRestoreError('history.readError');});
 },[refreshToken,loadLocal,data,eventId]);
 useEffect(()=>{
  if(previousIdentity.current===identityKey)return;previousIdentity.current=identityKey;
  cancelCloud();setCloudVersions([]);setCloudRequested(false);setCloudNext(null);
  setCloudError(account?.account&&!account.account.cloud.canSync?'history.cloudExpired':'history.cloudChanged');
  if(selectedRef.current){setChanged(true);if(selectedRef.current.selection.source==='cloud'){setSelected(null);setConfirm(false);}}
 },[identityKey,cancelCloud,account?.account]);
 const date=(value:number)=>new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(value);
 const reload=()=>{
  if(savingRef.current)return;
  setSelected(null);selectedRef.current=null;setConfirm(false);setRestored(null);restoredRef.current=null;setRestoreError(null);setChanged(false);
  cancelCloud();setCloudVersions([]);setCloudRequested(false);setCloudNext(null);setCloudError(null);void loadLocal();
 };
 const openLocal=(entry:EventHistoryEntry)=>{
  if(!page||savingRef.current)return;
  setSelected({selection:{source:'local',sequence:entry.sequence},before:entry.before,after:entry.after,createdAt:entry.createdAt,label:`history.source.${entry.source}`,head:page.head});
  setConfirm(false);setRestoreError(null);setRestored(null);restoredRef.current=null;
 };
 const openCloud=(revision:Revision)=>{
  if(!page||savingRef.current)return;
  const snapshot=(record:Revision['before'])=>record&&record.kind==='event'&&!record.deleted?{id:eventId,...eventDataSchema.parse(record.data)}:null;
  setSelected({selection:{source:'cloud',revision},before:snapshot(revision.before),after:snapshot(revision.after),createdAt:revision.acceptedAt,label:`history.reason.${revision.reason}`,head:page.head});
  setConfirm(false);setRestoreError(null);setRestored(null);restoredRef.current=null;
 };
 const loadCloud=async(more=false)=>{
  if(cloudLoadingRef.current||savingRef.current||!cloud?.controller)return;
  if(!account?.online){setCloudError('history.cloudOffline');return;}
  if(!account.account){setCloudError('history.cloudAuth');return;}
  if(!account.account.cloud.canSync){setCloudError('history.cloudExpired');return;}
  const before=more?cloudNext:undefined;if(more&&!before)return;
  const controller=new AbortController(),request=++remoteRequest.current;
  remoteAbort.current?.abort();remoteAbort.current=controller;cloudLoadingRef.current=true;setCloudLoading(true);setCloudError(null);
  try {
   const result=await cloud.controller.eventHistory(eventId,before??undefined,controller.signal);
   if(request!==remoteRequest.current||controller.signal.aborted)return;
   setCloudRequested(true);setCloudVersions(previous=>more?[...previous,...result.revisions]:result.revisions);
   setCloudNext(result.revisions.length===50?result.revisions.at(-1)!.revision:null);
  }catch(error){
   if(request!==remoteRequest.current||controller.signal.aborted)return;
   const key:MessageKey=error instanceof CloudApiError?({network:'history.cloudOffline','auth-required':'history.cloudAuth',expired:'history.cloudExpired',forbidden:'history.cloudForbidden',conflict:'history.cloudChanged'} as Partial<Record<string,MessageKey>>)[error.category]??'history.cloudError':'history.cloudError';
   failedCloudMore.current=more;setCloudError(key);
  }finally {if(request===remoteRequest.current){remoteAbort.current=null;cloudLoadingRef.current=false;setCloudLoading(false);}}
 };
 const accountBusy=!!selected?.head.owner&&!!account?.busy;
 const latest=page?.entries[0]?.after??page?.entries[0]?.before??null;
 const preview=selected?historyRestorePreview(selected.after,selected.head,latest):null;
 const restore=async()=>{
  if(savingRef.current||accountBusy||!selected||!preview?.event||preview.problem||changed)return;
  savingRef.current=true;setSaving(true);onBusyChange?.(true);setRestoreError(null);
  let committed:PuppyEvent|undefined;
  try {committed=await data.restore({eventId,selection:selected.selection,expected:selected.head});setRestored(committed);restoredRef.current=committed;setConfirm(false);}
  catch(error){const problem=error instanceof EventHistoryError?error.category:null;setRestoreError(problem==='stale'?'history.stale':problem==='pending'?'history.pending':problem==='unsupported'?'history.unsupported':problem==='unavailable'?'history.unavailable':'history.saveError');if(problem==='stale')setChanged(true);}
  finally {savingRef.current=false;setSaving(false);onBusyChange?.(false);}
  if(committed)onRestored(committed);
 };
 const back=()=>{
  if(savingRef.current)return;
  if(restoredRef.current){onBack();return;}
  if(confirm){setConfirm(false);return;}
  if(selected){setSelected(null);selectedRef.current=null;setRestoreError(null);return;}
  onBack();
 };
 const text={color:theme.text},muted={color:theme.textMuted};
 const notice=(key:MessageKey,id:string,danger=false)=><Text testID={id} accessibilityRole={danger?'alert':undefined} accessibilityLiveRegion="polite" style={[styles.notice,{color:danger?theme.danger:theme.text,backgroundColor:danger?theme.dangerSoft:theme.primarySoft,borderRadius:theme.presentation.controlRadius}]}>{t(key)}</Text>;
 const rows:HistoryRow[]=[];
 if(page?.head.owner&&page.head.cloudRecord){rows.push({kind:'cloud-controls'});for(const revision of cloudVersions)rows.push({kind:'cloud',revision});if(cloudNext)rows.push({kind:'cloud-more'});}
 for(const entry of page?.entries??[])rows.push({kind:'local',entry});
 if(page?.next)rows.push({kind:'local-more'});
 const renderRow=({item}:{item:HistoryRow})=>{
  if(item.kind==='local-more')return <AccountButton theme={theme} testID="history.local.more" label={t('history.more')} disabled={loading} loading={loading} onPress={()=>{void loadLocal(true);}}/>;
  if(item.kind==='cloud-controls')return <View style={styles.cloudControls}>
   <AccountButton theme={theme} testID="history.cloud.load" label={t('history.cloud')} disabled={cloudLoading||!cloud?.controller} loading={cloudLoading} icon="cloud-outline" onPress={()=>{void loadCloud();}}/>
   {cloudError?notice(cloudError,'history.cloud.error',true):null}
   {cloudError&&cloud?.controller?<AccountButton theme={theme} testID="history.cloud.retry" label={t('account.retry')} disabled={cloudLoading} onPress={()=>{void loadCloud(failedCloudMore.current);}}/>:null}
   {cloudRequested&&!cloudVersions.length&&!cloudLoading?notice('history.cloudEmpty','history.cloud.empty'):null}
  </View>;
  if(item.kind==='cloud-more')return <AccountButton theme={theme} testID="history.cloud.more" label={t('history.cloudMore')} disabled={cloudLoading} loading={cloudLoading} onPress={()=>{void loadCloud(true);}}/>;
  if(item.kind==='local'){
   const entry=item.entry,event=entry.after??entry.before;
   return <HistoryVersionRow theme={theme} event={event} testID={`history.local.${entry.sequence}`} title={date(entry.createdAt)} detail={`${t(`history.source.${entry.source}`)} · ${historyChangedFields(entry.before,entry.after).map(field=>t(`history.field.${field}`)).join(', ')}`} deleted={!entry.after} onPress={()=>openLocal(entry)}/>;
  }
  const revision=item.revision,event=revision.after.kind==='event'?{id:eventId,...eventDataSchema.parse(revision.after.data)}:null;
  return <HistoryVersionRow theme={theme} event={event} testID={`history.cloud.${revision.revision}`} title={date(revision.acceptedAt)} detail={`${t('history.cloudVersion',{revision:revision.revision})} · ${t(`history.reason.${revision.reason}`)}`} deleted={revision.after.deleted} onPress={()=>openCloud(revision)}/>;
 };
 return <View testID="history.panel" style={[styles.root,{backgroundColor:theme.background}]}>
  <View style={styles.header}>
   <Pressable testID="history.back" accessibilityRole="button" accessibilityLabel={t('onboarding.back')} accessibilityState={{disabled:saving}} disabled={saving} onPress={back} style={({pressed})=>[styles.back,{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised,borderRadius:theme.presentation.controlRadius}]}><MaterialCommunityIcons name="arrow-left" size={24} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no"/></Pressable>
   <Text accessibilityRole="header" maxFontSizeMultiplier={1.5} style={[styles.title,text,{fontFamily:theme.presentation.headingFont}]}>{t(confirm?'history.confirmTitle':'history.title')}</Text>
  </View>
  {selected?<ScrollView key={confirm?'confirm':'detail'} testID={confirm?'history.confirm':'history.detail'} contentContainerStyle={styles.content}>
   {restored?notice('history.restored','history.restored'):null}
   {!restored&&page&&!page.head.event&&page.head.sequence!==null?notice('history.deleted','history.deleted'):null}
   <Text style={[styles.body,muted]}>{date(selected.createdAt)} · {t(selected.label)}</Text>
   {confirm?<Text style={[styles.body,muted]}>{t('history.confirmBody')}</Text>:null}
   <Snapshot event={confirm?selected.head.event:selected.before} theme={theme} label={t('history.before')} prefix={confirm?'history.confirm.before':'history.before'}/>
   <Snapshot event={restored??(confirm?preview?.event??null:selected.after)} theme={theme} label={t('history.after')} prefix={confirm?'history.confirm.after':'history.after'}/>
   {changed&&!restored?notice('history.stale','history.stale',true):null}
   {restoreError?notice(restoreError,'history.restore.error',true):null}
   {restored?null:changed?<AccountButton theme={theme} testID="history.reload" label={t('history.reload')} disabled={saving} onPress={reload}/>:confirm?<View style={styles.stack}>
    <AccountButton theme={theme} testID="history.confirm.restore" label={t('history.restore')} primary disabled={saving||accountBusy} loading={saving} onPress={()=>{void restore();}}/>
    <AccountButton theme={theme} testID="history.confirm.cancel" label={t('account.cancel')} disabled={saving} onPress={()=>setConfirm(false)}/>
    {restoreError?<AccountButton theme={theme} testID="history.reload" label={t('history.reload')} disabled={saving} onPress={reload}/>:null}
   </View>:preview?.problem?notice(preview.problem==='identical'?'history.identical':preview.problem==='unsupported'?'history.unsupported':'history.deleted',`history.${preview.problem}`):<AccountButton theme={theme} testID="history.restore" label={t('history.restore')} primary disabled={accountBusy} onPress={()=>{setRestoreError(null);setConfirm(true);}}/>}
   {restoreError&&!changed&&!confirm&&!restored?<AccountButton theme={theme} testID="history.reload" label={t('history.reload')} onPress={reload}/>:null}
  </ScrollView>:<FlatList testID="history.local.list" data={rows} renderItem={renderRow} keyExtractor={item=>item.kind==='local'?`local.${item.entry.sequence}`:item.kind==='cloud'?`cloud.${item.revision.revision}`:item.kind} contentContainerStyle={styles.content}
    ListHeaderComponent={<View style={styles.stack}>{page&&!page.head.event&&page.head.sequence!==null?notice('history.deleted','history.deleted'):null}{loading&&!page?<View style={styles.loading}><ActivityIndicator color={theme.primary}/><Text style={[styles.body,muted]}>{t('history.loading')}</Text></View>:null}{readError?<>{notice('history.readError','history.read.error',true)}<AccountButton theme={theme} testID="history.local.retry" label={t('account.retry')} disabled={loading} onPress={()=>{void loadLocal(failedLocalMore.current);}}/></>:null}{!loading&&page&&!page.entries.length?notice('history.empty','history.empty'):null}</View>}/>
  }
 </View>;
}

export function HistoryVersionRow({theme,event,testID,title,detail,deleted,onPress}:{theme:Theme;event:PuppyEvent|null;testID:string;title:string;detail:string;deleted?:boolean;onPress:()=>void}) {
 const {t,eventLabel}=useLocalization();
 const activity=event?`${event.type==='custom'?event.customLabel:eventLabel(event.type)}${event.note?` · ${event.note}`:''}`:null;
 return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${title}. ${detail}${deleted?`. ${t('history.deleted')}`:''}${activity?`. ${activity}`:''}`} onPress={onPress} style={({pressed})=>[styles.row,{borderColor:theme.border,backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised,borderRadius:theme.presentation.controlRadius}]}>
  {event?<View style={[styles.icon,{backgroundColor:theme.primarySoft,borderRadius:theme.presentation.iconRadius}]}><ActivityIcon activity={event} theme={theme} color={theme.primary} size={22}/></View>:null}
  <View style={styles.copy}>
   <Text style={[styles.rowTitle,{color:theme.text}]}>{title}</Text>
   <Text style={[styles.small,{color:theme.textMuted}]}>{detail}</Text>
   {deleted?<Text style={[styles.small,{color:theme.danger}]}>{t('history.deleted')}</Text>:null}
   {event?<Text numberOfLines={2} style={[styles.small,{color:theme.text}]}>{activity}</Text>:null}
  </View><MaterialCommunityIcons name="chevron-right" size={22} color={theme.textMuted} accessibilityElementsHidden importantForAccessibility="no"/>
 </Pressable>;
}

function Snapshot({event,theme,label,prefix}:{event:PuppyEvent|null;theme:Theme;label:string;prefix:string}) {
 const {t,locale,eventLabel}=useLocalization();
 const date=(value:number)=>new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(value);
 return <View style={[styles.snapshot,{backgroundColor:theme.surfaceRaised,borderColor:theme.border,borderRadius:theme.presentation.cardRadius}]}>
  <Text style={[styles.small,{color:theme.textMuted}]}>{label}</Text>
  {!event?<Text testID={`${prefix}.empty`} style={[styles.body,{color:theme.text}]}>{t('history.notLogged')}</Text>:<>
   <View style={styles.activity}><ActivityIcon activity={event} theme={theme} color={theme.primary} size={26}/><Text testID={`${prefix}.activity`} style={[styles.rowTitle,{color:theme.text}]}>{event.type==='custom'?event.customLabel:eventLabel(event.type)}</Text></View>
   <Text testID={`${prefix}.at`} style={[styles.body,{color:theme.text}]}>{date(event.at)}</Text>
   {event.endedAt!==undefined?<Text style={[styles.body,{color:theme.textMuted}]}>{t('history.field.endedAt')}: {event.endedAt===null?t('editor.inProgress'):date(event.endedAt)}</Text>:null}
   <Text style={[styles.small,{color:theme.textMuted}]}>{t(event.source==='widget'?'eventRow.widget':'eventRow.app')}{event.estimated?` · ${t('eventRow.estimated')}`:''}</Text>
   {event.note?<Text selectable testID={`${prefix}.note`} style={[styles.body,{color:theme.text}]}>{event.note}</Text>:null}
  </>}
 </View>;
}
const styles=StyleSheet.create({root:{flex:1},header:{padding:spacing.md,flexDirection:'row',alignItems:'flex-start',gap:12},back:{width:48,height:48,alignItems:'center',justifyContent:'center'},title:{flex:1,fontSize:20,lineHeight:28,fontWeight:'700'},content:{paddingHorizontal:spacing.md,paddingBottom:spacing.xl,gap:12},row:{minHeight:72,borderWidth:StyleSheet.hairlineWidth,padding:14,flexDirection:'row',alignItems:'center',gap:12},icon:{width:42,height:42,alignItems:'center',justifyContent:'center'},copy:{flex:1,gap:4},rowTitle:{fontSize:16,lineHeight:23,fontWeight:'700',flexShrink:1},small:{fontSize:14,lineHeight:21},body:{fontSize:16,lineHeight:24},notice:{fontSize:16,lineHeight:24,padding:14},snapshot:{padding:16,borderWidth:StyleSheet.hairlineWidth,gap:10},activity:{flexDirection:'row',alignItems:'center',gap:10},stack:{gap:12},loading:{flexDirection:'row',alignItems:'center',gap:12},cloudControls:{gap:12,marginTop:12}});
