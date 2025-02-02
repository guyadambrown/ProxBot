require('dotenv').config();
const {proxmoxApi} = require('proxmox-api');
const {Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, Permissions, SlashCommandBuilder, Colors, AttachmentBuilder} = require('discord.js');
const client = new Client({intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent});
const fs = require('fs');
let proxmoxOnline = true;
let globalCommands = true;
let statusMessage = false;



if (process.env.PROXMOX_HOST === undefined || process.env.PROXMOX_USER === undefined || process.env.PROXMOX_PASSWORD === undefined) {
    logMessage('The "PROXMOX_USER", "PROXMOX_PASSWORD" and "PROXMOX_HOST" variables are not set  - Bot will not start.');
    process.exit(1);
}

if (process.env.TOKEN === undefined) {
    logMessage('The "TOKEN" environment variable is not set! - Bot will not start.');
    process.exit(1);
}

if (process.env.OWNER_ID === undefined) {
    logMessage('The "OWNER_ID" environment variable is not set! - Messages will not be sent to the owner.');
} else {
    statusMessage = true;
    logMessage('Status messaging enabled!');
}

if (process.env.TESTING_GUILD_ID === undefined) {
    logMessage('The "TESTING_GUILD_ID" environment variable is not set! - Command will be created in all guilds.');
}else {
    globalCommands = false;
}

const proxmox = new proxmoxApi({
    host: process.env.PROXMOX_HOST,
    username: process.env.PROXMOX_USERNAME,
    password: process.env.PROXMOX_PASSWORD
});

client.on('ready', (bot) => {
   

    // Send a message to the console wiht the current date/time and the bot's username
    logMessage(`Logged in as ${bot.user.tag}`);
    client.user.setActivity('Monitoring proxmox');

    const hostInfo = new SlashCommandBuilder()
        .setName('hostinfo')
        .setDescription('Get information about the proxmox server');

    const vmInfo = new SlashCommandBuilder()
        .setName('vminfo')
        .setDescription('Get information about the virtual machines on the proxmox server');

    const VM = new SlashCommandBuilder()
        .setName('vm')
        .setDescription('Control the state of a virtual machine')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start a virtual machine')
                .addStringOption(option => option.setName('vmid').setDescription('The ID of the virtual machine').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('Stop a virtual machine')
                .addStringOption(option => option.setName('vmid').setDescription('The ID of the virtual machine').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reboot')
                .setDescription('Reboot a virtual machine')
                .addStringOption(option => option.setName('vmid').setDescription('The ID of the virtual machine').setRequired(true))
        );

    if (globalCommands) {
        client.application.commands.create(hostInfo);
        client.application.commands.create(vmInfo);
        client.application.commands.create(VM);
        logMessage('Command registered globally!');
    } else {
        client.application.commands.create(hostInfo, process.env.TESTING_GUILD_ID);
        client.application.commands.create(vmInfo, process.env.TESTING_GUILD_ID);
        client.application.commands.create(VM, process.env.TESTING_GUILD_ID);
        logMessage('Command registered!');
    }
    
});


// Command handler

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    

    if (commandName === 'hostinfo') {
        logMessage(`@${interaction.user.tag} ran /${commandName} in the "${interaction.guild.name}" guild.`);
        await interaction.reply('Probing the proxmox server...');
        const proxmoxStatus = await getProxmoxStatus();
        
        // Load the proxmox and VM logo from file, and create an attachment.
        const proxmoxLogoFile = new AttachmentBuilder('./data/images/proxmoxLogo.png');

        // Create the status embed
        const statusEmbed = await createStatusEmbed(proxmoxStatus);

        // Send the embeds and attachments.
        await interaction.editReply({embeds: [statusEmbed], files: [proxmoxLogoFile]});
        
    }

    if (commandName === 'vminfo') {
        logMessage(`@${interaction.user.tag} ran /${commandName} in the "${interaction.guild.name}" guild.`);
        await interaction.reply('Getting virtual machine information...');
        const proxmoxVMs = await getProxmoxVMs();
        const proxmoxLXC = await getProxmoxLXC();
        // Create the VM embed
        const vmEmbed = createVMEmbed(proxmoxVMs, proxmoxLXC);
        const vmIconFile = new AttachmentBuilder('./data/images/vmIcon.png');
        await interaction.editReply({embeds: [vmEmbed], files: [vmIconFile]});
    }

    if (commandName === 'vm') {
        const subcommand = interaction.options.getSubcommand();
        const vmid = interaction.options.getString('vmid');
        logMessage(`@${interaction.user.tag} ran "/${commandName} ${subcommand} ${vmid}" in the "${interaction.guild.name}" guild.`);
        
        
        switch (subcommand) {
            case 'start':
                await interaction.reply('Starting the virtual machine...');
                try {
                    await vmPowerOn(vmid);
                    await interaction.editReply('Virtual machine started!');
                } catch (error) {
                    await replyWithErrorMessage(interaction, error.message);
                    
                }
                break;
            case 'stop':
                await interaction.reply('Stopping the virtual machine...');
                try {
                    await vmPowerOff(vmid);
                    await interaction.editReply('Virtual machine stopped!');
                } catch (error) {
                    await replyWithErrorMessage(interaction, error.message);
                    
                }
                break;
            case 'reboot':
                await interaction.reply('Rebooting the virtual machine...');
                try {
                    await vmReboot(vmid);
                    await interaction.editReply('Virtual machine rebooted!');
                } catch (error) {
                    await replyWithErrorMessage(interaction, error.message);
                }
                break;
        }
    
    }

    
});

