import type {CloudHandle} from '../cloud/handle';
import type {Theme} from '../theme';
import type {AssistantScreen} from '../assistant';
export type AssistantPanelProps={theme:Theme;cloud:CloudHandle;onClose:()=>void;onCommitted:()=>Promise<void>;onNavigate:(screen:AssistantScreen)=>void};
