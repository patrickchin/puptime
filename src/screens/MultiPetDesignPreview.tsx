import {MaterialCommunityIcons} from '@expo/vector-icons';
import {StatusBar} from 'expo-status-bar';
import {memo,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Alert,BackHandler,FlatList,Keyboard,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Switch,Text as NativeText,TextInput,View,useWindowDimensions,type TextProps} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {ActivityCsvSettings} from '../components/ActivityCsvSettings';
import {ActivityIcon} from '../components/ActivityIcon';
import {ConfirmDialog} from '../components/ConfirmDialog';
import {SideNavigation,type AppTab} from '../components/SideNavigation';
import {NotificationTimingControls} from '../components/NotificationTimingControls';
import {LocalizationProvider,useLocalization} from '../localization-context';
import {createEvent,formatTime,type EventType,type PuppyEvent,type PuppyEventChanges,type ScheduleEntry} from '../domain';
import {entityId} from '../entity-id';
import {DEFAULT_NOTIFICATION_PREFERENCES,type NotificationPreferences} from '../notification-config';
import {householdLogs,multiPetFixtures,type PetLog,type PreviewPet} from '../multi-pet-preview';
import {darkTheme,lightTheme,type Theme} from '../theme';
import {TimelineScreen} from './TimelineScreen';
import {InsightsScreen} from './InsightsScreen';
import {ScheduleScreen} from './ScheduleScreen';
import {LearnScreen} from './LearnScreen';
import {LogScreen,type LogEditRequest} from './LogScreen';

type PreviewTab=AppTab|'pets';
type IconName=keyof typeof MaterialCommunityIcons.glyphMap;
const emptyActivities:string[]=[];
// Body copy retains the existing 2× scale; large-text layouts reflow around it.
function Text(props:TextProps){return <NativeText maxFontSizeMultiplier={2} {...props}/>;}
function Icon({name,theme,size=24}:{name:IconName;theme:Theme;size?:number}){
  return <MaterialCommunityIcons accessible={false} accessibilityElementsHidden importantForAccessibility="no" name={name} color={theme.primary} size={size}/>;
}
function Action({label,onPress,theme,icon,testID}:{label:string;onPress:()=>void;theme:Theme;icon?:IconName;testID?:string}){
  return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({pressed})=>[s.action,label==='Done'&&{minWidth:76,flexShrink:0},{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised,borderColor:theme.border}]}>
    {icon?<Icon name={icon} theme={theme}/>:null}<Text style={[s.actionText,{color:theme.primary}]}>{label}</Text>
  </Pressable>;
}
function Avatar({pet,theme}:{pet:Pick<PreviewPet,'name'>;theme:Theme}){
  return <View accessible={false} style={[s.avatar,{backgroundColor:theme.primarySoft}]}><Text maxFontSizeMultiplier={1} style={[s.initial,{color:theme.primary}]}>{Array.from(pet.name).slice(0,2).join('').toLocaleUpperCase()}</Text></View>;
}