// Proxmox status functions

async function getProxmoxStatus() {
    if (!client.isReady()) {
        return null;
    }
    
    try {
    
        // Get the list of nodes
        const nodes = await proxmox.nodes.$get();
        
        // Get the first node's status
        const nodeStatus = await proxmox.nodes.$(nodes[0].node).status.$get();

        if (!proxmoxOnline) {

            proxmoxOnline = true;
            await client.users.cache.get(process.env.OWNER_ID).send('The proxmox server is back online!');
        }

        client.user.setActivity('CPU: ' + (nodeStatus.cpu * 100).toFixed(2) + '% | Mem: ' + (nodeStatus.memory.used / 1024 / 1024 / 1024).toFixed(2) + 'GB / ' + (nodeStatus.memory.total / 1024 / 1024 / 1024).toFixed(2) + 'GB');
        client.user.setStatus('online');

        return nodeStatus;

    } catch (error) {
        logMessage(error);
        if (proxmoxOnline) {
            client.user.setActivity('Proxmox offline!');
            client.user.setStatus('dnd');
            client.users.fetch(process.env.OWNER_ID).then(user => user.send('Proxmox server is offline!'));
            proxmoxOnline = false;
        }   
        
        
        return null;
    }

}

async function createStatusEmbed(proxmoxStatus) {

    const {usedGB, totalGB} = await humanReadableMemoryGigabyte(proxmoxStatus.memory.used, proxmoxStatus.memory.total);
    const {usedGB: swapUsedGB, totalGB: swapTotalGB} = await humanReadableMemoryGigabyte(proxmoxStatus.swap.used, proxmoxStatus.swap.total);
    const uptimeFormatted = await secondsToHumanReadable(proxmoxStatus.uptime);

    // Convert CPU usage to human readable format (decimal -> percentage)
    const cpuUsagePercentage = (proxmoxStatus.cpu * 100).toFixed(2);

    // Convert IO delay to human readable format.
     const ioDelayPercentage = (proxmoxStatus.wait * 100).toFixed(2);

    const statusEmbed = new EmbedBuilder()
            .setTitle(`Proxmox Status (${process.env.PROXMOX_HOST})`)
            .setColor(Colors.Orange)
            .setThumbnail('attachment://proxmoxLogo.png')
            .addFields(
                {name: 'Memory Usage', value: `${usedGB}GB / ${totalGB}GB`, inline: true},
                {name: 'Swap Usage', value: `${swapUsedGB}GB / ${swapTotalGB}GB`, inline: true},
                {name: 'Uptime', value: `${uptimeFormatted}`, inline: true},
                {name: 'CPU Usage', value: `${cpuUsagePercentage}%`, inline: true},
                {name: 'Load Average', value: `${proxmoxStatus.loadavg[0]}, ${proxmoxStatus.loadavg[1]}, ${proxmoxStatus.loadavg[2]}`, inline: true},
                {name: 'IO Delay', value: `${ioDelayPercentage}%`, inline: true},
                {name: 'Proxmox version', value: proxmoxStatus.pveversion},
                {name: 'Kernel version', value: proxmoxStatus.kversion}
            );
    return statusEmbed;

}

// Virtual Machine status functions

async function getProxmoxVMs() {

    // Get the list of nodes
    const nodes = await proxmox.nodes.$get();

    // Get vms from the first node
    const vms = await proxmox.nodes.$(nodes[0].node).qemu.$get();

    return vms;
}

