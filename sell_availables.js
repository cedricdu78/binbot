const binSecret = require('./config/secrets');
const config = require('./config/config');

const Binance = require('node-binance-api');

class Bot {

    api = new Binance().options({
        APIKEY: binSecret.key(),
        APISECRET: binSecret.secret()
    });

    balances = []
    exchangeInfo = []

    async getBalances() {
        await this.api.balance().then(balances => Object.entries(balances).forEach(([k,v]) => {
            this.balances.push({symbol: k, available: Number(v.available), onOrder: Number(v.onOrder)})
        }))
    }

    async getExchangeInfo() {
        await this.api.exchangeInfo().then(exchangeInfo => exchangeInfo['symbols'].forEach(v => {
            this.exchangeInfo.push({symbol: v.symbol, status: v.status, minPrice: v['filters'][0].minPrice,
                minQty: v['filters'][2].minQty
            })
        }))
    }

    getUnordered() {
        this.unordered = this.balances.filter(v => v.available > 0
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney())
    }

    getCurrenciesFilteredByBaseMoney() {
        this.exchangeInfo = this.exchangeInfo.filter(k => k.symbol.endsWith(config.baseMoney())
            && !k.symbol.endsWith('DOWN' + config.baseMoney())
            && !k.symbol.endsWith('UP' + config.baseMoney())
            && !k.symbol.endsWith('BULL' + config.baseMoney())
            && !k.symbol.endsWith('BEAR' + config.baseMoney())
            && k.status !== 'BREAK')
    }
    s
    getCurrenciesFilteredByUnordered() {
        this.exchangeInfo = this.exchangeInfo.filter(k => this.unordered.find(v =>
            k.symbol === v.symbol + config.baseMoney()) !== undefined)
    }

    getSell() {
        this.exchangeInfo.forEach(value => {

            let currency = this.unordered.find(v => value.symbol === v.symbol + config.baseMoney())

            value.lenVol = value.minQty.split('.')[0] === "0"
                ? (value.minQty.split('.')[1].split('1')[0] + '1').length : 0

            value.volume = String(currency.available)
            value.volume = value.volume.substr(0, value.volume.split('.')[0].length
                + (value.lenVol ? 1 : 0) + value.lenVol)

            this.api.marketSell(value.symbol, value.volume, {type: 'MARKET'}, (error,) => {
                if (error !== null) {
                    let responseJson = JSON.parse(error.body)
                    console.error("Sell: " + value.symbol + " [" + responseJson.code + "]: "
                        + responseJson["msg"] + " " + value.volume)
                } else {
                    console.log("Sell: " + value.symbol)
                }
            })
        })
    }
}

function start(delay = config.restartTime()) {
    new Promise(res => setTimeout(res, delay)).then(() => main())
}

async function main() {

    const myBot = new Bot()

    await myBot.getBalances()
    await myBot.getExchangeInfo()

    myBot.getUnordered()

    myBot.getCurrenciesFilteredByBaseMoney()

    myBot.getCurrenciesFilteredByUnordered()

    myBot.getSell()
}

start(0)
