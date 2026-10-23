import {MaterialCommunityIcons} from '@expo/vector-icons';
import {StatusBar} from 'expo-status-bar';
import {memo,useCallback,useEffect,useMemo,useState} from 'react';
import {Alert,BackHandler,FlatList,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Switch,Text as NativeText,TextInput,View,useWindowDimensions,type TextProps} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {ActivityCsvSettings} from '../components/ActivityCsvSettings';
import {ActivityIcon} from '../components/ActivityIcon';
import {SideNavigation,type AppTab} from '../components/SideNavigation';
import {NotificationTimingControls} from '../components/NotificationTimingControls';
import {LocalizationProvider,useLocalization} from '../localization-context';
import {createEvent,formatTime,type EventType,type PuppyEvent,type ScheduleEntry} from '../domain';
import {entityId} from '../entity-id';
import {DEFAULT_NOTIFICATION_PREFERENCES,type NotificationPreferences} from '../notification-config';
import {householdLogs,multiPetFixtures,type PetLog,type PreviewPet} from '../multi-pet-preview';
import {darkTheme,lightTheme,type Theme} from '../theme';
import {TimelineScreen} from './TimelineScreen';
import {InsightsScreen} from './InsightsScreen';
import {ScheduleScreen} from './ScheduleScreen';
import {LearnScreen} from './LearnScreen';

type IconName=keyof typeof MaterialCommunityIcons.glyphMap;
const emptyActivities:string[]=[];
// Keep large system text useful in compact controls; body copy still doubles.
function Text(props:TextProps){return <NativeText maxFontSizeMultiplier={2} {...props}/>;}
function Icon({name,theme,size=24}:{name:IconName;theme:Theme;size?:number}){
  return <MaterialCommunityIcons accessible={false} accessibilityElementsHidden importantForAccessibility="no" name={name} color={theme.primary} size={size}/>;
}
function Action({label,onPress,theme,icon,testID}:{label:string;onPress:()=>void;theme:Theme;icon?:IconName;testID?:string}){
  return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({pressed})=>[s.action,label==='Done'&&{minWidth:76,flexShrink:0},{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised,borderColor:theme.border}]}>
    {icon?<Icon name={icon} theme={theme}/>:null}<Text maxFontSizeMultiplier={1.5} style={[s.actionText,{color:theme.primary}]}>{label}</Text>
  </Pressable>;
}
function Avatar({pet,theme}:{pet:Pick<PreviewPet,'name'>;theme:Theme}){
  return <View accessible={false} style={[s.avatar,{backgroundColor:theme.primarySoft}]}><Text maxFontSizeMultiplier={1} style={[s.initial,{color:theme.primary}]}>{Array.from(pet.name).slice(0,2).join('').toLocaleUpperCase()}</Text></View>;
}

// This row never receives the editor's draft state. The probe-only entry point
// observes its renders on Android without changing production components.
const PetHistoryRow=memo(function PetHistoryRow({petId,petName,event,theme,onEdit,onRowRender}:{petId:string;petName:string;event:PuppyEvent;theme:Theme;onEdit:(petId:string,event:PuppyEvent)=>void;onRowRender?:(key:string)=>void}){
  onRowRender?.(`${petId}:${event.id}`);
  const {eventPastLabel,activityColors}=useLocalization(),colors=activityColors(theme,event);
  return <Pressable testID={`preview.event.${petId}.${event.id}`} accessibilityRole="button" accessibilityLabel={`Edit ${petName}, ${eventPastLabel(event)}, ${formatTime(event.at)}`} onPress={()=>onEdit(petId,event)}
    style={({pressed})=>[s.historyRow,{borderBottomColor:theme.border,backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised}]}>
    <View style={[s.activityIcon,{backgroundColor:colors.softColor}]}><ActivityIcon activity={event} theme={theme} color={colors.color} size={22}/></View>
    <View style={s.flex}><Text style={[s.petLabel,{color:theme.primary}]}>{petName}</Text><Text style={[s.body,{color:theme.text}]}>{eventPastLabel(event)}</Text>
      {event.note?<Text numberOfLines={2} style={[s.small,{color:theme.textMuted}]}>{event.note}</Text>:null}
      <Text style={[s.small,{color:theme.textMuted}]}>{new Intl.DateTimeFormat('en',{month:'short',day:'numeric'}).format(event.at)} · {formatTime(event.at)}</Text>
    </View><Icon name="pencil-outline" theme={theme} size={20}/>
  </Pressable>;
});

