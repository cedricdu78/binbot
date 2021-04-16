const binSecret = require('./config/secrets');
const config = require('./config/config');
const func = require('./lib/func');

const Binance = require('binance-api-node').default

class Bot {

    api = Binance({
        apiKey: binSecret.key(),
        apiSecret: binSecret.secret()
    });

    balances = []
    exchangeInfo = []
    openOrders = []
    bookTickers = []

    histories = []
    currencies = []
    orders = []
    new_orders = []
    mise = 0

    available = 0
    bnb = 0
    total = 0

    limitNegative = 0.2

    lastCurrency = ""

    async getExchangeInfo() {
        (await this.api.exchangeInfo())['symbols'].forEach(function(v) {
            this.push({symbol: v.symbol, status: v.status, minPrice: v['filters'][0].minPrice,
                minQty: v['filters'][2].minQty
            })
        }, this.exchangeInfo)
    }

    async getOpenOrders() {
        this.orders = [];
        (await this.api.openOrders()).forEach(function(v) {
            this.push({symbol: v.symbol, price: Number(v.price), volume: Number(v['origQty']), time: v.time})
        }, this.openOrders)
    }

    async getBookTickers() {
        this.bookTickers = []
        Object.entries(await this.api.prices()).forEach(function([k,v]) {
            this.push({symbol: k, price: Number(v)})
        }, this.bookTickers)
    }

    async getBalances() {
        this.balances = []
        this.total = 0;

        (await this.api.accountInfo())['balances'].forEach(function(v) {
            let price = this.bookTickers.find(k => k.symbol === v.asset + config.baseMoney()) !== undefined ?
                this.bookTickers.find(k => k.symbol === v.asset + config.baseMoney()).price : 0
            this.total += price * (Number(v.free) + Number(v.locked))
            price = price * (Number(v.free) + Number(v.locked))
            this.balances.push({symbol: v.asset, available: Number(v.free), onOrder: Number(v.locked), price: price})
        }, this)

        this.available = this.balances.find(v => v.symbol === "USDT").available
        this.bnb = this.balances.find(v => v.symbol === "BNB").price

        this.total += this.available

        this.mise = (this.total - this.bnb) * 99 / 100
    }

    getOrders() {
        this.openOrders.forEach(order => {
            let openValue = (order.price / (1 / 100 + 1) * order.volume).toFixed(2)
            let limitValue = (order.price * (1 - 1 / 100) * (1 - this.limitNegative / 100) * order.volume).toFixed(2)
            let nowValue = (order.volume * this.bookTickers.find(v2 => v2.symbol === order.symbol).price).toFixed(2)
            let wantValue = (order.price * order.volume).toFixed(2)

            this.orders.push(func.order(
                order.symbol,
                order.volume,
                limitValue,
                wantValue,
                openValue,
                nowValue,
                order.time,
                (nowValue / openValue * 100) - 100
            ))
        })
    }

    getCurrenciesFilteredByBaseMoney() {
        this.exchangeInfo = this.exchangeInfo.filter(k => k.symbol.endsWith(config.baseMoney())
            && !k.symbol.endsWith('DOWN' + config.baseMoney())
            && !k.symbol.endsWith('UP' + config.baseMoney())
            && !k.symbol.endsWith('BULL' + config.baseMoney())
            && !k.symbol.endsWith('BEAR' + config.baseMoney())
            && k.status !== 'BREAK')

        this.bookTickers = this.bookTickers.filter(k => this.exchangeInfo.find(v => v.symbol === k.symbol) !== undefined)
    }

    getCurrenciesFilteredByConditions() {
        this.bookTickers.forEach(value => {
            if (this.histories[value.symbol] !== undefined) {
                if (this.histories[value.symbol].length === 5)
                    this.histories[value.symbol].shift()

                this.histories[value.symbol].push(value.price)
            }
            else this.histories[value.symbol] = [value.price]
        })

        this.bookTickers.forEach(k => {
            k.prc = Number(((this.histories[k.symbol][4] - this.histories[k.symbol][0]) / this.histories[k.symbol][0]) * 100)
        })

        this.bookTickers = this.bookTickers.filter(k => Number(this.histories[k.symbol][0])
            < Number(this.histories[k.symbol][1]) && Number(this.histories[k.symbol][1])
            < Number(this.histories[k.symbol][2]) && Number(this.histories[k.symbol][2])
            < Number(this.histories[k.symbol][3]) && Number(this.histories[k.symbol][3])
            < Number(this.histories[k.symbol][4]) && (k.prc > 0.5)
            && this.balances.find(v => v.symbol + config.baseMoney() === k.symbol).onOrder === 0
            && k.symbol !== this.lastCurrency)

        let nbMise = String(this.available / this.mise).split('.')[0]

        this.bookTickers = this.bookTickers.sort((a, b) => b.prc - a.prc)
            .slice(0, nbMise <= 29 ? nbMise : 29)

        this.currencies = this.exchangeInfo.filter(k => this.bookTickers.find(v => v.symbol === k.symbol) !== undefined)
    }

