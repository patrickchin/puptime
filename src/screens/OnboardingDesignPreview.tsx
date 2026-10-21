import {MaterialCommunityIcons} from '@expo/vector-icons';
import {useFonts} from 'expo-font';
import {StatusBar} from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import {useEffect,useRef,useState} from 'react';
import {
  AccessibilityInfo,ActivityIndicator,Alert,Image,Keyboard,KeyboardAvoidingView,Platform,Pressable,
  ScrollView,StyleSheet,Text,TextInput,View,useWindowDimensions,
} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';

import {STARTER_SCHEDULE,formatMinutes,formatScheduleWindow,type PuppyEvent,type ScheduleEntry} from '../domain';
import {entityId} from '../entity-id';
import {DateTimeSelector} from '../components/DateTimeSelector';
import {LocalizationProvider} from '../localization-context';
import {poopDelays,poopWindowsAfterMeals,previewScheduleToKeep,puppyAges,starterMealTimes,suggestedMealCount,type PuppyAge} from '../onboarding-preview';
import {lightTheme,type Theme} from '../theme';
import {ScheduleScreen} from './ScheduleScreen';
import {OnboardingHomePreview,type PreviewGuide} from './OnboardingHomePreview';

const theme:Theme={...lightTheme,background:'#FCFCF9',surface:'#FFFDF7',surfaceRaised:'#FFFDF7',
  text:'#243D2E',textMuted:'#53685A',border:'#CDD8CF',primary:'#176B52',onPrimary:'#FFFDF5',
  presentation:{...lightTheme.presentation,headingFont:'RedHatDisplayBold',titleWeight:'400',controlRadius:12,cardRadius:18}};
const mascots=[require('../../assets/mascots/scruffy-terrier.png'),
  require('../../assets/mascots/onboarding/scruffy-ball.png'),
  require('../../assets/mascots/onboarding/scruffy-grass.png'),
  require('../../assets/mascots/onboarding/scruffy-bone.png'),
  require('../../assets/mascots/onboarding/scruffy-roll.png')];
type Step='welcome'|'profile'|'age'|'meals'|'mealTime'|'poop'|'poopDelay'|'poopCount'|'poopTime'|'review'|'schedule'|'reminders'|'ready'|'home';

// Explicit preview entry: answers and routine drafts stay in memory.
export function OnboardingDesignPreview(){
  const [fontsLoaded,fontError]=useFonts({
    RedHatDisplayBold:require('../../assets/fonts/RedHatDisplay-Bold.ttf'),
    RedHatText:require('../../assets/fonts/RedHatText-Regular.ttf'),
    RedHatTextSemiBold:require('../../assets/fonts/RedHatText-SemiBold.ttf'),
  });
  return <SafeAreaProvider><LocalizationProvider language="en">
    {fontsLoaded||fontError?<PreviewFlow/>:<View style={styles.loading}><ActivityIndicator color={theme.primary}/></View>}
  </LocalizationProvider></SafeAreaProvider>;
}

