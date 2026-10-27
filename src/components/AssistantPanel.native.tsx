import {MaterialCommunityIcons} from '@expo/vector-icons';
import {ExpoSpeechRecognitionModule,useSpeechRecognitionEvent} from 'expo-speech-recognition';
import * as Speech from 'expo-speech';
import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Keyboard,KeyboardAvoidingView,Platform,ScrollView,StyleSheet,Switch,Text,TextInput,View} from 'react-native';
import {Pressable} from './TelemetryPressable';
import {SafeAreaView} from 'react-native-safe-area-context';
import {assistantNeedsReview,describeAssistantAction,type AssistantPlan,type AssistantRequest} from '../assistant';
import {assistantCopy} from '../assistant-copy';
import {CloudApiError} from '../cloud/api';
import {entityId} from '../entity-id';
import {getLocalRuntime} from '../local/runtime.native';
import {useLocalization} from '../localization-context';
import {useTelemetryOverlay} from '../telemetry';
import type {AssistantPanelProps} from './assistant-panel-props';

type Message={role:'user'|'assistant';text:string};
type Pending={commandId:string;plan:AssistantPlan;context:AssistantRequest};

export function AssistantPanel({theme,cloud,onClose,onCommitted,onNavigate}:AssistantPanelProps){
  useTelemetryOverlay('assistant',true);
  const {language,locale}=useLocalization(),copy=assistantCopy[language];
  const [accepted,setAccepted]=useState(false),[confirm,setConfirm]=useState(true),[ready,setReady]=useState(false);
  const [availability,setAvailability]=useState<'loading'|'ready'|'auth'|'configuration'|'error'>('loading');
  const [draft,setDraft]=useState(''),[messages,setMessages]=useState<Message[]>([]),[pending,setPending]=useState<Pending|null>(null);
  const [phase,setPhase]=useState<'idle'|'planning'|'saving'>('idle'),[error,setError]=useState<string|null>(null);
  const [listening,setListening]=useState(false),[voice,setVoice]=useState(false),[spoken,setSpoken]=useState(true);
  const [undoId,setUndoId]=useState<string|null>(null),[puppyName,setPuppyName]=useState('');
  const active=useRef(true),busy=useRef(false),voiceRef=useRef(false),spokenRef=useRef(true),recognizing=useRef(false),recognitionStarting=useRef(false);
  const saving=useRef(false);
  const transcript=useRef(''),sendAfterEnd=useRef(false),request=useRef<AbortController|null>(null),generation=useRef(0);
  const history=useRef<Message[]>([]),pendingRef=useRef<Pending|null>(null),confirmRef=useRef(true),scroll=useRef<ScrollView>(null);
  const sendRef=useRef<(text:string)=>Promise<void>>(async()=>{}),startRef=useRef<()=>Promise<void>>(async()=>{});
  confirmRef.current=confirm;pendingRef.current=pending;spokenRef.current=spoken;
  const add=(message:Message)=>{history.current=[...history.current,message].slice(-40);setMessages(history.current);};
  const stopVoice=()=>{
    voiceRef.current=false;recognitionStarting.current=false;setVoice(false);sendAfterEnd.current=false;recognizing.current=false;setListening(false);
    ExpoSpeechRecognitionModule.abort();void Speech.stop();
  };
  const reply=(text:string)=>{
    if(!active.current)return;
    add({role:'assistant',text});
    if(!voiceRef.current)return;
    if(!spokenRef.current){void startRef.current();return;}
    const resume=()=>{if(active.current&&voiceRef.current)void startRef.current();};
    // A speech failure must not turn a committed write into a save failure.
    const speechFailed=()=>{if(active.current){setSpoken(false);resume();}};
    try{Speech.speak(text.slice(0,Speech.maxSpeechInputLength),{language:locale,onDone:resume,onError:speechFailed,onStopped:resume});}
    catch{speechFailed();}
  };
  const checkAvailability=async(signal?:AbortSignal)=>{
    setAvailability('loading');
    if(!cloud.assistant){setAvailability('configuration');return;}
    try{const status=await cloud.assistant.status(signal);if(active.current&&!signal?.aborted)setAvailability(status.available?'ready':'configuration');}
    catch(error){if(active.current&&!signal?.aborted)setAvailability(error instanceof CloudApiError&&error.status===401?'auth':'error');}
  };
  useEffect(()=>{
    const aborter=new AbortController();active.current=true;
    void (async()=>{
      try{const runtime=await getLocalRuntime(),[mode,name,last]=await Promise.all([runtime.assistant.confirmation(),runtime.storage.loadPuppyName(),runtime.assistant.lastResult()]);if(active.current){setConfirm(mode);setPuppyName(name);setUndoId(last&&!last.undone?last.commandId:null);setReady(true);}}
      catch{if(active.current)setError(copy.readError);}
    })();
    void checkAvailability(aborter.signal);
    const subscription=AppState.addEventListener('change',state=>{if(state==='background'){generation.current++;request.current?.abort();stopVoice();if(!saving.current){busy.current=false;setPhase('idle');}}});
    return()=>{active.current=false;generation.current++;aborter.abort();request.current?.abort();voiceRef.current=false;sendAfterEnd.current=false;ExpoSpeechRecognitionModule.abort();void Speech.stop();subscription.remove();};
  },[cloud.assistant]);

  const startListening=async()=>{
    if(!active.current||!voiceRef.current||busy.current||recognizing.current||recognitionStarting.current)return;
    recognitionStarting.current=true;
    try{
      if(!ExpoSpeechRecognitionModule.isRecognitionAvailable())throw new Error();
      const permission=await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if(!active.current||!voiceRef.current)return;
      if(!permission.granted)throw new Error();
      transcript.current='';sendAfterEnd.current=true;recognizing.current=true;setListening(true);setError(null);
      ExpoSpeechRecognitionModule.start({lang:locale,interimResults:true,continuous:false,addsPunctuation:true,contextualStrings:[puppyName,'pee','poop','meal','nap','confirm','cancel']});
    }catch{if(active.current){stopVoice();setError(copy.micError);}}
    finally{recognitionStarting.current=false;}
  };
  startRef.current=startListening;
  useSpeechRecognitionEvent('result',event=>{
    if(!active.current||!recognizing.current)return;
    const text=event.results[0]?.transcript?.trim();
    if(text){transcript.current=text;setDraft(text.slice(0,2000));}
  });
  useSpeechRecognitionEvent('end',()=>{
    recognizing.current=false;if(active.current)setListening(false);
    const text=transcript.current;transcript.current='';const send=sendAfterEnd.current;sendAfterEnd.current=false;
    if(active.current&&voiceRef.current&&send){if(text)void sendRef.current(text);else stopVoice();}
  });
  useSpeechRecognitionEvent('error',event=>{
    if(!active.current||event.error==='aborted')return;
    stopVoice();setError(copy.micError);
  });

  const commit=async(item:Pending)=>{
    if(busy.current)return;
    busy.current=true;saving.current=true;setPhase('saving');setError(null);sendAfterEnd.current=false;ExpoSpeechRecognitionModule.abort();
    try{
      const result=await (await getLocalRuntime()).assistant.execute(item.commandId,item.plan,item.context);
      await onCommitted();
      if(!active.current)return;
      setConfirm(result.confirmationAfter);setPending(null);pendingRef.current=null;
      if(result.changes.length||result.confirmationBefore!==result.confirmationAfter)setUndoId(result.commandId);
      const detail=item.plan.actions.map(action=>describeAssistantAction(action,item.context.puppy.name,locale)).join('\n');
      // Release before speaking so the next voice turn can start on completion.
      busy.current=false;setPhase('idle');
      const destination=item.plan.actions.filter(action=>action.kind==='navigate').at(-1);
      if(destination?.kind==='navigate'){stopVoice();onNavigate(destination.screen);return;}
      reply(`${result.changes.length?copy.saved:copy.done}${detail?'\n'+detail:''}`);
    }catch{if(active.current){setPending(item);setError(copy.saveFailed);stopVoice();}}
    finally{busy.current=false;saving.current=false;if(active.current)setPhase('idle');}
  };
  const cancel=()=>{setPending(null);pendingRef.current=null;setDraft('');setError(null);reply(copy.cancelled);};
  const sendText=async(raw:string)=>{
    const text=raw.trim();if(!text||busy.current||!accepted||!ready||availability!=='ready')return;
    const word=text.toLowerCase().replace(/[.!。！]/g,'').trim();
    if(pendingRef.current&&['confirm','yes','yes please','save','确认','保存','是','confirmar','sí','si','guardar'].includes(word)){setDraft('');await commit(pendingRef.current);return;}
    if(pendingRef.current&&['cancel','no','取消','不','cancelar'].includes(word)){cancel();return;}
    if(undoId&&['undo','undo that','撤销','deshacer'].includes(word)){setDraft('');await undo();return;}
    const previous=history.current.slice(-10).map(message=>({...message,text:message.text.slice(0,2000)})),attempt=++generation.current;
    busy.current=true;setPhase('planning');setError(null);setPending(null);pendingRef.current=null;
    sendAfterEnd.current=false;ExpoSpeechRecognitionModule.abort();add({role:'user',text});
    const aborter=new AbortController();request.current=aborter;
    try{
      const runtime=await getLocalRuntime(),[profile,page,customActivities,mode]=await Promise.all([runtime.storage.loadPuppyProfile(),runtime.activity.eventsPage({limit:30}),runtime.storage.loadCustomActivities(),runtime.assistant.confirmation()]);
      const context:AssistantRequest={text,now:Date.now(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,locale,puppy:{id:runtime.petId,name:profile.name},recentEvents:page.events.map(({source,...event})=>({...event,...(event.note?{note:event.note.slice(0,300)}:{})})),customActivities,confirmBeforeSaving:mode,conversation:previous};
      while(new TextEncoder().encode(JSON.stringify(context)).byteLength>60000&&context.conversation.length)context.conversation.shift();
      const plan=await cloud.assistant!.plan(context,aborter.signal);
      if(!active.current||attempt!==generation.current)return;
      setDraft('');setConfirm(mode);
      const item={commandId:entityId('cmd'),plan,context};
      busy.current=false;setPhase('idle');
      if(!plan.actions.length){reply(plan.reply);return;}
      if(assistantNeedsReview(plan,mode)){
        setPending(item);pendingRef.current=item;
        reply(`${plan.reply}\n${plan.actions.map(action=>describeAssistantAction(action,profile.name,locale)).join('\n')}\n${copy.reviewPrompt}`);
      }else await commit(item);
    }catch(error){
      if(active.current&&attempt===generation.current&&!aborter.signal.aborted){
        stopVoice();
        if(error instanceof CloudApiError&&error.status===401)setAvailability('auth');
        setError(error instanceof CloudApiError&&error.status===429?copy.rateLimited:copy.failed);
      }
    }finally{if(attempt===generation.current){busy.current=false;if(active.current)setPhase('idle');}}
  };
  sendRef.current=sendText;
  async function undo(){
    if(!undoId||busy.current)return;
    busy.current=true;saving.current=true;setPhase('saving');setError(null);
    try{await (await getLocalRuntime()).assistant.undo(undoId);await onCommitted();const mode=await (await getLocalRuntime()).assistant.confirmation();if(active.current){setConfirm(mode);setUndoId(null);busy.current=false;reply(copy.undone);}}
    catch{if(active.current){stopVoice();setError(copy.undoFailed);}}
    finally{busy.current=false;saving.current=false;if(active.current)setPhase('idle');}
  }
  const changeMode=async(enabled:boolean)=>{
    if(busy.current||pending)return;
    try{await (await getLocalRuntime()).assistant.setConfirmation(enabled);if(active.current)setConfirm(enabled);}
    catch{if(active.current)setError(copy.readError);}
  };
  const button=(label:string,onPress:()=>void,testID:string,primary=false,disabled=false)=><Pressable testID={testID} accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.button,{backgroundColor:primary?theme.primary:theme.surfaceRaised,borderColor:theme.border,opacity:disabled?.45:pressed?.75:1}]}><Text style={[styles.buttonText,{color:primary?theme.onPrimary:theme.text}]}>{label}</Text></Pressable>;
  const busyNow=phase!=='idle',enabled=ready&&availability==='ready'&&accepted;
  return <SafeAreaView style={[styles.container,{backgroundColor:theme.background}]} testID="assistant.screen">
    <View style={[styles.header,{borderBottomColor:theme.border}]}>
      <Text accessibilityRole="header" style={[styles.title,{color:theme.text}]}>{copy.title}</Text>
      <Pressable testID="assistant.close" accessibilityRole="button" accessibilityLabel={copy.close} disabled={phase==='saving'} onPress={()=>{stopVoice();onClose();}} style={styles.iconButton}><MaterialCommunityIcons accessible={false} name="close" size={25} color={theme.text}/></Pressable>
    </View>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={Platform.OS==='ios'?64:0}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" onContentSizeChange={()=>scroll.current?.scrollToEnd({animated:false})}>
        <View style={[styles.mode,{borderColor:theme.border}]}>
          <View style={styles.flex}><Text style={[styles.modeTitle,{color:theme.text}]}>{copy.review}</Text><Text style={[styles.small,{color:theme.textMuted}]}>{copy.reviewDetail}</Text></View>
          <Switch testID="assistant.confirmation" accessibilityLabel={copy.review} disabled={!ready||busyNow||!!pending||voice} value={confirm} onValueChange={enabled=>void changeMode(enabled)} trackColor={{true:theme.primary}}/>
        </View>
        {!accepted?<View style={[styles.notice,{backgroundColor:theme.surface,borderColor:theme.border}]}>
          <MaterialCommunityIcons accessible={false} name="microphone-outline" size={34} color={theme.primary}/>
          <Text style={[styles.intro,{color:theme.text}]}>{copy.consentTitle}</Text>
          <Text style={[styles.body,{color:theme.textMuted}]}>{copy.privacy}</Text>
          <Text style={[styles.small,{color:theme.textMuted}]}>{copy.consentNote}</Text>
          {button(copy.continue,()=>setAccepted(true),'assistant.accept',true)}
        </View>:null}
        {availability==='loading'?<View style={styles.row}><ActivityIndicator color={theme.primary}/><Text style={[styles.body,{color:theme.textMuted}]}>{copy.loading}</Text></View>:availability!=='ready'?<View style={[styles.notice,{backgroundColor:theme.surface,borderColor:theme.border}]}>
          <Text accessibilityRole="alert" style={[styles.body,{color:theme.text}]}>{availability==='auth'?copy.signIn:availability==='configuration'?copy.configuration:copy.unavailable}</Text>
          {availability==='auth'?button(copy.account,()=>onNavigate('account'),'assistant.account'):button(copy.retry,()=>void checkAvailability(),'assistant.retry')}
        </View>:null}
        {accepted&&messages.length===0?<View style={styles.welcome}>
          <Text style={[styles.intro,{color:theme.text}]}>{copy.intro}</Text><Text style={[styles.body,{color:theme.textMuted}]}>{copy.examples}</Text>
          {[copy.exampleLog,copy.exampleNote,copy.exampleNavigate].map((example,index)=><Pressable key={example} testID={`assistant.example.${index}`} accessibilityRole="button" disabled={!enabled||busyNow||voice} onPress={()=>setDraft(example)} style={[styles.example,{borderColor:theme.border,backgroundColor:theme.surface}]}><Text style={[styles.body,{color:theme.primary}]}>{example}</Text><MaterialCommunityIcons accessible={false} name="arrow-top-left" size={18} color={theme.primary}/></Pressable>)}
        </View>:null}
        {messages.map((message,index)=><View key={index} style={[styles.message,{alignSelf:message.role==='user'?'flex-end':'flex-start',backgroundColor:message.role==='user'?theme.primarySoft:theme.surface,borderColor:theme.border}]}><Text selectable style={[styles.body,{color:theme.text}]}>{message.text}</Text></View>)}
        {pending?<View testID="assistant.review" style={[styles.notice,{backgroundColor:theme.surface,borderColor:theme.primary}]}>
          <View style={styles.row}>{button(copy.confirm,()=>{Keyboard.dismiss();void commit(pending);},'assistant.confirm',true,busyNow)}{button(copy.cancel,cancel,'assistant.cancel',false,busyNow)}</View>
        </View>:null}
        {busyNow?<View style={styles.row}><ActivityIndicator color={theme.primary}/><Text accessibilityLiveRegion="polite" style={[styles.body,{color:theme.textMuted}]}>{phase==='saving'?copy.saving:copy.thinking}</Text></View>:null}
        {error?<Text testID="assistant.error" accessibilityRole="alert" style={[styles.body,{color:theme.danger}]}>{error}</Text>:null}
        {undoId?button(copy.undo,()=>void undo(),'assistant.undo',false,busyNow):null}
      </ScrollView>
      <View style={[styles.composer,{backgroundColor:theme.surface,borderTopColor:theme.border}]}>
        {voice?<Text accessibilityLiveRegion="polite" style={[styles.small,{color:theme.primary}]}>{listening?copy.listening:copy.voiceReady}</Text>:null}
        <TextInput testID="assistant.input" accessibilityLabel={copy.input} value={draft} onChangeText={setDraft} placeholder={copy.placeholder} placeholderTextColor={theme.textMuted} editable={enabled&&!busyNow&&!voice} autoCorrect={false} multiline maxLength={2000} style={[styles.input,{color:theme.text,backgroundColor:theme.background,borderColor:theme.border}]}/>
        <View style={styles.row}>
          <Pressable testID="assistant.voice" accessibilityRole="button" accessibilityLabel={voice?copy.stop:copy.voice} accessibilityState={{selected:voice,disabled:!enabled||(busyNow&&!voice)}} disabled={!enabled||(busyNow&&!voice)} onPress={()=>{Keyboard.dismiss();if(voice)stopVoice();else{voiceRef.current=true;setVoice(true);void startListening();}}} style={[styles.iconButton,{borderRadius:16,backgroundColor:voice?theme.dangerSoft:theme.primarySoft}]}><MaterialCommunityIcons accessible={false} name={voice?'stop':'microphone-outline'} size={25} color={voice?theme.danger:theme.primary}/></Pressable>
          <Pressable testID="assistant.speaker" accessibilityRole="button" accessibilityLabel={copy.speaker} accessibilityState={{selected:spoken}} onPress={()=>{setSpoken(!spoken);if(spoken)void Speech.stop();}} style={styles.iconButton}><MaterialCommunityIcons accessible={false} name={spoken?'volume-high':'volume-off'} size={24} color={theme.textMuted}/></Pressable>
          <View style={styles.flex}/>{button(copy.send,()=>{Keyboard.dismiss();void sendText(draft);},'assistant.send',true,!enabled||busyNow||voice||!draft.trim())}
        </View>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  container:{flex:1},flex:{flex:1},header:{minHeight:64,paddingHorizontal:20,paddingVertical:6,flexDirection:'row',alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth},title:{fontSize:22,fontWeight:'700',flex:1},
  content:{width:'100%',maxWidth:720,alignSelf:'center',padding:20,gap:16,paddingBottom:24},row:{flexDirection:'row',alignItems:'center',gap:12,flexWrap:'wrap'},
  mode:{flexDirection:'row',alignItems:'center',gap:12,paddingBottom:16,borderBottomWidth:StyleSheet.hairlineWidth},modeTitle:{fontSize:16,lineHeight:23,fontWeight:'600'},small:{fontSize:13,lineHeight:19},body:{fontSize:16,lineHeight:24},
  notice:{padding:20,borderWidth:1,borderRadius:22,gap:14},intro:{fontSize:25,lineHeight:32,fontWeight:'700'},welcome:{gap:12,paddingVertical:12},example:{padding:14,borderWidth:1,borderRadius:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  message:{padding:16,borderWidth:1,borderRadius:20,maxWidth:'94%'},button:{minHeight:48,paddingHorizontal:18,paddingVertical:12,borderRadius:16,borderWidth:1,alignItems:'center',justifyContent:'center'},buttonText:{fontSize:16,lineHeight:23,fontWeight:'600'},iconButton:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},
  composer:{paddingHorizontal:20,paddingVertical:12,borderTopWidth:StyleSheet.hairlineWidth,gap:10},input:{minHeight:52,maxHeight:120,paddingHorizontal:14,paddingVertical:12,borderRadius:16,borderWidth:1,fontSize:16,lineHeight:23,textAlignVertical:'top'},
});
