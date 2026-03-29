# homebridge-raymote

Raymote (Raypak) Homebridge plugin — UI-ready package.

## Configuration

This plugin is ready for the Homebridge UI. Simply install and configure via the settings screen.

If you are configuring manually in `config.json`:

```json
{
    "platforms": [
        {
            "platform": "RaymotePlatform",
            "name": "Raymote Pool Heater",
            "token": "YOUR_TOKEN_HERE"
        }
    ]
}