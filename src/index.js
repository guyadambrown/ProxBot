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
            const errorEmbed = new EmbedBuilder()
            .setTitle('Error')
            .setColor(Colors.Red)
            .setDescription('Could not connect to the Proxmox server!');
            await interaction.editReply({embeds: [errorEmbed]});
            return;

        } else {
            // Convert memory usage to human readable format
            const usedGB = (proxmoxStatus.memory.used / 1024 / 1024 / 1024).toFixed(2);
            const totalGB = (proxmoxStatus.memory.total / 1024 / 1024 / 1024).toFixed(2);

            // Convert swap usage to human readable format
            const swapUsedGB = (proxmoxStatus.swap.used / 1024 / 1024 / 1024).toFixed(2);
            const swapTotalGB = (proxmoxStatus.swap.total / 1024 / 1024 / 1024).toFixed(2);

            // Convert uptime to human readable format
            const uptime = proxmoxStatus.uptime;
            const uptimeDays = Math.floor(uptime / 86400);
            const uptimeHours = String(Math.floor(uptime % 86400 / 3600)).padStart(2, '0');
            const uptimeMinutes = String(Math.floor(uptime % 3600 / 60)).padStart(2, '0');
            const uptimeSeconds = String(Math.floor(uptime % 60)).padStart(2, '0');

            const uptimeFormatted = `${uptimeDays} days, ${uptimeHours}:${uptimeMinutes}:${uptimeSeconds}`;

            // Convert CPU usage to human readable format (decimal -> percentage)
            const cpuUsageDecimal = proxmoxStatus.cpu;
            const cpuUsagePercentage = cpuUsageDecimal * 100;

            // Convert IO delay to human readable format.
            const ioDelayDecimal = proxmoxStatus.wait;
            const ioDelayPercentage = ioDelayDecimal * 100;

            // Load the proxmox logo from file, and create an attachment.
            const proxmoxLogoFile = new AttachmentBuilder('./data/images/proxmoxLogo.png');

            // Load the vm logo from file, and create an attachment.
            const vmIconFile = new AttachmentBuilder('./data/images/vmIcon.png');


            const statusEmbed = new EmbedBuilder()
            .setTitle(`Proxmox Status (${process.env.PROXMOX_HOST})`)
            .setThumbnail('attachment://proxmoxLogo.png')
            .setColor(Colors.Orange)
            .addFields(
                {name: 'Memory Usage', value: `${usedGB} / ${totalGB} GB`, inline: true},
                {name: 'Swap Usage', value: `${swapUsedGB} / ${swapTotalGB} GB`, inline: true},
                {name: 'Uptime', value: `${uptimeFormatted}`, inline: true},
                {name: 'CPU Usage', value: `${cpuUsagePercentage.toFixed(2)}%`, inline: true},
                {name: 'Load Average', value: `${proxmoxStatus.loadavg[0]}, ${proxmoxStatus.loadavg[1]}, ${proxmoxStatus.loadavg[2]}`, inline: true},
                {name: 'IO Delay', value: `${ioDelayPercentage.toFixed(2)}%`, inline: true},
                {name: 'Proxmox version', value: proxmoxStatus.pveversion},
                {name: 'Kernel version', value: proxmoxStatus.kversion}
            );

            // Embed to show the list of virtual machines

            const vmEmbed = new EmbedBuilder()
            .setTitle('Virtual Machines')
            .setColor(Colors.Orange)
            .setThumbnail('attachment://vmIcon.png')

            for (const vm of proxmoxVMs) {
                if (vm.status === 'running') {
                    vm.status = 'Running ✅';
                    
                } else {
                    vm.status = 'Stopped ❌';
                }

                vmEmbed.addFields(
                    {name: `${vm.name} (QEMU) (ID: ${vm.vmid})`, value: vm.status, inline: false},
                );
            }

            for (const lxc of proxmoxLXC) {
                if (lxc.status === 'running') {
                    lxc.status = 'Running ✅';

                } else {
                    lxc.status = 'Stopped ❌';
                }

                vmEmbed.addFields(
                    {name: `${lxc.name} (LXC) (ID: ${lxc.vmid})`, value: lxc.status, inline: false},
                );
            }
            
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
            console.log(process.env.OWNER_ID);
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

client.login(process.env.TOKEN);



