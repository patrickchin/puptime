import {ScrollView,StyleSheet,Text,View} from 'react-native';
import {PuppyNameSetting} from '../components/PuppyNameSetting';
import {SettingsRow} from '../components/SettingsRow';
import type {CloudHandle} from '../cloud/handle';
import {useLocalization} from '../localization-context';
import {spacing,surfaceTreatment,type Theme} from '../theme';

// The production journal still owns one pet. Keep its real profile together;
// additional-pet creation remains in the separate in-memory design preview.
export function PetsScreen({theme,cloud,eventCount,onShare,onOpenShared,onOpenAccount,shared=false,sharedName}:{shared?:boolean;sharedName?:string;theme:Theme;cloud:CloudHandle;eventCount:number;onShare:()=>void;onOpenShared:()=>void;onOpenAccount?:()=>void}){
 const {t,locale}=useLocalization();
 const card=[styles.card,surfaceTreatment(theme),{backgroundColor:theme.surfaceRaised,borderColor:theme.border}];
 return <ScrollView testID="screen.pets" contentContainerStyle={styles.content}>
  <View>
   {shared?<Text accessibilityRole="header" style={[styles.name,{color:theme.text}]}>{sharedName}</Text>:<PuppyNameSetting theme={theme} cloud={cloud}/>}
   <Text style={[styles.count,{color:theme.textMuted}]}>{t(eventCount===1?'account.logsOne':'account.logsMany',{count:new Intl.NumberFormat(locale).format(eventCount)})}</Text>
  </View>
  <View style={styles.section}>
   <Text accessibilityRole="header" style={[styles.heading,{color:theme.text}]}>{t('pets.sharing')}</Text>
   <View style={card}>
    {!shared?<><SettingsRow theme={theme} testID="puppy.share" icon="account-multiple-plus-outline" label={t('sharing.title')} detail={t('pets.shareDetail')} onPress={onShare} wrap/><View style={[styles.divider,{backgroundColor:theme.border}]}/></>:null}
    <SettingsRow theme={theme} testID="puppy.shared" icon="paw-outline" label={t('sharing.sharedTitle')} detail={t('pets.sharedDetail')} onPress={onOpenShared} wrap/>
   </View>
  </View>
  {cloud.available&&onOpenAccount?<View style={card}><SettingsRow theme={theme} testID="puppy.account" icon="account-circle-outline" label={t('account.title')} detail={t('settings.accountDetail')} onPress={onOpenAccount} wrap/></View>:null}
 </ScrollView>;
}
const styles=StyleSheet.create({content:{width:'100%',maxWidth:720,alignSelf:'center',padding:spacing.md,gap:spacing.lg,paddingBottom:spacing.xl},name:{fontSize:28,lineHeight:36,fontWeight:'700'},count:{fontSize:15,lineHeight:22,paddingHorizontal:8},section:{gap:spacing.sm},heading:{fontSize:18,lineHeight:25,fontWeight:'700'},card:{borderWidth:1,borderRadius:22,padding:8},divider:{height:StyleSheet.hairlineWidth,marginHorizontal:8}});
