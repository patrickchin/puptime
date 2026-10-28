import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Alert, Animated, Easing, Image, Keyboard,
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { Pressable } from '../components/TelemetryPressable';

import { ActivityIcon } from '../components/ActivityIcon';
import { useLocalization } from '../localization-context';
import type { OnboardingScreenProps } from '../onboarding';
import { headingStyle, spacing } from '../theme';
import { ExactReminderAccessError } from '../reminders';

const practiceActions = ['pee', 'poop', 'meal'] as const;
type PracticeActivity = (typeof practiceActions)[number];

export function OnboardingScreen({theme, mode, notificationPermission, onAllowNotifications, onOpenSystemSettings, onFinish,onBack}:OnboardingScreenProps) {
  const {t,activityLabel,activityColors,locale}=useLocalization();
  const {fontScale,height}=useWindowDimensions();
  const largeText=fontScale>=1.5;
  const [step,setStep]=useState(0);
  const [practice,setPractice]=useState<PracticeActivity|null>(null);
  const [practiceReminder,setPracticeReminder]=useState(false);
  const [puppyName,setPuppyName]=useState('');
  const [keyboardVisible,setKeyboardVisible]=useState(Keyboard.isVisible());
  const [busy,setBusy]=useState(false);
  const [reduceMotion,setReduceMotion]=useState(true);
  const mounted=useRef(true),locked=useRef(false);
  const title=useRef<Text>(null),scroll=useRef<ScrollView>(null);
  const bounce=useRef(new Animated.Value(0)).current;
  const replay=mode==='replay';
  const embedded=mode==='embedded',lastStep=embedded?2:3;
  const colors=practice?activityColors(theme,{type:practice}):null;
  const headings=['tour.logTitle','tour.timelineTitle','tour.routineTitle',replay?'tour.replayTitle':'tour.readyTitle'] as const;

  useEffect(()=>{
    mounted.current=true;
    let current=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(current)setReduceMotion(value);});
    const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduceMotion);
    return()=>{mounted.current=false;current=false;subscription.remove();bounce.stopAnimation();};
  },[bounce]);
  useEffect(()=>{
    const show=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow',()=>setKeyboardVisible(true)),hide=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillHide':'keyboardDidHide',()=>setKeyboardVisible(false));
    return()=>{show.remove();hide.remove();};
  },[]);
  useEffect(()=>{
    if(reduceMotion){bounce.stopAnimation();bounce.setValue(0);}
  },[bounce,reduceMotion]);
  useEffect(()=>{
    scroll.current?.scrollTo({y:0,animated:false});
    const frame=requestAnimationFrame(()=>{if(title.current)AccessibilityInfo.sendAccessibilityEvent(title.current,'focus');});
    return()=>cancelAnimationFrame(frame);
  },[step]);

  function tryActivity(type:PracticeActivity) {
    // Practice is deliberately component state; no storage writer belongs here.
    setPractice(type);
    AccessibilityInfo.announceForAccessibility(t('tour.practiceAdded',{activity:activityLabel({type})}));
    if(reduceMotion)return;
    bounce.stopAnimation();bounce.setValue(0);
    Animated.sequence([
      Animated.timing(bounce,{toValue:1,duration:130,easing:Easing.out(Easing.quad),useNativeDriver:true}),
      Animated.timing(bounce,{toValue:0,duration:230,easing:Easing.out(Easing.quad),useNativeDriver:true}),
    ]).start();
  }
  async function finish(skip=false) {
    if(locked.current)return;
    locked.current=true;setBusy(true);Keyboard.dismiss();
    try{await onFinish(skip||replay||embedded?undefined:{puppyName});}
    catch{Alert.alert(t('settings.saveErrorTitle'),t('settings.saveErrorBody'));}
    finally{locked.current=false;if(mounted.current)setBusy(false);}
  }
  async function allowNotifications() {
    if(locked.current)return;
    Keyboard.dismiss();
    if(notificationPermission==='blocked'){onOpenSystemSettings();return;}
    locked.current=true;setBusy(true);
    try{await onAllowNotifications();}
    catch(error){Alert.alert(t('schedule.reminderErrorTitle'),t(error instanceof ExactReminderAccessError?'notifications.exactSetupRequired':'schedule.reminderErrorBody'));}
    finally{locked.current=false;if(mounted.current)setBusy(false);}
  }
  const card={backgroundColor:theme.surfaceRaised,borderColor:theme.border,borderRadius:theme.presentation.cardRadius};

  const footer=(
      <View style={[styles.footer,largeText&&styles.scrollFooter,{backgroundColor:theme.background,borderColor:theme.border}]}>
        <Pressable testID="onboarding.primary" accessibilityRole="button" disabled={busy} accessibilityState={{disabled:busy,busy}} onPress={()=>step<lastStep?setStep(step+1):void finish()} style={({pressed})=>[styles.primary,{backgroundColor:pressed?theme.primaryPressed:theme.primary,borderRadius:theme.presentation.controlRadius,opacity:busy?0.6:1}]}>
          <Text style={[styles.primaryText,{color:theme.onPrimary}]}>{t(step<lastStep||embedded?'onboarding.continue':replay?'tour.replayDone':'onboarding.start')}</Text>
          <MaterialCommunityIcons accessible={false} name="arrow-right" size={21} color={theme.onPrimary}/>
        </Pressable>
        {step>0?<View style={[step===3&&!replay?styles.footerChoices:undefined,largeText&&styles.largeChoices]}>
          <Pressable testID="onboarding.back" accessibilityRole="button" disabled={busy} onPress={()=>{Keyboard.dismiss();setStep(step-1);}} style={styles.back}><Text style={[styles.backText,{color:theme.textMuted}]}>{t('onboarding.back')}</Text></Pressable>
          {step===3&&!replay?<Pressable testID="onboarding.later" accessibilityRole="button" disabled={busy} onPress={()=>void finish(true)} style={styles.back}><Text style={[styles.backText,{color:theme.textMuted}]}>{t('onboarding.later')}</Text></Pressable>:null}
        </View>:embedded?<Pressable testID="onboarding.back" accessibilityRole="button" disabled={busy} onPress={onBack} style={styles.back}><Text style={[styles.backText,{color:theme.textMuted}]}>{t('onboarding.back')}</Text></Pressable>:!largeText?<View style={styles.backSlot}/>:null}
      </View>
  );

  return (
    <KeyboardAvoidingView testID="screen.onboarding" behavior={Platform.OS==='ios'?'padding':'height'} style={[styles.root,{backgroundColor:theme.background}]}>
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <MaterialCommunityIcons accessible={false} name="paw" size={20} color={theme.primary}/>
          <Text maxFontSizeMultiplier={1.3} style={[styles.brandText,headingStyle(theme),{color:theme.text}]}>Puptime</Text>
        </View>
        <Pressable testID="onboarding.skip" accessibilityRole="button" disabled={busy} accessibilityState={{disabled:busy}} onPress={()=>void finish(true)} style={styles.skip}>
          <Text style={[styles.skipText,{color:theme.textMuted}]}>{t('onboarding.skip')}</Text>
        </Pressable>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel={t(embedded?'setup.tourProgress':'onboarding.progress',{step:step+1})} accessibilityValue={{min:1,max:lastStep+1,now:step+1}} style={styles.progress}>
        {Array.from({length:lastStep+1},(_,index)=><View key={index} style={[styles.progressMark,{backgroundColor:index<=step?theme.primary:theme.border}]}/>)}
      </View>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {step===3&&!largeText&&!keyboardVisible?<Image source={require('../../assets/mascots/scruffy-terrier.png')} accessible={false} resizeMode="contain" style={[styles.mascot,{height:Math.min(145,height*0.18)}]}/>:null}
        <Text ref={title} testID={`onboarding.step.${step}`} accessibilityRole="header" style={[styles.title,headingStyle(theme),largeText&&styles.largeTitle,{color:theme.text}]}>{t(headings[step])}</Text>
        {step===0?<Text style={[styles.body,{color:theme.textMuted}]}>{t('tour.logBody')}</Text>:null}

        {step===0?<>
          <Animated.View style={[styles.card,styles.practiceCard,card,{transform:[{translateY:bounce.interpolate({inputRange:[0,1],outputRange:[0,-6]})}]}]}>
            <View style={[styles.actions,largeText&&styles.largeActions]}>
              {practiceActions.map(type=>{
                const activity={type},appearance=activityColors(theme,activity),selected=practice===type;
                return <Pressable key={type} testID={`onboarding.demo.${type}`} accessibilityRole="button" accessibilityLabel={t('tour.practiceAction',{activity:activityLabel(activity)})} accessibilityState={{selected}} onPress={()=>tryActivity(type)} style={({pressed})=>[styles.action,largeText&&styles.largeAction,{backgroundColor:selected?appearance.softColor:theme.surface,borderColor:selected?appearance.color:theme.border,borderRadius:theme.presentation.controlRadius,opacity:pressed?0.75:1}]}>
                  <ActivityIcon activity={activity} theme={theme} color={appearance.color} size={32}/>
                  <Text style={[styles.actionLabel,{color:theme.text}]}>{activityLabel(activity)}</Text>
                </Pressable>;
              })}
            </View>
            {practice&&colors?<View testID="onboarding.demo.row" accessible accessibilityLabel={t('tour.practiceAdded',{activity:activityLabel({type:practice})})} style={[styles.practiceRow,{backgroundColor:colors.softColor}]}>
              <MaterialCommunityIcons accessible={false} name="check-circle-outline" size={23} color={colors.color}/>
              <Text style={[styles.practiceText,{color:theme.text}]}>{t('tour.practiceAdded',{activity:activityLabel({type:practice})})}</Text>
            </View>:null}
          </Animated.View>
        </>:null}

        {step===1?<View style={[styles.card,styles.example,card]}>
          <View style={styles.clockHeader}>{!largeText?<Text style={[styles.day,{color:theme.textMuted}]}/>:null}<View style={styles.track}>{['06','12','18'].map(hour=><Text key={hour} style={[styles.hour,{color:theme.textMuted}]}>{hour}</Text>)}</View></View>
          {(['onboarding.todayPreview','onboarding.timelineYesterday','onboarding.timelineEarlier'] as const).map((day,index)=>{
            const marks=[{type:'pee' as const,position:22+index*3},{type:'meal' as const,position:48},...(index===0&&practice?[{type:practice,position:77}]:[{type:'walk' as const,position:75-index*2}])];
            return <View key={day} testID={index===0?'onboarding.demo.timeline.today':undefined} accessibilityLabel={t(day)} style={[styles.dayRow,largeText&&styles.largeDayRow]}>
              <Text style={[styles.day,largeText&&styles.largeDayLabel,{color:theme.text}]}>{t(day)}</Text>
              <View style={[styles.track,styles.trackLine,largeText&&styles.largeTrack,{backgroundColor:theme.surface,borderColor:theme.border}]}>
                {[25,50,75].map(position=><View key={position} style={[styles.gridLine,{left:`${position}%`,backgroundColor:theme.border}]}/>)}
                {marks.map(({type,position},mark)=><View key={mark} accessible accessibilityLabel={activityLabel({type})} style={[styles.mark,{left:`${position}%`,backgroundColor:activityColors(theme,{type}).color}]}/>)}
              </View>
            </View>;
          })}
          <View style={styles.legend}>{(['pee','meal','walk'] as const).map(type=><View key={type} style={styles.legendItem}><ActivityIcon activity={{type}} theme={theme} color={activityColors(theme,{type}).color} size={18}/><Text style={[styles.legendText,{color:theme.textMuted}]}>{activityLabel({type})}</Text></View>)}</View>
        </View>:null}

        {step===2?<View style={[styles.card,styles.example,card]}>
          <View style={styles.walkRow}>
            <View style={[styles.walkIcon,{backgroundColor:theme.primarySoft}]}><ActivityIcon activity={{type:'walk'}} theme={theme} color={theme.primary} size={35}/></View>
            <View style={styles.flex}><Text style={[styles.cardTitle,headingStyle(theme),{color:theme.text}]}>{t('tour.exampleWalk')}</Text><Text style={[styles.body,{color:theme.textMuted}]}>{new Intl.DateTimeFormat(locale,{hour:'numeric',minute:'2-digit'}).format(new Date(2020,0,1,9,0))}</Text></View>
          </View>
          <View style={[styles.reminderRow,{borderColor:theme.border}]}>
            <Text style={[styles.reminderLabel,{color:theme.text}]}>{t('tour.practiceReminder')}</Text>
            <Switch testID="onboarding.demo.routine.reminder" accessibilityLabel={t('tour.practiceReminder')} value={practiceReminder} onValueChange={setPracticeReminder} trackColor={{true:theme.primary,false:theme.border}}/>
          </View>
          <View style={[styles.reminderPreview,{backgroundColor:theme.primarySoft}]}>
            <MaterialCommunityIcons accessible={false} name={practiceReminder?'bell-ring-outline':'bell-off-outline'} size={23} color={theme.primary}/>
            <Text style={[styles.flex,styles.body,{color:theme.text}]}>{t(practiceReminder?'tour.practiceReminderOn':'tour.practiceReminderOff')}</Text>
          </View>
        </View>:null}

        {step===3?<>
          {!replay?<>
            <TextInput testID="onboarding.name.input" accessibilityLabel={t('tour.nameLabel')} value={puppyName} onChangeText={setPuppyName} placeholder={t('tour.namePlaceholder')} placeholderTextColor={theme.textMuted} maxLength={256} autoCapitalize="words" autoCorrect={false} textContentType="none" returnKeyType="done" onSubmitEditing={Keyboard.dismiss} editable={!busy} style={[styles.nameInput,{color:theme.text,backgroundColor:theme.surfaceRaised,borderColor:theme.border,borderRadius:theme.presentation.controlRadius}]}/>
            <View style={[styles.notificationCard,card,largeText&&styles.largeNotification]}>
              <MaterialCommunityIcons accessible={false} name="bell-outline" color={theme.primary} size={25}/>
              <View style={[styles.flex,largeText&&styles.largeCopy]}><Text style={[styles.fieldLabel,{color:theme.text}]}>{t('tour.notificationsTitle')}</Text><Text style={[styles.small,{color:theme.textMuted}]}>{t(notificationPermission==='granted'?'tour.notificationsOn':'tour.notificationsOptional')}</Text></View>
              {notificationPermission!=='granted'?<Pressable testID="onboarding.notifications.allow" accessibilityRole="button" disabled={busy} onPress={()=>void allowNotifications()} style={[styles.allow,largeText&&styles.largeAllow]}><Text style={[styles.allowText,{color:theme.primary}]}>{t(notificationPermission==='blocked'?'schedule.openSettings':'tour.allow')}</Text></Pressable>:<MaterialCommunityIcons accessible={false} name="check-circle" color={theme.primary} size={25}/>}
            </View>
          </>:null}
        </>:null}
        {largeText?footer:null}
      </ScrollView>
      {!largeText?footer:null}
    </KeyboardAvoidingView>
  );
}

