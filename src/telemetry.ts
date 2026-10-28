import { createProductTelemetry, type TelemetryScreen } from './product-telemetry';

// The website owns its separate consent-controlled browser client.
export const appTelemetryConfigured = false;
export const productTelemetry = createProductTelemetry(() => {});
export const initializeAppTelemetry = async () => false;
export const setAppTelemetryEnabled = async (_enabled: boolean) => {};
export const flushAppTelemetry = () => {};
export function useTelemetryOverlay(_screen: TelemetryScreen, _visible: boolean) {}
