"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RaypakPlatform = void 0;
const settings_1 = require("./settings");
const accessory_1 = require("./accessory");
const raypakApi_1 = require("./raypakApi");
class RaypakPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.cachedAccessories = [];
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.log.debug('Raypak platform initialising');
        this.api.on('didFinishLaunching', () => {
            this.discoverDevices();
        });
    }
    configureAccessory(accessory) {
        this.log.info('Restoring cached accessory:', accessory.displayName);
        this.cachedAccessories.push(accessory);
    }
    async discoverDevices() {
        const { baseUrl, username, password } = this.config;
        if (!username || !password) {
            this.log.error('Raypak: missing required config fields (username, password)');
            return;
        }
        const apiClient = new raypakApi_1.RaypakApi(baseUrl ?? 'https://connected.raypak.com', username, password, this.log);
        const devices = await apiClient.getDevices();
        if (devices.length === 0) {
            this.log.warn('Raypak: no heater devices found on this account');
            return;
        }
        // Track which UUIDs are still present so we can remove stale ones
        const activeUUIDs = new Set();
        for (const device of devices) {
            const uuid = this.api.hap.uuid.generate(`raypak-${device.deviceId}`);
            activeUUIDs.add(uuid);
            const existing = this.cachedAccessories.find((a) => a.UUID === uuid);
            if (existing) {
                this.log.info('Restoring heater accessory:', existing.displayName);
                existing.context.device = device;
                new accessory_1.RaypakHeaterAccessory(this, existing, apiClient, device);
            }
            else {
                const displayName = device.name || 'Raypak Pool Heater';
                this.log.info('Adding new heater accessory:', displayName);
                const accessory = new this.api.platformAccessory(displayName, uuid);
                accessory.context.device = device;
                new accessory_1.RaypakHeaterAccessory(this, accessory, apiClient, device);
                this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
            }
        }
        // Remove cached accessories for devices that no longer exist
        const stale = this.cachedAccessories.filter((a) => !activeUUIDs.has(a.UUID));
        if (stale.length > 0) {
            this.log.info(`Removing ${stale.length} stale accessory(ies)`);
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
        }
    }
}
exports.RaypakPlatform = RaypakPlatform;
//# sourceMappingURL=platform.js.map