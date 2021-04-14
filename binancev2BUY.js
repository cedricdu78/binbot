const binSecret = require('./config/secrets');
const config = require('./config/config');
const func = require('./lib/func');

const Binance = require('node-binance-api');

class Bot {

    api = new Binance().options({
        APIKEY: binSecret.key(),
        APISECRET: binSecret.secret()
    });

    balances = []
    exchangeInfo = []
    bookTickers = []

    new_orders = []
    mise = 0

    available = 0
    bnb = 0

    async getExchangeInfo(mise, prc, currency) {
        await new Promise((resolve,) => {
            this.api.exchangeInfo().then(exchangeInfo => {
                const v = exchangeInfo['symbols'].find(v => v.symbol === currency)
                if (v !== undefined) {

                    const minPrice = v['filters'][0].minPrice,
                        minQty = v['filters'][2].minQty

                    this.api.bookTickers(currency).then(info => {
                        this.api.bookTickers("BNBUSDT").then(info2 => {

                            if (info !== undefined && info2 !== undefined) {
                                let price = Number(info.askPrice)

                                this.api.balance().then(balances => {
                                    this.available = Number(balances["USDT"].available)
                                    this.bnb = Number(balances["BNB"].available * Number(info2.askPrice))

                                    this.mise = Number(this.available) * Number(mise) / 100

                                    const lenPrice = minPrice.split('.')[0] === "0"
                                        ? (minPrice.split('.')[1].split('1')[0] + '1').length : 0

                                    const lenVol = minQty.split('.')[0] === "0"
                                        ? (minQty.split('.')[1].split('1')[0] + '1').length : 0

                                    let volume = String(this.mise / price)
                                    volume = volume.substr(0, volume.split('.')[0].length
                                        + (lenVol ? 1 : 0) + lenVol)

                                    let sellPrice = String(price * (prc / 100 + 1))
                                    sellPrice = sellPrice.substr(0, sellPrice.split('.')[0].length
                                        + (lenPrice ? 1 : 0) + lenPrice)

                                    price = String(price * Number(volume))
                                    price = price.substr(0, price.split('.')[0].length
                                        + (lenPrice ? 1 : 0) + lenPrice)

                                    this.api.marketBuy(currency, volume, (error,) => {
                                        if (error !== null) {
                                            let responseJson = JSON.parse(error.body)
                                            console.error("Buy: " + currency + " [" + responseJson.code + "]: "
                                                + responseJson["msg"] + " " + Number(price)
                                                + " " + volume)
                                        } else {
                                            this.api.sell(currency, volume, sellPrice, {type: 'LIMIT'}, (error,) => {
                                                if (error !== null) {
                                                    let responseJson = JSON.parse(error.body)
                                                    console.error("Sell: " + currency + " [" + responseJson.code + "]: "
                                                        + responseJson["msg"] + " " + sellPrice + " " + volume)
                                                } else {
                                                    this.new_orders.push(func.order(currency,
                                                        volume,
                                                        Number(sellPrice) * Number(volume),
                                                        price,
                                                        price,
                                                        Date.now()
                                                        )
                                                    )
                                                    resolve()
                                                }
                                            })
                                        }
                                    })
                                })
                            }
                        })
                    })
                }
            })
        })
    }

    getConsole() {
        if (this.new_orders.length > 0) console.table(this.new_orders)
        console.table({
            status: {
                Mise: Number(this.mise.toFixed(2)),
                BNB: Number((this.bnb).toFixed(2)),
                USD: Number(this.available.toFixed(2))
            }
        })
    }
}

function start(delay = config.restartTime()) {
    new Promise(res => setTimeout(res, delay)).then(() => main())
}

async function main() {

    const myBot = new Bot()

    await myBot.getExchangeInfo(process.argv[2], process.argv[3], process.argv[4])

    myBot.getConsole()
}

start(0)
