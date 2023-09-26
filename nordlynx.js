#!/usr/bin/env node

const Promise = require('bluebird')
const rp = require('request-promise')
const fs = require('fs')
const readFileAsync = Promise.promisify(fs.readFile)
const writeFileAsync = Promise.promisify(fs.writeFile)
const exec = require('child-process-promise').exec

const CONFIG = JSON.parse(fs.readFileSync(`${__dirname}/nordconf.json`))
const NETIF = 'lynx'
const PROFILE_PATH = '/home/pi/.firewalla/run/wg_profile/'
const API = {
    baseUrl: 'https://api.nordvpn.com',
    statsPath: '/server/stats/',
    serversPath: '/v1/servers/',
}
const NOW = new Date().toISOString();

'use strict'

function debugLog(log) {
    if(CONFIG.debug) {
        console.log(log);
    }
}

async function apiRequest(path, filters, limit) {
    let url = `${API.baseUrl}${path}`;

    const queryParams = [];
    if(filters) queryParams.push(`filters${filters.join('&filters')}`);
    if(limit) queryParams.push(`limit=${CONFIG.limit}`);
    if(queryParams.length) url += `?${queryParams.join(`&`)}`;

		try {
      const response = await rp.get({ url, json: true });
		  return response;
		} catch(error) {
		  const message = `An error has occured: ${error}"`;
			throw new Error(message);
		}
}

async function serverLoad(server) {
    return await apiRequest(API.statsPath + server)
}

async function generateVPNConfig({ profile, isQuickProfile = false }) {
		  let settings;

			const baseFilePath = `${PROFILE_PATH + profile.id}`;
      const displayName = `${profile.country} (${profile.city})`

    try {
						
      // Check if the file exists.
			// It will error if the file doesn't exist, so we know that the file needs to be created.
			fs.statSync(`${baseFilePath}.json`);
      settings = JSON.parse(await readFileAsync(`${baseFilePath}.settings`, {encoding: 'utf8'}))
    } catch (err) {
        if (err.code === 'ENOENT') {
						const { strictVPN, routeDNS } = CONFIG;
						// Default settings
            settings = {
								serverSubnets: [],
								overrideDefaultRoute: true,
								strictVPN: typeof strictVPN === 'boolean' ? strictVPN : true,
								routeDNS: typeof routeDNS === 'boolean' ? routeDNS : true,
								createdDate: NOW,
								updatedDate: undefined,
								displayName,
								subtype: 'wireguard',
								profileId: profile.id,
								deviceCount: 0,
								load: { percent: profile.load },
								serverName: profile.hostname,
						}
        }
    }

		//let netifDown = false;
    //try {
     //   fs.statSync(`/sys/class/net/vpn_${profile.id}`)
    //} catch (err) {
     //   if (err.code === 'ENOENT') {
      //      netifDown = true
//
//	    			debugLog('the VPN profile does not have an active connection')
//	    			debugLog(err)
 //       }
  //  }

    //if(!netifDown) {

			const isNewConfigFile = settings.createdDate === NOW;
			const settingsAreOutdated = !isNewConfigFile && settings.profileId != profile.id;
				//console.log(`createdDate: ${settings.createdDate}`)
				//console.log(`now: ${NOW}`)
				//console.log(`settings.profileId: ${settings.profileId}`)
				//console.log(`profile.id: ${profile.id}`)
				//console.log(`isNew: ${isNewConfigFile}`)
				//console.log(`settingsAreOutdated: ${settingsAreOutdated}`)

	    if (isNewConfigFile ) {
				debugLog(`${settings.serverName} is recommended.`)
			} else if(!settingsAreOutdated) {
					settings.load.percent = profile.load
		    	debugLog(`${settings.serverName} (load ${settings.load.percent}%) is still recommended.`)
			} else {
					const newServerHasLowerLoad = async ({ settings, profile }) => {
					   try {
								await refreshCurrentServerLoad({ settings });
								const maxLoadIsSet = typeof CONFIG.maxLoad === 'number';

								const currentServerLoad = settings.load.percent;
								const newServerLoad = profile.load;
								// Always compare load between the current server and the new one,
								// but only compare to the maxLoad if the maxLoad config exists.
								return currentServerLoad > newServerLoad &&
				          (maxLoadIsSet ? currentServerLoad > CONFIG.maxLoad : true)
					   } catch(error) {
						   throw new Error(error);
						  }
					}

				const isNewQuickProfile = isQuickProfile && settings.profileId !== profile.id;
				if(isNewQuickProfile || !isQuickProfile && (await newServerHasLowerLoad({ settings, profile }))) {
								//console.log('lower')
					settings.displayName = displayName
		   		settings.serverName = profile.hostname
					settings.serverDDNS = profile.station
					settings.load.percent = profile.load
					settings.updatedDate = NOW;

					debugLog(`${settings.serverName} (load ${settings.load.percent}%) changed to ${profile.hostname} (load ${profile.load}%).`)
				} else {
								// TODO: MERGE THIS WITH THE OTHER USAGE
					settings.load.percent = profile.load
		    	debugLog(`${settings.serverName} (load ${settings.load.percent}%) is still recommended.`)
				}
			}
   // }

						// TODO: ALWAYS PERSIST THE PROFILE CONFIG FILE TO DISK SO WE CAN COMPARE IF THE SETTINGS CHANGED BETWEEN PROFILE REVISIONS
		// TODO: Includ checking for config file changes
							// Persist if:
							// - createdDate === NOW or
							//   - load is different 
							//   - and config field is different
							//
							// if persisting:
							//  - if created date !== NOW, update the `updatedDate`
							//
							// Send event if:
							// - createdDate === NOW
							// - any config field changed
	 const isNewConfig = settings.createdDate == NOW;
	 const isUpdatedConfig = settings.updatedDate === NOW;
    if (isNewConfig || isUpdatedConfig) {
			//TODO: only save if there are changes
			await writeFileAsync(`${baseFilePath}.settings`, JSON.stringify(settings), { encoding: 'utf8' })

	    const jsonProfile = {
				privateKey: CONFIG.privateKey,
				addresses: [profile.ip],
				dns: profile.dns,
				peers: [{
					persistentKeepalive: "25",
					publicKey: profile.pubkey,
					allowedIPs: ["0.0.0.0/0", "::/0"],
					endpoint: `${profile.station}:51820`,
				}],
	    }
      await writeFileAsync(`${baseFilePath}.json`, JSON.stringify(jsonProfile), { encoding: 'utf8' })

			// Only send the event if the server changed
			// TODO: Add detection for if config fields changed too
			const shouldSendVPNSettingsChangedEvent = settings.profileId !== profile.id
			if(shouldSendVPNSettingsChangedEvent) {
							debugLog(`refreshing routes for ${settings.serverName} (load ${settings.load.percent}%).`)
							const brokerEvent = {
								type: "VPNClient:SettingsChanged",
								profileId: settings.profileId,
								settings,
								fromProcess: "VPNClient"
							}
							exec(`redis-cli PUBLISH TO.FireMain '${JSON.stringify(brokerEvent)}'`)
		  }
    }
} 
				   async function refreshCurrentServerLoad({ settings }) {
								// Save the new `load` into the config so that it stays up to date and
								// set the flag to have it persisted to disk, even if we 
					   try {
								const { percent: newLoad } = await serverLoad(settings.serverName);
								const loadDidChange = settings.load.percent !== newLoad;
                settings.load.percent = newLoad;
								settings.updatedDate = NOW;
                return loadDidChange; 
					   } catch(error) {
						   throw new Error(error);
					 }
					  }

