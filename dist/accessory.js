"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RaypakHeaterAccessory = void 0;
const DEFAULT_POLL_INTERVAL_MINUTES = 1;
const FAHRENHEIT_TO_CELSIUS = (f) => (f - 32) * 5 / 9;
const CELSIUS_TO_FAHRENHEIT = (c) => c * 9 / 5 + 32;
class RaypakHeaterAccessory {
    constructor(platform, accessory, apiClient, device) {
        this.platform = platform;
        this.accessory = accessory;
        this.apiClient = apiClient;
        this.device = device;
        this.lastStatus = null;
        const { Service: Svc, Characteristic: Char } = platform;
        this.pollIntervalMs =
            (platform.config.pollInterval ?? DEFAULT_POLL_INTERVAL_MINUTES) *
                60 *
                1000;
        // ── Accessory Information ─────────────────────────────────────────────
        this.accessory
            .getService(Svc.AccessoryInformation)
            .setCharacteristic(Char.Manufacturer, 'Raypak')
            .setCharacteristic(Char.Model, device.model)
            .setCharacteristic(Char.SerialNumber, device.serialNumber)
            .setCharacteristic(Char.FirmwareRevision, device.firmwareVersion);
        // ── HeaterCooler Service ──────────────────────────────────────────────
        this.heaterService =
            this.accessory.getService(Svc.HeaterCooler) ??
                this.accessory.addService(Svc.HeaterCooler, device.name);
        this.heaterService.setCharacteristic(Char.Name, device.name);
        // Active (on/off)
        this.heaterService
            .getCharacteristic(Char.Active)
            .onGet(this.handleActiveGet.bind(this))
            .onSet(this.handleActiveSet.bind(this));
        // Current Heater-Cooler State (idle / heating)
        this.heaterService
            .getCharacteristic(Char.CurrentHeaterCoolerState)
            .onGet(this.handleCurrentStateGet.bind(this));
        // Target Heater-Cooler State (locked to HEAT for pool heater)
        this.heaterService
            .getCharacteristic(Char.TargetHeaterCoolerState)
            .setProps({
            validValues: [Char.TargetHeaterCoolerState.HEAT],
        })
            .onGet(() => Char.TargetHeaterCoolerState.HEAT)
            .onSet(() => {
            // Pool heater only supports heat mode — no-op
        });
        // Current Temperature
        this.heaterService
            .getCharacteristic(Char.CurrentTemperature)
            .setProps({ minValue: -40, maxValue: 100, minStep: 0.1 })
            .onGet(this.handleCurrentTempGet.bind(this));
        // Heating Threshold Temperature (target setpoint)
        this.heaterService
            .getCharacteristic(Char.HeatingThresholdTemperature)
            .setProps({
            minValue: FAHRENHEIT_TO_CELSIUS(60),
            maxValue: FAHRENHEIT_TO_CELSIUS(104),
            minStep: 0.5,
        })
            .onGet(this.handleTargetTempGet.bind(this))
            .onSet(this.handleTargetTempSet.bind(this));
        // ── Start polling ─────────────────────────────────────────────────────
        this.poll();
        setInterval(() => this.poll(), this.pollIntervalMs);
    }
    // ── Characteristic handlers ───────────────────────────────────────────
    handleActiveGet() {
        const { Characteristic: Char } = this.platform;
        if (!this.lastStatus) {
            return Char.Active.INACTIVE;
        }
        return this.lastStatus.isOn ? Char.Active.ACTIVE : Char.Active.INACTIVE;
    }
    async handleActiveSet(value) {
        const on = value === this.platform.Characteristic.Active.ACTIVE;
        this.platform.log.info(`Raypak: turning heater ${on ? 'ON' : 'OFF'}`);
        const ok = await this.apiClient.setPowerState(this.device.deviceId, on);
        if (!ok) {
            this.platform.log.error('Raypak: failed to set power state');
        }
    }
    handleCurrentStateGet() {
        const { Characteristic: Char } = this.platform;
        if (!this.lastStatus || !this.lastStatus.isOn) {
            return Char.CurrentHeaterCoolerState.INACTIVE;
        }
        return this.lastStatus.isHeating
            ? Char.CurrentHeaterCoolerState.HEATING
            : Char.CurrentHeaterCoolerState.IDLE;
    }
    handleCurrentTempGet() {
        if (!this.lastStatus) {
            return 0;
        }
        return FAHRENHEIT_TO_CELSIUS(this.lastStatus.currentTemp);
    }
    handleTargetTempGet() {
        if (!this.lastStatus) {
            return FAHRENHEIT_TO_CELSIUS(80);
        }
        return FAHRENHEIT_TO_CELSIUS(this.lastStatus.targetTemp);
    }
    async handleTargetTempSet(value) {
        const tempF = Math.round(CELSIUS_TO_FAHRENHEIT(value));
        this.platform.log.info(`Raypak: setting target temperature to ${tempF}°F`);
        const ok = await this.apiClient.setTargetTemperature(this.device.deviceId, tempF);
        if (!ok) {
            this.platform.log.error('Raypak: failed to set target temperature');
        }
    }
    // ── Polling ───────────────────────────────────────────────────────────
    async poll() {
        this.platform.log.debug('Raypak: polling heater status...');
        const status = await this.apiClient.getStatus(this.device.deviceId);
        if (!status) {
            this.platform.log.warn('Raypak: no status returned, will retry next interval');
            return;
        }
        this.lastStatus = status;
        const { Characteristic: Char } = this.platform;
        // Push all updates to HomeKit
        this.heaterService.updateCharacteristic(Char.Active, status.isOn ? Char.Active.ACTIVE : Char.Active.INACTIVE);
        this.heaterService.updateCharacteristic(Char.CurrentHeaterCoolerState, !status.isOn
            ? Char.CurrentHeaterCoolerState.INACTIVE
            : status.isHeating
                ? Char.CurrentHeaterCoolerState.HEATING
                : Char.CurrentHeaterCoolerState.IDLE);
        this.heaterService.updateCharacteristic(Char.CurrentTemperature, FAHRENHEIT_TO_CELSIUS(status.currentTemp));
        this.heaterService.updateCharacteristic(Char.HeatingThresholdTemperature, FAHRENHEIT_TO_CELSIUS(status.targetTemp));
        // Update setpoint range if the device reports different limits
        if (status.minTemp && status.maxTemp) {
            this.heaterService
                .getCharacteristic(Char.HeatingThresholdTemperature)
                .setProps({
                minValue: FAHRENHEIT_TO_CELSIUS(status.minTemp),
                maxValue: FAHRENHEIT_TO_CELSIUS(status.maxTemp),
                minStep: 0.5,
            });
        }
        // Log a summary
        this.platform.log.info(`[${this.accessory.displayName}] ` +
            `power=${status.isOn ? 'ON' : 'OFF'} | ` +
            `water=${status.currentTemp}°F | ` +
            `setpoint=${status.targetTemp}°F | ` +
            `heating=${status.isHeating}` +
            (status.error ? ` | FAULT: ${status.error}` : ''));
    }
}
exports.RaypakHeaterAccessory = RaypakHeaterAccessory;
//# sourceMappingURL=accessory.js.map