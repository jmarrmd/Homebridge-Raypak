import { Logger } from 'homebridge';
export interface HeaterDevice {
    deviceId: string;
    name: string;
    model: string;
    serialNumber: string;
    firmwareVersion: string;
}
export interface HeaterStatus {
    isOn: boolean;
    currentTemp: number;
    targetTemp: number;
    minTemp: number;
    maxTemp: number;
    isHeating: boolean;
    mode: 'heat' | 'standby';
    error: string | null;
}
export declare class RaypakApi {
    private readonly baseUrl;
    private readonly username;
    private readonly password;
    private readonly log;
    private readonly client;
    private readonly jar;
    private loggedIn;
    private accessToken;
    constructor(baseUrl: string, username: string, password: string, log: Logger);
    login(): Promise<boolean>;
    private ensureLoggedIn;
    getDevices(): Promise<HeaterDevice[]>;
    getStatus(deviceId: string): Promise<HeaterStatus | null>;
    setTargetTemperature(deviceId: string, temp: number): Promise<boolean>;
    setPowerState(deviceId: string, on: boolean): Promise<boolean>;
    private parseStatus;
}
//# sourceMappingURL=raypakApi.d.ts.map