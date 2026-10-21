import {MaterialCommunityIcons} from '@expo/vector-icons';
import {useFonts} from 'expo-font';
import {StatusBar} from 'expo-status-bar';
import {useEffect,useRef,useState} from 'react';
import {
  ActivityIndicator,Image,Keyboard,KeyboardAvoidingView,Platform,Pressable,
  ScrollView,StyleSheet,Text,TextInput,View,useWindowDimensions,
} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';

import {STARTER_SCHEDULE,type ScheduleEntry} from '../domain';
import {LocalizationProvider} from '../localization-context';
import {lightTheme,type Theme} from '../theme';
import {ScheduleScreen} from './ScheduleScreen';

const theme:Theme={...lightTheme,background:'#FCFCF9',surface:'#FFFDF7',surfaceRaised:'#FFFDF7',
  text:'#243D2E',textMuted:'#53685A',border:'#CDD8CF',primary:'#176B52',onPrimary:'#FFFDF5',
  presentation:{...lightTheme.presentation,headingFont:'RedHatDisplayBold',titleWeight:'400',controlRadius:12,cardRadius:18}};
const mascots=[require('../../assets/mascots/scruffy-terrier.png'),
  require('../../assets/mascots/onboarding/scruffy-ball.png'),
  require('../../assets/mascots/onboarding/scruffy-grass.png'),
  require('../../assets/mascots/onboarding/scruffy-bone.png'),
  require('../../assets/mascots/onboarding/scruffy-roll.png')];

// This entry exercises real native inputs and the existing schedule editor,
// with component-local drafts only. It never opens account or storage services.
export function OnboardingDesignPreview(){
  const [fontsLoaded,fontError]=useFonts({
    RedHatDisplayBold:require('../../assets/fonts/RedHatDisplay-Bold.ttf'),
    RedHatText:require('../../assets/fonts/RedHatText-Regular.ttf'),
    RedHatTextSemiBold:require('../../assets/fonts/RedHatText-SemiBold.ttf'),
  });
  return <SafeAreaProvider><LocalizationProvider language="en">
    <StatusBar style="dark"/>
    {fontsLoaded||fontError?<PreviewFlow/>:<View style={styles.loading}><ActivityIndicator color={theme.primary}/></View>}
  </LocalizationProvider></SafeAreaProvider>;
}

