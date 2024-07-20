require('dotenv').config();
const {proxmoxApi} = require('proxmox-api');
const {Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, Permissions, SlashCommandBuilder, Colors, AttachmentBuilder} = require('discord.js');
const client = new Client({intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent});
let proxmoxOnline = true;
let statusMessage = false;
let globalCommands = true;          

if (process.env.PROXMOX_HOST === undefined || process.env.PROXMOX_USER === undefined || process.env.PROXMOX_PASSWORD === undefined) {
    console.error('The "PROXMOX_USER", "PROXMOX_PASSWORD" and "PROXMOX_HOST" variables are not set  - Bot will not start.');
    process.exit(1);
}

if (process.env.TOKEN === undefined) {
    console.error('The "TOKEN" environment variable is not set! - Bot will not start.');
    process.exit(1);
}

if (process.env.OWNER_ID === undefined) {
    console.error('The "OWNER_ID" environment variable is not set! - Messages will not be sent to the owner.');
} else {
    statusMessage = true;
    console.log('Status messaging enabled!');
}

if (process.env.TESTING_GUILD_ID === undefined) {
    console.error('The "TESTING_GUILD_ID" environment variable is not set! - Command will be created in all guilds.');
}else {
    globalCommands = false;
}



client.on('ready', (bot) => {
   

    // Send a message to the console wiht the current date/time and the bot's username
    console.log(`[${new Date().toLocaleString()}] Logged in as ${bot.user.tag}`);
    client.user.setActivity('Monitoring proxmox');

    const proxinfo = new SlashCommandBuilder()
    .setName('proxinfo')
    .setDescription('Get information about the proxmox server');

    if (globalCommands) {
        client.application.commands.create(proxinfo);
        console.log('Command registered globally!');
    } else {
        client.application.commands.create(proxinfo, process.env.TESTING_GUILD_ID);
        console.log('Command registered!');
    }
    
});

// Set an interval to check the proxmox server status every 5 seconds
setInterval(() => {
    getProxmoxStatus()
}, process.env.TIME_BETWEEN_CHECKS || 5000);

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'proxinfo') {
        await interaction.reply('Probing the proxmox server...');
        const proxmoxStatus = await getProxmoxStatus();
        const proxmoxVMs = await getProxmoxVMs();
        const proxmoxLXC = await getProxmoxLXC();
        
        if (!proxmoxStatus) {
            await replyWithErrorMessage(interaction, 'Failed to get proxmox status!');
            return;

        } else {
            // Load the proxmox and VM logo from file, and create an attachment.
            const proxmoxLogoFile = new AttachmentBuilder('./data/images/proxmoxLogo.png');
            const vmIconFile = new AttachmentBuilder('./data/images/vmIcon.png');

            // Create the status embed
            const statusEmbed = await createStatusEmbed(proxmoxStatus);

            // Create the VM embed
            const vmEmbed = createVMEmbed(proxmoxVMs, proxmoxLXC);

            // Send the embeds and attachments.
            await interaction.editReply({embeds: [statusEmbed, vmEmbed], files: [proxmoxLogoFile, vmIconFile]});
        }
    }
});

async function getProxmoxStatus() {
    if (!client.isReady()) {
        return null;
    }
    
    try {
        const proxmox = new proxmoxApi({
            host: process.env.PROXMOX_HOST,
            username: process.env.PROXMOX_USERNAME,
            password: process.env.PROXMOX_PASSWORD
        });
    
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
        console.error(error);
        if (proxmoxOnline) {
            client.user.setActivity('Proxmox offline!');
            client.user.setStatus('dnd');
            client.users.fetch(process.env.OWNER_ID).then(user => user.send('Proxmox server is offline!'));
            proxmoxOnline = false;
        }   
        
        
        return null;
    }

}

async function getProxmoxVMs() {
    const proxmox = new proxmoxApi({
        host: process.env.PROXMOX_HOST,
        username: process.env.PROXMOX_USERNAME,
        password: process.env.PROXMOX_PASSWORD
    });

    // Get the list of nodes
    const nodes = await proxmox.nodes.$get();

    // Get vms from the first node
    const vms = await proxmox.nodes.$(nodes[0].node).qemu.$get();

    return vms;
}

async function getProxmoxLXC() {
    const proxmox = new proxmoxApi({
        host: process.env.PROXMOX_HOST,
        username: process.env.PROXMOX_USERNAME,
        password: process.env.PROXMOX_PASSWORD
    });

    // Get the list of nodes
    const nodes = await proxmox.nodes.$get();

    // Get vms from the first node
    const lxc = await proxmox.nodes.$(nodes[0].node).lxc.$get();

    return lxc;
}

async function replyWithErrorMessage(interaction, message) {
    const errorEmbed = new EmbedBuilder()
    .setTitle('Error')
    .setColor(Colors.Red)
    .setDescription(message);
    await interaction.editReply({embeds: [errorEmbed]});
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

client.login(process.env.TOKEN);