function PreviewFlow(){
  const [step,setStep]=useState<Step>('welcome');
  const [name,setName]=useState('');
  const [age,setAge]=useState<PuppyAge|null>(null);
  const [mealTimes,setMealTimes]=useState(()=>starterMealTimes(3));
  const [mealIndex,setMealIndex]=useState(0);
  const [poopTimes,setPoopTimes]=useState([8*60,18*60]);
  const [poopIndex,setPoopIndex]=useState(0);
  const [schedule,setSchedule]=useState<ScheduleEntry[]>(()=>STARTER_SCHEDULE.filter(entry=>entry.type!=='meal').map(entry=>({...entry,reminder:false})));
  const [keepingFullPlan,setKeepingFullPlan]=useState(false);
  const [mascot]=useState(()=>mascots[Math.floor(Math.random()*mascots.length)]);
  const [keyboardVisible,setKeyboardVisible]=useState(Keyboard.isVisible());
  const [pickingTime,setPickingTime]=useState(false);
  const [events,setEvents]=useState<PuppyEvent[]>([]);
  const [guide,setGuide]=useState<PreviewGuide>('quick');
  const [reminderAnswer,setReminderAnswer]=useState<'later'|'granted'|'declined'>('later');
  const [requestingReminders,setRequestingReminders]=useState(false);
  const [reminderError,setReminderError]=useState<string|null>(null);
  const permissionRequest=useRef(false);
  const scroll=useRef<ScrollView>(null);
  const heading=useRef<Text>(null);
  const {fontScale}=useWindowDimensions();
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
  },[step,mealIndex,poopIndex]);
  function go(next:Step){Keyboard.dismiss();setPickingTime(false);setStep(next);}
  function replaceTimes(type:'meal'|'poop',times:{minutes:number;toleranceMinutes?:number}[]){
    setSchedule(current=>{
      const previous=current.filter(entry=>entry.type===type);
      return [...current.filter(entry=>entry.type!==type),...times.map((time,index)=>({id:previous[index]?.id??entityId('rtn'),type,...time,reminder:false}))].sort((a,b)=>a.minutes-b.minutes);
    });
  }
  function keepGuidedTimes(){setKeepingFullPlan(false);setSchedule(current=>previewScheduleToKeep(current,false));go('reminders');}
  function finish(){setSchedule(current=>previewScheduleToKeep(current,keepingFullPlan));go('reminders');}
  async function requestReminderPermission(){
    const current=await Notifications.getPermissionsAsync();
    const result=current.granted||!current.canAskAgain?current:await Notifications.requestPermissionsAsync({ios:{allowAlert:true,allowBadge:true,allowSound:true}});
    return result.granted;
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
      const granted=await requestReminderPermission();
      setReminderAnswer(granted?'granted':'declined');go('ready');
    }catch{setReminderError('We couldn’t ask your phone just now. We can do this later, or try again.');}
    finally{permissionRequest.current=false;setRequestingReminders(false);}
  }
  function back(){
    if(pickingTime){setPickingTime(false);return;}
    if(step==='mealTime'&&mealIndex>0){setMealIndex(mealIndex-1);return;}
    if(step==='poopTime'&&poopIndex>0){setPoopIndex(poopIndex-1);return;}
    const previous:Partial<Record<Step,Step>>={profile:'welcome',age:'profile',meals:'age',mealTime:'meals',poop:meals.length?'mealTime':'meals',poopDelay:'poop',poopCount:'poop',poopTime:'poopCount',review:'poop',schedule:'review',reminders:'review',ready:'reminders',home:'ready'};
    go(previous[step]??'profile');
  }
  const header=<View style={styles.header}>
    {step!=='welcome'?<Pressable testID="preview.back" accessibilityRole="button" accessibilityLabel="Go back" disabled={requestingReminders} onPress={back} style={styles.back}>
      <MaterialCommunityIcons name="chevron-left" size={18} color={theme.textMuted}/><Text style={styles.backText}>Back</Text>
    </Pressable>:<View style={styles.back}/>}
    <View style={styles.brand}><Image source={require('../../assets/puptime-icon.png')} style={styles.icon}/><Text style={styles.brandName}>Puptime</Text></View>
    <Text style={styles.optional}>{!['welcome','review','ready','home'].includes(step)?'Optional':''}</Text>
  </View>;
  const footer=(label:string,onPress:()=>void,skipLabel:string,skip:()=>void)=><View style={styles.footer}>
    <Pressable testID="preview.continue" accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({pressed})=>[styles.primary,pressed&&styles.pressed]}>
      <Text style={styles.primaryText}>{label}</Text><MaterialCommunityIcons name="arrow-right" size={20} color={theme.onPrimary}/>
    </Pressable>
    <Pressable testID="preview.skip" accessibilityRole="button" onPress={skip} style={styles.secondary}><Text style={styles.secondaryText}>{skipLabel}</Text></Pressable>
  </View>;
  const later=(label:string,onPress:()=>void)=><View style={styles.footer}><Pressable testID="preview.skip" accessibilityRole="button" onPress={onPress} style={styles.secondary}><Text style={styles.secondaryText}>{label}</Text></Pressable></View>;
  const choice=(id:string,label:string,onPress:()=>void)=><Pressable key={id} testID={`preview.choice.${id}`} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({pressed})=>[styles.choice,pressed&&styles.choicePressed]}>
    <Text style={styles.choiceText}>{label}</Text><MaterialCommunityIcons name="chevron-right" size={21} color={theme.primary}/>
  </Pressable>;
  const prompt=(title:string,body?:string)=><View style={styles.prompt}><Text ref={heading} accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.title}>{title}</Text>{body?<Text style={styles.body}>{body}</Text>:null}</View>;
  const smallMascot=<Image accessible={false} source={mascot} resizeMode="contain" style={styles.smallMascot}/>;
  const mealStep=step==='mealTime';
  const timeIndex=mealStep?mealIndex:poopIndex;
  const times=mealStep?mealTimes:poopTimes;
  const time=times[timeIndex]??0;

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
        <MaterialCommunityIcons accessible={false} name={provider.icon} color={theme.text} size={21}/><Text style={styles.signInText}>{provider.label}</Text>
      </Pressable>)}</View>
      <Pressable testID="preview.guest" accessibilityRole="button" onPress={()=>go('profile')} style={styles.secondary}><Text style={[styles.secondaryText,{color:theme.onPrimary}]}>Let’s start without an account</Text></Pressable>
    </View>
  </ScrollView>;
  else if(step==='profile')body=<>
    <ScrollView ref={scroll} testID="preview.profile" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.profileContent}>
      <Text ref={heading} accessibilityRole="header" style={styles.title}>First, what’s your{fontScale<1.5?'\n':' '}pup’s name?</Text>
      {!keyboardVisible&&fontScale<1.5?<View style={styles.art}><Image source={mascot} accessible={false} resizeMode="contain" style={styles.mascot}/></View>:<View style={styles.keyboardSpace}/>}
      <View style={styles.nameField}><TextInput testID="preview.name" accessibilityLabel="Puppy’s name, optional" value={name} onChangeText={setName}
        placeholder="e.g. Milo" placeholderTextColor={theme.textMuted} maxLength={256} autoCapitalize="words" autoCorrect={false}
        selectionColor={theme.primary} autoComplete="off" clearButtonMode="while-editing" returnKeyType="done" onSubmitEditing={Keyboard.dismiss}
        onFocus={()=>scroll.current?.scrollToEnd({animated:true})} style={styles.nameInput}/></View>
    </ScrollView>
    {footer('Let’s meet them',()=>go('age'),'I’ll add their name later',()=>{setName('');go('age');})}
  </>;
  else if(step==='age')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt(`And how old\nis ${pup}?`,'An estimate is fine.')}
      <View style={styles.answers}>{puppyAges.map(item=>choice(item.id,item.label,()=>{setAge(item.id);go('meals');}))}</View>
      {smallMascot}
    </ScrollView>
    {later('I’m not sure yet',()=>{setAge(null);go('meals');})}
  </>;
  else if(step==='meals')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt('Let’s set up\nmealtimes.',recommendation?`${age==='adult'?'For many adult dogs':`At ${ageLabel}`}, ${recommendation} meals a day is common. Keep your vet’s plan if it’s different. How many does ${pup} have?`:`How many meals does ${pup} usually have each day?`)}
      <View style={styles.answers}>{[1,2,3,4].map(count=>choice(`meals-${count}`,`${count} ${count===1?'meal':'meals'} a day`,()=>{if(count!==mealTimes.length)setMealTimes(starterMealTimes(count));setMealIndex(0);go('mealTime');}))}</View>
    </ScrollView>
    {later('Let’s do this later',()=>{replaceTimes('meal',[]);go('poop');})}
  </>;
  else if(step==='mealTime'||step==='poopTime')body=<>
    <ScrollView key={`${step}-${timeIndex}`} contentContainerStyle={styles.conversation}>
      <Text style={styles.progress}>{mealStep?'Meal':'Poop window'} {timeIndex+1} of {times.length}</Text>
      {prompt(timeIndex===0?(mealStep?`When’s ${pup}’s\nfirst meal?`:'When’s the first\nusual poop?'):(mealStep?'And the\nnext meal?':'And the next\nusual poop?'),timeIndex===0?(mealStep?'Roughly what time works for you?':'We’ll leave half an hour either side. You can adjust the window later.'):`${formatMinutes(times[timeIndex-1],'en')} for the last one. What time comes next?`)}
      <View style={styles.timeSpace}>
        {smallMascot}
        <Pressable testID="preview.time" accessibilityRole="button" accessibilityLabel={`Change ${mealStep?'meal time':'poop window centre'}, ${formatMinutes(time,'en')}`} onPress={()=>setPickingTime(true)} style={({pressed})=>[styles.timeAnswer,pressed&&styles.choicePressed]}>
          <Text style={styles.timeText}>{formatMinutes(time,'en')}</Text><MaterialCommunityIcons name="chevron-down" size={24} color={theme.primary}/>
        </Pressable>
      </View>
    </ScrollView>
    {footer(timeIndex===times.length-1?(mealStep?'That’s mealtimes sorted':'That’s the last one'):'Next',()=>{
      if(timeIndex<times.length-1){if(mealStep)setMealIndex(timeIndex+1);else setPoopIndex(timeIndex+1);}
      else{replaceTimes(mealStep?'meal':'poop',times.map(minutes=>({minutes,...(!mealStep?{toleranceMinutes:30}:{})})));go(mealStep?'poop':'review');}
    },'Let’s do this later',()=>{replaceTimes(mealStep?'meal':'poop',[]);go(mealStep?'poop':'review');})}
  </>;
  else if(step==='poop')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt('Now, let’s\ntalk poop.',`A toilet break after meals can help. Have you noticed when ${pup} tends to poop?`)}
      <View style={styles.answers}>
        {meals.length?choice('after-meals','Usually after meals',()=>go('poopDelay')):null}
        {choice('known-times','I know the usual times',()=>go('poopCount'))}
        {choice('still-learning','We’re still figuring it out',()=>{replaceTimes('poop',[]);go('review');})}
      </View>
      {smallMascot}
    </ScrollView>
    {later('Skip for now',()=>{replaceTimes('poop',[]);go('review');})}
  </>;
  else if(step==='poopDelay')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt('How soon after\na meal?','Roughly is fine. We’ll keep it as a window.')}
      <View style={styles.answers}>{poopDelays.map((delay,index)=>choice(`delay-${index}`,delay.label,()=>{replaceTimes('poop',poopWindowsAfterMeals(meals.map(entry=>entry.minutes),delay));go('review');}))}</View>
      {smallMascot}
    </ScrollView>
    {later('Actually, let’s work this out later',()=>{replaceTimes('poop',[]);go('review');})}
  </>;
  else if(step==='poopCount')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt('How many times\non a usual day?','Some days will be different. That’s okay.')}
      <View style={styles.answers}>{[1,2,3,4,5].map(count=>choice(`poops-${count}`,`${count} ${count===1?'time':'times'}`,()=>{setPoopTimes(current=>count===current.length?current:Array.from({length:count},(_,index)=>Math.round((8+index*10/Math.max(1,count-1))*60)));setPoopIndex(0);go('poopTime');}))}</View>
    </ScrollView>
    {later('I’m not sure yet',()=>{replaceTimes('poop',[]);go('review');})}
  </>;
  else if(step==='review')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt(name.trim()?`That’s a start,\n${name.trim()}.`:'That’s a start.',poops.length?'We’ll get to know the rest of the routine as you log.':'No rush on poop times. Log a few days and we can look for a pattern together.')}
      <View style={styles.plan}>
        <Text style={styles.planHeading}>Mealtimes</Text>
        {meals.length?meals.map(entry=><Text key={entry.id} style={styles.planTime}>{formatMinutes(entry.minutes,'en')}</Text>):<Text style={styles.body}>We’ll set these up later.</Text>}
      </View>
      <View style={styles.plan}>
        <Text style={styles.planHeading}>Usual poop windows</Text>
        {poops.length?poops.map(entry=><Text key={entry.id} style={styles.planTime}>{formatScheduleWindow(entry,'en')}</Text>):<Text style={styles.body}>Still getting to know {pup}.</Text>}
      </View>
      {keepingFullPlan&&schedule.length>meals.length+poops.length?<Text style={styles.body}>We’ve kept your other {schedule.length-meals.length-poops.length} routine times, too.</Text>:null}
    </ScrollView>
    {footer('That looks good to me',finish,'See the full schedule',()=>go('schedule'))}
  </>;
  else if(step==='schedule')body=<>
    <View style={styles.schedule}><ScheduleScreen theme={theme} events={[]} schedule={schedule} customActivities={[]}
      setupHeader={<View style={styles.prompt}>{prompt('Anything else\nto add?','These extra starter times are optional. Keep just the times we chose if that’s enough for now.')}</View>}
      onChange={async next=>setSchedule(next)}
      onSaveEntry={async entry=>setSchedule(current=>[...current.filter(item=>item.id!==entry.id),entry].sort((a,b)=>a.minutes-b.minutes))}
      onRemoveEntry={async id=>setSchedule(current=>current.filter(item=>item.id!==id))}
      onRequestReminderPermission={requestReminderPermission}/></View>
    {footer('Let’s keep this plan',()=>{setKeepingFullPlan(true);go('reminders');},'Keep just our meal & poop times',keepGuidedTimes)}
  </>;
  else if(step==='reminders')body=<>
    <ScrollView key={step} contentContainerStyle={styles.conversation}>
      {prompt('Would a little\nnudge help?','A gentle heads-up at the times you choose. Your phone will ask for permission first.')}
      <View style={styles.notification}>
        <Image accessible={false} source={require('../../assets/puptime-icon.png')} style={styles.icon}/>
        <View style={styles.notificationCopy}><Text style={[styles.choiceText,{flex:0}]}>A little heads-up from Puptime</Text><Text style={styles.body}>Time for {pup}’s next meal?</Text></View>
      </View>
      {smallMascot}
      {reminderError?<Text accessibilityRole="alert" style={styles.error}>{reminderError}</Text>:null}
      {requestingReminders?<ActivityIndicator color={theme.primary} accessibilityLabel="Asking your phone about notifications"/>:null}
    </ScrollView>
    <View style={styles.footer}>
      <Pressable testID="preview.reminders.allow" accessibilityRole="button" accessibilityState={{disabled:requestingReminders,busy:requestingReminders}} disabled={requestingReminders} onPress={()=>{void allowReminders();}} style={[styles.primary,requestingReminders&&styles.pressed]}><Text style={styles.primaryText}>Yes, allow notifications</Text></Pressable>
      <Pressable testID="preview.reminders.later" accessibilityRole="button" disabled={requestingReminders} onPress={()=>{setReminderAnswer('later');go('ready');}} style={styles.secondary}><Text style={styles.secondaryText}>Not now, thanks</Text></Pressable>
    </View>
  </>;
  else if(step==='ready')body=<>
    <ScrollView testID="preview.ready" contentContainerStyle={styles.ready}>
      {smallMascot}{prompt('Let’s see how\ntoday goes.',reminderAnswer==='granted'?`Your phone allows notifications now. We can pick your reminders later. For now, log whenever ${pup} eats or goes potty.`:`Reminders can wait. Whenever ${pup} eats or goes potty, you can log it with a tap.`)}
    </ScrollView>
    {footer('Show me around',()=>{setGuide('quick');go('home');},'I’ll explore on my own',()=>{setGuide(null);go('home');})}
  </>;
  else body=<OnboardingHomePreview theme={theme} pup={pup} events={events} setEvents={setEvents} guide={guide} setGuide={setGuide} onReview={()=>go('review')}/>;

  const background=step==='welcome'?{backgroundColor:theme.primary}:undefined;
  return <SafeAreaView edges={['top','bottom','left','right']} style={[styles.root,background]}>
    <StatusBar style={step==='welcome'?'light':'dark'}/>
    <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={[styles.root,background]}>
      {step!=='welcome'&&step!=='home'?header:null}{body}
      {pickingTime?<DateTimeSelector value={new Date(2000,0,1,Math.floor(time/60),time%60)} mode="time" locale="en" theme={theme}
        onChange={date=>{const minutes=date.getHours()*60+date.getMinutes();if(mealStep)setMealTimes(current=>current.map((item,index)=>index===mealIndex?minutes:item));else setPoopTimes(current=>current.map((item,index)=>index===poopIndex?minutes:item));setPickingTime(false);}}
        onCancel={()=>setPickingTime(false)}/>:null}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles=StyleSheet.create({
  welcome:{flexGrow:1,paddingHorizontal:22,paddingTop:28,paddingBottom:12},welcomeBrand:{alignItems:'center',gap:14},welcomeIcon:{width:64,height:64,borderRadius:16},welcomeName:{fontFamily:'RedHatDisplayBold',fontSize:52,lineHeight:60,letterSpacing:-1.5,color:theme.onPrimary},welcomeCopy:{fontFamily:'RedHatText',fontSize:15,lineHeight:23,textAlign:'center',color:theme.onPrimary,marginTop:14},
  welcomeArt:{flex:1,minHeight:180,alignItems:'center',justifyContent:'center',paddingVertical:22},welcomeActions:{gap:16,paddingTop:18},welcomeQuestion:{fontFamily:'RedHatText',fontSize:16,lineHeight:24,color:theme.onPrimary,textAlign:'center'},signInRow:{flexDirection:'row',gap:10},signInButton:{flex:1,minHeight:54,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:7,borderWidth:1,borderColor:theme.border,borderRadius:16,backgroundColor:theme.surface},signInText:{fontFamily:'RedHatTextSemiBold',fontSize:14,color:theme.text},
  notification:{padding:18,borderRadius:20,borderWidth:1,borderColor:theme.border,backgroundColor:theme.surface,flexDirection:'row',gap:14,alignItems:'center'},notificationCopy:{flex:1,gap:8},error:{fontFamily:'RedHatText',fontSize:15,lineHeight:23,color:theme.danger},
  root:{flex:1,backgroundColor:theme.background},loading:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:theme.background},
  header:{minHeight:52,paddingHorizontal:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  brand:{flexDirection:'row',alignItems:'center',gap:7},icon:{width:28,height:28,borderRadius:7},brandName:{fontFamily:'RedHatDisplayBold',fontSize:20,color:theme.text,letterSpacing:-.5},
  back:{minWidth:62,minHeight:44,flexDirection:'row',alignItems:'center'},backText:{fontFamily:'RedHatText',fontSize:13,color:theme.textMuted},optional:{fontFamily:'RedHatText',fontSize:13,color:theme.textMuted,minWidth:62,textAlign:'right'},
  profileContent:{flexGrow:1,paddingHorizontal:22,paddingTop:22},title:{fontFamily:'RedHatDisplayBold',fontSize:34,lineHeight:39,letterSpacing:-.8,color:theme.text},
  art:{flex:1,minHeight:140,alignItems:'center',justifyContent:'center',marginTop:12},mascot:{width:'100%',height:'100%',maxHeight:300,minHeight:140},keyboardSpace:{flexGrow:1,minHeight:16},
  nameField:{paddingTop:18,paddingBottom:20},nameInput:{fontFamily:'RedHatText',fontSize:27,minHeight:60,paddingVertical:10,borderBottomWidth:2,borderBottomColor:theme.primary,color:theme.text},
  footer:{paddingHorizontal:22,paddingTop:18,paddingBottom:2,backgroundColor:theme.background},primary:{minHeight:52,paddingHorizontal:16,paddingVertical:12,borderRadius:999,backgroundColor:theme.primary,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},
  primaryText:{fontFamily:'RedHatTextSemiBold',fontSize:15,color:theme.onPrimary},pressed:{opacity:.75},secondary:{minHeight:44,alignItems:'center',justifyContent:'center',paddingVertical:8,marginTop:4},secondaryText:{fontFamily:'RedHatText',fontSize:14,color:theme.textMuted},
  conversation:{flexGrow:1,paddingHorizontal:22,paddingTop:28,paddingBottom:20,gap:28},prompt:{gap:18},body:{fontFamily:'RedHatText',fontSize:16,lineHeight:24,color:theme.textMuted},
  answers:{gap:12},choice:{minHeight:62,paddingVertical:16,paddingHorizontal:18,borderWidth:1,borderColor:theme.border,borderRadius:18,backgroundColor:theme.surface,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},choicePressed:{backgroundColor:theme.primarySoft,borderColor:theme.primary},choiceText:{fontFamily:'RedHatTextSemiBold',fontSize:17,lineHeight:24,color:theme.text,flex:1},
  smallMascot:{height:150,width:180,alignSelf:'center'},progress:{fontFamily:'RedHatText',fontSize:13,color:theme.textMuted},timeSpace:{flexGrow:1,justifyContent:'center',gap:28,paddingVertical:12},timeAnswer:{minHeight:96,padding:20,borderRadius:24,backgroundColor:theme.primarySoft,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:18},timeText:{fontFamily:'RedHatDisplayBold',fontSize:40,lineHeight:52,color:theme.primary,fontVariant:['tabular-nums'],flexShrink:1},
  plan:{borderTopWidth:1,borderColor:theme.border,paddingTop:20,gap:12},planHeading:{fontFamily:'RedHatTextSemiBold',fontSize:15,color:theme.textMuted},planTime:{fontFamily:'RedHatTextSemiBold',fontSize:22,lineHeight:30,color:theme.text,fontVariant:['tabular-nums']},schedule:{flex:1},ready:{flexGrow:1,padding:24,justifyContent:'center',gap:28},
});
