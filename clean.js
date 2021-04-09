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

    async prepare() {
        await this.api.balance().then(balances => Object.entries(balances).forEach(([k,v]) => {
            this.balances.push({symbol: k, available: Number(v.available) - config.keep_balance(), onOrder: Number(v.onOrder)})
        }))

        await this.api.exchangeInfo().then(exchangeInfo => exchangeInfo['symbols'].forEach(v => {
            this.exchangeInfo.push({symbol: v.symbol, status: v.status, minPrice: v['filters'][0].minPrice,
                minQty: v['filters'][2].minQty
            })
        }))

        this.unordered = this.balances.filter(v => v.available > 0
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney())

        this.exchangeInfo = this.exchangeInfo.filter(k => k.symbol.endsWith(config.baseMoney())
            && !k.symbol.endsWith('DOWN' + config.baseMoney())
            && !k.symbol.endsWith('UP' + config.baseMoney())
            && !k.symbol.endsWith('BULL' + config.baseMoney())
            && !k.symbol.endsWith('BEAR' + config.baseMoney())
            && k.status !== 'BREAK'
            && this.unordered.find(v => k.symbol === v.symbol + config.baseMoney()) !== undefined)
    }

    sell() {
        this.openOrders.forEach(order => {
            this.api.cancel(order.symbol, order.orderId, () => {
                console.log("Cancel: " + order.symbol)
                this.api.marketSell(order.symbol, order['origQty'], { type: 'MARKET' }, () => {
                    console.log("Sell: " + order.symbol)
                })
            })
        })

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

    await myBot.prepare()

    myBot.sell()
}

start(0)
