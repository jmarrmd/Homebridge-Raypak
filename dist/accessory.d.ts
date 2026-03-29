import { PlatformAccessory } from 'homebridge';
import { RaypakPlatform } from './platform';
import { RaypakApi, HeaterDevice } from './raypakApi';
export declare class RaypakHeaterAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly apiClient;
    private readonly device;
    private readonly heaterService;
    private readonly pollIntervalMs;
    private lastStatus;
    constructor(platform: RaypakPlatform, accessory: PlatformAccessory, apiClient: RaypakApi, device: HeaterDevice);
    private handleActiveGet;
    private handleActiveSet;
    private handleCurrentStateGet;
    private handleCurrentTempGet;
    private handleTargetTempGet;
    private handleTargetTempSet;
    private poll;
}
//# sourceMappingURL=accessory.d.ts.map