function PreviewFlow(){
  const [step,setStep]=useState<'profile'|'schedule'|'done'>('profile');
  const [name,setName]=useState('');
  const [schedule,setSchedule]=useState<ScheduleEntry[]>(()=>STARTER_SCHEDULE.map(entry=>({...entry,reminder:false})));
  const [mascot]=useState(()=>mascots[Math.floor(Math.random()*mascots.length)]);
  const [keyboardVisible,setKeyboardVisible]=useState(Keyboard.isVisible());
  const scroll=useRef<ScrollView>(null);
  const {fontScale}=useWindowDimensions();
  useEffect(()=>{
    const show=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow',()=>setKeyboardVisible(true));
    const hide=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillHide':'keyboardDidHide',()=>setKeyboardVisible(false));
    return()=>{show.remove();hide.remove();};
  },[]);
  function next(){Keyboard.dismiss();setStep('schedule');}
  const brand=<View style={styles.brand}><Image source={require('../../assets/puptime-icon.png')} style={styles.icon}/><Text style={styles.brandName}>Puptime</Text></View>;
  const header=<View style={styles.header}>
    {step==='schedule'?<Pressable testID="preview.back" accessibilityRole="button" accessibilityLabel="Back to puppy name" onPress={()=>setStep('profile')} style={styles.back}>
      <MaterialCommunityIcons name="chevron-left" size={18} color={theme.textMuted}/><Text style={styles.backText}>Back</Text>
    </Pressable>:<View style={styles.back}/>}
    {brand}<Text style={styles.optional}>{step==='schedule'||step==='profile'?'Optional':''}</Text>
  </View>;
  const footer=(label:string,onPress:()=>void,skip:()=>void)=><View style={styles.footer}>
    <Pressable testID="preview.continue" accessibilityRole="button" onPress={onPress} style={({pressed})=>[styles.primary,pressed&&styles.pressed]}>
      <Text style={styles.primaryText}>{label}</Text><MaterialCommunityIcons name="arrow-right" size={20} color={theme.onPrimary}/>
    </Pressable>
    <Pressable testID="preview.skip" accessibilityRole="button" onPress={skip} style={styles.secondary}><Text style={styles.secondaryText}>Skip for now</Text></Pressable>
  </View>;
  return <SafeAreaView edges={['top','bottom','left','right']} style={styles.root}>
    <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.root}>
      {header}
      {step==='profile'?<>
        <ScrollView ref={scroll} testID="preview.profile" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.profileContent}>
          <Text accessibilityRole="header" style={styles.title}>Your puppy’s{fontScale<1.5?'\n':' '}name?</Text>
          {!keyboardVisible&&fontScale<1.5?<View style={styles.art}><Image source={mascot} accessible={false} resizeMode="contain" style={styles.mascot}/></View>:<View style={styles.keyboardSpace}/>}
          <View style={styles.nameField}>
            <TextInput testID="preview.name" accessibilityLabel="Puppy’s name, optional" value={name} onChangeText={setName}
              placeholder="e.g. Milo" placeholderTextColor={theme.textMuted} maxLength={256} autoCapitalize="words" autoCorrect={false}
              selectionColor={theme.primary} autoComplete="off" clearButtonMode="while-editing" returnKeyType="done" onSubmitEditing={Keyboard.dismiss}
              onFocus={()=>scroll.current?.scrollToEnd({animated:true})} style={styles.nameInput}/>
          </View>
        </ScrollView>
        {footer('Continue',next,()=>{setName('');next();})}
      </>:step==='schedule'?<>
        <View style={styles.schedule}>
          <ScheduleScreen theme={theme} events={[]} schedule={schedule} customActivities={[]}
            setupHeader={<View style={styles.scheduleHeader}>
              <Text accessibilityRole="header" style={styles.title}>Let’s set up{'\n'}your schedule.</Text>
              <View style={styles.learning}>
                <View style={styles.learningTitle}><MaterialCommunityIcons name="clock-outline" size={18} color={theme.primary}/><Text style={styles.learningHeading}>Let your logs lead</Text></View>
                <Text style={styles.learningBody}>Edit these starter times, or skip. Puptime can suggest times from your logs for you to review later.</Text>
              </View>
              <Text style={styles.starterLabel}>Starter schedule</Text>
            </View>}
            onChange={async nextSchedule=>setSchedule(nextSchedule)}
            onSaveEntry={async entry=>setSchedule(current=>[...current.filter(item=>item.id!==entry.id),entry].sort((a,b)=>a.minutes-b.minutes))}
            onRemoveEntry={async id=>setSchedule(current=>current.filter(item=>item.id!==id))}
            onRequestReminderPermission={async()=>false}/>
        </View>
        {footer('Use this schedule',()=>setStep('done'),()=>{setSchedule([]);setStep('done');})}
      </>:<View testID="preview.ready" style={styles.ready}>
        <MaterialCommunityIcons name="check-circle-outline" size={48} color={theme.primary}/>
        <Text accessibilityRole="header" style={styles.title}>Ready to go.</Text>
        <Text style={styles.learningBody}>{name.trim()||'Your puppy'}’s routine can change as you learn what works.</Text>
        <Pressable accessibilityRole="button" onPress={()=>setStep('schedule')} style={styles.secondary}><Text style={styles.secondaryText}>Back to schedule</Text></Pressable>
      </View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:theme.background},loading:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:theme.background},
  header:{minHeight:52,paddingHorizontal:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  brand:{flexDirection:'row',alignItems:'center',gap:7},icon:{width:28,height:28,borderRadius:7},brandName:{fontFamily:'RedHatDisplayBold',fontSize:20,color:theme.text,letterSpacing:-.5},
  back:{minWidth:62,minHeight:44,flexDirection:'row',alignItems:'center'},backText:{fontFamily:'RedHatText',fontSize:13,color:theme.textMuted},optional:{fontFamily:'RedHatText',fontSize:13,color:theme.textMuted,minWidth:62,textAlign:'right'},
  profileContent:{flexGrow:1,paddingHorizontal:22,paddingTop:22},title:{fontFamily:'RedHatDisplayBold',fontSize:34,lineHeight:38,letterSpacing:-.8,color:theme.text},
  art:{flex:1,minHeight:140,alignItems:'center',justifyContent:'center',marginTop:12},mascot:{width:'100%',height:'100%',maxHeight:300,minHeight:140},keyboardSpace:{flexGrow:1,minHeight:16},
  nameField:{paddingTop:18,paddingBottom:20},
  nameInput:{fontFamily:'RedHatText',fontSize:27,minHeight:60,paddingVertical:10,borderBottomWidth:2,borderBottomColor:theme.primary,color:theme.text},
  footer:{paddingHorizontal:22,paddingTop:18,paddingBottom:2,backgroundColor:theme.background},primary:{minHeight:52,paddingHorizontal:16,paddingVertical:12,borderRadius:999,backgroundColor:theme.primary,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},
  primaryText:{fontFamily:'RedHatTextSemiBold',fontSize:15,color:theme.onPrimary},pressed:{opacity:.75},secondary:{minHeight:44,alignItems:'center',justifyContent:'center',paddingVertical:8,marginTop:4},secondaryText:{fontFamily:'RedHatText',fontSize:14,color:theme.textMuted},
  schedule:{flex:1},scheduleHeader:{gap:24},learning:{padding:18,borderRadius:18,backgroundColor:'#E7EFE7',gap:8},learningTitle:{flexDirection:'row',gap:8,alignItems:'center'},learningHeading:{fontFamily:'RedHatTextSemiBold',fontSize:14,color:theme.text},learningBody:{fontFamily:'RedHatText',fontSize:13,lineHeight:20,color:theme.textMuted},starterLabel:{fontFamily:'RedHatTextSemiBold',fontSize:15,color:theme.text,marginTop:4},
  ready:{flex:1,padding:24,justifyContent:'center',gap:24},
});
