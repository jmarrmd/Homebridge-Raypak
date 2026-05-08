'use strict';

const axios = require('axios');

let Service, Characteristic;

// --- Conversion Helpers ---
// F to C: C = (F - 32) / 1.8
function FtoC(f) {
  return (f - 32) / 1.8;
}

// C to F: F = C * 1.8 + 32
function CtoF(c) {
  return (c * 1.8) + 32;
}
// --------------------------

module.exports = (api) => {
  if (!api || !api.registerPlatform) {
    throw new Error('This plugin requires Homebridge v1.3+ (new plugin API).');
  }
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  
  api.registerPlatform('homebridge-raymote', 'RaymotePlatform', RaymotePlatform, true);
};

class RaymotePlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;

    this.token = this.config.token || '';
    this.baseUrl = this.config.baseUrl || 'https://raymote.raypak.com/external/api';
    this.pollInterval = this.config.pollInterval || 30;
    
    this.heaterAccessories = {};
    this.cache = {};
    this._interval = null;
    
    if (!this.token) {
        this.log.error('❌ Plugin is not configured: Raymote Token is missing.');
        return;
    }

    if (this.api) {
      this.api.on('didFinishLaunching', () => {
        this.log.info('✨ RaymotePlatform finished launching, starting polling...');
        this.startPolling();
      });
    }
  }

  // --- Homebridge API Methods ---
  
  configureAccessory(accessory) {
    this.log.info('Restoring cached accessory:', accessory.displayName);
    this.heaterAccessories[accessory.displayName] = accessory;
  }

  accessories(callback) {
    callback([]);
  }

  // --- Custom Logic ---

  async fetchData() {
    const url = `${this.baseUrl}/getAll?token=${encodeURIComponent(this.token)}`;
    try {
      const res = await axios.get(url, { timeout: 8000 }); 
      return res.data;
    } catch (err) {
      this.log.debug('Error fetching Raymote data:', err.message); 
      return null;
    }
  }

  startPolling() {
    if (this._interval) clearInterval(this._interval);
    
    this.pollOnce();
    
    const seconds = Math.max(5, this.pollInterval);
    this._interval = setInterval(() => this.pollOnce(), seconds * 1000);
  }

  async pollOnce() {
    const data = await this.fetchData();
    if (!data) return;

    const mapped = {
      inlet1: safeFloat(data.v3),
      inlet2: safeFloat(data.v4),
      setpoint: safeFloat(data.v41),
      heaterOn: (data.v53 !== undefined) ? (String(data.v53) === '1' || String(data.v53).toLowerCase() === 'true') : false
    };

    this.cache = mapped;

    const accName = this.config.name || 'Raymote Pool Heater';
    let accessory = this.heaterAccessories[accName];

    if (!accessory) {
      accessory = this.createAccessory(accName);
      this.heaterAccessories[accName] = accessory;
      this.api.registerPlatformAccessories('homebridge-raymote', 'RaymotePlatform', [accessory]);
      this.log.info(`✅ Created and registered new accessory: ${accName}`);
    }

    this.updateAccessoryCharacteristics(accessory, mapped);
  }

  createAccessory(name) {
    const uuid = this.api.hap.uuid.generate(name);
    const accessory = new this.api.platformAccessory(name, uuid);

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'Raypak')
      .setCharacteristic(Characteristic.Model, 'Raymote Heater')
      .setCharacteristic(Characteristic.SerialNumber, uuid.substring(0, 8));

    const thermostatService = accessory.getService(Service.Thermostat) || accessory.addService(Service.Thermostat, name, 'THERMOSTAT');

    // Remove legacy Switch service if it exists on cached accessories
    const legacySwitch = accessory.getService(Service.Switch);
    if (legacySwitch) {
      accessory.removeService(legacySwitch);
    }

    // --- Thermostat Service Logic ---
    thermostatService.getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', (cb) => cb(null, FtoC(this.cache.inlet1 || this.cache.inlet2 || 0)));

    thermostatService.getCharacteristic(Characteristic.TargetTemperature)
      .setProps({
          minValue: FtoC(50), 
          maxValue: FtoC(104), 
          minStep: FtoC(1) - FtoC(0)
      })
      .on('get', (cb) => cb(null, FtoC(this.cache.setpoint || 80)))
      .on('set', async (value, cb) => {
        try {
          const targetF = CtoF(value); 
          await this.setSetpoint(targetF);
          this.cache.setpoint = targetF;
          cb(null);
        } catch (e) {
          cb(e);
        }
      });

    thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .on('get', (cb) => {
        const on = !!this.cache.heaterOn;
        cb(null, on ? Characteristic.CurrentHeatingCoolingState.HEAT : Characteristic.CurrentHeatingCoolingState.OFF);
      });

    thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      // 🚨 NEW CODE: Restrict modes to only OFF and HEAT
      .setProps({
          validValues: [
              Characteristic.TargetHeatingCoolingState.OFF,
              Characteristic.TargetHeatingCoolingState.HEAT
          ]
      })
      // ----------------------------------------------------
      .on('get', (cb) => {
         const on = !!this.cache.heaterOn;
         cb(null, on ? Characteristic.TargetHeatingCoolingState.HEAT : Characteristic.TargetHeatingCoolingState.OFF);
      })
      .on('set', async (value, cb) => {
        // HomeKit will only send OFF (0) or HEAT (1) now
        try {
            const desiredOn = (value === Characteristic.TargetHeatingCoolingState.OFF) ? false : true;
            await this.setHeater(desiredOn);
            this.cache.heaterOn = desiredOn;
            cb(null);
        } catch (e) {
            cb(e);
        }
      });

    thermostatService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .on('get', (cb) => cb(null, Characteristic.TemperatureDisplayUnits.FAHRENHEIT));
      
    return accessory;
  }

  updateAccessoryCharacteristics(accessory, mapped) {
    try {
      if (!accessory) return;
      
      const t = accessory.getService(Service.Thermostat);

      if (t) {
        const currentTempF = mapped.inlet1 || mapped.inlet2 || 0;
        t.updateCharacteristic(Characteristic.CurrentTemperature, FtoC(currentTempF));
        
        t.updateCharacteristic(Characteristic.TargetTemperature, FtoC(mapped.setpoint || 80));
        
        const mode = mapped.heaterOn ? Characteristic.CurrentHeatingCoolingState.HEAT : Characteristic.CurrentHeatingCoolingState.OFF;
        t.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, mode);
        
        const targetMode = mapped.heaterOn ? Characteristic.TargetHeatingCoolingState.HEAT : Characteristic.TargetHeatingCoolingState.OFF;
        t.updateCharacteristic(Characteristic.TargetHeatingCoolingState, targetMode);
      }
    } catch (e) {
      this.log.error('Error updating accessory values:', e.message);
    }
  }

  async setSetpoint(tempF) {
    const url = `${this.baseUrl}/update?token=${encodeURIComponent(this.token)}&v41=${encodeURIComponent(Math.round(tempF))}`;
    try {
      await axios.get(url, { timeout: 5000 });
      this.log.info(`Set temperature to ${tempF}F`);
    } catch (err) {
      this.log.error('Error setting setpoint:', (err && err.message) ? err.message : err);
      throw new Error('Failed to set setpoint via Raymote API.');
    }
  }

  async setHeater(on) {
    const val = on ? 1 : 0;
    const url = `${this.baseUrl}/update?token=${encodeURIComponent(this.token)}&v53=${encodeURIComponent(val)}`;
    try {
      await axios.get(url, { timeout: 5000 });
      this.log.info(`Turned heater ${on ? 'ON' : 'OFF'}`);
    } catch (err) {
      this.log.error('Error toggling heater:', (err && err.message) ? err.message : err);
      throw new Error('Failed to toggle heater via Raymote API.');
    }
  }
}

function safeFloat(v) {
  const n = parseFloat(v);
  return (isNaN(n) ? 0 : n);
}