const styles=StyleSheet.create({
  backSlot:{height:44},
  largeTitle:{fontSize:25,lineHeight:31,letterSpacing:-0.3},largeActions:{flexDirection:'column'},largeAction:{flex:0,flexDirection:'row',justifyContent:'flex-start',gap:16,padding:16},largeDayRow:{flexDirection:'column',alignItems:'stretch',gap:10},largeDayLabel:{width:'100%'},largeTrack:{flex:0,width:'100%'},largeNotification:{flexDirection:'column',alignItems:'flex-start'},largeCopy:{flex:0},largeAllow:{maxWidth:'100%'},scrollFooter:{paddingHorizontal:0,marginTop:24},largeChoices:{flexDirection:'column'},
  root:{flex:1},flex:{flex:1},topBar:{minHeight:58,paddingHorizontal:spacing.lg,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{flexDirection:'row',alignItems:'center',gap:8},brandText:{fontSize:17},skip:{minWidth:55,minHeight:44,justifyContent:'center',alignItems:'flex-end'},skipText:{fontSize:15,fontWeight:'700'},
  progress:{flexDirection:'row',gap:6,marginHorizontal:spacing.lg,marginBottom:28},progressMark:{flex:1,height:4,borderRadius:4},content:{paddingHorizontal:spacing.lg,paddingBottom:24},title:{fontSize:36,lineHeight:43,letterSpacing:-0.9},body:{fontSize:16,lineHeight:23,marginTop:12},
  mascot:{width:'100%',marginBottom:20},card:{padding:18,borderWidth:1},practiceCard:{marginTop:30},actions:{flexDirection:'row',gap:8},action:{flex:1,minWidth:0,minHeight:118,borderWidth:1,alignItems:'center',justifyContent:'center',padding:8,gap:7},actionLabel:{fontSize:16,fontWeight:'700',textAlign:'center'},practiceRow:{marginTop:14,borderRadius:12,padding:12,flexDirection:'row',alignItems:'center',gap:10},practiceText:{fontSize:15,lineHeight:21,flex:1},
  example:{marginTop:30},clockHeader:{flexDirection:'row',marginTop:4,marginBottom:7},day:{width:76,fontSize:13,fontWeight:'700',paddingRight:6},track:{flex:1,flexDirection:'row',justifyContent:'space-around'},dayRow:{flexDirection:'row',alignItems:'center',marginVertical:10},trackLine:{height:40,borderWidth:1,borderRadius:9},gridLine:{position:'absolute',top:0,bottom:0,width:1},mark:{position:'absolute',top:10,width:8,height:18,borderRadius:4},hour:{fontSize:11},legend:{flexDirection:'row',flexWrap:'wrap',gap:16,marginTop:18},legendItem:{flexDirection:'row',alignItems:'center',gap:5},legendText:{fontSize:12},
  walkRow:{flexDirection:'row',alignItems:'center',gap:14,marginTop:2,marginBottom:22},walkIcon:{width:65,height:65,borderRadius:22,alignItems:'center',justifyContent:'center'},cardTitle:{fontSize:22,lineHeight:28},reminderRow:{borderTopWidth:1,paddingTop:18,flexDirection:'row',alignItems:'center',gap:15},reminderLabel:{flex:1,fontSize:16,lineHeight:23,fontWeight:'600'},reminderPreview:{marginTop:22,borderRadius:14,padding:14,flexDirection:'row',alignItems:'center',gap:12},
  fieldLabel:{fontSize:16,lineHeight:23,fontWeight:'700'},nameInput:{marginTop:8,minHeight:54,borderWidth:1,paddingHorizontal:16,paddingVertical:13,fontSize:18},notificationCard:{borderWidth:1,marginTop:20,padding:14,flexDirection:'row',alignItems:'center',gap:10},small:{fontSize:13,lineHeight:19,marginTop:3},allow:{minHeight:44,minWidth:44,justifyContent:'center',maxWidth:'35%'},allowText:{fontSize:14,lineHeight:20,fontWeight:'700'},
  footer:{paddingHorizontal:spacing.lg,paddingTop:13,paddingBottom:8,borderTopWidth:1},footerChoices:{flexDirection:'row',justifyContent:'space-between',gap:16},primary:{minHeight:54,paddingHorizontal:16,paddingVertical:15,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},primaryText:{fontSize:16,lineHeight:23,fontWeight:'800',flexShrink:1,textAlign:'center'},back:{minWidth:60,minHeight:44,alignItems:'center',justifyContent:'center',paddingVertical:10},backText:{fontSize:14,fontWeight:'700'},
});
