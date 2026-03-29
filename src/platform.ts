import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { RaypakHeaterAccessory } from './accessory';
import { RaypakApi } from './raypakApi';

export class RaypakPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly cachedAccessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('Raypak platform initialising');

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restoring cached accessory:', accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  private async discoverDevices(): Promise<void> {
    const { baseUrl, username, password } = this.config;

    if (!username || !password) {
      this.log.error(
        'Raypak: missing required config fields (username, password)',
      );
      return;
    }

    const apiClient = new RaypakApi(
      baseUrl as string | undefined ?? 'https://connected.raypak.com',
      username as string,
      password as string,
      this.log,
    );

    const devices = await apiClient.getDevices();

    if (devices.length === 0) {
      this.log.warn('Raypak: no heater devices found on this account');
      return;
    }

    // Track which UUIDs are still present so we can remove stale ones
    const activeUUIDs = new Set<string>();

    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(`raypak-${device.deviceId}`);
      activeUUIDs.add(uuid);

      const existing = this.cachedAccessories.find((a) => a.UUID === uuid);

      if (existing) {
        this.log.info('Restoring heater accessory:', existing.displayName);
        existing.context.device = device;
        new RaypakHeaterAccessory(this, existing, apiClient, device);
      } else {
        const displayName = device.name || 'Raypak Pool Heater';
        this.log.info('Adding new heater accessory:', displayName);
        const accessory = new this.api.platformAccessory(displayName, uuid);
        accessory.context.device = device;
        new RaypakHeaterAccessory(this, accessory, apiClient, device);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // Remove cached accessories for devices that no longer exist
    const stale = this.cachedAccessories.filter((a) => !activeUUIDs.has(a.UUID));
    if (stale.length > 0) {
      this.log.info(`Removing ${stale.length} stale accessory(ies)`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }
}
