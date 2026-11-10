import MarketingSite from '../App.web';
import AccountPage from '../src/web/AccountPage';
import { isAppSurface } from '../src/web/origins';

export default isAppSurface ? AccountPage : MarketingSite;