async function getProfile({ countryId , isQuickProfile = false }) {
    const filters = ['[servers_technologies][identifier]=wireguard_udp']
    if (!isQuickProfile) {
        filters.push(`[country_id]=${countryId}`)
    }

    const path = API.serversPath + 'recommendations'
    const servers =  await apiRequest(path, filters, true)
		if(servers.length) {
      const profile = {}
			
      let server = servers[0]
      if (servers.length > 1 && !CONFIG.limit > 1) {
        server = servers.sort((a, b) => parseFloat(a.load) - parseFloat(b.load))[0]
      }
						let country = server.locations[0].country.name;
			const countryId = server.locations[0].country.id

						// Quick profile overrides
						if(isQuickProfile) {
              country = 'Quick'
						}

      			profile.id = `${NETIF}-${countryId}-${country}`;
            profile.pubkey = server.technologies.find(o => o.identifier === 'wireguard_udp').metadata[0].value;
            profile.countryid = countryId;
            profile.country = country; 
            profile.ip = `10.5.0.${countryId}/24` // TODO: make octet unique, not country id
						profile.dns = CONFIG.dns && CONFIG.dns.length ? CONFIG.dns : ["1.1.1.1"],
            profile.city = server.locations[0].country.city.name
            profile.hostname = server.hostname
            profile.station = server.station
            profile.load = server.load
						profile.config = CONFIG;

            return profile;
        }
}

async function main() {
    // Generate a "Quick Connect" profile using the recommended server
    if (CONFIG.recommended) {
				const isQuickProfile = true;
        const profile = await getProfile({ isQuickProfile })
        await generateVPNConfig({ profile, isQuickProfile })
    }

    // Generate profiles for the countries specified in the config
    const countryList = await apiRequest(API.serversPath + 'countries')
    for (const item of CONFIG.countries) {
        const country = countryList.find(o => o.name === item)
        const profile = await getProfile({ countryId: country.id })
        await generateVPNConfig({ profile })
    }
}

main();