async function getProxmoxLXC() {

    // Get the list of nodes
    const nodes = await proxmox.nodes.$get();

    // Get vms from the first node
    const lxc = await proxmox.nodes.$(nodes[0].node).lxc.$get();

    return lxc;
}

async function getProxmoxVMStatus(vmid) {
    const nodes = await proxmox.nodes.$get();
    try {
        const vmStatus = await proxmox.nodes.$(nodes[0].node).qemu.$(vmid).status.current.$get();
        return vmStatus;
    } catch (error) {
        return null;
    }
    
}

async function getProxmoxLXCStatus(vmid) {
    const nodes = await proxmox.nodes.$get();
    const lxcStatus = await proxmox.nodes.$(nodes[0].node).lxc.$(vmid).status.current.$get();
    return lxcStatus;
}

function createVMEmbed(proxmoxVMs, proxmoxLXC) {
    const vmEmbed = new EmbedBuilder()
            .setTitle('Virtual Machines')
            .setColor(Colors.Orange)
            .setThumbnail('attachment://vmIcon.png')

            proxmoxVMs.forEach(vm => {
                const status = vm.status === 'running' ? 'Running ✅' : 'Stopped ❌';
                vmEmbed.addFields(
                    {name: `${vm.name} (QEMU) (ID: ${vm.vmid})`, value: status, inline: false},
                );
            });

            proxmoxLXC.forEach(lxc => {
                const status = lxc.status === 'running' ? 'Running ✅' : 'Stopped ❌';
                vmEmbed.addFields(
                    {name: `${lxc.name} (LXC) (ID: ${lxc.vmid})`, value: status, inline: false},
                );
            });

            
            return vmEmbed;
}

// Virtual Machine control functions
async function vmPowerOn(vmid) {
    const nodes = await proxmox.nodes.$get();
    if (await getProxmoxVMStatus(vmid) === null) {
        throw new Error(`Virtual machine (VMID: ${vmid}) not found!`);
    }
    await proxmox.nodes.$(nodes[0].node).qemu.$(vmid).status.start.$post();
}

async function vmPowerOff(vmid) {
    const nodes = await proxmox.nodes.$get();
    if (await getProxmoxVMStatus(vmid) === null) {
        throw new Error(`Virtual machine (VMID: ${vmid}) not found!`);
    }
    await proxmox.nodes.$(nodes[0].node).qemu.$(vmid).status.stop.$post();
}

async function vmReboot(vmid) {
    const nodes = await proxmox.nodes.$get();
    if (await getProxmoxVMStatus(vmid) === null) {
        throw new Error(`Virtual machine (VMID: ${vmid}) not found!`);
    }
    await proxmox.nodes.$(nodes[0].node).qemu.$(vmid).status.reboot.$post();
}

// Utility functions

async function replyWithErrorMessage(interaction, message) {
    const errorEmbed = new EmbedBuilder()
    .setTitle('Error')
    .setColor(Colors.Red)
    .setDescription(message);
    await interaction.editReply({embeds: [errorEmbed]});
    logMessage(`Error: ${message}`);
}

async function humanReadableMemoryGigabyte(usedMem, totalMem) {
    // Convert memory usage from bytes to gigabytes
    const usedGB = (usedMem / 1024 / 1024 / 1024).toFixed(2);
    const totalGB = (totalMem / 1024 / 1024 / 1024).toFixed(2);
    return {usedGB, totalGB};
}

async function secondsToHumanReadable(secconds) {
    // Convert seconds to a date string
    const days = Math.floor(secconds / 86400);
    const hours = String(Math.floor(secconds % 86400 / 3600)).padStart(2, '0');
    const minutes = String(Math.floor(secconds % 3600 / 60)).padStart(2, '0');
    const seccond = String(Math.floor(secconds % 60)).padStart(2, '0');
    // Format the time string
    const timeFormatted = `${days} days, ${hours}:${minutes}:${seccond}`;
    return timeFormatted;
}

function logMessage(message) {
    // Get the current date and time
    let date = new Date().toLocaleString();

    // Look for a log file and write the message to it, if not, create a new one.
    let formattedMessage = `[${date}] ${message}`;

    fs.appendFileSync(`./data/logs/botlog.log`, formattedMessage + '\n');

    console.log(formattedMessage);
}

// Timers

setInterval(() => {
    getProxmoxStatus()
}, process.env.TIME_BETWEEN_CHECKS || 5000);

// Login to the bot using the token from the .env file
client.login(process.env.TOKEN);



