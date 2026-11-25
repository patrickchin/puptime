import {KeyboardAvoidingView,Platform,ScrollView,StyleSheet} from 'react-native';
import {PuppyIdentity} from '../components/PuppyIdentity';
import {PuppyNameSetting} from '../components/PuppyNameSetting';
import {SettingsGroup} from '../components/SettingsGroup';
import {SettingsRow} from '../components/SettingsRow';
import type {CloudHandle} from '../cloud/handle';
import {useLocalization} from '../localization-context';
import {spacing,type Theme} from '../theme';
import {SharedPuppiesScreen} from './SharedPuppiesScreen';

export function PetsScreen({theme,cloud,shared,onOpenProfile,onOpenAccount,onOpenJournal}:{
  theme:Theme;cloud:CloudHandle;shared:boolean;onOpenProfile:()=>void;onOpenAccount:()=>void;onOpenJournal:()=>void;
}){
  const {t}=useLocalization();
  return <ScrollView testID="screen.pets" contentContainerStyle={styles.content}>
    <SettingsGroup theme={theme} label={t('pets.owned')} rows={[{
      key:'owner',visible:true,content:shared
        ?<SettingsRow theme={theme} testID="shared.ownPuppy" icon="paw-outline" label={t('sharing.ownPuppy')}
          detail={t('account.onDevice')} onPress={onOpenProfile} wrap/>
        :<PuppyIdentity theme={theme} showName onPress={onOpenProfile}/>,
    }]}/>
    <SharedPuppiesScreen cloud={cloud} theme={theme} onBack={onOpenJournal} onOpenAccount={onOpenAccount}/>
  </ScrollView>;
}

export function PuppyProfileScreen({theme,cloud,onShare}:{theme:Theme;cloud:CloudHandle;onShare:()=>void}){
  return <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={styles.fill}>
    <ScrollView testID="screen.puppyProfile" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.profile}>
      <PuppyNameSetting theme={theme} cloud={cloud} onShare={onShare}/>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles=StyleSheet.create({
  fill:{flex:1},
  content:{width:'100%',maxWidth:720,alignSelf:'center',paddingHorizontal:spacing.md,paddingBottom:spacing.xl},
  profile:{width:'100%',maxWidth:720,alignSelf:'center',padding:spacing.md,paddingBottom:spacing.xl},
});