function EventEditor({pet,event,theme,onClose,onSave}:{pet:PreviewPet;event:PuppyEvent;theme:Theme;onClose:()=>void;onSave:(note:string)=>void}){
  const [note,setNote]=useState(event.note??'');
  const {eventPastLabel}=useLocalization();
  return <Modal visible animationType="none" onRequestClose={onClose} presentationStyle="pageSheet">
    <SafeAreaView style={[s.flex,{backgroundColor:theme.background}]}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS==='ios'?'padding':'height'}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
          <View style={s.line}><Action label="Cancel" onPress={onClose} theme={theme}/><View style={s.flex}/><Action testID="preview.editor.save" label="Save" onPress={()=>onSave(note)} theme={theme}/></View>
          <View style={s.line}><Avatar pet={pet} theme={theme}/><Text style={[s.heading,{color:theme.text}]}>{pet.name}</Text></View>
          <Text accessibilityRole="header" style={[s.title,{color:theme.text}]}>{eventPastLabel(event)}</Text>
          <Text style={[s.body,{color:theme.textMuted}]}>{new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short'}).format(event.at)}</Text>
          <Text accessibilityRole="header" style={[s.heading,{color:theme.text}]}>Note</Text>
          <TextInput testID="preview.editor.note" accessibilityLabel="Note" multiline value={note} onChangeText={setNote} style={[s.input,{minHeight:140,textAlignVertical:'top',color:theme.text,backgroundColor:theme.surfaceRaised,borderColor:theme.border}]}/>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

export function MultiPetDesignPreview({onRowRender}:{onRowRender?:(key:string)=>void}={}){
  return <SafeAreaProvider><LocalizationProvider language="en"><Preview onRowRender={onRowRender}/></LocalizationProvider></SafeAreaProvider>;
}
function Preview({onRowRender}:{onRowRender?:(key:string)=>void}){
  const [pets,setPets]=useState(multiPetFixtures),[selected,setSelected]=useState('pet_preview_0');
  const [tab,setTab]=useState<AppTab>('log'),[settings,setSettings]=useState(false),[drawer,setDrawer]=useState(false);
  const [navigationHistory,setNavigationHistory]=useState<Array<AppTab|'settings'>>([]);
  const [picker,setPicker]=useState(false),[manage,setManage]=useState(false),[dark,setDark]=useState(false);
  const [naming,setNaming]=useState<{id?:string;value:string}|null>(null),[nameError,setNameError]=useState<string|null>(null);
  const [filter,setFilter]=useState<string>(),[editor,setEditor]=useState<{petId:string;event:PuppyEvent}|null>(null);
  const [toast,setToast]=useState<{petId:string;event:PuppyEvent;label:string}|null>(null);
  const [preferences,setPreferences]=useState<Record<string,NotificationPreferences>>({});
  const [delivery,setDelivery]=useState(true),[widget,setWidget]=useState(false),[widgetPet,setWidgetPet]=useState('pet_preview_0');
  const theme=dark?darkTheme:lightTheme,pet=pets.find(item=>item.id===selected)??pets[0];
  const {activityLabel,activityColors,relativeTime,t}=useLocalization(),{width,fontScale}=useWindowDimensions();
  const narrow=width<380||fontScale>1.3;
  const logs=useMemo(()=>householdLogs(pets,filter),[pets,filter]);
  const openEditor=useCallback((petId:string,event:PuppyEvent)=>setEditor({petId,event}),[]);
  const renderRow=useCallback(({item}:{item:PetLog})=><PetHistoryRow {...item} theme={theme} onEdit={openEditor} onRowRender={onRowRender}/>,[theme,openEditor,onRowRender]);
  function navigate(next:AppTab){setTab(next);setSettings(false);setDrawer(false);setToast(null);setNavigationHistory([]);}
  function openTab(next:AppTab){setNavigationHistory(history=>[...history,settings?'settings':tab]);setTab(next);setSettings(false);setDrawer(false);}
  function goBack(){const previous=navigationHistory.at(-1);setNavigationHistory(history=>history.slice(0,-1));setSettings(previous==='settings');if(previous!=='settings')setTab(previous??'log');}
  useEffect(()=>{
    const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{
      if(drawer){setDrawer(false);return true;}
      if(settings||navigationHistory.length){goBack();return true;}
      if(tab!=='log'){navigate('log');return true;}
      return false;
    });
    return()=>subscription.remove();
  },[drawer,settings,navigationHistory,tab]);
  function updatePet(id:string,change:Partial<PreviewPet>){setPets(current=>current.map(item=>item.id===id?{...item,...change}:item));}
  async function changeSchedule(schedule:ScheduleEntry[]){updatePet(pet.id,{schedule});}
  function logFor(target:PreviewPet,type:EventType){
    const event=createEvent(type,'app');updatePet(target.id,{events:[event,...target.events]});
    setToast({petId:target.id,event,label:`${activityLabel(event)} logged for ${target.name}`});
  }
  const card={backgroundColor:theme.surfaceRaised,borderColor:theme.border};
  const title=(text:string)=><Text maxFontSizeMultiplier={1.5} accessibilityRole="header" style={[s.title,{color:theme.text}]}>{text}</Text>;
  const section=(text:string)=><Text accessibilityRole="header" style={[s.heading,{color:theme.text}]}>{text}</Text>;
  const petActions=(target:PreviewPet)=><View key={target.id} style={[s.petCard,card]}>
    <View style={s.line}><Avatar pet={target} theme={theme}/><View style={s.flex}><Text style={[s.petName,{color:theme.text}]}>{target.name}</Text><Text style={[s.small,{color:theme.textMuted}]}>{target.detail||'No logs yet'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`More activities for ${target.name}`} style={s.iconButton} onPress={()=>Alert.alert(target.name,'Sample activities',(['walk','nap'] as const).map(type=>({text:activityLabel({type}),onPress:()=>logFor(target,type)})).concat([{text:'Cancel',onPress:()=>{}}]))}><Icon name="plus" theme={theme}/></Pressable>
    </View>
    <View style={[s.line,{alignItems:'stretch'}]}>{(['pee','poop','meal'] as const).map(type=>{
      const colors=activityColors(theme,{type}),latest=target.events.find(event=>event.type===type);
      return <Pressable key={type} testID={`preview.quick.${target.id}.${type}`} accessibilityRole="button" accessibilityLabel={`Log ${activityLabel({type})} for ${target.name}`} onPress={()=>logFor(target,type)}
        style={({pressed})=>[s.quick,{backgroundColor:pressed?theme.primarySoft:theme.surface,borderColor:theme.border}]}>
        <View style={[s.quickLabel,narrow&&s.column]}><ActivityIcon activity={{type}} theme={theme} color={colors.color} size={21}/><Text style={[s.actionText,{color:theme.text}]}>{activityLabel({type})}</Text></View>
        <Text style={[s.small,{color:theme.textMuted}]}>{latest?relativeTime(latest.at):'No logs yet'}</Text>
      </Pressable>;
    })}</View>
  </View>;

  const logHeader=<View style={s.stack}>
    <View style={s.line}><View style={s.flex}/><Action label={`${pets.length} pets`} icon="paw-outline" theme={theme} onPress={()=>setManage(true)} testID="preview.pets"/></View>
    {pets.map(petActions)}
    <View style={s.line}>{section('History')}<View style={s.flex}/><Action testID="preview.filter" label={pets.find(item=>item.id===filter)?.name??'All pets'} icon="filter-variant" theme={theme} onPress={()=>setPicker(true)}/></View>
    {!logs.length?<View style={[s.petCard,card]}>{section('No logs yet')}<Text style={[s.body,{color:theme.textMuted}]}>Log an activity for {pets.find(item=>item.id===filter)?.name??'your pets'} above.</Text></View>:null}
  </View>;

  function settingsContent(){return <ScrollView contentContainerStyle={s.content}>
    {section('Your pets')}
    <View style={[s.petCard,card]}>{pets.map(item=><Pressable key={item.id} testID={`preview.rename.${item.id}`} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} onPress={()=>{setManage(true);setNameError(null);setNaming({id:item.id,value:item.name});}} style={s.settingRow}><Avatar pet={item} theme={theme}/><Text style={[s.body,s.flex,{color:theme.text}]}>{item.name}</Text><Icon name="pencil-outline" theme={theme} size={20}/></Pressable>)}
      <Action label="Manage pets" icon="paw-outline" theme={theme} onPress={()=>setManage(true)}/></View>
    {section('On this device')}
    <View style={[s.petCard,card]}>
      <View style={s.settingRow}><Icon name="theme-light-dark" theme={theme}/><Text style={[s.body,s.flex,{color:theme.text}]}>Dark appearance</Text><Switch testID="preview.dark" accessibilityLabel="Dark appearance" value={dark} onValueChange={setDark}/></View>
      <Action label="Home Screen widget" icon="widgets-outline" theme={theme} onPress={()=>setWidget(true)} testID="preview.widget"/>
      <Action testID="preview.notifications" label="Notifications" icon="bell-outline" theme={theme} onPress={()=>openTab('notifications')}/>
    </View>
    {section('Activity data')}
    <Action label={pet.name} icon="paw-outline" theme={theme} onPress={()=>setPicker(true)} testID="preview.data.pet"/>
    <ActivityCsvSettings theme={theme} eventCount={pet.events.length} loadExportEvents={async()=>pet.events}
      onImport={async()=>{Alert.alert('Import for '+pet.name,'The preview uses sample logs. Production imports must confirm the destination pet.');}}/>
    {section('Backup & account')}
    <View style={[s.petCard,card]}><Text style={[s.body,{color:theme.text}]}>Local log backups</Text><Text style={[s.small,{color:theme.textMuted}]}>All pets · Separate recovery history for each pet</Text><Text style={[s.body,{color:theme.text}]}>One account for your pets</Text><Text style={[s.small,{color:theme.textMuted}]}>Cloud backup and sync need multi-pet qualification.</Text></View>
    <Text style={[s.small,{color:theme.textMuted}]}>Design preview · Sample data. Changes reset when the app restarts. System notifications, cloud sync and widget installation are not connected.</Text>
  </ScrollView>;}

  return <SafeAreaView style={[s.flex,{backgroundColor:theme.background}]} edges={['top','bottom']}>
    <StatusBar style={dark?'light':'dark'}/>
    <SideNavigation open={drawer} enabled tab={tab} settingsVisible={settings} theme={theme} onOpen={()=>setDrawer(true)} onClose={()=>setDrawer(false)} onChange={navigate} onSettings={()=>{setNavigationHistory([tab]);setDrawer(false);setSettings(true);}}>
      <View style={s.header}>
        <Pressable testID={settings?'settings.back':navigationHistory.length?'nav.back':'nav.open'} accessibilityRole="button"
          accessibilityLabel={settings||navigationHistory.length?'Back':'Open navigation'} onPress={()=>settings||navigationHistory.length?goBack():setDrawer(true)} style={({pressed})=>[s.iconButton,{opacity:pressed?0.6:1}]}><Icon name={settings||navigationHistory.length?'arrow-left':'menu'} theme={theme}/></Pressable>
        <Text testID="nav.title" accessibilityRole="header" style={[s.brand,s.flex,{color:theme.text,minWidth:fontScale>1.1?'70%':70}]}>{t(settings?'settings.title':tab==='notifications'?'notifications.title':tab==='learn'?'learn.title':`nav.${tab}`)}</Text>
        {!settings&&(tab==='log'||tab==='timeline')?<Action testID="nav.switch" label={t(tab==='log'?'nav.timeline':'nav.log')} icon="swap-horizontal" theme={theme} onPress={()=>navigate(tab==='log'?'timeline':'log')}/>:null}
      </View>
      {!settings&&tab!=='log'&&tab!=='learn'?<Pressable testID="preview.scope" accessibilityRole="button" accessibilityLabel={`Selected pet, ${pet.name}. Change pet`} onPress={()=>setPicker(true)} style={[s.scope,{backgroundColor:theme.primarySoft}]}>
        <Icon name="paw-outline" theme={theme} size={20}/><Text style={[s.petLabel,s.flex,{color:theme.primary}]}>{pet.name}</Text><Icon name="chevron-down" theme={theme} size={22}/>
      </Pressable>:null}
      <View style={s.flex}>
        {settings?settingsContent():tab==='log'?<FlatList testID="preview.history" data={logs} keyExtractor={item=>`${item.petId}:${item.event.id}`} renderItem={renderRow} ListHeaderComponent={logHeader} contentContainerStyle={s.content} initialNumToRender={12}/>
          :tab==='timeline'?<TimelineScreen showHeader={false} key={pet.id} events={pet.events} schedule={pet.schedule} onOpenSchedule={()=>openTab('schedule')} theme={theme}/>
          :tab==='insights'?<InsightsScreen showHeader={false} key={pet.id} events={pet.events} customActivities={emptyActivities} theme={theme}/>
          :tab==='schedule'?<ScheduleScreen showHeader={false} key={pet.id} events={pet.events} schedule={pet.schedule} customActivities={emptyActivities} theme={theme} onChange={changeSchedule} onSaveEntry={async entry=>{await changeSchedule([...pet.schedule.filter(item=>item.id!==entry.id),entry].sort((a,b)=>a.minutes-b.minutes));}} onRemoveEntry={async id=>{await changeSchedule(pet.schedule.filter(item=>item.id!==id));}} onRequestReminderPermission={async()=>true}/>
          :tab==='learn'?<LearnScreen showHeader={false} theme={theme}/>
          :<ScrollView contentContainerStyle={s.content}>
            <View style={[s.petCard,card]}><View style={s.line}><Text style={[s.body,s.flex,{color:theme.text}]}>On this device · All pets</Text><Switch accessibilityLabel="Notifications on this device for all pets" value={delivery} onValueChange={setDelivery}/></View></View>
            {section(`${pet.name}’s reminders`)}<View style={[s.petCard,card]}><NotificationTimingControls theme={theme} preferences={preferences[pet.id]??DEFAULT_NOTIFICATION_PREFERENCES} schedule={pet.schedule} onScheduleChange={changeSchedule} onChange={async value=>setPreferences(current=>({...current,[pet.id]:value}))}/></View>
            <View style={[s.petCard,card]}>{section('Notification preview')}<Text style={[s.body,{color:theme.text}]}>{pet.name} · Time for a potty break</Text><Text style={[s.small,{color:theme.textMuted}]}>Names stay visible even with reminders for several pets.</Text></View>
          </ScrollView>}
      </View>
      {toast&&!settings&&tab==='log'?<View style={[s.toast,{backgroundColor:theme.primary}]}><Text accessibilityLiveRegion="polite" style={[s.body,s.flex,{color:theme.onPrimary}]}>{toast.label}</Text><Pressable testID="preview.undo" accessibilityRole="button" accessibilityLabel={"Undo "+toast.label} style={s.iconButton} onPress={()=>{const target=pets.find(item=>item.id===toast.petId)!;updatePet(target.id,{events:target.events.filter(item=>item.id!==toast.event.id)});setToast(null);}}><Text style={[s.actionText,{color:theme.onPrimary}]}>Undo</Text></Pressable></View>:null}
    </SideNavigation>

    <Modal visible={picker||manage||widget} animationType="none" presentationStyle="pageSheet" onRequestClose={()=>{if(naming)setNaming(null);else{setPicker(false);setManage(false);setWidget(false);}}}>
      <SafeAreaView style={[s.flex,{backgroundColor:theme.background}]}>
      {!naming?<ScrollView contentContainerStyle={s.content}>
        <View style={s.line}>{title(widget?'Home Screen widget':manage?'Your pets':tab==='log'&&!settings?'History for':'Choose a pet')}<View style={s.flex}/><Action label="Done" testID="preview.modal.done" theme={theme} onPress={()=>{setPicker(false);setManage(false);setWidget(false);}}/></View>
        {picker&&tab==='log'&&!settings?<Action label="All pets" theme={theme} onPress={()=>{setFilter(undefined);setPicker(false);}}/>:null}
        {widget?<Text style={[s.body,{color:theme.textMuted}]}>Choose the pet for this widget. Its name stays above the logging buttons.</Text>:null}
        {pets.map(item=><Pressable testID={`preview.select.${item.id}`} key={item.id} accessibilityRole={manage?'button':'radio'} accessibilityState={manage?undefined:{checked:item.id===(widget?widgetPet:tab==='log'&&!settings?filter:selected)}} accessibilityLabel={manage?`Edit ${item.name}`:item.name}
          onPress={()=>{if(manage){setNaming({id:item.id,value:item.name});setNameError(null);}else if(widget)setWidgetPet(item.id);else{if(tab==='log'&&!settings)setFilter(item.id);else setSelected(item.id);setPicker(false);}}} style={({pressed})=>[s.petCard,s.line,card,{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised}]}>
          <Avatar pet={item} theme={theme}/><View style={s.flex}><Text style={[s.petName,{color:theme.text}]}>{item.name}</Text><Text style={[s.small,{color:theme.textMuted}]}>{item.events.length} logs · {item.detail||'New pet'}</Text></View><Icon name={manage?'pencil-outline':item.id===(widget?widgetPet:tab==='log'&&!settings?filter:selected)?'check-circle':'circle-outline'} theme={theme}/>
        </Pressable>)}
        {!widget?<Action testID="preview.add" label="Add a pet" icon="plus" theme={theme} onPress={()=>{setNaming({value:''});setNameError(null);}}/>:null}
        {widget?<View style={[s.petCard,card]}><Text style={[s.petName,{color:theme.text}]}>{pets.find(item=>item.id===widgetPet)?.name}</Text><View style={s.line}>{(['pee','poop','meal'] as const).map(type=><View key={type} style={[s.quick,{borderColor:theme.border,backgroundColor:theme.surface}]}><ActivityIcon activity={{type}} theme={theme} color={activityColors(theme,{type}).color} size={24}/><Text style={[s.actionText,{color:theme.text}]}>{activityLabel({type})}</Text></View>)}</View><Text style={[s.small,{color:theme.textMuted}]}>Widget layout proposal · Installation is not connected</Text></View>:null}
      </ScrollView>:<KeyboardAvoidingView style={s.flex} behavior={Platform.OS==='ios'?'padding':'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
          {title(naming.id?'Pet’s name':'Add a pet')}
          <TextInput testID="preview.name" accessibilityLabel={naming?.id?'Pet’s name':'Pet name'} autoFocus value={naming?.value??''} onChangeText={value=>{setNaming(current=>current?{...current,value}:null);setNameError(null);}} placeholder="Name" placeholderTextColor={theme.textMuted} maxLength={256} style={[s.input,{color:theme.text,borderColor:theme.border,backgroundColor:theme.surfaceRaised}]}/>
          {nameError?<Text accessibilityRole="alert" style={[s.body,{color:theme.danger}]}>{nameError}</Text>:null}
          {!naming?.id?<Text style={[s.small,{color:theme.textMuted}]}>This pet starts with an empty log and routine.</Text>:null}
          <View style={s.line}><Action label="Cancel" theme={theme} onPress={()=>setNaming(null)}/><View style={s.flex}/><Action testID="preview.name.save" label={naming?.id?'Save':'Add pet'} theme={theme} onPress={()=>{
            if(!naming?.value.trim()){setNameError('Enter a name.');return;}
            if(pets.some(item=>item.id!==naming.id&&item.name.toLocaleLowerCase()===naming.value.trim().toLocaleLowerCase())){setNameError('Another pet uses that name. Add a nickname.');return;}
            if(naming.id)updatePet(naming.id,{name:naming.value.trim()});
            else{const id=entityId('pet');setPets(current=>[...current,{id,name:naming.value.trim(),detail:'',events:[],schedule:[]}]);setSelected(id);setFilter(id);setTab('log');setSettings(false);setPicker(false);setManage(false);}
            setNaming(null);
          }}/></View>
        </ScrollView></KeyboardAvoidingView>}
      </SafeAreaView>
    </Modal>
    {editor?<EventEditor pet={pets.find(item=>item.id===editor.petId)!} event={editor.event} theme={theme} onClose={()=>setEditor(null)} onSave={note=>{const target=pets.find(item=>item.id===editor.petId)!;updatePet(target.id,{events:target.events.map(event=>event.id===editor.event.id?{...event,note}:event)});setEditor(null);}}/>:null}
  </SafeAreaView>;
}

