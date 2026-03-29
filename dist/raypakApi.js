"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RaypakApi = void 0;
const axios_1 = require("axios");
const axios_cookiejar_support_1 = require("axios-cookiejar-support");
const tough_cookie_1 = require("tough-cookie");
const DEFAULT_BASE_URL = 'https://connected.raypak.com';
class RaypakApi {
    constructor(baseUrl, username, password, log) {
        this.baseUrl = baseUrl;
        this.username = username;
        this.password = password;
        this.log = log;
        this.loggedIn = false;
        this.accessToken = null;
        this.jar = new tough_cookie_1.CookieJar();
        this.client = (0, axios_cookiejar_support_1.wrapper)(axios_1.default.create({
            baseURL: (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ''),
            jar: this.jar,
            withCredentials: true,
            maxRedirects: 5,
            timeout: 15000,
        }));
    }
    async login() {
        try {
            this.log.debug('Raypak: attempting login...');
            const response = await this.client.post('/api/auth/login', {
                username: this.username,
                password: this.password,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = response.data;
            this.accessToken = data?.token ?? data?.accessToken ?? null;
            if (this.accessToken) {
                this.client.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
            }
            this.loggedIn = true;
            this.log.debug('Raypak: login successful');
            return true;
        }
        catch (err) {
            this.loggedIn = false;
            this.accessToken = null;
            this.log.error('Raypak: login failed:', err.message);
            return false;
        }
    }
    async ensureLoggedIn() {
        if (this.loggedIn) {
            return true;
        }
        return this.login();
    }
    async getDevices() {
        if (!(await this.ensureLoggedIn())) {
            return [];
        }
        try {
            const response = await this.client.get('/api/devices');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = response.data;
            const devices = Array.isArray(data) ? data : data?.devices ?? [];
            return devices.map((d) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const dev = d;
                return {
                    deviceId: String(dev.id ?? dev.deviceId ?? ''),
                    name: String(dev.name ?? dev.displayName ?? 'Raypak Heater'),
                    model: String(dev.model ?? dev.modelNumber ?? 'Unknown'),
                    serialNumber: String(dev.serialNumber ?? dev.serial ?? 'Unknown'),
                    firmwareVersion: String(dev.firmwareVersion ?? dev.firmware ?? '1.0'),
                };
            });
        }
        catch (err) {
            this.log.error('Raypak: failed to fetch devices:', err.message);
            // Session may have expired — try once more
            this.loggedIn = false;
            if (await this.login()) {
                try {
                    const response = await this.client.get('/api/devices');
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const data = response.data;
                    const devices = Array.isArray(data) ? data : data?.devices ?? [];
                    return devices.map((d) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const dev = d;
                        return {
                            deviceId: String(dev.id ?? dev.deviceId ?? ''),
                            name: String(dev.name ?? dev.displayName ?? 'Raypak Heater'),
                            model: String(dev.model ?? dev.modelNumber ?? 'Unknown'),
                            serialNumber: String(dev.serialNumber ?? dev.serial ?? 'Unknown'),
                            firmwareVersion: String(dev.firmwareVersion ?? dev.firmware ?? '1.0'),
                        };
                    });
                }
                catch (retryErr) {
                    this.log.error('Raypak: retry failed:', retryErr.message);
                }
            }
            return [];
        }
    }
    async getStatus(deviceId) {
        if (!(await this.ensureLoggedIn())) {
            return null;
        }
        try {
            const response = await this.client.get(`/api/devices/${deviceId}/status`);
            return this.parseStatus(response.data);
        }
        catch (err) {
            this.log.error('Raypak: failed to fetch status:', err.message);
            // Session expired — retry once
            this.loggedIn = false;
            if (await this.login()) {
                try {
                    const response = await this.client.get(`/api/devices/${deviceId}/status`);
                    return this.parseStatus(response.data);
                }
                catch (retryErr) {
                    this.log.error('Raypak: status retry failed:', retryErr.message);
                }
            }
            return null;
        }
    }
    async setTargetTemperature(deviceId, temp) {
        if (!(await this.ensureLoggedIn())) {
            return false;
        }
        try {
            await this.client.post(`/api/devices/${deviceId}/setpoint`, {
                temperature: temp,
            });
            this.log.debug(`Raypak: set target temperature to ${temp}°F`);
            return true;
        }
        catch (err) {
            this.log.error('Raypak: failed to set temperature:', err.message);
            return false;
        }
    }
    async setPowerState(deviceId, on) {
        if (!(await this.ensureLoggedIn())) {
            return false;
        }
        try {
            await this.client.post(`/api/devices/${deviceId}/power`, {
                state: on ? 'on' : 'off',
            });
            this.log.debug(`Raypak: set power state to ${on ? 'ON' : 'OFF'}`);
            return true;
        }
        catch (err) {
            this.log.error('Raypak: failed to set power state:', err.message);
            return false;
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parseStatus(data) {
        const status = data?.status ?? data ?? {};
        return {
            isOn: status.isOn === true || status.power === 'on' || status.powerState === true,
            currentTemp: parseFloat(status.currentTemp ?? status.waterTemp ?? status.currentTemperature) || 0,
            targetTemp: parseFloat(status.targetTemp ?? status.setpoint ?? status.targetTemperature) || 0,
            minTemp: parseFloat(status.minTemp ?? status.minSetpoint) || 60,
            maxTemp: parseFloat(status.maxTemp ?? status.maxSetpoint) || 104,
            isHeating: status.isHeating === true || status.heating === true ||
                status.burnerActive === true || status.flame === true,
            mode: status.mode === 'standby' ? 'standby' : 'heat',
            error: status.error ?? status.faultCode ?? status.errorCode ?? null,
        };
    }
}
exports.RaypakApi = RaypakApi;
//# sourceMappingURL=raypakApi.js.map