    async getBuy() {
        this.new_orders = []
        if (this.currencies.length > 0) {
            await new Promise((resolve,) => {
                console.log()
                this.currencies.forEach(value => {

                    value.price = Number(this.histories[value.symbol][this.histories[value.symbol].length - 1])

                    value.lenPrice = value.minPrice.split('.')[0] === "0"
                        ? (value.minPrice.split('.')[1].split('1')[0] + '1').length : 0

                    value.lenVol = value.minQty.split('.')[0] === "0"
                        ? (value.minQty.split('.')[1].split('1')[0] + '1').length : 0

                    value.volume = String(this.mise / value.price)
                    value.volume = value.volume.substr(0, value.volume.split('.')[0].length
                        + (value.lenVol ? 1 : 0) + value.lenVol)

                    value.sellPrice = String(value.price * (1 / 100 + 1))
                    value.sellPrice = value.sellPrice.substr(0, value.sellPrice.split('.')[0].length
                        + (value.lenPrice ? 1 : 0) + value.lenPrice)

                    value.sellPriceLimit = String(value.price * (1 - this.limitNegative / 100))
                    value.sellPriceLimit = value.sellPriceLimit.substr(0, value.sellPriceLimit.split('.')[0].length
                        + (value.lenPrice ? 1 : 0) + value.lenPrice)

                    value.price = String(value.price * Number(value.volume))
                    value.price = value.price.substr(0, value.price.split('.')[0].length
                        + (value.lenPrice ? 1 : 0) + value.lenPrice)

                    console.log(value.symbol + " " + value.price + " " + value.sellPrice + " " + value.sellPriceLimit)

                    // this.api.order({symbol: value.symbol, side: 'BUY', quantity: value.volume, type: 'MARKET'
                    // }).then(() => {
                    //     this.available -= Number(value.price)
                    //     this.bnb -= Number(value.price) * config.feeValue() / 100
                    //
                    //     this.api.orderOco({ symbol: value.symbol, side: 'SELL', quantity: value.volume, price: value.sellPrice,
                    //         stopPrice: value.sellPriceLimit, stopLimitPrice: value.sellPriceLimit,
                    //     }).then(() => {
                    //         this.lastCurrency = value.symbol
                    //         this.new_orders.push((func.order(value.symbol,
                    //                 value.volume,
                    //                 Number(value.sellPriceLimit) * Number(value.volume),
                    //                 Number(value.sellPrice) * Number(value.volume),
                    //                 value.price,
                    //                 value.price,
                    //                 Date.now(),
                    //                 0
                    //             )
                    //         ))
                    //
                    //         if (this.currencies.indexOf(value) === this.currencies.length - 1)
                    //             resolve()
                    //     }).catch(e => {
                    //         let responseJson = JSON.parse(e.body)
                    //         console.error("Sell: " + value.symbol + " [" + responseJson.code + "]: "
                    //             + responseJson["msg"] + " " + value.sellPrice + " " + value.sellPriceLimit + " "
                    //             + value.volume)
                    //
                    //         if (this.currencies.indexOf(value) === this.currencies.length - 1)
                    //             resolve()
                    //     })
                    // }).catch(e => {
                    //     let responseJson = JSON.parse(e.body)
                    //     console.error("Buy: " + value.symbol + " [" + responseJson.code + "]: "
                    //         + responseJson["msg"] + " " + Number(value.price)
                    //         + " " + value.volume)
                    //
                    //     if (this.currencies.indexOf(value) === this.currencies.length - 1)
                    //         resolve()
                    // })
                })
            })
        }
    }

    getConsole() {
        if (this.orders.length > 0) console.table(this.orders)
        if (this.new_orders.length > 0) console.table(this.new_orders)
        if (this.balances.filter(v => v.price > 1 && v.available > 0 && v.symbol !== config.feeMoney()).length > 0)
            console.table(this.balances.filter(v => v.price > 1 && v.available > 0 && v.symbol !== config.feeMoney()))

        console.table({
            status: {
                BNB: Number((this.bnb).toFixed(2)),
                USD: Number(this.available.toFixed(2)),
                Mise: Number(this.mise.toFixed(2)),
                Total: Number(this.total.toFixed(2)),
            }
        })
    }
}

const myBot = new Bot()

function start(delay = config.restartTime()) {
    new Promise(res => setTimeout(res, delay)).then(() => main(myBot))
}

async function main(myBot) {

    if (myBot.exchangeInfo.length === 0) {
        await myBot.getExchangeInfo()
    }

    await myBot.getOpenOrders()
    await myBot.getBookTickers()
    await myBot.getBalances()

    myBot.getOrders()
    myBot.getCurrenciesFilteredByBaseMoney()
    myBot.getCurrenciesFilteredByConditions()

    await myBot.getBuy()

    myBot.getConsole()

    start(300000)
}

start()
