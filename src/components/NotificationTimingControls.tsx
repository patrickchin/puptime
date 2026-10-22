import {useRef,useState} from 'react';
import {Modal,Pressable,ScrollView,StyleSheet,Switch,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {ScheduleEntry} from '../domain';
import {useLocalization} from '../localization-context';
import {pottyReminderDelayOptions,reminderOffsetOptions,type NotificationPreferences,type ReminderOffsetMinutes,type PottyReminderDelayMinutes} from '../notification-config';
import type {Theme} from '../theme';
import {ActivityIcon} from './ActivityIcon';

export function NotificationTimingControls({theme,preferences,schedule,onChange,onScheduleChange,pickerTheme=theme,disabled=false}:{
  theme:Theme;pickerTheme?:Theme;preferences:NotificationPreferences;schedule:ScheduleEntry[];disabled?:boolean;
  onChange:(preferences:NotificationPreferences)=>Promise<void>;
  onScheduleChange:(schedule:ScheduleEntry[])=>Promise<void>;
}){
  const {t,activityColors}=useLocalization();
  const [editing,setEditing]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const insets=useSafeAreaInsets(),locked=useRef(false);
  async function save(action:()=>Promise<void>){
    if(locked.current||disabled)return;
    locked.current=true;setBusy(true);setError(false);
    try{await action();setEditing(null);}catch{setError(true);}finally{locked.current=false;setBusy(false);}
  }
  const offsetLabel=(value:number)=>t(value===0?'notifications.atTime':value<0?'notifications.before':'notifications.after',{count:Math.abs(value)});
  const rules=[
    ...(['meal','poop'] as const).map(type=>({
      id:type,description:undefined,activity:{type},label:t(type==='meal'?'notifications.scheduledMeal':'notifications.scheduledPoop'),
      enabled:schedule.some(entry=>entry.type===type&&entry.reminder),available:schedule.some(entry=>entry.type===type),
      value:(type==='meal'?preferences.mealReminderOffsetMinutes:preferences.poopReminderOffsetMinutes)??-preferences.reminderLeadMinutes,
      options:reminderOffsetOptions,labelFor:offsetLabel,
      toggle:(enabled:boolean)=>onScheduleChange(schedule.map(entry=>entry.type===type?{...entry,reminder:enabled}:entry)),
      choose:(value:number)=>onChange({...preferences,[type==='meal'?'mealReminderOffsetMinutes':'poopReminderOffsetMinutes']:value as ReminderOffsetMinutes}),
    })),
    ...(['pottyAfterMeal','pottyAfterPee'] as const).map(key=>({
      id:key,description:t(key==='pottyAfterMeal'?'notifications.afterMealHelp':'notifications.afterPeeHelp'),activity:{type:key==='pottyAfterMeal'?'meal' as const:'pee' as const},label:t(key==='pottyAfterMeal'?'notifications.loggedMeal':'notifications.loggedPee'),
      enabled:preferences[key]?.enabled??false,available:true,value:preferences[key]?.delayMinutes??120,
      options:pottyReminderDelayOptions,labelFor:(value:number)=>t(value<60?'time.minutes':'time.hours',{count:value<60?value:value/60}),
      toggle:(enabled:boolean)=>onChange({...preferences,[key]:{enabled,delayMinutes:preferences[key]?.delayMinutes??120}}),
      choose:(value:number)=>onChange({...preferences,[key]:{enabled:preferences[key]?.enabled??false,delayMinutes:value as PottyReminderDelayMinutes}}),
    })),
  ];
  const active=rules.find(rule=>rule.id===editing);
  return <View style={styles.rules}>
    {rules.map(rule=>{const colors=activityColors(theme,rule.activity);return <View key={rule.id} style={[styles.rule,{borderColor:theme.border}]}>
      <View style={styles.row}>
        <View style={[styles.icon,{backgroundColor:colors.softColor}]}><ActivityIcon activity={rule.activity} theme={theme} color={colors.color} size={24}/></View>
        <Text style={[styles.label,{color:theme.text}]}>{rule.label}</Text>
        <Switch testID={`notifications.timing.${rule.id}.enabled`} accessibilityLabel={rule.label} value={rule.enabled}
          disabled={disabled||busy||!rule.available} onValueChange={enabled=>{void save(()=>rule.toggle(enabled));}}
          trackColor={{false:theme.border,true:theme.isDark?'#73D3AD':theme.primary}} thumbColor={theme.isDark?'#FFFDF5':theme.surfaceRaised}/>
      </View>
      {rule.description?<Text style={[styles.help,{color:theme.textMuted}]}>{rule.description}</Text>:null}
      {rule.available?<Pressable testID={`notifications.timing.${rule.id}.time`} accessibilityRole="button" accessibilityLabel={`${rule.label}, ${rule.labelFor(rule.value)}`}
        disabled={disabled||busy} onPress={()=>setEditing(rule.id)} style={styles.time}>
        <Text style={[styles.value,{color:theme.primary}]}>{rule.labelFor(rule.value)}  ▾</Text>
      </Pressable>:<Text style={{marginLeft:48,fontSize:14,lineHeight:20,color:theme.textMuted}}>{t('notifications.noScheduledTimes')}</Text>}
    </View>;})}
    {error?<Text accessibilityRole="alert" style={{color:theme.danger}}>{t('settings.saveErrorBody')}</Text>:null}
    <Modal visible={!!active} transparent animationType="none" onRequestClose={()=>{if(!busy)setEditing(null);}}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel={t('app.cancel')} accessibilityRole="button" disabled={busy} onPress={()=>setEditing(null)} style={StyleSheet.absoluteFill}/>
        <View accessibilityViewIsModal style={[styles.sheet,{backgroundColor:pickerTheme.background,paddingBottom:Math.max(insets.bottom,16)}]}>
          <Text accessibilityRole="header" style={[styles.heading,{color:pickerTheme.text}]}>{active?.label}</Text>
          <ScrollView>{active?.options.map(value=><Pressable key={value} testID={`notifications.timing.option.${value}`} accessibilityRole="radio" accessibilityState={{checked:active.value===value,disabled:busy}} disabled={busy}
            onPress={()=>{void save(()=>active.choose(value));}} style={[styles.option,{backgroundColor:active.value===value?pickerTheme.primarySoft:undefined}]}>
            <Text style={[styles.value,{color:pickerTheme.text}]}>{active.labelFor(value)}{active.value===value?'  ✓':''}</Text>
          </Pressable>)}</ScrollView>
          <Pressable testID="notifications.timing.close" disabled={busy} onPress={()=>setEditing(null)} style={styles.option}><Text style={[styles.value,{color:pickerTheme.primary}]}>{t('app.cancel')}</Text></Pressable>
        </View>
      </View>
    </Modal>
  </View>;
}
const styles=StyleSheet.create({
  rules:{gap:8},rule:{borderBottomWidth:StyleSheet.hairlineWidth,paddingVertical:10},row:{flexDirection:'row',alignItems:'center',gap:12},label:{fontSize:16,lineHeight:23,fontWeight:'600',flex:1},
  icon:{width:36,height:36,borderRadius:12,alignItems:'center',justifyContent:'center'},
  help:{marginLeft:48,marginTop:6,fontSize:14,lineHeight:20},
  time:{marginLeft:48,minHeight:44,justifyContent:'center',alignSelf:'flex-start'},value:{fontSize:16,lineHeight:23},overlay:{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,.4)'},
  sheet:{maxHeight:'85%',padding:20,borderTopLeftRadius:24,borderTopRightRadius:24},heading:{fontSize:24,lineHeight:30,fontWeight:'700',paddingBottom:16},option:{minHeight:48,justifyContent:'center',padding:12,borderRadius:12},
});
