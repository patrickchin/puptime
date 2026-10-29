import {useEffect,useRef,useState} from 'react';
import {ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AccountButton,AccountSignIn} from '../components/AccountSignIn';
import {useAccountSnapshot} from '../cloud/use-account-snapshot';
import type {CloudHandle} from '../cloud/handle';
import {useCareSession} from '../care-session';
import type {SharedPuppy} from '../sharing';
import {useLocalization} from '../localization-context';
import {headingStyle,spacing,type Theme} from '../theme';

export function SharedPuppiesScreen({cloud,theme,onBack,initialShareId,inviteToken}:{cloud:CloudHandle;theme:Theme;onBack:()=>void;initialShareId?:string;inviteToken?:string}){
 const {t}=useLocalization(),session=useCareSession(),state=useAccountSnapshot(cloud.controller),accountId=state?.account?.user.id;
 const [puppies,setPuppies]=useState<SharedPuppy[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(false),[retry,setRetry]=useState(0),[opening,setOpening]=useState<string|null>(null);
 const autoOpened=useRef(false),locked=useRef(false);
 async function open(puppy:SharedPuppy){
  if(!accountId||locked.current)return;locked.current=true;setOpening(puppy.id);setError(false);
  try{await session.activate(puppy,accountId);onBack();}catch{setError(true);}finally{locked.current=false;setOpening(null);}
 }
 useEffect(()=>{
  if(!accountId||!cloud.sharing)return;let current=true;setLoading(true);setError(false);
  void(async()=>{
   try{
    const result=await cloud.sharing!.puppies(accountId);
    if(current){setPuppies(result.puppies);const invited=result.puppies.find(puppy=>puppy.id===initialShareId);if(invited&&!autoOpened.current){autoOpened.current=true;await open(invited);}}
   }catch{if(current)setError(true);}finally{if(current)setLoading(false);}
  })();return()=>{current=false;};
 },[accountId,cloud.sharing,retry]);
 async function accept(){
  if(!accountId||!cloud.sharing||!initialShareId||!inviteToken||locked.current)return;
  locked.current=true;setOpening(initialShareId);setError(false);
  try{await cloud.sharing.accept(accountId,initialShareId,inviteToken);setRetry(value=>value+1);}catch{setError(true);}finally{locked.current=false;setOpening(null);}
 }
 return <SafeAreaView style={[styles.root,{backgroundColor:theme.background}]} edges={['top','bottom']}>
  <View style={styles.header}><AccountButton theme={theme} testID="shared.back" label={t('account.back')} onPress={onBack}/><Text accessibilityRole="header" style={[styles.title,headingStyle(theme),{color:theme.text}]}>{t('sharing.sharedTitle')}</Text></View>
  <ScrollView keyboardShouldPersistTaps="handled" testID="screen.sharedPuppies" contentContainerStyle={styles.content}>
   {!accountId?<><Text style={[styles.body,{color:theme.textMuted}]}>{t('sharing.signInShared')}</Text><AccountSignIn cloud={cloud} theme={theme} showIntro={false}/></>:<>
    {error?<Text accessibilityRole="alert" style={[styles.body,{color:theme.danger}]}>{t('sharing.error')}</Text>:null}
    {loading||opening?<Text accessibilityRole="progressbar" style={[styles.body,{color:theme.textMuted}]}>{t('sharing.loading')}</Text>:null}
    {initialShareId&&inviteToken&&!puppies.some(puppy=>puppy.id===initialShareId)?<AccountButton theme={theme} primary testID="shared.accept" label={t('sharing.accept')} disabled={loading||!!opening} onPress={()=>{void accept();}}/>:null}
    {puppies.map(puppy=><View key={puppy.id}><AccountButton theme={theme} testID={`shared.puppy.${puppy.id}`} label={puppy.name} disabled={loading||!!opening} onPress={()=>{void open(puppy);}}/><Text style={[styles.body,{color:theme.textMuted}]}>{puppy.kind==='household'?t('sharing.permanent'):t('sharing.ends',{date:new Date(puppy.expiresAt!).toLocaleString()})}</Text></View>)}
    {!loading&&!puppies.length&&!inviteToken?<Text style={[styles.body,{color:theme.textMuted}]}>{t('sharing.noShared')}</Text>:null}
    <AccountButton theme={theme} testID="shared.refresh" label={t('sharing.refresh')} disabled={loading||!!opening} onPress={()=>setRetry(value=>value+1)}/>
    {session.selection?<AccountButton theme={theme} testID="shared.ownPuppy" label={t('sharing.ownPuppy')} disabled={!!opening} onPress={()=>{void session.leave().then(onBack);}}/>:null}
   </>}
  </ScrollView>
 </SafeAreaView>;
}
const styles=StyleSheet.create({root:{flex:1},header:{padding:spacing.md,gap:8},content:{padding:spacing.md,gap:12,width:'100%',maxWidth:720,alignSelf:'center'},title:{fontSize:28,fontWeight:'700'},body:{fontSize:16,lineHeight:24}});
