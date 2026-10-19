import {MaterialCommunityIcons} from '@expo/vector-icons';
import {useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,ActivityIndicator,Alert,Image,Keyboard,KeyboardAvoidingView,Linking,Pressable,ScrollView,StyleSheet,Text,TextInput,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {AccountButton,AccountSignIn,accountProblemKey} from '../components/AccountSignIn';
import {useAccountSnapshot} from '../cloud/use-account-snapshot';
import {continueFirstLaunchLocally} from '../cloud/account-controller';
import {getLocalRuntime} from '../local/runtime.ios';
import {loadFirstLaunch,saveFirstLaunchProfile,saveFirstLaunchStep} from '../storage.ios';
import {useLocalization} from '../localization-context';
import type {MessageKey} from '../localization';
import {firstLaunchStepSchema,type FirstLaunchScreenProps,type FirstLaunchStep} from '../first-launch';
import {headingStyle,spacing} from '../theme';
import {OnboardingScreen} from './OnboardingScreen';

export {loadFirstLaunch as loadInitialSetup} from '../storage.ios';
const titles:Record<FirstLaunchStep,MessageKey>={welcome:'setup.welcomeTitle',profile:'setup.profileTitle',account:'setup.accountTitle',cloud:'setup.cloudTitle',walkthrough:'tour.logTitle',reminders:'setup.remindersTitle'};

export function FirstLaunchScreen({progress:initial,cloud,theme,notificationPermission,onAllowNotifications,onDisableNotifications,onOpenSystemSettings,onFinish}:FirstLaunchScreenProps) {
 const {t,locale}=useLocalization(),state=useAccountSnapshot(cloud.controller),{fontScale,height}=useWindowDimensions();
 const insets=useSafeAreaInsets();
 const [progress,setProgress]=useState(initial),[name,setName]=useState(initial.puppyName==='My puppy'?'':initial.puppyName);
 const [keyboardVisible,setKeyboardVisible]=useState(Keyboard.isVisible());
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[ready,setReady]=useState(false),[pristine,setPristine]=useState<boolean|null>(null);
 const locked=useRef(false),mounted=useRef(true),scroll=useRef<ScrollView>(null),title=useRef<Text>(null);
 const step=progress.step,account=state?.account,existing=account?.pets[0],working=busy||!!state?.busy;
 const enrolled=!!state?.sync?.accountId&&state.sync.state!=='local';
 const active=state?.sync?.state==='active'&&state.sync.accountId===account?.user.id&&!!account?.cloud.canSync;
 const shownName=progress.puppyName==='My puppy'?t('account.defaultName'):progress.puppyName;
 const cloudError=accountProblemKey(state?.problem??null),days=state?.config?.trialDays??14;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  const show=Keyboard.addListener('keyboardWillShow',()=>setKeyboardVisible(true)),hide=Keyboard.addListener('keyboardWillHide',()=>setKeyboardVisible(false));
  return()=>{show.remove();hide.remove();};
 },[]);
 useEffect(()=>{
  scroll.current?.scrollTo({y:0,animated:false});
  const frame=requestAnimationFrame(()=>{if(title.current)AccessibilityInfo.sendAccessibilityEvent(title.current,'focus');});
  return()=>cancelAnimationFrame(frame);
 },[step,ready]);
 useEffect(()=>{
  let current=true;
  if(step==='cloud')void getLocalRuntime().then(runtime=>runtime.sync.canRestoreSetup(runtime.petId)).then(value=>{if(current)setPristine(value);}).catch(()=>{if(current)setError(t('settings.saveErrorBody'));});
  return()=>{current=false;};
 },[step,state?.local?.eventCount,state?.sync?.state,state?.problem,account?.user.id]);
 useEffect(()=>{
  if(step==='account'&&account&&!state?.busy&&!locked.current)void act(()=>checkpoint('cloud'));
 },[step,account?.user.id,state?.busy]);

 async function act(action:()=>Promise<unknown>) {
  if(locked.current||state?.busy)return;
  locked.current=true;setBusy(true);setError(null);
  try{await action();}
  catch{if(mounted.current){setError(t('settings.saveErrorBody'));scroll.current?.scrollTo({y:0,animated:false});AccessibilityInfo.announceForAccessibility(t('settings.saveErrorBody'));}}
  finally{locked.current=false;if(mounted.current)setBusy(false);}
 }
 async function checkpoint(next:FirstLaunchStep) {
  Keyboard.dismiss();await saveFirstLaunchStep(next);
  const saved=await loadFirstLaunch();if(!saved)throw new Error('Setup is already complete.');
  if(mounted.current){setProgress(saved);setName(saved.puppyName==='My puppy'?'':saved.puppyName);setReady(false);}
 }
 async function profile(value:string) {
  Keyboard.dismiss();await saveFirstLaunchProfile(value);
  const saved=await loadFirstLaunch();if(!saved)throw new Error('Setup is already complete.');
  if(mounted.current)setProgress(saved);
 }
 async function local(confirmPending=false) {
  await act(async()=>{
   const result=cloud.controller?await cloud.controller.continueLocally({confirmPending}):await continueFirstLaunchLocally(await getLocalRuntime(),confirmPending);
   if(result==='pending-confirmation-required'){
    Alert.alert(t('setup.localConfirmTitle'),t('setup.localConfirmBody'),[{text:t('account.cancel'),style:'cancel'},{text:t('setup.continueLocal'),onPress:()=>{void local(true);}}]);return;
   }
   if(result==='cancelled'){await onFinish();return;}
   if(result!=='ok')return;
   await checkpoint('walkthrough');
  });
 }
 async function activate(mode:'restore'|'combine') {
  await act(async()=>{
   if(!cloud.controller)return;
   if(mode==='combine'&&enrolled){if(await cloud.controller.continueLocally({confirmPending:true})!=='ok')return;}
   await cloud.controller.enableCloud({mode,...(existing?{confirmedPetId:existing.id}:{})});
  });
 }
 function combine() {
  Alert.alert(t('account.combine'),t('account.combineBody'),[{text:t('account.cancel'),style:'cancel'},{text:t('account.combine'),onPress:()=>{void activate('combine');}}]);
 }
 function back() {
  if(working)return;
  if(ready){setReady(false);return;}
  const previous=step==='profile'?'welcome':step==='account'?'profile':step==='cloud'?'profile':step==='reminders'?'walkthrough':'account';
  void act(()=>checkpoint(previous));
 }
 const bodyStyle=[styles.body,{color:theme.textMuted}];
 const cardStyle=[styles.card,{backgroundColor:theme.surfaceRaised,borderColor:theme.border,borderRadius:theme.presentation.cardRadius}];
 const button=(testID:string,label:string,onPress:()=>void,primary=false,disabled=working,loading=false)=><AccountButton key={testID} testID={testID} theme={theme} label={label} onPress={onPress} primary={primary} disabled={disabled} loading={loading}/>;
 if(step==='walkthrough')return <View style={styles.root}>
  {error?<Text testID="setup.error" accessibilityRole="alert" style={[styles.body,{color:theme.danger,padding:16}]}>{error}</Text>:null}
  <OnboardingScreen theme={theme} mode="embedded" notificationPermission={notificationPermission} onAllowNotifications={onAllowNotifications} onOpenSystemSettings={onOpenSystemSettings} onFinish={()=>checkpoint('reminders')} onBack={()=>{void act(()=>checkpoint(account?'cloud':'account'));return true;}}/>
 </View>;
 const stage=firstLaunchStepSchema.options.indexOf(step)+1;
 return <KeyboardAvoidingView testID="screen.firstLaunch" behavior="padding" keyboardVerticalOffset={insets.top} style={[styles.root,{backgroundColor:theme.background}]}>
  <View style={styles.header}>
   {step!=='welcome'&&!(enrolled&&step==='cloud')?<Pressable testID="setup.back" accessibilityRole="button" accessibilityLabel={t('onboarding.back')} disabled={working} accessibilityState={{disabled:working}} onPress={back} style={[styles.back,working&&{opacity:0.5}]}><MaterialCommunityIcons accessible={false} name="arrow-left" size={22} color={theme.primary}/><Text style={[styles.backText,{color:theme.primary}]}>{t('onboarding.back')}</Text></Pressable>:null}
   <View style={styles.brand}><MaterialCommunityIcons accessible={false} name="paw" color={theme.primary} size={20}/><Text maxFontSizeMultiplier={1.3} style={[styles.brandText,headingStyle(theme),{color:theme.text}]}>Puptime</Text></View>
  </View>
  {step!=='welcome'?<View accessibilityRole="progressbar" accessibilityLabel={t('setup.progress',{step:stage})} accessibilityValue={{min:1,max:6,now:stage}} style={styles.progress}>{firstLaunchStepSchema.options.map((value,index)=><View key={value} style={[styles.mark,{backgroundColor:index<stage?theme.primary:theme.border}]}/>)}</View>:null}
  <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content,step==='profile'&&styles.profileContent]}>
   {!keyboardVisible&&(step==='welcome'||step==='profile'&&fontScale<1.5)?<Image source={require('../../assets/mascots/scruffy-terrier.png')} accessible={false} resizeMode="contain" style={[styles.mascot,{height:fontScale>=1.5?80:Math.min(step==='welcome'?210:132,height*(step==='welcome'?0.25:0.18))}]}/>:null}
   <Text ref={title} testID={`setup.step.${ready?'ready':step}`} accessibilityRole="header" style={[styles.title,headingStyle(theme),fontScale>=1.5&&styles.largeTitle,{color:theme.text}]}>{t(ready?'setup.readyTitle':titles[step])}</Text>
   {error?<Text testID="setup.error" accessibilityRole="alert" style={[styles.body,{color:theme.danger}]}>{error}</Text>:null}
   {step==='welcome'?<>
    <View style={styles.space}/>
    <View style={styles.actions}>
     {button('setup.start',t('setup.start'),()=>{void act(()=>checkpoint('profile'));},true)}
     {button('setup.signIn',t('setup.returning'),()=>{void act(()=>checkpoint('account'));})}
     <Text style={[styles.caption,{color:theme.textMuted}]}>{t('setup.localPromise')}</Text>
    </View>
   </>:null}
   {step==='profile'?<>
    <TextInput testID="setup.profile.input" accessibilityLabel={t('tour.nameLabel')} value={name} onChangeText={setName} placeholder={t('tour.namePlaceholder')} placeholderTextColor={theme.textMuted} maxLength={256} autoCapitalize="words" autoCorrect={false} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} editable={!working} style={[styles.input,headingStyle(theme),{color:theme.text,borderColor:theme.primary}]}/>
    <View style={styles.space}/>
    {button('setup.profile.next',t('onboarding.continue'),()=>{void act(()=>profile(name));},true)}
    {button('setup.profile.later',t('onboarding.later'),()=>{void act(()=>profile(progress.puppyName));})}
   </>:null}
   {step==='account'?<>
    <Text style={bodyStyle}>{t('setup.accountBody')}</Text>
    <AccountSignIn cloud={cloud} theme={theme} showIntro={false}/>
    <View style={styles.space}/>
    {button('setup.local',t('setup.withoutAccount'),()=>{void local();},false)}
    <Pressable accessibilityRole="link" onPress={()=>{void Linking.openURL('https://github.com/patrickchin/puptime/blob/main/PRIVACY.md').catch(()=>setError(t('learn.linkErrorBody')));}} style={styles.privacy}><Text style={[styles.caption,{color:theme.primary,textDecorationLine:'underline'}]}>{t('account.privacy')}</Text></Pressable>
   </>:null}
   {step==='cloud'?<>
    {cloudError?<Text testID="setup.cloud.error" accessibilityRole="alert" style={[styles.body,{color:theme.danger}]}>{t(cloudError)}</Text>:null}
    {!account?<AccountSignIn cloud={cloud} theme={theme} showIntro={false} showError={false}/>:<>
     <Text style={[styles.caption,{color:theme.textMuted}]}>{account.user.email}</Text>
     {existing?<View testID="setup.cloud.puppy" style={cardStyle}>
      <Text style={[styles.label,{color:theme.primary}]}>{t('account.cloudPuppy')}</Text>
      <Text style={[styles.puppyName,headingStyle(theme),{color:theme.text}]}>{existing.name}</Text>
      <Text style={bodyStyle}>{t(existing.eventCount===1?'account.logsOne':'account.logsMany',{count:new Intl.NumberFormat(locale).format(existing.eventCount)})}</Text>
      {!enrolled?<Text style={bodyStyle}>{t(pristine?'setup.restoreBody':'account.combineBody')}</Text>:null}
     </View>:null}
     {!account.cloud.canSync?<Text style={bodyStyle}>{t(account.cloud.source==='none'?'account.trialBody':'account.pausedBody',{days})}</Text>:null}
     {active?<>
      <Text testID="setup.cloud.active" style={[styles.label,{color:theme.primary}]}>{t('setup.cloudReady')}</Text>
      {button('setup.cloud.next',t('onboarding.continue'),()=>{void act(()=>checkpoint('walkthrough'));},true)}
     </>:enrolled&&state?.problem!=='confirmation-required'?<>
      {state?.running?<View style={styles.loading}><ActivityIndicator color={theme.primary}/><Text style={bodyStyle}>{t('setup.cloudLoading')}</Text></View>:null}
      {button('setup.cloud.retry',t('account.retry'),()=>{void cloud.controller?.retry();},false,working||!!state?.running||!state?.online)}
     </>:<>
      {button('setup.cloud.enable',existing?t(pristine?'setup.restore':'account.combine'):t(account.cloud.canSync?'account.enable':'account.startTrial',{days}),()=>{if(existing&&!pristine)combine();else void activate(existing?'restore':'combine');},true,working||!state?.online||!!existing&&pristine===null,working)}
     </>}
    </>}
    <View style={styles.space}/>
    {button('setup.cloud.local',t('setup.continueLocal'),()=>{void local();})}
   </>:null}
   {step==='reminders'&&!ready?<>
    <Text style={bodyStyle}>{t('setup.remindersBody')}</Text>
    <View style={[cardStyle,styles.notificationPreview]}>
     <View style={[styles.notificationIcon,{backgroundColor:theme.primarySoft}]}><MaterialCommunityIcons accessible={false} name="bell-outline" color={theme.primary} size={27}/></View>
     <View style={styles.notificationCopy}><Text style={[styles.label,{color:theme.text}]}>{t('onboarding.notificationExampleTitle')}</Text><Text style={bodyStyle}>{t('onboarding.notificationExampleBody')}</Text></View>
    </View>
    <View style={styles.space}/>
    {button('setup.reminders.allow',t(notificationPermission==='blocked'?'schedule.openSettings':notificationPermission==='granted'?'setup.useReminders':'setup.allowReminders'),()=>{void act(async()=>{const granted=await onAllowNotifications();if(granted)setReady(true);else if(notificationPermission==='blocked')onOpenSystemSettings();else setError(t('schedule.notificationsBody'));});},true,working,busy)}
    {button('setup.reminders.later',t('onboarding.later'),()=>{void act(async()=>{await onDisableNotifications();setReady(true);});})}
   </>:null}
   {ready?<>
    <View style={[styles.readyCard,{backgroundColor:theme.primarySoft,borderRadius:theme.presentation.cardRadius}]}><MaterialCommunityIcons accessible={false} name="check-circle-outline" size={40} color={theme.primary}/><Text style={[styles.puppyName,headingStyle(theme),{color:theme.text}]}>{shownName}</Text></View>
    <View style={styles.space}/>
    {button('setup.finish',t('onboarding.start'),()=>{void act(()=>onFinish());},true,working,busy)}
   </>:null}
  </ScrollView>
 </KeyboardAvoidingView>;
}
const styles=StyleSheet.create({
 root:{flex:1},header:{minHeight:56,paddingHorizontal:spacing.lg,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},back:{minHeight:44,flexDirection:'row',alignItems:'center',gap:5},backText:{fontSize:15,fontWeight:'600'},brand:{flexDirection:'row',alignItems:'center',gap:8,marginLeft:'auto'},brandText:{fontSize:17},progress:{flexDirection:'row',gap:6,marginHorizontal:spacing.lg,marginBottom:8},mark:{height:4,borderRadius:4,flex:1},
 content:{flexGrow:1,width:'100%',maxWidth:600,alignSelf:'center',paddingHorizontal:spacing.lg,paddingTop:28,paddingBottom:spacing.md,gap:20},profileContent:{paddingTop:32},title:{fontSize:36,lineHeight:43,letterSpacing:-0.9},largeTitle:{fontSize:25,lineHeight:32},body:{fontSize:16,lineHeight:24},caption:{fontSize:14,lineHeight:21},label:{fontSize:16,lineHeight:23,fontWeight:'700'},
 mascot:{width:'100%',alignSelf:'center'},puppyName:{fontSize:28,lineHeight:36,flexShrink:1},input:{minHeight:76,borderBottomWidth:2,paddingHorizontal:0,paddingTop:8,paddingBottom:14,fontSize:31,lineHeight:40},
 space:{flexGrow:1,minHeight:8},actions:{gap:12},card:{padding:20,borderWidth:1,gap:10},privacy:{minHeight:44,justifyContent:'center'},loading:{flexDirection:'row',alignItems:'center',gap:12},notificationPreview:{flexDirection:'row',alignItems:'center',gap:14,marginTop:12},notificationIcon:{width:50,height:50,borderRadius:16,alignItems:'center',justifyContent:'center'},notificationCopy:{flex:1,gap:4},readyCard:{padding:26,marginTop:16,gap:20},
});