// This row never receives the editor's draft state. The probe-only entry point
// observes its renders on Android without changing production components.
const PetHistoryRow=memo(function PetHistoryRow({petId,petName,event,theme,onEdit,onDelete,onRowRender}:{petId:string;petName:string;event:PuppyEvent;theme:Theme;onEdit:(petId:string,event:PuppyEvent)=>void;onDelete:(petId:string,event:PuppyEvent)=>void;onRowRender?:(key:string,phase:'mount'|'update')=>void}){
  const observed=useRef(false);
  onRowRender?.(`${petId}:${event.id}`,observed.current?'update':'mount');
  observed.current=true;
  const {eventPastLabel,activityColors,t}=useLocalization(),colors=activityColors(theme,event);
  const {width,fontScale}=useWindowDimensions();
  const largeText=fontScale>=1.4&&width/Math.min(fontScale,2)<300;
  const activity=eventPastLabel(event),note=event.note?.trim();
  const timestamp=`${new Intl.DateTimeFormat('en',{month:'short',day:'numeric'}).format(event.at)} · ${formatTime(event.at)}`;
  return <View testID={`preview.event.${petId}.${event.id}`} style={[s.historyRow,largeText&&s.alignTop,{borderBottomColor:theme.border,backgroundColor:theme.surfaceRaised}]}>
    <Pressable testID={`preview.edit.${petId}.${event.id}`} accessibilityRole="button" accessibilityLabel={`Edit ${petName}, ${activity}, ${timestamp}${note?`, ${note}`:''}`} onPress={()=>onEdit(petId,event)}
      style={({pressed})=>[s.historyEdit,largeText&&s.alignTop,{backgroundColor:pressed?theme.primarySoft:undefined}]}>
      {!largeText?<View style={[s.historyIcon,{backgroundColor:colors.softColor}]}><ActivityIcon activity={event} theme={theme} color={colors.color} size={20}/></View>:null}
      <View style={s.historyCopy}>
        <Text style={[s.historyTitle,{color:theme.text}]}><Text style={[s.petLabel,{color:theme.primary}]}>{petName}</Text> · {activity}</Text>
        <Text numberOfLines={largeText?undefined:2} style={[s.small,{color:theme.textMuted}]}>{timestamp}{note?` · ${note}`:''}</Text>
      </View><Icon name="pencil-outline" theme={theme} size={20}/>
    </Pressable>
    <Pressable testID={`preview.delete.${petId}.${event.id}`} accessibilityRole="button" accessibilityLabel={`${petName}: ${t('eventRow.delete',{activity,time:formatTime(event.at)})}`} onPress={()=>onDelete(petId,event)}
      style={({pressed})=>[s.iconButton,{borderRadius:12,backgroundColor:pressed?theme.dangerSoft:undefined}]}>
      <MaterialCommunityIcons accessible={false} accessibilityElementsHidden importantForAccessibility="no" name="trash-can-outline" color={theme.danger} size={20}/>
    </Pressable>
  </View>;
});

// Reuse the production editor and consume the request once so autosaving does
// not reopen it or replace the draft when the pet's event list changes.
function PreviewEventEditor({pet,event,theme,onClose,onSave}:{pet:PreviewPet;event:PuppyEvent;theme:Theme;onClose:()=>void;onSave:(petId:string,event:PuppyEvent,changes:PuppyEventChanges)=>Promise<void>}){
  const [request,setRequest]=useState<LogEditRequest|null>({eventId:event.id});
  return <LogScreen editorOnly events={pet.events} customActivities={emptyActivities} theme={theme}
    editRequest={request} onEditRequestHandled={()=>setRequest(null)} onEditorClosed={onClose}
    onSave={(current,changes)=>onSave(pet.id,current,changes)}
    onLog={async()=>{}} onDelete={async()=>{}} onOpenSettings={()=>{}}/>;
}