const s=StyleSheet.create({
  flex:{flex:1},content:{padding:20,paddingBottom:32,gap:16},stack:{gap:16,marginBottom:12},line:{flexDirection:'row',alignItems:'center',gap:12},column:{flexDirection:'column'},
  header:{paddingHorizontal:16,minHeight:60,flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},brand:{fontSize:20,lineHeight:28,fontWeight:'700'},iconButton:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},
  title:{fontSize:20,lineHeight:28,fontWeight:'700',flexShrink:1},heading:{fontSize:20,lineHeight:28,fontWeight:'700',flexShrink:1},body:{fontSize:16,lineHeight:24},small:{fontSize:13,lineHeight:19},
  petName:{fontSize:20,lineHeight:28,fontWeight:'700'},petLabel:{fontSize:15,lineHeight:22,fontWeight:'700'},avatar:{width:44,height:44,borderRadius:16,alignItems:'center',justifyContent:'center'},initial:{fontSize:18,fontWeight:'700'},
  petCard:{borderWidth:1,borderRadius:20,padding:16,gap:12},quick:{flex:1,minWidth:0,minHeight:76,borderRadius:14,borderWidth:1,paddingVertical:12,paddingHorizontal:4,alignItems:'center',justifyContent:'center',gap:5},quickLabel:{flexDirection:'row',alignItems:'center',gap:6},
  action:{minHeight:48,borderWidth:1,borderRadius:14,paddingHorizontal:12,paddingVertical:10,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,flexShrink:1},actionText:{fontSize:15,lineHeight:22,fontWeight:'600',flexShrink:1},
  historyRow:{flexDirection:'row',gap:12,alignItems:'center',padding:16,borderBottomWidth:StyleSheet.hairlineWidth,borderRadius:12,minHeight:96},activityIcon:{width:40,height:40,borderRadius:14,alignItems:'center',justifyContent:'center'},
  settingRow:{minHeight:56,flexDirection:'row',alignItems:'center',gap:12},scope:{marginHorizontal:20,marginTop:4,marginBottom:12,paddingHorizontal:14,paddingVertical:12,borderRadius:16,flexDirection:'row',alignItems:'center',gap:10,minHeight:48},
  input:{borderWidth:1,borderRadius:14,padding:14,fontSize:17,lineHeight:25,minHeight:52},toast:{margin:16,borderRadius:16,padding:12,flexDirection:'row',alignItems:'center',gap:8},
});
