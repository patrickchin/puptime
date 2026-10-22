import {MaterialCommunityIcons} from '@expo/vector-icons';
import {useFonts} from 'expo-font';
import {StatusBar} from 'expo-status-bar';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {
  AccessibilityInfo,ActivityIndicator,Alert,Animated,Easing,Image,Keyboard,KeyboardAvoidingView,Platform,Pressable,
  ScrollView,StyleSheet,Text,TextInput,View,useWindowDimensions,type ImageSourcePropType,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {formatMinutes,formatScheduleWindow,type ScheduleEntry} from '../domain';
import {entityId} from '../entity-id';
import {DateTimeSelector} from '../components/DateTimeSelector';
import {NotificationTimingControls} from '../components/NotificationTimingControls';
import {DEFAULT_NOTIFICATION_PREFERENCES,type NotificationPreferences} from '../notification-config';
import {starterPoopWindows,puppyAges,starterMealTimes,suggestedMealCount,type PuppyAge} from '../onboarding-preview';
import {lightTheme,type Theme} from '../theme';
import {OnboardingPlanTimeline} from '../components/OnboardingPlanTimeline';
export type OnboardingDraft={puppyName:string;schedule:ScheduleEntry[];notifications:NotificationPreferences;showGuide:boolean};
export type ConversationalOnboardingProps={onFinish:(draft:OnboardingDraft)=>Promise<void>;onAllowNotifications:()=>Promise<boolean>;onDisableNotifications:()=>Promise<void>};

const appTheme:Theme={...lightTheme,surface:'#FFFDF7',surfaceRaised:'#FFFDF7',
  text:'#243D2E',textMuted:'#53685A',border:'#CDD8CF',primary:'#176B52',onPrimary:'#FFFDF5',
  presentation:{...lightTheme.presentation,headingFont:'RedHatDisplayBold',titleWeight:'400',controlRadius:12,cardRadius:18}};
const theme:Theme={...appTheme,isDark:true,background:appTheme.primary,
  surface:'#216F59',surfaceRaised:'#2B7C64',text:'#FFFDF5',textMuted:'#DCE9DD',border:'#598E79',
  primary:'#F7EBD2',onPrimary:'#1B503C',primaryPressed:'#E4D6B8',primarySoft:'#2B7C64',danger:'#FFB7A5'};
const mascots=[require('../../assets/mascots/scruffy-terrier.png'),
  require('../../assets/mascots/onboarding/scruffy-ball.png'),
  require('../../assets/mascots/onboarding/scruffy-grass.png'),
  require('../../assets/mascots/onboarding/scruffy-bone.png'),
  require('../../assets/mascots/onboarding/scruffy-roll.png')];
type Step='welcome'|'profile'|'age'|'meals'|'mealTime'|'poop'|'review'|'reminders'|'ready';

// Draft answers are committed by the real app when setup finishes.
export function OnboardingDesignPreview(props:ConversationalOnboardingProps){
  const [fontsLoaded,fontError]=useFonts({
    RedHatDisplayBold:require('../../assets/fonts/RedHatDisplay-Bold.ttf'),
    RedHatText:require('../../assets/fonts/RedHatText-Regular.ttf'),
    RedHatTextSemiBold:require('../../assets/fonts/RedHatText-SemiBold.ttf'),
  });
  return fontsLoaded||fontError?<PreviewFlow {...props}/>:<View style={styles.loading}><ActivityIndicator color={theme.primary}/></View>;
}

function PreviewFlow({onFinish,onAllowNotifications,onDisableNotifications}:ConversationalOnboardingProps){
  const [step,setStep]=useState<Step>('welcome');
  const [name,setName]=useState('');
  const [age,setAge]=useState<PuppyAge|null>(null);
  const [mealTimes,setMealTimes]=useState(()=>starterMealTimes(3));
  const [mealIndex,setMealIndex]=useState(0);
  const [poopWindows,setPoopWindows]=useState<{minutes:number;toleranceMinutes:number}[]>([]);
  const poopMealTimes=useRef<number[]>([]);
  const [poopIndex,setPoopIndex]=useState(0);
  const [schedule,setSchedule]=useState<ScheduleEntry[]>([]);
  const [mascot]=useState(()=>mascots[Math.floor(Math.random()*mascots.length)]);
  const [keyboardVisible,setKeyboardVisible]=useState(Keyboard.isVisible());
  const [pickingTime,setPickingTime]=useState(false);
  const [preferences,setPreferences]=useState<NotificationPreferences>(()=>({...DEFAULT_NOTIFICATION_PREFERENCES,pottyAfterPee:{enabled:false,delayMinutes:120},pottyAfterMeal:{enabled:false,delayMinutes:30}}));
  const [finishing,setFinishing]=useState(false),[finishError,setFinishError]=useState(false);
  const completion=useRef(false);
  const [reminderAnswer,setReminderAnswer]=useState<'later'|'granted'|'declined'>('later');
  const [requestingReminders,setRequestingReminders]=useState(false);
  const [reminderError,setReminderError]=useState<string|null>(null);
  const permissionRequest=useRef(false);
  const scroll=useRef<ScrollView>(null);
  const heading=useRef<Text>(null);
  const {fontScale,width}=useWindowDimensions();
  const [reduceMotion,setReduceMotion]=useState(true);
  const [outgoing,setOutgoing]=useState<ReactNode>(null);
  const [direction,setDirection]=useState(1);
  const transition=useRef(new Animated.Value(1)).current;
  const page=useRef<ReactNode>(null),transitioning=useRef(false);
  useEffect(()=>{
    let current=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(current)setReduceMotion(value);});
    const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduceMotion);
    return()=>{current=false;subscription.remove();transition.stopAnimation();};
  },[transition]);
  const pup=name.trim()||'your pup';
  const meals=schedule.filter(entry=>entry.type==='meal');
  const poops=schedule.filter(entry=>entry.type==='poop');
  const recommendation=suggestedMealCount(age);
  const ageLabel=puppyAges.find(item=>item.id===age)?.label;
  useEffect(()=>{
    const show=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow',()=>setKeyboardVisible(true));
    const hide=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillHide':'keyboardDidHide',()=>setKeyboardVisible(false));
    return()=>{show.remove();hide.remove();};
  },[]);
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{if(heading.current)AccessibilityInfo.sendAccessibilityEvent(heading.current,'focus');});
    return()=>cancelAnimationFrame(frame);
  },[step]);
  function go(next:Step,backward=false){
    if(transitioning.current||next===step)return;
    Keyboard.dismiss();setPickingTime(false);
    if(reduceMotion){setStep(next);return;}
    transitioning.current=true;setOutgoing(page.current);setDirection(backward?-1:1);
    transition.setValue(0);setStep(next);
    requestAnimationFrame(()=>Animated.timing(transition,{toValue:1,duration:300,easing:Easing.out(Easing.cubic),useNativeDriver:true}).start(()=>{setOutgoing(null);transitioning.current=false;}));
  }
  function preparePoop(times:number[]){
    if(times.length!==poopMealTimes.current.length||times.some((time,index)=>time!==poopMealTimes.current[index])){
      setPoopWindows(starterPoopWindows(times));poopMealTimes.current=[...times];
    }
    go('poop');
  }
  function replaceTimes(type:'meal'|'poop',times:{minutes:number;toleranceMinutes?:number}[]){
    setSchedule(current=>{
      const previous=current.filter(entry=>entry.type===type);
      return [...current.filter(entry=>entry.type!==type),...times.map((time,index)=>({id:previous[index]?.id??entityId('rtn'),type,...time,reminder:previous[index]?.reminder??false}))].sort((a,b)=>a.minutes-b.minutes);
    });
  }
  async function complete(showGuide:boolean){
    if(completion.current)return;
    completion.current=true;setFinishing(true);setFinishError(false);
    try{await onFinish({puppyName:name.trim()||'My puppy',schedule,notifications:preferences,showGuide});}
    catch{setFinishError(true);}
    finally{completion.current=false;setFinishing(false);}
  }
  function previewSignIn(provider:string){
    Alert.alert('Sign-in design preview',`${provider} sign-in isn’t connected in this preview. You can explore the whole journey as a guest.`,[
      {text:'Back',style:'cancel'}, {text:'Explore as a guest',onPress:()=>go('profile')},
    ]);
  }
  async function allowReminders(){
    if(permissionRequest.current)return;
    permissionRequest.current=true;setRequestingReminders(true);setReminderError(null);
    try{
      const granted=await onAllowNotifications();
      setReminderAnswer(granted?'granted':'declined');go('ready');
    }catch{setReminderError('We couldn’t ask your phone just now. We can do this later, or try again.');}
    finally{permissionRequest.current=false;setRequestingReminders(false);}
  }
  async function deferReminders(){
    if(permissionRequest.current)return;
    permissionRequest.current=true;setRequestingReminders(true);setReminderError(null);
    try{await onDisableNotifications();setReminderAnswer('later');go('ready');}
    catch{setReminderError('We couldn’t save that choice. Please try again.');}
    finally{permissionRequest.current=false;setRequestingReminders(false);}
  }
  function back(){
    if(pickingTime){setPickingTime(false);return;}
    const previous:Partial<Record<Step,Step>>={profile:'welcome',age:'profile',meals:'age',mealTime:'meals',poop:meals.length?'mealTime':'meals',review:'poop',reminders:'review',ready:'reminders'};
    go(previous[step]??'profile',true);
  }
  const header=<View style={styles.header}>
    {step!=='welcome'?<Pressable testID="preview.back" accessibilityRole="button" accessibilityLabel="Go back" disabled={requestingReminders} onPress={back} style={styles.back}>
      <MaterialCommunityIcons name="chevron-left" size={18} color={theme.textMuted}/><Text style={styles.backText}>Back</Text>
    </Pressable>:<View style={styles.back}/>}
    <View style={styles.brand}><Image source={require('../../assets/puptime-icon.png')} style={styles.icon}/><Text style={styles.brandName}>Puptime</Text></View>
    <View style={styles.headerSpacer}/>
  </View>;
  const footer=(label:string,onPress:()=>void,skipLabel:string,skip:()=>void)=><View style={styles.footer}>
    <Pressable testID="preview.continue" accessibilityRole="button" accessibilityLabel={label} disabled={finishing} accessibilityState={{disabled:finishing,busy:finishing}} onPress={onPress} style={({pressed})=>[styles.primary,(pressed||finishing)&&styles.pressed]}>
      <Text style={styles.primaryText}>{label}</Text><MaterialCommunityIcons name="arrow-right" size={20} color={theme.onPrimary}/>
    </Pressable>
    <Pressable testID="preview.skip" accessibilityRole="button" disabled={finishing} onPress={skip} style={styles.secondary}><Text style={styles.secondaryText}>{skipLabel}</Text></Pressable>
  </View>;
  const later=(label:string,onPress:()=>void)=><View style={styles.footer}><Pressable testID="preview.skip" accessibilityRole="button" onPress={onPress} style={styles.secondary}><Text style={styles.secondaryText}>{label}</Text></Pressable></View>;
  const choice=(id:string,label:string,onPress:()=>void)=><Pressable key={id} testID={`preview.choice.${id}`} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({pressed})=>[styles.choice,pressed&&styles.choicePressed]}>
    <Text style={styles.choiceText}>{label}</Text><MaterialCommunityIcons name="chevron-right" size={21} color={appTheme.primary}/>
  </Pressable>;
  const prompt=(title:string,body?:string)=><View style={styles.prompt}><Text ref={heading} testID="preview.prompt" accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.title}>{title}</Text>{body?<Text style={styles.body}>{body}</Text>:null}</View>;
  const mascotImage=<Image accessible={false} source={mascot} resizeMode="contain" style={styles.mascot}/>;
  const mealStep=step==='mealTime';
  const timeIndex=mealStep?mealIndex:poopIndex;
  const time=mealStep?mealTimes[timeIndex]??0:((poopWindows[timeIndex]?.minutes??15)-15+1440)%1440;
  const activityArt=(source:ImageSourcePropType)=><View style={styles.activityArt}><Image accessible={false} source={source} resizeMode="contain" style={styles.mascot}/></View>;

  let body;
  if(step==='welcome')body=<ScrollView testID="preview.welcome" contentContainerStyle={styles.welcome}>
    <View style={styles.welcomeBrand}><Image accessible={false} source={require('../../assets/puptime-icon.png')} style={styles.welcomeIcon}/><Text ref={heading} accessibilityRole="header" style={styles.welcomeName}>Puptime</Text></View>
    <Text style={styles.welcomeCopy}>Track potty breaks, meals and walks.</Text>
    <View style={styles.welcomeArt}><Image accessible={false} source={mascot} resizeMode="contain" style={styles.mascot}/></View>
    <View style={styles.welcomeActions}>
      <Text style={styles.welcomeQuestion}>How would you like to begin?</Text>
      <View style={styles.signInRow}>{([
        {id:'apple',label:'Apple',icon:'apple'}, {id:'google',label:'Google',icon:'google'}, {id:'email',label:'Email',icon:'email-outline'},
      ] as const).map(provider=><Pressable key={provider.id} testID={`preview.auth.${provider.id}`} accessibilityRole="button" accessibilityLabel={`Continue with ${provider.label}`} onPress={()=>previewSignIn(provider.label)} style={({pressed})=>[styles.signInButton,pressed&&styles.choicePressed]}>
        <MaterialCommunityIcons accessible={false} name={provider.icon} color={appTheme.text} size={21}/><Text style={styles.signInText}>{provider.label}</Text>
      </Pressable>)}</View>
      <Pressable testID="preview.guest" accessibilityRole="button" onPress={()=>go('profile')} style={styles.secondary}><Text style={[styles.secondaryText,{color:theme.text}]}>Let’s start without an account</Text></Pressable>
    </View>
  </ScrollView>;
  else if(step==='profile')body=<>
    <ScrollView ref={scroll} testID="preview.profile" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.profileContent}>
      <Text ref={heading} accessibilityRole="header" testID="preview.prompt" style={styles.title}>What’s your pup’s name?</Text>
      {!keyboardVisible&&fontScale<1.5?<View style={styles.art}><Image source={mascot} accessible={false} resizeMode="contain" style={styles.mascot}/></View>:<View style={styles.keyboardSpace}/>}
      <View style={styles.nameField}><TextInput testID="preview.name" accessibilityLabel="Puppy’s name, optional" value={name} onChangeText={setName}
        placeholder="e.g. Milo" placeholderTextColor={theme.textMuted} maxLength={256} autoCapitalize="words" autoCorrect={false}
        selectionColor={theme.primary} keyboardAppearance="dark" autoComplete="off" clearButtonMode="while-editing" returnKeyType="done" onSubmitEditing={Keyboard.dismiss}
        onFocus={()=>scroll.current?.scrollToEnd({animated:true})} style={styles.nameInput}/></View>
    </ScrollView>
    {footer('Let’s meet them',()=>go('age'),'I’ll add their name later',()=>{setName('');go('age');})}
  </>;
  else if(step==='age')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt(`How old is ${pup}?`)}
      <View style={styles.answers}>{puppyAges.map(item=>choice(item.id,item.label,()=>{setAge(item.id);go('meals');}))}</View>
      {mascotImage}
    </ScrollView>
    {later('I’m not sure yet',()=>{setAge(null);go('meals');})}
  </>;
  else if(step==='meals')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt('Let’s plan mealtimes.',recommendation?`${age==='adult'?'For many adult dogs':`At ${ageLabel}`}, ${recommendation} meals a day is common. Keep your vet’s plan if it’s different. How many does ${pup} have?`:`How many meals does ${pup} usually have each day?`)}
      <View style={styles.answers}>{[1,2,3,4].map(count=>choice(`meals-${count}`,`${count} ${count===1?'meal':'meals'} a day`,()=>{if(count!==mealTimes.length)setMealTimes(starterMealTimes(count));setMealIndex(0);go('mealTime');}))}</View>
    </ScrollView>
    {later('Let’s do this later',()=>{replaceTimes('meal',[]);preparePoop(mealTimes);})}
  </>;
  else if(step==='mealTime')body=<>
    <ScrollView testID="preview.mealTimes" contentContainerStyle={styles.conversation}>
      {prompt('When does '+pup+' eat?')}
      <View style={styles.answers}>{mealTimes.map((minutes,index)=><Pressable key={index} testID={`preview.mealTime.${index}`} accessibilityRole="button" accessibilityLabel={`Meal ${index+1}, ${formatMinutes(minutes,'en')}`} onPress={()=>{setMealIndex(index);setPickingTime(true);}} style={[styles.choice,styles.mealRow]}>
        <Text style={styles.choiceText}>Meal {index+1}</Text><Text style={styles.mealTime}>{formatMinutes(minutes,'en')}</Text><MaterialCommunityIcons name="chevron-down" color={appTheme.primary} size={20}/>
      </Pressable>)}</View>
      {activityArt(require('../../assets/mascots/onboarding/scruffy-eating.png'))}
    </ScrollView>
    {footer('That works for us',()=>{replaceTimes('meal',mealTimes.map(minutes=>({minutes})));preparePoop(mealTimes);},'Let’s do this later',()=>{replaceTimes('meal',[]);preparePoop(mealTimes);})}
  </>;
  else if(step==='poop')body=<>
    <ScrollView testID="preview.poopTimes" contentContainerStyle={[styles.conversation,styles.poopConversation]}>
      {prompt(`When does ${pup} poop?`,meals.length?'We’ve started 30–60 minutes after meals. Move a window to suit your pup.':'Some starting windows to adjust or skip. Each covers 30 minutes.')}
      <View style={styles.poopAnswers}>{poopWindows.map((window,index)=><View key={index} style={styles.poopPair}>
        {meals.length>0?<Text testID={`preview.poopMealTime.${index}`} style={styles.mealReference}>Meal {index+1} · {formatMinutes(poopMealTimes.current[index],'en')}</Text>:null}
        <Pressable testID={`preview.poopTime.${index}`} accessibilityRole="button"
        accessibilityLabel={`Poop window ${index+1}, ${formatScheduleWindow(window,'en')}, change start time`} onPress={()=>{setPoopIndex(index);setPickingTime(true);}} style={[styles.choice,styles.mealRow]}>
          <Text style={[styles.windowTime,{flex:1}]}>{formatScheduleWindow(window,'en')}</Text><MaterialCommunityIcons name="chevron-down" color={appTheme.primary} size={20}/>
        </Pressable>
      </View>)}</View>
      {activityArt(require('../../assets/mascots/onboarding/scruffy-pooping.png'))}
    </ScrollView>
    {footer('That works for us',()=>{replaceTimes('poop',poopWindows);go('review');},'Skip for now',()=>{replaceTimes('poop',[]);go('review');})}
  </>;
  else if(step==='review')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt('Here’s our starting plan.',!schedule.length?'Log a few days to help us suggest a routine.':undefined)}
      <OnboardingPlanTimeline schedule={schedule} theme={theme}/>
      <View style={styles.plan}>
        <Text style={styles.planHeading}>Mealtimes</Text>
        {meals.length?meals.map(entry=><Text key={entry.id} style={styles.planTime}>{formatMinutes(entry.minutes,'en')}</Text>):<Text style={styles.body}>We’ll set these up later.</Text>}
      </View>
      <View style={styles.plan}>
        <Text style={styles.planHeading}>Usual poop windows</Text>
        {poops.length?poops.map(entry=><Text key={entry.id} style={styles.planTime}>{formatScheduleWindow(entry,'en')}</Text>):<Text style={styles.body}>Still getting to know {pup}.</Text>}
      </View>
    </ScrollView>
    {footer('That looks good to me',()=>go('reminders'),'Back to poop times',()=>go('poop',true))}
  </>;
  else if(step==='reminders')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt('Set up reminders')}
      <NotificationTimingControls theme={theme} pickerTheme={appTheme} preferences={preferences} schedule={schedule} disabled={requestingReminders}
        onChange={async next=>setPreferences(next)} onScheduleChange={async next=>setSchedule(next)}/>
      {reminderError?<Text accessibilityRole="alert" style={styles.error}>{reminderError}</Text>:null}
      {requestingReminders?<ActivityIndicator color={theme.primary} accessibilityLabel="Asking your phone about notifications"/>:null}
    </ScrollView>
    <View style={styles.footer}>
      <Pressable testID="preview.reminders.allow" accessibilityRole="button" accessibilityState={{disabled:requestingReminders,busy:requestingReminders}} disabled={requestingReminders} onPress={()=>{void allowReminders();}} style={[styles.primary,requestingReminders&&styles.pressed]}><Text style={styles.primaryText}>Yes, allow notifications</Text></Pressable>
      <Pressable testID="preview.reminders.later" accessibilityRole="button" disabled={requestingReminders} onPress={()=>{void deferReminders();}} style={styles.secondary}><Text style={styles.secondaryText}>Not now, thanks</Text></Pressable>
    </View>
  </>;
  else if(step==='ready')body=<>
    <ScrollView testID="preview.ready" contentContainerStyle={styles.ready}>
      {mascotImage}{prompt('Ready for today?',reminderAnswer==='granted'?'You can change reminders in Notifications.':undefined)}
    </ScrollView>
    {finishError?<Text accessibilityRole="alert" style={[styles.error,{paddingHorizontal:22}]}>We couldn’t save your setup. Your answers are still here—please try again.</Text>:null}
    {footer(finishing?'Saving…':'Show me around',()=>{void complete(true);},'I’ll explore on my own',()=>{void complete(false);})}
  </>;
  const currentPage=<>{step!=='welcome'?header:null}<View style={styles.bodyViewport}>{body}</View></>;
  page.current=currentPage;
  return <SafeAreaView edges={['top','bottom','left','right']} style={styles.root}>
    <StatusBar style="light"/>
    <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.root}>
      <View style={styles.bodyViewport}>
        {outgoing?<Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill,{transform:[{translateX:transition.interpolate({inputRange:[0,1],outputRange:[0,-width*direction]})}]}]}>{outgoing}</Animated.View>:null}
        <Animated.View pointerEvents={outgoing?'none':'auto'} style={[styles.root,{transform:[{translateX:transition.interpolate({inputRange:[0,1],outputRange:[width*direction,0]})}]}]}>{currentPage}</Animated.View>
      </View>
      {pickingTime?<DateTimeSelector value={new Date(2000,0,1,Math.floor(time/60),time%60)} mode="time" locale="en" theme={appTheme} label={mealStep?'Meal time':'Poop window starts'}
        onChange={date=>{const minutes=date.getHours()*60+date.getMinutes();if(mealStep)setMealTimes(current=>current.map((item,index)=>index===mealIndex?minutes:item));else setPoopWindows(current=>current.map((item,index)=>index===poopIndex?{...item,minutes:(minutes+15)%1440}:item));setPickingTime(false);}}
        onCancel={()=>setPickingTime(false)}/>:null}
    </KeyboardAvoidingView>
  </SafeAreaView>;

}