export function MultiPetDesignPreview({onRowRender}:{onRowRender?:(key:string,phase:'mount'|'update')=>void}={}){
  return <SafeAreaProvider><LocalizationProvider language="en"><Preview onRowRender={onRowRender}/></LocalizationProvider></SafeAreaProvider>;
}
function Preview({onRowRender}:{onRowRender?:(key:string,phase:'mount'|'update')=>void}){
  const [pets,setPets]=useState(multiPetFixtures),[selected,setSelected]=useState('pet_preview_0');
  const [tab,setTab]=useState<PreviewTab>('log'),[settings,setSettings]=useState(false),[drawer,setDrawer]=useState(false);
  const [navigationHistory,setNavigationHistory]=useState<Array<PreviewTab|'settings'>>([]);
  const [picker,setPicker]=useState(false),[dark,setDark]=useState(false);
  const [naming,setNaming]=useState<{id?:string;value:string}|null>(null),[nameError,setNameError]=useState<string|null>(null);
  const [filter,setFilter]=useState<string>(),[editor,setEditor]=useState<{petId:string;event:PuppyEvent}|null>(null);
  const [pendingDelete,setPendingDelete]=useState<{petId:string;event:PuppyEvent}|null>(null);
  const [toast,setToast]=useState<{petId:string;event:PuppyEvent;label:string}|null>(null);
  const [preferences,setPreferences]=useState<Record<string,NotificationPreferences>>({});
  const [delivery,setDelivery]=useState(true),[widget,setWidget]=useState(false),[widgetPet,setWidgetPet]=useState('pet_preview_0');
  const theme=dark?darkTheme:lightTheme,pet=pets.find(item=>item.id===selected)??pets[0];
  const {activityLabel,activityColors,eventPastLabel,relativeTime,t}=useLocalization(),{width,fontScale}=useWindowDimensions();
  const largeText=fontScale>=1.4&&width/Math.min(fontScale,2)<300,narrow=width<380;

  const logs=useMemo(()=>householdLogs(pets,filter),[pets,filter]);
  const openEditor=useCallback((petId:string,event:PuppyEvent)=>setEditor({petId,event}),[]);
  const saveEvent=useCallback(async(petId:string,event:PuppyEvent,changes:PuppyEventChanges)=>{
    setPets(current=>current.map(pet=>pet.id===petId?{...pet,events:pet.events.map(item=>item.id===event.id?{...item,...changes}:item)}:pet));
  },[]);
  const requestDelete=useCallback((petId:string,event:PuppyEvent)=>setPendingDelete({petId,event}),[]);
  const renderRow=useCallback(({item}:{item:PetLog})=><PetHistoryRow {...item} theme={theme} onEdit={openEditor} onDelete={requestDelete} onRowRender={onRowRender}/>,[theme,openEditor,requestDelete,onRowRender]);
  function navigate(next:PreviewTab){Keyboard.dismiss();setTab(next);setSettings(false);setDrawer(false);setToast(null);setNaming(null);setNavigationHistory([]);}
  function openTab(next:PreviewTab){setNavigationHistory(history=>[...history,settings?'settings':tab]);setTab(next);setSettings(false);setDrawer(false);}
  function goBack(){if(naming){Keyboard.dismiss();setNaming(null);setNameError(null);return;}const previous=navigationHistory.at(-1);setNavigationHistory(history=>history.slice(0,-1));setSettings(previous==='settings');if(previous!=='settings')setTab(previous??'log');}
  useEffect(()=>{
    const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{
      if(drawer){setDrawer(false);return true;}
      if(naming){goBack();return true;}
      if(settings||navigationHistory.length){goBack();return true;}
      if(tab!=='log'){navigate('log');return true;}
      return false;
    });
    return()=>subscription.remove();
  },[drawer,settings,navigationHistory,tab,naming]);
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
    <View style={[s.line,largeText&&s.alignTop]}>{!largeText?<Avatar pet={target} theme={theme}/>:null}<View style={s.flex}><Text style={[s.petName,{color:theme.text}]}>{target.name}</Text><Text style={[s.small,{color:theme.textMuted}]}>{target.detail||'No logs yet'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`More activities for ${target.name}`} style={s.iconButton} onPress={()=>Alert.alert(target.name,'Sample activities',(['walk','nap'] as const).map(type=>({text:activityLabel({type}),onPress:()=>logFor(target,type)})).concat([{text:'Cancel',onPress:()=>{}}]))}><Icon name="plus" theme={theme}/></Pressable>
    </View>
    <View style={[s.line,{alignItems:'stretch'},largeText&&s.actionList]}>{(['pee','poop','meal'] as const).map(type=>{
      const colors=activityColors(theme,{type}),latest=target.events.find(event=>event.type===type);
      return <Pressable key={type} testID={`preview.quick.${target.id}.${type}`} accessibilityRole="button" accessibilityLabel={`Log ${activityLabel({type})} for ${target.name}`} onPress={()=>logFor(target,type)}
        style={({pressed})=>[s.quick,largeText&&s.quickRow,{backgroundColor:pressed?theme.primarySoft:theme.surface,borderColor:theme.border}]}>
        <View style={[s.quickLabel,narrow&&!largeText&&s.column,largeText&&s.flex]}><ActivityIcon activity={{type}} theme={theme} color={colors.color} size={largeText?24:21}/><Text style={[s.actionText,{color:theme.text}]}>{activityLabel({type})}</Text></View>
        <Text style={[s.small,largeText&&s.lastLogged,{color:theme.textMuted}]}>{latest?relativeTime(latest.at):'No logs yet'}</Text>
      </Pressable>;
    })}</View>
  </View>;

  const logHeader=<View style={s.stack}>
    <View style={s.line}><View style={s.flex}/><Action label={`${pets.length} pets`} icon="paw-outline" theme={theme} onPress={()=>openTab('pets')} testID="preview.pets"/></View>
    {pets.map(petActions)}
    <View style={largeText?s.stack:s.line}>{section('History')}{!largeText?<View style={s.flex}/>:null}<Action testID="preview.filter" label={pets.find(item=>item.id===filter)?.name??'All pets'} icon="filter-variant" theme={theme} onPress={()=>setPicker(true)}/></View>
    {!logs.length?<View style={[s.petCard,card]}>{section('No logs yet')}<Text style={[s.body,{color:theme.textMuted}]}>Log an activity for {pets.find(item=>item.id===filter)?.name??'your pets'} above.</Text></View>:null}
  </View>;

  function savePet(){
    if(!naming)return;
    const name=naming.value.trim();
    if(!name){setNameError('Enter a name.');return;}
    if(pets.some(item=>item.id!==naming.id&&item.name.toLocaleLowerCase()===name.toLocaleLowerCase())){setNameError('Another pet uses that name. Add a nickname.');return;}
    if(naming.id)updatePet(naming.id,{name});
    else setPets(current=>[...current,{id:entityId('pet'),name,detail:'',events:[],schedule:[]}]);
    Keyboard.dismiss();setNaming(null);setNameError(null);
  }
  function petsContent(){return <ScrollView testID="preview.pets.page" contentContainerStyle={s.content}>
    <View style={s.line}><Text style={[s.small,s.flex,{color:theme.textMuted}]}>{pets.length} pets</Text><Action testID="preview.add" label="Add a pet" icon="plus" theme={theme} onPress={()=>{setNaming({value:''});setNameError(null);}}/></View>
    {pets.map(item=><Pressable key={item.id} testID={`preview.rename.${item.id}`} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}
      onPress={()=>{setNaming({id:item.id,value:item.name});setNameError(null);}} style={({pressed})=>[s.petCard,s.line,largeText&&s.alignTop,card,{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised}]}>
      {!largeText?<Avatar pet={item} theme={theme}/>:null}<View style={s.flex}><Text style={[s.petName,{color:theme.text}]}>{item.name}</Text><Text style={[s.small,{color:theme.textMuted}]}>{[item.detail,`${item.events.length} logs`].filter(Boolean).join(' · ')}</Text></View><Icon name="chevron-right" theme={theme}/>
    </Pressable>)}
  </ScrollView>;}
  function petForm(){return <KeyboardAvoidingView testID="preview.pet.form" style={s.flex} behavior={Platform.OS==='ios'?'padding':'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      <Text style={[s.body,{color:theme.text}]}>Name</Text>
      <TextInput maxFontSizeMultiplier={2} testID="preview.name" accessibilityLabel="Pet name" autoFocus value={naming?.value??''} onChangeText={value=>{setNaming(current=>current?{...current,value}:null);setNameError(null);}} maxLength={256} style={[s.input,{color:theme.text,borderColor:theme.border,backgroundColor:theme.surfaceRaised}]}/>
      {nameError?<Text accessibilityRole="alert" style={[s.body,{color:theme.danger}]}>{nameError}</Text>:null}
      {!naming?.id?<Text style={[s.small,{color:theme.textMuted}]}>This pet starts with an empty log and routine.</Text>:null}
    </ScrollView>
  </KeyboardAvoidingView>;}

  function settingsContent(){return <ScrollView contentContainerStyle={s.content}>
    {section('On this device')}
    <View style={[s.petCard,card]}>
      <View style={[s.settingRow,largeText&&s.alignTop]}><Icon name="theme-light-dark" theme={theme}/><Text style={[s.body,s.flex,{color:theme.text}]}>Dark appearance</Text><Switch testID="preview.dark" accessibilityLabel="Dark appearance" value={dark} onValueChange={setDark}/></View>
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
    <SideNavigation open={drawer} enabled={!naming} tab={tab} settingsVisible={settings} theme={theme} onOpen={()=>setDrawer(true)} onClose={()=>setDrawer(false)} onChange={navigate} onPets={()=>navigate('pets')} onSettings={()=>{setNavigationHistory([tab]);setDrawer(false);setSettings(true);}}>
      <View style={s.header}>
        <Pressable testID={naming?'nav.back':settings?'settings.back':navigationHistory.length?'nav.back':'nav.open'} accessibilityRole="button"
          accessibilityLabel={naming||settings||navigationHistory.length?'Back':'Open navigation'} onPress={()=>naming||settings||navigationHistory.length?goBack():setDrawer(true)} style={({pressed})=>[s.iconButton,{opacity:pressed?0.6:1}]}><Icon name={naming||settings||navigationHistory.length?'arrow-left':'menu'} theme={theme}/></Pressable>
        <Text testID="nav.title" accessibilityRole="header" style={[s.brand,s.flex,{color:theme.text,minWidth:!naming&&fontScale>1.1?'70%':70}]}>{naming?(naming.id?'Edit pet':'Add a pet'):t(settings?'settings.title':tab==='notifications'?'notifications.title':tab==='learn'?'learn.title':`nav.${tab}`)}</Text>
        {naming?<Action testID="preview.name.save" label={naming.id?'Save':'Add pet'} theme={theme} onPress={savePet}/>:null}
        {!naming&&!settings&&(tab==='log'||tab==='timeline')?<Action testID="nav.switch" label={t(tab==='log'?'nav.timeline':'nav.log')} icon="swap-horizontal" theme={theme} onPress={()=>navigate(tab==='log'?'timeline':'log')}/>:null}

      </View>
      {!naming&&!settings&&tab!=='pets'&&tab!=='log'&&tab!=='learn'?<Pressable testID="preview.scope" accessibilityRole="button" accessibilityLabel={`Selected pet, ${pet.name}. Change pet`} onPress={()=>setPicker(true)} style={[s.scope,{backgroundColor:theme.primarySoft}]}>
        <Icon name="paw-outline" theme={theme} size={20}/><Text style={[s.petLabel,s.flex,{color:theme.primary}]}>{pet.name}</Text><Icon name="chevron-down" theme={theme} size={22}/>
      </Pressable>:null}
      <View style={s.flex}>
        {naming?petForm():settings?settingsContent():tab==='pets'?petsContent():tab==='log'?<FlatList testID="preview.history" data={logs} keyExtractor={item=>`${item.petId}:${item.event.id}`} renderItem={renderRow} ListHeaderComponent={logHeader} contentContainerStyle={s.content} initialNumToRender={12}/>
          :tab==='timeline'?<TimelineScreen showHeader={false} key={pet.id} events={pet.events} schedule={pet.schedule} onOpenSchedule={()=>openTab('schedule')} theme={theme}/>
          :tab==='insights'?<InsightsScreen showHeader={false} key={pet.id} events={pet.events} customActivities={emptyActivities} theme={theme}/>
          :tab==='schedule'?<ScheduleScreen showHeader={false} key={pet.id} events={pet.events} schedule={pet.schedule} customActivities={emptyActivities} theme={theme} onChange={changeSchedule} onSaveEntry={async entry=>{await changeSchedule([...pet.schedule.filter(item=>item.id!==entry.id),entry].sort((a,b)=>a.minutes-b.minutes));}} onRemoveEntry={async id=>{await changeSchedule(pet.schedule.filter(item=>item.id!==id));}} onRequestReminderPermission={async()=>true}/>
          :tab==='learn'?<LearnScreen showHeader={false} theme={theme}/>
          :<ScrollView contentContainerStyle={s.content}>
            <View style={[s.petCard,card]}><View style={largeText?s.stack:s.line}><Text style={[s.body,!largeText&&s.flex,{color:theme.text}]}>On this device · All pets</Text><Switch accessibilityLabel="Notifications on this device for all pets" value={delivery} onValueChange={setDelivery}/></View></View>

            {section(`${pet.name}’s reminders`)}<View style={[s.petCard,card]}><NotificationTimingControls theme={theme} preferences={preferences[pet.id]??DEFAULT_NOTIFICATION_PREFERENCES} schedule={pet.schedule} onScheduleChange={changeSchedule} onChange={async value=>setPreferences(current=>({...current,[pet.id]:value}))}/></View>
            <View style={[s.petCard,card]}>{section('Notification preview')}<Text style={[s.body,{color:theme.text}]}>{pet.name} · Time for a potty break</Text><Text style={[s.small,{color:theme.textMuted}]}>Names stay visible even with reminders for several pets.</Text></View>
          </ScrollView>}
      </View>
      {toast&&!naming&&!settings&&tab==='log'?<View style={[s.toast,largeText&&s.toastStack,{backgroundColor:theme.primary}]}><Text accessibilityLiveRegion="polite" style={[s.body,!largeText&&s.flex,{color:theme.onPrimary}]}>{toast.label}</Text><View style={s.line}><Pressable testID="preview.edit" accessibilityRole="button" accessibilityLabel={t('common.editLogA11y')} style={s.iconButton} onPress={()=>{openEditor(toast.petId,toast.event);setToast(null);}}><Text style={[s.actionText,{color:theme.onPrimary}]}>{t('common.edit')}</Text></Pressable><Pressable testID="preview.undo" accessibilityRole="button" accessibilityLabel={"Undo "+toast.label} style={s.iconButton} onPress={()=>{const target=pets.find(item=>item.id===toast.petId)!;updatePet(target.id,{events:target.events.filter(item=>item.id!==toast.event.id)});setToast(null);}}><Text style={[s.actionText,{color:theme.onPrimary}]}>Undo</Text></Pressable></View></View>:null}

    </SideNavigation>

    <Modal visible={picker||widget} animationType="none" presentationStyle="pageSheet" onRequestClose={()=>{setPicker(false);setWidget(false);}}>
      <SafeAreaView style={[s.flex,{backgroundColor:theme.background}]}>
        <ScrollView contentContainerStyle={s.content}>
          <View style={[s.line,largeText&&s.alignTop]}><View style={s.flex}>{title(widget?'Home Screen widget':tab==='log'&&!settings?'History for':'Choose a pet')}</View>{largeText?<Pressable testID="preview.modal.done" accessibilityRole="button" accessibilityLabel="Done" onPress={()=>{setPicker(false);setWidget(false);}} style={s.iconButton}><Icon name="close" theme={theme}/></Pressable>:<Action label="Done" testID="preview.modal.done" theme={theme} onPress={()=>{setPicker(false);setWidget(false);}}/>}</View>
          {picker&&tab==='log'&&!settings?<Action label="All pets" theme={theme} onPress={()=>{setFilter(undefined);setPicker(false);}}/>:null}
          {widget?<Text style={[s.body,{color:theme.textMuted}]}>Choose the pet for this widget. Its name stays above the logging buttons.</Text>:null}
          {pets.map(item=><Pressable testID={`preview.select.${item.id}`} key={item.id} accessibilityRole="radio" accessibilityState={{checked:item.id===(widget?widgetPet:tab==='log'&&!settings?filter:selected)}} accessibilityLabel={item.name}
            onPress={()=>{if(widget)setWidgetPet(item.id);else{if(tab==='log'&&!settings)setFilter(item.id);else setSelected(item.id);setPicker(false);}}} style={({pressed})=>[s.petCard,s.line,largeText&&s.alignTop,card,{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised}]}>
            {!largeText?<Avatar pet={item} theme={theme}/>:null}<View style={s.flex}><Text style={[s.petName,{color:theme.text}]}>{item.name}</Text><Text style={[s.small,{color:theme.textMuted}]}>{item.events.length} logs · {item.detail||'New pet'}</Text></View><Icon name={item.id===(widget?widgetPet:tab==='log'&&!settings?filter:selected)?'check-circle':'circle-outline'} theme={theme}/>
          </Pressable>)}
          {!widget?<Action testID="preview.manage" label="Manage pets" icon="paw-outline" theme={theme} onPress={()=>{setPicker(false);openTab('pets');}}/>:null}
          {widget?<View style={[s.petCard,card]}><Text style={[s.petName,{color:theme.text}]}>{pets.find(item=>item.id===widgetPet)?.name}</Text><View style={largeText?s.actionList:s.line}>{(['pee','poop','meal'] as const).map(type=><View key={type} style={[s.quick,largeText&&s.quickRow,{borderColor:theme.border,backgroundColor:theme.surface}]}><ActivityIcon activity={{type}} theme={theme} color={activityColors(theme,{type}).color} size={24}/><Text style={[s.actionText,{color:theme.text}]}>{activityLabel({type})}</Text></View>)}</View><Text style={[s.small,{color:theme.textMuted}]}>Widget layout proposal · Installation is not connected</Text></View>:null}
        </ScrollView>

      </SafeAreaView>
    </Modal>
    <ConfirmDialog visible={pendingDelete!==null} theme={theme} title={t('app.deleteTitle')} confirmLabel={t('app.delete')}
      message={pendingDelete?`${pets.find(item=>item.id===pendingDelete.petId)?.name} · ${t('app.deleteMessage',{activity:eventPastLabel(pendingDelete.event),time:formatTime(pendingDelete.event.at)})}`:''}
      onCancel={()=>setPendingDelete(null)} onConfirm={()=>{
        if(!pendingDelete)return;
        setPets(current=>current.map(item=>item.id===pendingDelete.petId?{...item,events:item.events.filter(event=>event.id!==pendingDelete.event.id)}:item));
        setPendingDelete(null);setToast(null);
      }}/>
    {editor?<PreviewEventEditor key={`${editor.petId}:${editor.event.id}`} pet={pets.find(item=>item.id===editor.petId)!} event={editor.event} theme={theme} onClose={()=>setEditor(null)} onSave={saveEvent}/>:null}
  </SafeAreaView>;
}

const s=StyleSheet.create({
  flex:{flex:1},content:{padding:20,paddingBottom:32,gap:16},stack:{gap:16,marginBottom:12},line:{flexDirection:'row',alignItems:'center',gap:12},column:{flexDirection:'column'},
  header:{paddingHorizontal:16,minHeight:60,flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},brand:{fontSize:20,lineHeight:28,fontWeight:'700'},iconButton:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},
  title:{fontSize:20,lineHeight:28,fontWeight:'700',flexShrink:1},heading:{fontSize:20,lineHeight:28,fontWeight:'700',flexShrink:1},body:{fontSize:16,lineHeight:24},small:{fontSize:13,lineHeight:19},
  petName:{fontSize:20,lineHeight:28,fontWeight:'700'},petLabel:{fontSize:15,lineHeight:22,fontWeight:'700'},avatar:{width:44,height:44,borderRadius:16,alignItems:'center',justifyContent:'center'},initial:{fontSize:18,fontWeight:'700'},
  petCard:{borderWidth:1,borderRadius:20,padding:16,gap:12},quick:{flex:1,minWidth:0,minHeight:76,borderRadius:14,borderWidth:1,paddingVertical:12,paddingHorizontal:4,alignItems:'center',justifyContent:'center',gap:5},quickLabel:{flexDirection:'row',alignItems:'center',gap:6},
  action:{minHeight:48,borderWidth:1,borderRadius:14,paddingHorizontal:12,paddingVertical:10,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,flexShrink:1},actionText:{fontSize:15,lineHeight:22,fontWeight:'600',flexShrink:1},
  historyRow:{flexDirection:'row',gap:12,alignItems:'center',padding:16,borderBottomWidth:StyleSheet.hairlineWidth,borderRadius:12,minHeight:72},historyEdit:{flex:1,minHeight:48,flexDirection:'row',alignItems:'center',gap:12,borderRadius:12},historyCopy:{flex:1,gap:4},
  historyTitle:{fontSize:15,lineHeight:22},historyIcon:{width:40,height:40,borderRadius:14,alignItems:'center',justifyContent:'center'},
  settingRow:{minHeight:56,flexDirection:'row',alignItems:'center',gap:12},scope:{marginHorizontal:20,marginTop:4,marginBottom:12,paddingHorizontal:14,paddingVertical:12,borderRadius:16,flexDirection:'row',alignItems:'center',gap:10,minHeight:48},
  input:{borderWidth:1,borderRadius:14,padding:14,fontSize:17,lineHeight:25,minHeight:52},toast:{margin:16,borderRadius:16,padding:12,flexDirection:'row',alignItems:'center',gap:8},
  alignTop:{alignItems:'flex-start'},actionList:{flexDirection:'column',gap:8},quickRow:{flex:0,flexDirection:'row',minHeight:68,paddingHorizontal:12,justifyContent:'flex-start',gap:12},lastLogged:{flexShrink:1,maxWidth:'58%',textAlign:'right'},toastStack:{flexDirection:'column',alignItems:'stretch'},
});
