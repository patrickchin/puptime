import type {CloudHandle} from '../cloud/handle';
import {useAccountSnapshot} from '../cloud/use-account-snapshot';
import {useLocalization} from '../localization-context';
import {type Theme} from '../theme';
import {SettingsRow} from './SettingsRow';

export function AccountSettingsRow({cloud,theme,onOpen}:{cloud:CloudHandle;theme:Theme;onOpen:()=>void}) {
 const {t}=useLocalization(),state=useAccountSnapshot(cloud.controller);
 return <SettingsRow testID="settings.account.open" wrap icon="account-circle-outline" label={t('account.title')}
  detail={state?.account?.user.email??t(state?.sync?.accountId?'account.status.auth':'settings.accountDetail')} onPress={onOpen} theme={theme}/>;
}
