#!/usr/bin/env node

const Promise = require('bluebird')
const rp = require('request-promise')
const fs = require('fs')
const readFileAsync = Promise.promisify(fs.readFile)
const writeFileAsync = Promise.promisify(fs.writeFile)

const config = JSON.parse(fs.readFileSync(`${__dirname}/nordconf.json`))
const netif = 'nordlynx' 
const profilePath = '/home/pi/.firewalla/run/wg_profile/'
// const profilePath = '/tmp/'
const api = {
    baseUrl: 'https://api.nordvpn.com',
    statsPath: '/server/stats',
    serversPath: '/v1/servers',
}
const params = {
    privateKey: config.privateKey
}

'use strict'

async function  apiRequest(path, filters=null, limit=false) {
    var url = api.baseUrl + path
    if (filters) {
        url += `?filters${filters.join('&filters')}`
    }
    if (limit) {
        url += `&limit=${config.limit}`
    }
    var options = {
      url: url,
      json: true
    }

    return await rp.get(options)
}

async function generateVPNConfig(params) {
    var fileName = netif + params.countryid
    var displayName = `${params.country} (${params.city})`
    var profile = {
      "peers": [{
      "publicKey": params.pubkey,
      "endpoint": `${params.hostname}:51820`,
      "persistentKeepalive": "20",
      "allowedIPs": ["0.0.0.0/0"]}],
      "addresses": ["10.5.0.2/24"],
      "privateKey": params.privateKey,
      "dns": ["1.1.1.1"]
    }
    try {
        var settings = await readFileAsync(`${profilePath + fileName}.settings`, { encoding: 'utf8' })
        .then((result) => {
            settings = JSON.parse(result)
        settings.displayName = displayName
            settings.serverDDNS = params.station
            return settings
    })
    } catch (err) {
        var settings = {
          "serverSubnets": [],
          "overrideDefaultRoute": true,
          "routeDNS": false,
          "strictVPN": true,
          "displayName": displayName,
          "createdDate": `${Date.now() / 1000}`,
          "serverVPNPort": 51820,
          "subtype": "wireguard",
          "serverDDNS": params.station
        }
    }
    writeFileAsync(`${profilePath + fileName}.settings`, JSON.stringify(settings), { encoding: 'utf8' })
    writeFileAsync(`${profilePath + fileName}.json`, JSON.stringify(profile), { encoding: 'utf8' })
}

async function getProfile(countryId) {
    var path = `${api.serversPath}/recommendations`
    var filters = ['[servers_technologies][identifier]=wireguard_udp']
    if (countryId != 0) {
        filters.push(`[country_id]=${countryId}`)
    }

    return await apiRequest(path, filters, true)
    .then((result) => {
        params.pubkey = result[0].technologies.find(o => o.identifier === 'wireguard_udp').metadata[0].value
        params.countryid = countryId
        if (countryId != 0) {
            params.country = result[0].locations[0].country.name
        } else {
            params.country = 'Nord Quick'
        }
        params.city = result[0].locations[0].country.city.name
        params.hostname = result[0].hostname
        params.station = result[0].station

        return params
    })
}

if (config.recommended) {
    getProfile(0)
    .then((result) => {
        generateVPNConfig(result)
    })
}

apiRequest(api.serversPath + '/countries')
.then((result) => {
    config.countries.forEach(item => {
        var country = result.find(o => o.name === item)
        getProfile(country.id)
        .then((result) => {
            generateVPNConfig(result)
        })
    })
})