import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect,useState } from 'react';
import { ActivityIndicator,Alert,Keyboard,KeyboardAvoidingView,Linking,Pressable,ScrollView,StyleSheet,Switch,Text,TextInput,View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CloudHandle } from '../cloud/use-cloud';
import { useAccountSnapshot } from '../cloud/use-account-snapshot';
import { accountStatus } from '../cloud/account-status';
import type { AccountProblem } from '../cloud/account-controller';
import { useLocalization } from '../localization-context';
import type { MessageKey } from '../localization';
import { spacing,surfaceTreatment,type Theme } from '../theme';

function problemKey(problem:AccountProblem|null):MessageKey|null {
  if(!problem||['confirmation-required','pending-confirmation-required','auth-required','expired'].includes(problem))return null;
  if(problem==='invalid-email')return 'account.error.email';
  if(problem==='invalid-code')return 'account.error.code';
  if(problem==='code-expired')return 'account.error.expiredCode';
  if(problem==='too-many-attempts'||problem==='rate-limited')return 'account.error.attempts';
  if(problem==='network')return 'account.error.network';
  if(problem==='trial-unavailable')return 'account.error.trial';
  if(problem==='account-mismatch')return 'account.error.mismatch';
  if(problem==='sign-out-failed')return 'account.error.signOut';
  if(problem==='remote-sign-out-unconfirmed')return 'account.error.remoteSignOut';
  if(problem==='local-storage')return 'account.error.storage';
  if(problem==='provider-unavailable'||problem==='server-error'||problem==='invalid-response'||problem==='account-deleted')return 'account.error.service';
  return 'account.error.signIn';
}
export function AccountScreen({cloud,theme,eventCount,onBack,onOpenActivity}:{cloud:CloudHandle;theme:Theme;eventCount:number;onBack:()=>void;onOpenActivity:()=>void}) {
  const {t,locale}=useLocalization(),state=useAccountSnapshot(cloud.controller);
  const [localName,setLocalName]=useState<string|null>(null),[readFailed,setReadFailed]=useState(false);
  const [email,setEmail]=useState(''),[code,setCode]=useState(''),[editingEmail,setEditingEmail]=useState(false),[samePuppy,setSamePuppy]=useState(false);
  const account=state?.account,existing=account?.pets[0],busy=state?.busy??false;
  const status=accountStatus(state),errorKey=problemKey(state?.problem??(readFailed?'local-storage':null));
  const configured=!!state?.config&&(state.config.providers.apple||state.config.providers.google||state.config.providers.email);
  const enrolled=!!state?.sync?.accountId&&state.sync.state!=='local';
  const days=state?.config?.trialDays??14;
  useEffect(()=>{let mounted=true;cloud.getLocalName().then(name=>{if(mounted)setLocalName(name);}).catch(()=>{if(mounted)setReadFailed(true);});return()=>{mounted=false;};},[cloud.getLocalName]);
  useEffect(()=>{setSamePuppy(false);},[account?.user.id,existing?.id]);
  useEffect(()=>{if(state?.codeSentTo)setEmail(state.codeSentTo);if(account)Keyboard.dismiss();},[state?.codeSentTo,account?.user.id]);
  const titleStyle={color:theme.text,fontFamily:theme.presentation.headingFont,fontSize:theme.presentation.titleSize,lineHeight:theme.presentation.titleLineHeight,fontWeight:theme.presentation.titleWeight};
  const bodyStyle={color:theme.textMuted};
  const cardStyle=[styles.card,surfaceTreatment(theme),{backgroundColor:theme.surfaceRaised,borderColor:theme.border,borderRadius:theme.presentation.cardRadius}];
  const inputStyle=[styles.input,{color:theme.text,backgroundColor:theme.surface,borderColor:theme.border,borderRadius:theme.presentation.controlRadius}];
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
          <Pressable testID="account.back" accessibilityRole="button" accessibilityLabel={t('account.back')} onPress={onBack} style={({pressed})=>[styles.back,{backgroundColor:pressed?theme.primarySoft:theme.surfaceRaised,borderRadius:theme.presentation.controlRadius}]}>
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
        {errorKey?<Text testID="account.error" accessibilityRole="alert" style={[styles.notice,{color:theme.danger,backgroundColor:theme.dangerSoft,borderRadius:theme.presentation.controlRadius}]}>{t(errorKey)}</Text>:null}
        {!cloud.controller?(<Text testID="account.unavailable" style={[styles.body,bodyStyle]}>{t(cloud.problem==='local-storage'?'account.error.storage':'account.unavailable')}</Text>):!state?.config?(<View style={styles.stack}>{!state?.problem?<View style={styles.loading}><ActivityIndicator color={theme.primary}/><Text style={[styles.body,bodyStyle]}>{t('account.loading')}</Text></View>:null}<AccountButton theme={theme} testID="account.refresh" label={t('account.refresh')} disabled={busy||!state?.online} onPress={()=>{void cloud.controller!.refresh();}}/></View>):!account?(<View style={styles.stack}>
          <Text style={[styles.body,bodyStyle]}>{configured?t('account.intro'):t('account.unavailable')}</Text>
          {state.config.providers.apple?<AccountButton theme={theme} testID="account.apple" label={t('account.apple')} icon="apple" disabled={busy||!state.online} onPress={()=>{void cloud.controller!.signInSocial('apple');}}/>:null}
          {state.config.providers.google?<AccountButton theme={theme} testID="account.google" label={t('account.google')} icon="google" disabled={busy||!state.online} onPress={()=>{void cloud.controller!.signInSocial('google');}}/>:null}
          {state.config.providers.email?state.codeSentTo&&!editingEmail?(<View style={styles.stack}>
            <Text style={[styles.body,{color:theme.text}]}>{t('account.codeSent',{email:state.codeSentTo})}</Text>
            <Text style={[styles.label,{color:theme.text}]}>{t('account.code')}</Text>
            <TextInput testID="account.code.input" accessibilityLabel={t('account.code')} style={inputStyle} value={code} onChangeText={text=>setCode(text.replace(/\D/g,'').slice(0,6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} selectTextOnFocus editable={!busy} />
            <AccountButton theme={theme} testID="account.verify" label={t('account.verify')} primary disabled={busy||!state.online||code.length!==6} loading={busy} onPress={()=>{void cloud.controller!.verifyEmail(state.codeSentTo!,code);}}/>
            <AccountButton theme={theme} testID="account.resend" label={t('account.resend')} disabled={busy||!state.online} onPress={()=>{setCode('');void cloud.controller!.requestEmail(state.codeSentTo!);}}/>
            <AccountButton theme={theme} testID="account.changeEmail" label={t('account.changeEmail')} disabled={busy} onPress={()=>{setEditingEmail(true);setCode('');}}/>
          </View>):(<View style={styles.stack}>
            <Text style={[styles.label,{color:theme.text}]}>{t('account.email')}</Text>
            <TextInput testID="account.email.input" accessibilityLabel={t('account.email')} style={inputStyle} value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" autoCapitalize="none" autoCorrect={false} editable={!busy} returnKeyType="send" onSubmitEditing={()=>{if(!busy)void cloud.controller!.requestEmail(email).then(result=>{if(result==='ok')setEditingEmail(false);});}} />
            <AccountButton theme={theme} testID="account.sendCode" label={t('account.sendCode')} primary disabled={busy||!state.online||!email.trim()} loading={busy} onPress={()=>{void cloud.controller!.requestEmail(email).then(result=>{if(result==='ok')setEditingEmail(false);});}}/>
          </View>):null}
          <AccountButton theme={theme} testID="account.refresh" label={t('account.refresh')} disabled={busy||!state.online} onPress={()=>{void cloud.controller!.refresh();}}/>
        </View>):(<View style={styles.stack}>
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
            {state!.sync!.pending?<Text style={[styles.body,{color:theme.text}]}>{t('account.pending',{count:state!.sync!.pending})}</Text>:null}
            {state!.sync!.blocked?<><Text style={[styles.body,bodyStyle]}>{t('account.blocked',{count:state!.sync!.blocked})}</Text><AccountButton theme={theme} testID="account.viewLogs" label={t('account.viewLogs')} onPress={onOpenActivity}/></>:null}
            {status==='expired'||status==='offline'||status==='paused'?<Text style={[styles.body,bodyStyle]}>{t('account.pausedBody')}</Text>:null}
            {account.cloud.expiresAt?<Text style={[styles.body,bodyStyle]}>{t('account.expires',{date:new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(account.cloud.expiresAt)})}</Text>:null}
            <AccountButton theme={theme} testID="account.retry" label={t(status==='expired'?'account.refresh':'account.retry')} disabled={busy||state!.running||!state!.online} onPress={()=>{void cloud.controller!.retry();}}/>
          </View>)}
          <AccountButton theme={theme} testID="account.signOut" label={t('account.signOut')} disabled={busy} onPress={signOut}/>
        </View>)}
        <Pressable accessibilityRole="link" accessibilityLabel={t('account.privacy')} onPress={()=>{void Linking.openURL('https://github.com/patrickchin/puptime/blob/main/PRIVACY.md').catch(()=>Alert.alert(t('learn.linkError'),t('learn.linkErrorBody')));}} style={styles.privacy}><Text style={[styles.body,{color:theme.primary,textDecorationLine:'underline'}]}>{t('account.privacy')}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
function AccountButton({theme,label,onPress,testID,primary=false,disabled=false,loading=false,icon}:{theme:Theme;label:string;onPress:()=>void;testID:string;primary?:boolean;disabled?:boolean;loading?:boolean;icon?:keyof typeof MaterialCommunityIcons.glyphMap}) {
  const color=disabled?theme.textMuted:primary?theme.onPrimary:theme.primary;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled,busy:loading}} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.button,{borderColor:theme.border,borderRadius:theme.presentation.controlRadius,backgroundColor:disabled?theme.surface:primary?(pressed?theme.primaryPressed:theme.primary):(pressed?theme.primarySoft:theme.surfaceRaised)}]}>
    {loading?<ActivityIndicator color={color}/>:icon?<MaterialCommunityIcons name={icon} size={22} color={color} accessibilityElementsHidden importantForAccessibility="no"/>:null}
    <Text style={[styles.buttonText,{color}]}>{label}</Text>
  </Pressable>;
}
const styles=StyleSheet.create({
 root:{flex:1},content:{width:'100%',maxWidth:720,alignSelf:'center',padding:spacing.md,gap:spacing.md,paddingBottom:spacing.xl},header:{flexDirection:'row',alignItems:'flex-start',gap:12},back:{width:48,height:48,alignItems:'center',justifyContent:'center'},title:{flex:1},card:{borderWidth:1,padding:spacing.md,gap:12},summaryHeader:{flexDirection:'row',alignItems:'center',gap:12},eyebrow:{fontSize:14,fontWeight:'700',flex:1},puppy:{fontSize:25,lineHeight:32,fontWeight:'700'},status:{fontSize:16,lineHeight:23,fontWeight:'700'},body:{fontSize:16,lineHeight:24},label:{fontSize:16,lineHeight:23,fontWeight:'700'},stack:{gap:12},input:{minHeight:52,borderWidth:1,paddingHorizontal:14,paddingVertical:12,fontSize:18},button:{minHeight:52,borderWidth:1,paddingHorizontal:16,paddingVertical:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},buttonText:{fontSize:16,lineHeight:22,fontWeight:'700',flexShrink:1,textAlign:'center'},notice:{fontSize:16,lineHeight:24,padding:14},loading:{flexDirection:'row',gap:12,alignItems:'center'},confirm:{flexDirection:'row',alignItems:'center',gap:12},grow:{flex:1},privacy:{minHeight:48,justifyContent:'center',alignSelf:'flex-start'},
});
