import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
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
  currentTemp: number;       // current water temperature in °F
  targetTemp: number;        // desired temperature setpoint in °F
  minTemp: number;           // minimum allowed setpoint in °F
  maxTemp: number;           // maximum allowed setpoint in °F
  isHeating: boolean;        // actively firing / heating
  mode: 'heat' | 'standby';
  error: string | null;      // active fault code, if any
}

const DEFAULT_BASE_URL = 'https://connected.raypak.com';

export class RaypakApi {
  private readonly client: AxiosInstance;
  private readonly jar: CookieJar;
  private loggedIn = false;
  private accessToken: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
    private readonly log: Logger,
  ) {
    this.jar = new CookieJar();
    this.client = wrapper(
      axios.create({
        baseURL: (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ''),
        jar: this.jar,
        withCredentials: true,
        maxRedirects: 5,
        timeout: 15000,
      }),
    );
  }

  async login(): Promise<boolean> {
    try {
      this.log.debug('Raypak: attempting login...');
      const response = await this.client.post('/api/auth/login', {
        username: this.username,
        password: this.password,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = response.data as any;
      this.accessToken = data?.token ?? data?.accessToken ?? null;

      if (this.accessToken) {
        this.client.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
      }

      this.loggedIn = true;
      this.log.debug('Raypak: login successful');
      return true;
    } catch (err) {
      this.loggedIn = false;
      this.accessToken = null;
      this.log.error('Raypak: login failed:', (err as Error).message);
      return false;
    }
  }

  private async ensureLoggedIn(): Promise<boolean> {
    if (this.loggedIn) {
      return true;
    }
    return this.login();
  }

  async getDevices(): Promise<HeaterDevice[]> {
    if (!(await this.ensureLoggedIn())) {
      return [];
    }

    try {
      const response = await this.client.get('/api/devices');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = response.data as any;
      const devices: unknown[] = Array.isArray(data) ? data : data?.devices ?? [];

      return devices.map((d: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dev = d as any;
        return {
          deviceId: String(dev.id ?? dev.deviceId ?? ''),
          name: String(dev.name ?? dev.displayName ?? 'Raypak Heater'),
          model: String(dev.model ?? dev.modelNumber ?? 'Unknown'),
          serialNumber: String(dev.serialNumber ?? dev.serial ?? 'Unknown'),
          firmwareVersion: String(dev.firmwareVersion ?? dev.firmware ?? '1.0'),
        };
      });
    } catch (err) {
      this.log.error('Raypak: failed to fetch devices:', (err as Error).message);
      // Session may have expired — try once more
      this.loggedIn = false;
      if (await this.login()) {
        try {
          const response = await this.client.get('/api/devices');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = response.data as any;
          const devices: unknown[] = Array.isArray(data) ? data : data?.devices ?? [];

          return devices.map((d: unknown) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dev = d as any;
            return {
              deviceId: String(dev.id ?? dev.deviceId ?? ''),
              name: String(dev.name ?? dev.displayName ?? 'Raypak Heater'),
              model: String(dev.model ?? dev.modelNumber ?? 'Unknown'),
              serialNumber: String(dev.serialNumber ?? dev.serial ?? 'Unknown'),
              firmwareVersion: String(dev.firmwareVersion ?? dev.firmware ?? '1.0'),
            };
          });
        } catch (retryErr) {
          this.log.error('Raypak: retry failed:', (retryErr as Error).message);
        }
      }
      return [];
    }
  }

  async getStatus(deviceId: string): Promise<HeaterStatus | null> {
    if (!(await this.ensureLoggedIn())) {
      return null;
    }

    try {
      const response = await this.client.get(`/api/devices/${deviceId}/status`);
      return this.parseStatus(response.data);
    } catch (err) {
      this.log.error('Raypak: failed to fetch status:', (err as Error).message);
      // Session expired — retry once
      this.loggedIn = false;
      if (await this.login()) {
        try {
          const response = await this.client.get(`/api/devices/${deviceId}/status`);
          return this.parseStatus(response.data);
        } catch (retryErr) {
          this.log.error('Raypak: status retry failed:', (retryErr as Error).message);
        }
      }
      return null;
    }
  }

  async setTargetTemperature(deviceId: string, temp: number): Promise<boolean> {
    if (!(await this.ensureLoggedIn())) {
      return false;
    }

    try {
      await this.client.post(`/api/devices/${deviceId}/setpoint`, {
        temperature: temp,
      });
      this.log.debug(`Raypak: set target temperature to ${temp}°F`);
      return true;
    } catch (err) {
      this.log.error('Raypak: failed to set temperature:', (err as Error).message);
      return false;
    }
  }

  async setPowerState(deviceId: string, on: boolean): Promise<boolean> {
    if (!(await this.ensureLoggedIn())) {
      return false;
    }

    try {
      await this.client.post(`/api/devices/${deviceId}/power`, {
        state: on ? 'on' : 'off',
      });
      this.log.debug(`Raypak: set power state to ${on ? 'ON' : 'OFF'}`);
      return true;
    } catch (err) {
      this.log.error('Raypak: failed to set power state:', (err as Error).message);
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseStatus(data: any): HeaterStatus {
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