const styles=StyleSheet.create({
  welcome:{flexGrow:1,paddingHorizontal:22,paddingTop:28,paddingBottom:12},welcomeBrand:{alignItems:'center',gap:14},welcomeIcon:{width:64,height:64,borderRadius:16},welcomeName:{fontFamily:'RedHatDisplayBold',fontSize:52,lineHeight:60,letterSpacing:-1.5,color:theme.text},welcomeCopy:{fontFamily:'RedHatText',fontSize:15,lineHeight:23,textAlign:'center',color:theme.text,marginTop:14},
  welcomeArt:{flex:1,minHeight:180,alignItems:'center',justifyContent:'center',paddingVertical:22},welcomeActions:{gap:16,paddingTop:18},welcomeQuestion:{fontFamily:'RedHatText',fontSize:16,lineHeight:24,color:theme.text,textAlign:'center'},signInRow:{flexDirection:'row',gap:10},signInButton:{flex:1,minHeight:54,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:7,borderWidth:1,borderColor:theme.border,borderRadius:16,backgroundColor:appTheme.surface},signInText:{fontFamily:'RedHatTextSemiBold',fontSize:14,color:appTheme.text},
  notification:{padding:18,borderRadius:20,borderWidth:1,borderColor:theme.border,backgroundColor:theme.surface,flexDirection:'row',gap:14,alignItems:'center'},notificationCopy:{flex:1,gap:8},error:{fontFamily:'RedHatText',fontSize:15,lineHeight:23,color:theme.danger},
  bodyViewport:{flex:1,overflow:'hidden'},root:{flex:1,backgroundColor:theme.background},loading:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:theme.background},
  header:{minHeight:52,paddingHorizontal:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  brand:{flexDirection:'row',alignItems:'center',gap:7},icon:{width:28,height:28,borderRadius:7},brandName:{fontFamily:'RedHatDisplayBold',fontSize:20,color:theme.text,letterSpacing:-.5},
  back:{minWidth:62,minHeight:44,flexDirection:'row',alignItems:'center'},backText:{fontFamily:'RedHatText',fontSize:13,color:theme.textMuted},headerSpacer:{width:62},
  profileContent:{flexGrow:1,paddingHorizontal:22,paddingTop:22},title:{fontFamily:'RedHatDisplayBold',fontSize:26,lineHeight:33,letterSpacing:-.5,color:theme.text},
  art:{flex:1,minHeight:160,alignItems:'center',justifyContent:'center',marginTop:12},mascot:{width:'100%',maxWidth:320,height:160,alignSelf:'center'},keyboardSpace:{flexGrow:1,minHeight:16},
  nameField:{paddingTop:18,paddingBottom:20},nameInput:{fontFamily:'RedHatText',fontSize:27,minHeight:60,paddingVertical:10,borderBottomWidth:2,borderBottomColor:theme.primary,color:theme.text},
  footer:{paddingHorizontal:22,paddingTop:18,paddingBottom:2,backgroundColor:theme.background},primary:{minHeight:52,paddingHorizontal:16,paddingVertical:12,borderRadius:999,backgroundColor:theme.primary,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},
  primaryText:{fontFamily:'RedHatTextSemiBold',fontSize:15,color:theme.onPrimary},pressed:{opacity:.75},secondary:{minHeight:44,alignItems:'center',justifyContent:'center',paddingVertical:8,marginTop:4},secondaryText:{fontFamily:'RedHatText',fontSize:14,color:theme.textMuted},
  conversation:{flexGrow:1,paddingHorizontal:22,paddingTop:28,paddingBottom:20,gap:28},prompt:{gap:18},body:{fontFamily:'RedHatText',fontSize:16,lineHeight:24,color:theme.textMuted},
  mealRow:{gap:10},mealTime:{fontFamily:'RedHatTextSemiBold',fontSize:20,color:appTheme.primary,fontVariant:['tabular-nums']},
  answers:{gap:12},choice:{minHeight:62,paddingVertical:16,paddingHorizontal:18,borderWidth:1,borderColor:theme.border,borderRadius:18,backgroundColor:appTheme.surface,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},choicePressed:{backgroundColor:appTheme.primarySoft,borderColor:appTheme.primary},choiceText:{fontFamily:'RedHatTextSemiBold',fontSize:17,lineHeight:24,color:appTheme.text,flex:1},
  activityArt:{flexGrow:1,justifyContent:'flex-end',alignItems:'center'},
  poopConversation:{gap:16,paddingTop:20},poopAnswers:{gap:14},poopPair:{gap:8},mealReference:{fontFamily:'RedHatText',fontSize:14,lineHeight:20,color:'#B6CBC1',paddingHorizontal:4,fontVariant:['tabular-nums']},windowTime:{fontFamily:'RedHatTextSemiBold',fontSize:18,lineHeight:25,color:appTheme.primary,fontVariant:['tabular-nums']},
  progress:{fontFamily:'RedHatText',fontSize:13,color:theme.textMuted},timeSpace:{flexGrow:1,justifyContent:'center',gap:28,paddingVertical:12},timeAnswer:{minHeight:96,padding:20,borderRadius:24,backgroundColor:appTheme.surface,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:18},timeText:{fontFamily:'RedHatDisplayBold',fontSize:40,lineHeight:52,color:appTheme.primary,fontVariant:['tabular-nums'],flexShrink:1},
  plan:{borderTopWidth:1,borderColor:theme.border,paddingTop:20,gap:12},planHeading:{fontFamily:'RedHatTextSemiBold',fontSize:15,color:theme.textMuted},planTime:{fontFamily:'RedHatTextSemiBold',fontSize:22,lineHeight:30,color:theme.text,fontVariant:['tabular-nums']},schedule:{flex:1},ready:{flexGrow:1,padding:24,justifyContent:'center',gap:28},
});
