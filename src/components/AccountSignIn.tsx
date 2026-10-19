import {MaterialCommunityIcons} from '@expo/vector-icons';
import {useEffect,useState} from 'react';
import {ActivityIndicator,Keyboard,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import type {CloudHandle} from '../cloud/use-cloud';
import {useAccountSnapshot} from '../cloud/use-account-snapshot';
import type {AccountProblem} from '../cloud/account-controller';
import {useLocalization} from '../localization-context';
import type {MessageKey} from '../localization';
import type {Theme} from '../theme';

export function accountProblemKey(problem:AccountProblem|null):MessageKey|null {
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
  if(problem==='social-incomplete')return 'account.error.socialIncomplete';
  if(problem==='link-incomplete')return 'account.error.linkIncomplete';
  if(problem==='provider-unavailable'||problem==='server-error'||problem==='invalid-response'||problem==='account-deleted')return 'account.error.service';
  return 'account.error.signIn';
}
export function AccountSignIn({cloud,theme,showError=true,showIntro=true}:{cloud:CloudHandle;theme:Theme;showError?:boolean;showIntro?:boolean}) {
 const {t}=useLocalization(),state=useAccountSnapshot(cloud.controller);
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[editingEmail,setEditingEmail]=useState(false);
 const busy=state?.busy??false,account=state?.account;
 const configured=!!state?.config&&(state.config.providers.apple||state.config.providers.google||state.config.providers.email);
 const errorKey=accountProblemKey(state?.problem??null),bodyStyle={color:theme.textMuted};
 const inputStyle=[styles.input,{color:theme.text,backgroundColor:theme.surface,borderColor:theme.border,borderRadius:theme.presentation.controlRadius}];
 useEffect(()=>{if(state?.codeSentTo)setEmail(state.codeSentTo);if(account){setCode('');Keyboard.dismiss();}},[state?.codeSentTo,account?.user.id]);
 if(account)return null;
 return <View style={styles.stack}>
  {showError&&errorKey?<Text testID="account.error" accessibilityRole="alert" style={[styles.body,{color:theme.danger}]}>{t(errorKey)}</Text>:null}
  {!cloud.controller?<>
   {cloud.available&&!cloud.problem?<View style={styles.loading}><ActivityIndicator color={theme.primary}/><Text style={[styles.body,bodyStyle]}>{t('account.loading')}</Text></View>:<Text testID="account.unavailable" style={[styles.body,bodyStyle]}>{t(cloud.problem==='local-storage'?'account.error.storage':'account.unavailable')}</Text>}
   {cloud.problem==='local-storage'&&cloud.retry?<AccountButton theme={theme} testID="account.refresh" label={t('account.refresh')} onPress={cloud.retry}/>:null}
  </>:!state?.config?<>
   {!state?.problem?<View style={styles.loading}><ActivityIndicator color={theme.primary}/><Text style={[styles.body,bodyStyle]}>{t('account.loading')}</Text></View>:null}
   <AccountButton theme={theme} testID="account.refresh" label={t('account.refresh')} disabled={busy||!state?.online} onPress={()=>{void cloud.controller!.refresh();}}/>
  </>:<>
          {showIntro||!configured?<Text style={[styles.body,bodyStyle]}>{t(configured?'account.intro':'account.unavailable')}</Text>:null}
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

  </>}
 </View>;
}
export function AccountButton({theme,label,onPress,testID,primary=false,disabled=false,loading=false,icon}:{theme:Theme;label:string;onPress:()=>void;testID:string;primary?:boolean;disabled?:boolean;loading?:boolean;icon?:keyof typeof MaterialCommunityIcons.glyphMap}) {
  const color=disabled?theme.textMuted:primary?theme.onPrimary:theme.primary;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled,busy:loading}} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.button,{borderColor:theme.border,borderRadius:theme.presentation.controlRadius,backgroundColor:disabled?theme.surface:primary?(pressed?theme.primaryPressed:theme.primary):(pressed?theme.primarySoft:theme.surfaceRaised)}]}>
    {loading?<ActivityIndicator color={color}/>:icon?<MaterialCommunityIcons name={icon} size={22} color={color} accessibilityElementsHidden importantForAccessibility="no"/>:null}
    <Text style={[styles.buttonText,{color}]}>{label}</Text>
  </Pressable>;
}
const styles=StyleSheet.create({stack:{gap:12},body:{fontSize:16,lineHeight:24},label:{fontSize:16,lineHeight:23,fontWeight:'700'},input:{minHeight:52,borderWidth:1,paddingHorizontal:14,paddingVertical:12,fontSize:18},button:{minHeight:52,borderWidth:1,paddingHorizontal:16,paddingVertical:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},buttonText:{fontSize:16,lineHeight:22,fontWeight:'700',flexShrink:1,textAlign:'center'},loading:{flexDirection:'row',gap:12,alignItems:'center'}});
