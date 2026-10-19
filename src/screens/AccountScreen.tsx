import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect,useState } from 'react';
import { Alert,KeyboardAvoidingView,Linking,Pressable,ScrollView,StyleSheet,Switch,Text,View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CloudHandle } from '../cloud/use-cloud';
import {AccountButton,AccountSignIn,accountProblemKey} from '../components/AccountSignIn';
import { useAccountSnapshot } from '../cloud/use-account-snapshot';
import { accountStatus } from '../cloud/account-status';
import { useLocalization } from '../localization-context';
import { spacing,surfaceTreatment,type Theme } from '../theme';

export function AccountScreen({cloud,theme,eventCount,onBack,onOpenActivity}:{cloud:CloudHandle;theme:Theme;eventCount:number;onBack:()=>void;onOpenActivity:()=>void}) {
  const {t,locale}=useLocalization(),state=useAccountSnapshot(cloud.controller);
  const [localName,setLocalName]=useState<string|null>(null),[readFailed,setReadFailed]=useState(false);
  const [samePuppy,setSamePuppy]=useState(false);
  const account=state?.account,existing=account?.pets[0],busy=state?.busy??false;
  const status=accountStatus(state),errorKey=accountProblemKey(state?.problem??(readFailed?'local-storage':null));
  const enrolled=!!state?.sync?.accountId&&state.sync.state!=='local';
  const days=state?.config?.trialDays??14;
  useEffect(()=>{let mounted=true;cloud.getLocalName().then(name=>{if(mounted)setLocalName(name);}).catch(()=>{if(mounted)setReadFailed(true);});return()=>{mounted=false;};},[cloud.getLocalName]);
  useEffect(()=>{setSamePuppy(false);},[account?.user.id,existing?.id]);
  useEffect(()=>()=>cloud.controller?.cancelExport(),[cloud.controller]);
  const titleStyle={color:theme.text,fontFamily:theme.presentation.headingFont,fontSize:theme.presentation.titleSize,lineHeight:theme.presentation.titleLineHeight,fontWeight:theme.presentation.titleWeight};
  const bodyStyle={color:theme.textMuted};
  const cardStyle=[styles.card,surfaceTreatment(theme),{backgroundColor:theme.surfaceRaised,borderColor:theme.border,borderRadius:theme.presentation.cardRadius}];
  const name=state?.local?.name??localName;
  const shownName=name==='My puppy'||!name?t('account.defaultName'):name;
  const count=state?.local?.eventCount??eventCount;
  const countLabel=(value:number)=>t(value===1?'account.logsOne':'account.logsMany',{count:new Intl.NumberFormat(locale).format(value)});
  const signOut=()=>Alert.alert(t('account.signOutTitle'),t('account.signOutBody',{count:state?.sync?.pending??0}),[
    {text:t('account.cancel'),style:'cancel'},
    {text:t('account.signOut'),style:'destructive',onPress:()=>{void cloud.controller?.signOut({confirmPending:true});}},
  ]);
  return <SafeAreaView style={[styles.root,{backgroundColor:theme.background}]} edges={['top','bottom']}>
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      <ScrollView testID="screen.account" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable testID="account.back" accessibilityRole="button" accessibilityLabel={t('account.back')} onPress={()=>{cloud.controller?.cancelExport();onBack();}} style={({pressed})=>[styles.back,{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised,borderRadius:theme.presentation.controlRadius}]}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
          <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.title,titleStyle]}>{t('account.title')}</Text>
        </View>
        <View testID="account.local.summary" style={cardStyle}>
          <View style={styles.summaryHeader}><MaterialCommunityIcons name="dog-side" size={31} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no" /><Text maxFontSizeMultiplier={2} style={[styles.eyebrow,{color:theme.primary}]}>{t('account.onDevice')}</Text></View>
          <Text maxFontSizeMultiplier={2} style={[styles.puppy,{color:theme.text,fontFamily:theme.presentation.headingFont}]}>{shownName}</Text>
          <Text testID="account.local.count" style={[styles.body,bodyStyle]}>{readFailed?t('account.error.storage'):countLabel(count)}</Text>
          <Text testID="account.status" accessibilityLiveRegion="polite" style={[styles.status,{color:theme.primary}]}>{t(`account.status.${status}`)}</Text>
        </View>
        {errorKey&&errorKey!=='account.error.export'?<Text testID="account.error" accessibilityRole="alert" style={[styles.notice,{color:theme.danger,backgroundColor:theme.dangerSoft,borderRadius:theme.presentation.controlRadius}]}>{t(errorKey)}</Text>:null}
        {!account?<AccountSignIn cloud={cloud} theme={theme} showError={false}/>:(<View style={styles.stack}>
          <Text selectable style={[styles.body,{color:theme.text}]}>{account.user.email}</Text>
          {!enrolled?(<View style={cardStyle}>
            <Text style={[styles.body,bodyStyle]}>{t('account.enrollBody')}</Text>
            {!account.cloud.canSync?<Text style={[styles.body,bodyStyle]}>{t('account.trialBody',{days})}</Text>:null}
            {existing?(<View style={styles.stack}>
              <Text style={[styles.label,{color:theme.primary}]}>{t('account.cloudPuppy')}</Text><Text maxFontSizeMultiplier={2} style={[styles.puppy,{color:theme.text}]}>{existing.name}</Text><Text style={[styles.body,bodyStyle]}>{countLabel(existing.eventCount)}</Text>
              <Text style={[styles.body,bodyStyle]}>{t('account.combineBody')}</Text>
              <View style={styles.confirm}><Switch testID="account.samePuppy" accessibilityLabel={t('account.samePuppy')} value={samePuppy} onValueChange={setSamePuppy} disabled={busy} trackColor={{true:theme.primary,false:theme.border}}/><Text style={[styles.body,styles.grow,{color:theme.text}]}>{t('account.samePuppy')}</Text></View>
            </View>):null}
            <AccountButton theme={theme} testID="account.enable" label={existing?t('account.combine'):account.cloud.canSync?t('account.enable'):t('account.startTrial',{days})} primary disabled={busy||!state!.online||!!existing&&!samePuppy} loading={busy} onPress={()=>{void cloud.controller!.enableCloud({...(existing?{confirmedPetId:existing.id}:{})});}}/>
          </View>):(<View style={cardStyle}>
            {state!.lastSyncedAt!==null?<Text testID="account.lastSynced" style={[styles.body,bodyStyle]}>{t('account.lastSynced',{date:new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(state!.lastSyncedAt)})}</Text>:null}
            {state!.sync!.pending?<Text style={[styles.body,{color:theme.text}]}>{t('account.pending',{count:state!.sync!.pending})}</Text>:null}
            {state!.sync!.blocked?<><Text style={[styles.body,bodyStyle]}>{t('account.blocked',{count:state!.sync!.blocked})}</Text><AccountButton theme={theme} testID="account.viewLogs" label={t('account.viewLogs')} onPress={onOpenActivity}/></>:null}
            {status==='expired'||status==='offline'||status==='paused'?<Text style={[styles.body,bodyStyle]}>{t('account.pausedBody')}</Text>:null}
            {account.cloud.expiresAt?<Text style={[styles.body,bodyStyle]}>{t('account.expires',{date:new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(account.cloud.expiresAt)})}</Text>:null}
            <AccountButton theme={theme} testID="account.retry" label={t(status==='expired'?'account.refresh':'account.retry')} disabled={busy||state!.running||!state!.online} onPress={()=>{void cloud.controller!.retry();}}/>
          </View>)}
          {state?.config&&(state.config.providers.apple||state.config.providers.google)?<View style={cardStyle}>
            {state.linkedProviders===null?<AccountButton theme={theme} testID="account.methods.refresh" label={t(busy?'account.methodsLoading':'account.refreshMethods')} disabled={busy||!state.online} loading={busy} onPress={()=>{void cloud.controller!.refresh();}}/>:(['apple','google'] as const).filter(provider=>state.config!.providers[provider]).map(provider=>state.linkedProviders!.includes(provider)?<View key={provider} testID={`account.${provider}.connected`} style={styles.summaryHeader}>
              <MaterialCommunityIcons name="check-circle-outline" size={22} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no"/>
              <Text style={[styles.body,styles.grow,{color:theme.text}]}>{t(provider==='apple'?'account.connectedApple':'account.connectedGoogle')}</Text>
            </View>:<AccountButton key={provider} theme={theme} testID={`account.${provider}.connect`} label={t(provider==='apple'?'account.connectApple':'account.connectGoogle')} icon={provider} disabled={busy||!state.online} loading={state.linkingProvider===provider} onPress={()=>{void cloud.controller!.connectProvider(provider);}}/>)}
          </View>:null}
          <View style={cardStyle}>
            {errorKey==='account.error.export'?<Text testID="account.error" accessibilityRole="alert" style={[styles.notice,{color:theme.danger,backgroundColor:theme.dangerSoft,borderRadius:theme.presentation.controlRadius}]}>{t(errorKey)}</Text>:null}
            <AccountButton theme={theme} testID="account.export" label={t(state?.exporting?'account.exporting':'account.export')} icon="download-outline" disabled={busy||!state!.online||!account.cloud.canExport} loading={state?.exporting} onPress={()=>{void cloud.controller!.exportData();}}/>
            {state?.exporting?<AccountButton theme={theme} testID="account.export.cancel" label={t('account.cancel')} onPress={()=>cloud.controller!.cancelExport()}/>:state?.sync?.pending?<Text style={[styles.body,bodyStyle]}>{t('account.exportPending')}</Text>:null}
          </View>
          <AccountButton theme={theme} testID="account.signOut" label={t('account.signOut')} disabled={busy} onPress={signOut}/>
        </View>)}
        {!account&&state?.sync?.accountId?<AccountButton theme={theme} testID="account.signOut" label={t('account.signOut')} disabled={busy} onPress={signOut}/>:null}
        <Pressable accessibilityRole="link" accessibilityLabel={t('account.privacy')} onPress={()=>{void Linking.openURL('https://github.com/patrickchin/puptime/blob/main/PRIVACY.md').catch(()=>Alert.alert(t('learn.linkError'),t('learn.linkErrorBody')));}} style={styles.privacy}><Text style={[styles.body,{color:theme.primary,textDecorationLine:'underline'}]}>{t('account.privacy')}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({
 root:{flex:1},content:{width:'100%',maxWidth:720,alignSelf:'center',padding:spacing.md,gap:spacing.md,paddingBottom:spacing.xl},header:{flexDirection:'row',alignItems:'flex-start',gap:12},back:{width:48,height:48,alignItems:'center',justifyContent:'center'},title:{flex:1},card:{borderWidth:1,padding:spacing.md,gap:12},summaryHeader:{flexDirection:'row',alignItems:'center',gap:12},eyebrow:{fontSize:14,fontWeight:'700',flex:1},puppy:{fontSize:25,lineHeight:32,fontWeight:'700'},status:{fontSize:16,lineHeight:23,fontWeight:'700'},body:{fontSize:16,lineHeight:24},label:{fontSize:16,lineHeight:23,fontWeight:'700'},stack:{gap:12},notice:{fontSize:16,lineHeight:24,padding:14},confirm:{flexDirection:'row',alignItems:'center',gap:12},grow:{flex:1},privacy:{minHeight:48,justifyContent:'center',alignSelf:'flex-start'},
});
