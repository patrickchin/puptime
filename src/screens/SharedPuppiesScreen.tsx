import {memo,useCallback,useEffect,useRef,useState} from 'react';
import {AppState,FlatList,KeyboardAvoidingView,Modal,Platform,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AccountButton,AccountSignIn} from '../components/AccountSignIn';
import {DateTimeSelector} from '../components/DateTimeSelector';
import {Pressable} from '../components/TelemetryPressable';
import {useAccountSnapshot} from '../cloud/use-account-snapshot';
import type {CloudHandle} from '../cloud/handle';
import type {SharingApi} from '../cloud/sharing-api';
import {CloudApiError} from '../cloud/api';
import {eventTypes,type EventType} from '../domain';
import {entityId} from '../entity-id';
import {reuseCareRows,careEditPatch,type CarePage,type CareRow,type CareWrite} from '../sharing';
import {useLocalization} from '../localization-context';
import {localizedEventLabel} from '../localization';
import {headingStyle,spacing,type Theme} from '../theme';

export function SharedPuppiesScreen({cloud,theme,onBack,initialShareId}:{cloud:CloudHandle;theme:Theme;onBack:()=>void;initialShareId?:string}){
 const {t}=useLocalization(),state=useAccountSnapshot(cloud.controller),accountId=state?.account?.user.id;
 const [selected,setSelected]=useState(initialShareId),[puppies,setPuppies]=useState<{id:string;name:string;ownerName:string}[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!accountId||!cloud.sharing)return;let current=true;setPuppies([]);setLoading(true);setError(false);cloud.sharing.puppies(accountId).then(value=>{if(current)setPuppies(value.puppies);}).catch(()=>{if(current)setError(true);}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[accountId,cloud.sharing,retry]);
 return <SafeAreaView style={[styles.root,{backgroundColor:theme.background}]} edges={['top','bottom']}>
  <View style={styles.header}><AccountButton theme={theme} testID="shared.back" label={t('account.back')} onPress={()=>selected?setSelected(undefined):onBack()}/><Text accessibilityRole="header" style={[styles.title,headingStyle(theme),{color:theme.text}]}>{t('sharing.sharedTitle')}</Text></View>
  {!accountId?<ScrollView contentContainerStyle={styles.content}><Text style={[styles.body,{color:theme.textMuted}]}>{t('sharing.signInShared')}</Text><AccountSignIn cloud={cloud} theme={theme}/></ScrollView>:selected&&cloud.sharing?<SharedJournal key={`${accountId}:${selected}`} api={cloud.sharing} accountId={accountId} shareId={selected} theme={theme}/>:<ScrollView testID="screen.sharedPuppies" contentContainerStyle={styles.content}>
   {error?<Text accessibilityRole="alert" style={[styles.body,{color:theme.danger}]}>{t('sharing.error')}</Text>:null}
   {loading?<Text accessibilityRole="progressbar" style={[styles.body,{color:theme.textMuted}]}>{t('sharing.loading')}</Text>:puppies.map(puppy=><AccountButton key={puppy.id} theme={theme} testID={`shared.puppy.${puppy.id}`} label={puppy.name} onPress={()=>setSelected(puppy.id)}/>)}
   {!loading&&!puppies.length?<Text style={[styles.body,{color:theme.textMuted}]}>{t('sharing.noShared')}</Text>:null}
   <AccountButton theme={theme} testID="shared.action.1" label={t('sharing.refresh')} disabled={loading} onPress={()=>setRetry(value=>value+1)}/>
  </ScrollView>}
 </SafeAreaView>;
}
function SharedJournal({api,accountId,shareId,theme}:{api:SharingApi;accountId:string;shareId:string;theme:Theme}){
 const {t}=useLocalization(),[page,setPage]=useState<CarePage|null>(null),[routines,setRoutines]=useState<CareRow[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[moreBusy,setMoreBusy]=useState(false);
 const [editor,setEditor]=useState<{kind:'event'|'routine';row?:CareRow}|null>(null);
 const current=useRef(true),inFlight=useRef(false);
 const refresh=useCallback(async()=>{
  if(inFlight.current)return;inFlight.current=true;
  try{
   const logs=await api.carePage(accountId,shareId),routineRows:CareRow[]=[];let cursor=0;
   do{const next=await api.carePage(accountId,shareId,'routine',cursor);routineRows.push(...next.records);if(next.nextCursor===null)break;cursor=next.nextCursor;}while(routineRows.length<1000);
   if(current.current){setPage(old=>({...logs,records:reuseCareRows(old?.records??[],logs.records)}));setRoutines(old=>reuseCareRows(old,routineRows));setError('');}
  }catch(reason){if(current.current){setError(t('sharing.careError'));if(reason instanceof CloudApiError&&[401,403,410].includes(reason.status)){setPage(null);setRoutines([]);setEditor(null);}}}finally{inFlight.current=false;if(current.current)setLoading(false);}
 },[api,accountId,shareId,t]);
 useEffect(()=>{current.current=true;void refresh();const subscription=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});return()=>{current.current=false;subscription.remove();};},[refresh]);
 useEffect(()=>{if(editor||moreBusy)return;const timer=setInterval(()=>{if(AppState.currentState==='active')void refresh();},15000);return()=>clearInterval(timer);},[editor,moreBusy,refresh]);
 const edit=useCallback((row:CareRow)=>{if(row.record.kind==='event'||row.record.kind==='routine')setEditor({kind:row.record.kind,row});},[]);
 const write=async(input:CareWrite)=>{await api.careWrite(accountId,shareId,input);await refresh();};
 async function more(){
  if(!page?.nextCursor||moreBusy)return;setMoreBusy(true);
  try{const next=await api.carePage(accountId,shareId,'event',page.nextCursor);if(current.current)setPage(old=>old?{...old,records:[...old.records,...next.records.filter(row=>!old.records.some(saved=>saved.record.id===row.record.id))],nextCursor:next.nextCursor}:old);}
  catch{if(current.current)setError(t('sharing.careError'));}finally{if(current.current)setMoreBusy(false);}
 }
 const renderRow=useCallback(({item}:{item:CareRow})=><SharedRow row={item} theme={theme} onEdit={edit}/>,[theme,edit]);
 const header=<View style={styles.stack}>
  {loading?<Text accessibilityRole="progressbar" style={[styles.body,{color:theme.textMuted}]}>{t('sharing.loading')}</Text>:null}
  {error?<Text accessibilityRole="alert" style={[styles.body,{color:theme.danger}]}>{error}</Text>:null}
  {page?<><Text accessibilityRole="header" style={[styles.puppy,headingStyle(theme),{color:theme.text}]}>{page.puppyName}</Text><Text style={[styles.body,{color:theme.textMuted}]}>{t('sharing.permanent')}</Text><AccountButton theme={theme} testID="shared.log" label={t('sharing.logActivity')} primary onPress={()=>setEditor({kind:'event'})}/>
   <Text accessibilityRole="header" style={[styles.title,{color:theme.text}]}>{t('sharing.routine')}</Text>
   {routines.map(row=><SharedRow key={row.record.id} row={row} theme={theme} onEdit={edit}/>)}
   <AccountButton theme={theme} testID="shared.addRoutine" label={t('sharing.addRoutine')} onPress={()=>setEditor({kind:'routine'})}/>
   <Text accessibilityRole="header" style={[styles.title,{color:theme.text}]}>{t('sharing.logs')}</Text>
  </>:null}
  <AccountButton theme={theme} testID="shared.action.2" label={t('sharing.refresh')} onPress={()=>{void refresh();}}/>
 </View>;
 return <View style={styles.root}>
  <FlatList testID="screen.sharedJournal" data={page?.records??[]} keyExtractor={row=>row.record.id} renderItem={renderRow} contentContainerStyle={styles.content} ListHeaderComponent={header} ListEmptyComponent={!loading?<Text style={[styles.body,{color:theme.textMuted}]}>{t('sharing.noLogs')}</Text>:null} ListFooterComponent={page?.nextCursor?<AccountButton theme={theme} testID="shared.action.3" label={t('sharing.more')} disabled={moreBusy} onPress={()=>{void more();}}/>:null}/>
  <Modal visible={editor!==null} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setEditor(null)}>{editor?<SharedEditor theme={theme} kind={editor.kind} row={editor.row} onClose={()=>setEditor(null)} write={write}/>:null}</Modal>
 </View>;
}
const SharedRow=memo(function SharedRow({row,theme,onEdit}:{row:CareRow;theme:Theme;onEdit:(row:CareRow)=>void}){
 const {t,locale,language}=useLocalization(),data=row.record.data;
 if(!('type' in data))return null;
 const when='at' in data?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(data.at):'minutes' in data?new Intl.DateTimeFormat(locale,{hour:'numeric',minute:'2-digit'}).format(new Date(2000,0,1,Math.floor(data.minutes/60),data.minutes%60)):'';
 return <View style={[styles.row,{borderColor:theme.border}]}><View style={styles.grow}><Text style={[styles.label,{color:theme.text}]}>{data.type==='custom'&&'customLabel' in data?data.customLabel:localizedEventLabel(language,data.type)}</Text><Text style={[styles.body,{color:theme.textMuted}]}>{when}</Text>{'note' in data&&data.note?<Text style={[styles.body,{color:theme.text}]}>{data.note}</Text>:null}</View>{row.canEdit?<AccountButton theme={theme} testID="shared.action.4" label={t('sharing.edit')} onPress={()=>onEdit(row)}/>:null}</View>;
});
function SharedEditor({theme,kind,row,onClose,write}:{theme:Theme;kind:'event'|'routine';row?:CareRow;onClose:()=>void;write:(input:CareWrite)=>Promise<void>}){
 const {t,locale,language}=useLocalization(),data=row?.record.data;
 const eventLabel=(type:EventType)=>localizedEventLabel(language,type);
 const [type,setType]=useState<EventType>(data&&'type' in data?data.type:'walk'),[label,setLabel]=useState(data&&'customLabel' in data?data.customLabel??'':'');
 const [at,setAt]=useState(()=>data&&'at' in data?new Date(data.at):data&&'minutes' in data?new Date(2000,0,1,Math.floor(data.minutes/60),data.minutes%60):new Date());
 const [endedAt,setEndedAt]=useState<Date|null>(()=>data&&'endedAt' in data&&typeof data.endedAt==='number'?new Date(data.endedAt):null);
 const [note,setNote]=useState(data&&'note' in data?data.note?.replace(/(?:^|\n\n)Logged by [^\n]+$/,'')??'':'');
 const [picker,setPicker]=useState<'date'|'time'|'end'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[confirm,setConfirm]=useState(false);
 const locked=useRef(false),draft=useRef<{fingerprint:string;requestId:string;localId:string}|null>(null);
 async function save(remove=false){
  if(locked.current)return;locked.current=true;setBusy(true);setError(false);
  try{
   const patch=remove?{}:careEditPatch(row,kind==='event'?{type,at:at.getTime(),source:'app',note,...(type==='nap'?{endedAt:endedAt?.getTime()??null}:{}),...(type==='custom'?{customLabel:label}:{})}:{type,minutes:at.getHours()*60+at.getMinutes(),...(type==='custom'?{customLabel:label}:{})});
   if(!remove&&row&&!Object.keys(patch).length){onClose();return;}
   const fingerprint=JSON.stringify({patch,remove,revision:row?.record.revision});
   if(draft.current?.fingerprint!==fingerprint)draft.current={fingerprint,requestId:entityId('csr'),localId:row?.localId??entityId(kind==='event'?'evt':'rtn')};
   await write({kind,requestId:draft.current.requestId,localId:draft.current.localId,intent:remove?'delete':row?'patch':'create',...(row?{expectedRevision:row.record.revision}:{}),patch} as CareWrite);onClose();
  }catch{setError(true);}finally{locked.current=false;setBusy(false);}
 }
 return <SafeAreaView style={[styles.root,{backgroundColor:theme.background}]} edges={['top','bottom']}><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.root}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
  <Text accessibilityRole="header" style={[styles.title,headingStyle(theme),{color:theme.text}]}>{t(row?'sharing.edit':kind==='event'?'sharing.logActivity':'sharing.addRoutine')}</Text>
  {error?<Text accessibilityRole="alert" style={[styles.body,{color:theme.danger}]}>{t('sharing.careError')}</Text>:null}
  {!row?<View style={styles.options}>{eventTypes.map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:type===value,disabled:busy}} disabled={busy} onPress={()=>setType(value)} style={[styles.option,{borderColor:type===value?theme.primary:theme.border,backgroundColor:type===value?theme.primarySoft:theme.surface}]}><Text style={[styles.body,{color:theme.text}]}>{eventLabel(value)}</Text></Pressable>)}</View>:<Text style={[styles.label,{color:theme.text}]}>{eventLabel(type)}</Text>}
  {type==='custom'?<TextInput accessibilityLabel={t('sharing.customName')} value={label} onChangeText={setLabel} maxLength={40} editable={!busy} style={[styles.input,{color:theme.text,borderColor:theme.border}]}/>:null}
  {kind==='event'?<AccountButton theme={theme} testID="shared.action.5" label={new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(at)} disabled={busy} onPress={()=>setPicker('date')}/>:null}
  <AccountButton theme={theme} testID="shared.action.6" label={new Intl.DateTimeFormat(locale,{timeStyle:'short'}).format(at)} disabled={busy} onPress={()=>setPicker('time')}/>
  {kind==='event'&&type==='nap'?<><AccountButton theme={theme} testID="shared.action.7" label={endedAt?new Intl.DateTimeFormat(locale,{timeStyle:'short'}).format(endedAt):t('sharing.endNap')} disabled={busy} onPress={()=>setPicker('end')}/>{endedAt?<AccountButton theme={theme} testID="shared.action.8" label={t('sharing.keepSleeping')} onPress={()=>setEndedAt(null)}/>:null}</>:null}
  {kind==='event'?<><Text style={[styles.label,{color:theme.text}]}>{t('sharing.note')}</Text><TextInput testID="shared.note" accessibilityLabel={t('sharing.note')} value={note} onChangeText={setNote} multiline maxLength={16000} editable={!busy} style={[styles.input,{color:theme.text,borderColor:theme.border}]}/></>:null}
  <AccountButton theme={theme} testID="shared.save" label={t(busy?'sharing.creating':'sharing.save')} disabled={busy||type==='custom'&&!label.trim()} primary onPress={()=>{void save();}}/>
  <AccountButton theme={theme} testID="shared.action.9" label={t('account.cancel')} disabled={busy} onPress={onClose}/>
  {row?<AccountButton theme={theme} testID="shared.action.10" label={t(confirm?'sharing.confirmDelete':'sharing.delete')} disabled={busy} onPress={()=>{if(confirm)void save(true);else setConfirm(true);}}/>:null}
 </ScrollView></KeyboardAvoidingView>{picker?<DateTimeSelector theme={theme} locale={locale} mode={picker==='date'?'date':'time'} value={picker==='end'?endedAt??new Date():at} onCancel={()=>setPicker(null)} onChange={date=>{if(picker==='end')setEndedAt(date);else setAt(date);setPicker(null);}}/>:null}</SafeAreaView>;
}
const styles=StyleSheet.create({root:{flex:1},header:{padding:16,flexDirection:'row',alignItems:'center',gap:16},title:{fontSize:22,lineHeight:30,flexShrink:1,fontWeight:'700'},puppy:{fontSize:30,lineHeight:38},content:{padding:spacing.md,gap:12,paddingBottom:32,width:'100%',maxWidth:720,alignSelf:'center'},body:{fontSize:16,lineHeight:24},label:{fontSize:17,lineHeight:24,fontWeight:'600'},row:{paddingVertical:16,borderBottomWidth:1,flexDirection:'row',alignItems:'flex-start',gap:12},grow:{flex:1,gap:6},stack:{gap:12},options:{flexDirection:'row',flexWrap:'wrap',gap:8},option:{minHeight:48,padding:12,borderWidth:1,borderRadius:12},input:{minHeight:64,padding:14,borderWidth:1,borderRadius:12,fontSize:16}});
