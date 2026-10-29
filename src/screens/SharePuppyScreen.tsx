import {useEffect,useMemo,useRef,useState} from 'react';
import {Alert,Image,KeyboardAvoidingView,Linking,Platform,ScrollView,Share,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import qrcode from 'qrcode-generator';
import {AccountButton} from '../components/AccountSignIn';
import {Pressable} from '../components/TelemetryPressable';
import {AccountScreen} from './AccountScreen';
import {SharedPuppiesScreen} from './SharedPuppiesScreen';
import {useAccountSnapshot} from '../cloud/use-account-snapshot';
import type {CloudHandle} from '../cloud/handle';
import {entityId} from '../entity-id';
import {sharingUrl,type CreateShare,type PuppyShare} from '../sharing';
import {useLocalization} from '../localization-context';
import {headingStyle,spacing,type Theme} from '../theme';

export function SharePuppyScreen({cloud,theme,eventCount,onBack,initialKind='household'}:{cloud:CloudHandle;theme:Theme;eventCount:number;onBack:()=>void;initialKind?:'household'|'temporary'}){
 const {t,locale}=useLocalization(),state=useAccountSnapshot(cloud.controller);
 const [kind,setKind]=useState(initialKind),[label,setLabel]=useState(''),[permission,setPermission]=useState<'view'|'contribute'>('contribute');
 const [days,setDays]=useState<number|null>(1),[end,setEnd]=useState(()=>new Date(Date.now()+86400000)),[picker,setPicker]=useState<'date'|'time'|null>(null);
 const [setup,setSetup]=useState(false),[shares,setShares]=useState<PuppyShare[]>([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[link,setLink]=useState<string|null>(null),[revision,setRevision]=useState(0);
 const draft=useRef<CreateShare|null>(null),locked=useRef(false),mounted=useRef(true);
 const [shared,setShared]=useState(false);
 const account=state?.account,accountId=account?.user.id,pet=account?.pets[0];
 const ready=!!accountId&&!!pet&&state?.sync?.state==='active'&&state.sync.accountId===accountId&&!!cloud.sharing;
 const identity=useRef(accountId);identity.current=accountId;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{setLink(null);draft.current=null;setShares([]);},[accountId,pet?.id]);
 useEffect(()=>{if(!ready)return;let current=true;setLoading(true);setError('');cloud.sharing!.list(accountId!,pet!.id).then(result=>{if(current)setShares(result.shares);}).catch(()=>{if(current)setError(t('sharing.error'));}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[ready,accountId,pet?.id,cloud.sharing,revision,t]);
 useEffect(()=>{draft.current=null;setLink(null);},[kind,label,permission,days,end]);
 const qr=useMemo(()=>{if(!link)return null;const code=qrcode(0,'M');code.addData(link);code.make();return code.createDataURL(5,20);},[link]);
 const format=(at:number)=>new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(at);
 const button=(id:string,text:string,action:()=>void,primary=false,disabled=busy)=><AccountButton key={id} theme={theme} testID={id} label={text} onPress={action} primary={primary} disabled={disabled}/>;
 const choice=(id:string,text:string,selected:boolean,action:()=>void)=><Pressable key={id} testID={id} accessibilityRole="radio" accessibilityState={{checked:selected,disabled:busy}} disabled={busy} onPress={action} style={({pressed})=>[styles.choice,{backgroundColor:selected?theme.primarySoft:theme.surfaceRaised,borderColor:selected?theme.primary:theme.border,opacity:pressed||busy?0.6:1}]}><Text style={[styles.body,{color:theme.text,flex:1}]}>{text}</Text><Text accessible={false} style={[styles.label,{color:theme.primary}]}>{selected?'●':'○'}</Text></Pressable>;
 async function create(){
  if(locked.current||!ready)return;locked.current=true;setBusy(true);setError('');const expected=accountId!;
  try{
   const expiresAt=kind==='household'?null:days===null?end.getTime():Date.now()+days*86400000;
   if(expiresAt!==null&&(expiresAt<=Date.now()||expiresAt>Date.now()+30*86400000)){setError(t('sharing.invalidEnd'));return;}
   draft.current??={id:entityId('shr'),token:entityId('inv'),petId:pet!.id,kind,permission:kind==='household'?'contribute':permission,expiresAt,label:label.trim()||t(kind==='household'?'sharing.household':'sharing.temporary')};
   const result=await cloud.sharing!.create(expected,draft.current);
   if(!mounted.current||identity.current!==expected)return;
   setShares(current=>[result,...current.filter(row=>row.id!==result.id)]);setLink(sharingUrl(cloud.sharingOrigin!,result.id,draft.current.token));
  }catch{if(mounted.current)setError(t('sharing.error'));}
  finally{locked.current=false;if(mounted.current)setBusy(false);}
 }
 async function revoke(id:string){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');const expected=accountId!;
  try{await cloud.sharing!.revoke(expected,id);if(mounted.current&&identity.current===expected){setShares(current=>current.map(row=>row.id===id?{...row,revoked:true}:row));if(draft.current?.id===id)setLink(null);}}
  catch{if(mounted.current)setError(t('sharing.error'));}finally{locked.current=false;if(mounted.current)setBusy(false);}
 }
 if(shared)return <SharedPuppiesScreen cloud={cloud} theme={theme} onBack={()=>setShared(false)}/>;
 if(setup)return <AccountScreen cloud={cloud} theme={theme} eventCount={eventCount} onBack={()=>setSetup(false)} onOpenActivity={onBack}/>;
 return <SafeAreaView style={[styles.root,{backgroundColor:theme.background}]} edges={['top','bottom']}><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.root}>
 <ScrollView testID="screen.sharing" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
  <View style={styles.header}>{button('sharing.back',t('account.back'),onBack)}<Text accessibilityRole="header" style={[styles.title,headingStyle(theme),{color:theme.text}]}>{t('sharing.title')}</Text></View>
  {error?<Text accessibilityRole="alert" style={[styles.body,{color:theme.danger}]}>{error}</Text>:null}
  {!ready?<View style={styles.stack}><Text style={[styles.body,{color:theme.textMuted}]}>{t('sharing.setupBody')}</Text>{button('sharing.setup',t('sharing.setup'),()=>setSetup(true),true)}</View>:<>
   <View accessibilityRole="radiogroup" style={styles.stack}>{(['household','temporary'] as const).map(value=><View key={value}>
    {choice(`sharing.kind.${value}`,t(value==='household'?'sharing.household':'sharing.temporary'),kind===value,()=>setKind(value))}
    {kind===value?<Text style={[styles.body,{color:theme.textMuted,marginTop:8}]}>{t(value==='household'?'sharing.householdBody':'sharing.temporaryBody')}</Text>:null}
   </View>)}</View>
   <Text accessibilityRole="header" style={[styles.label,{color:theme.text}]}>{t('sharing.label')}</Text>
   <TextInput testID="sharing.label" accessibilityLabel={t('sharing.label')} value={label} onChangeText={setLabel} placeholder={t('sharing.labelPlaceholder')} placeholderTextColor={theme.textMuted} editable={!busy} maxLength={80} style={[styles.input,{color:theme.text,borderColor:theme.border,backgroundColor:theme.surfaceRaised}]}/>
   {kind==='temporary'?<>
    <Text accessibilityRole="header" style={[styles.label,{color:theme.text}]}>{t('sharing.permission')}</Text>
    <View accessibilityRole="radiogroup">{(['contribute','view'] as const).map(value=>choice(`sharing.permission.${value}`,t(value==='contribute'?'sharing.contribute':'sharing.view'),permission===value,()=>setPermission(value)))}</View>
    <Text accessibilityRole="header" style={[styles.label,{color:theme.text}]}>{t('sharing.duration')}</Text>
    <View accessibilityRole="radiogroup" style={styles.options}>{([1,3,7,null] as const).map((value,index)=>choice(`sharing.duration.${value??'custom'}`,t((['sharing.day','sharing.threeDays','sharing.week','sharing.custom'] as const)[index]),days===value,()=>setDays(value)))}</View>
    {days===null?<View style={styles.stack}>{button('sharing.date',`${t('sharing.date')}: ${new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(end)}`,()=>setPicker('date'))}{button('sharing.time',`${t('sharing.time')}: ${new Intl.DateTimeFormat(locale,{timeStyle:'short'}).format(end)}`,()=>setPicker('time'))}
     {picker?<DateTimePicker value={end} mode={picker} minimumDate={picker==='date'?new Date():undefined} maximumDate={picker==='date'?new Date(Date.now()+30*86400000):undefined} onChange={(_,date)=>{setPicker(null);if(date)setEnd(date);}}/>:null}
    </View>:null}
   </>:null}
   {!link?button('sharing.create',t(busy?'sharing.creating':'sharing.create'),()=>{void create();},true):<View style={[styles.card,{backgroundColor:theme.surfaceRaised,borderColor:theme.border}]}>
    <Text style={[styles.body,{color:theme.text}]}>{kind==='household'?t('sharing.householdNotice'):t('sharing.notice',{date:format(draft.current!.expiresAt!)})}</Text>
    <Image source={{uri:qr!}} accessibilityLabel={t('sharing.qr')} style={styles.qr} resizeMode="contain"/>
    {button('sharing.send',t('sharing.send'),()=>{void Share.share({message:link}).catch(()=>setError(t('sharing.error')));},true)}
    {button('sharing.new',t('sharing.new'),()=>{draft.current=null;setLink(null);})}
   </View>}
   <Text accessibilityRole="header" style={[styles.section,headingStyle(theme),{color:theme.text}]}>{t('sharing.active')}</Text>
   {loading?<Text accessibilityRole="progressbar" style={[styles.body,{color:theme.textMuted}]}>{t('sharing.loading')}</Text>:!shares.length?<Text style={[styles.body,{color:theme.textMuted}]}>{t('sharing.empty')}</Text>:shares.map(row=>{
    const ended=row.revoked||(row.expiresAt!==null&&row.expiresAt<=Date.now())||(!row.accepted&&row.kind==='household'&&row.inviteExpiresAt<=Date.now());
    return <View key={row.id} style={[styles.card,{backgroundColor:theme.surfaceRaised,borderColor:theme.border}]}><Text style={[styles.label,{color:theme.text}]}>{row.memberName||row.label}</Text><Text style={[styles.body,{color:theme.textMuted}]}>{t(row.kind==='household'?'sharing.household':'sharing.temporary')} · {ended?t('sharing.ended'):row.expiresAt?format(row.expiresAt):t(row.accepted?'sharing.permanent':'sharing.pending')}</Text>
     {!ended?button(`sharing.revoke.${row.id}`,t('sharing.revoke'),()=>Alert.alert(t('sharing.revokeTitle'),t('sharing.revokeBody'),[{text:t('account.cancel'),style:'cancel'},{text:t('sharing.revoke'),style:'destructive',onPress:()=>{void revoke(row.id);}}])):null}
    </View>;
   })}
   {button('sharing.refresh',t('sharing.retry'),()=>setRevision(value=>value+1))}
  </>}
  {button('sharing.shared',t('sharing.openShared'),()=>setShared(true))}
 </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const styles=StyleSheet.create({root:{flex:1},content:{width:'100%',maxWidth:620,alignSelf:'center',padding:spacing.md,gap:12,paddingBottom:32},header:{flexDirection:'row',alignItems:'center',gap:16},title:{flex:1,fontSize:25,lineHeight:32},body:{fontSize:16,lineHeight:24},label:{fontSize:16,lineHeight:23,fontWeight:'700'},section:{fontSize:21,lineHeight:28,marginTop:20},input:{minHeight:52,borderWidth:1,borderRadius:12,padding:14,fontSize:16},stack:{gap:12},options:{gap:8},choice:{minHeight:50,padding:14,borderRadius:12,borderWidth:1,flexDirection:'row',alignItems:'center',gap:12,marginBottom:8},card:{padding:16,borderWidth:1,borderRadius:16,gap:12},qr:{width:240,height:240,maxWidth:'100%',alignSelf:'center',backgroundColor:'white'}});
