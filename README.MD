# ProxBot

ProxBot is a Discord bot designed to connect to a Proxmox host and provide status information. It also sends alerts to the user when an outage is detected. All settings can be configured through environment variables.

## Features

- Live status showing CPU and RAM usage.
- DM Notifcations in case of an outage.
- Customisable time between health checks.
- Basic VM power controls.

## Installation

1. Clone this repository.
2. Change directory into the repository
3. Install the required dependencies by running `npm install`.
4. Set up the necessary environment variables (see Configuration section).
5. Start the bot by running `npm .`.

## Configuration

ProxBot requires the following environment variables to be set:

> Please set `NODE_TLS_REJECT_UNAUTHORIZED` to `0` if you do not have a valid SSL certifcate configured.

- `PROXMOX_HOST`: The hostname or IP address of the Proxmox host.
- `PROXMOX_USERNAME`: The username to authenticate with the Proxmox host.
- `PROXMOX_PASSWORD`: The password to authenticate with the Proxmox host.
- `DISCORD_TOKEN`: The Discord bot token.

There are also some optional environment variables:

- `TESTING_GUILD_ID` : The is of a discord guild that you want to deploy the commands to.
- `TIME_BETWEEN_CHECKS` : The time in milliseconds between each health check. Also updated status.
- `OWNER_ID` : The user ID of the discord user that you want to alert if the server fails to respond.

## Usage

Once the bot is running and connected to your Discord server, you can use the following commands:

- `/proxinfo`: Get the current status of the Proxmox host, shows running VMs and LXC containers.

- `/vm {start/stop/reboot} {VMID}`: Allows a user to control the power state of a given VM

## Planned features
- Allow power controls for LXC containers.
- Allow the downloading of a spice file to view the console. (maybe - Only works on local network)

## Contributing

Contributions are welcome! If you have any suggestions or find any issues, please open an issue or submit a pull request.
