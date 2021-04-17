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
    openOrders = []
    bookTickers = []

    histories = []
    currencies = []
    orders = []
    new_orders = []
    mise = 0

    available = 0
    total = 0

    gain = 0.3

    async getExchangeInfo() {
        await this.api.exchangeInfo().then(exchangeInfo => exchangeInfo['symbols'].forEach(v => {
            this.exchangeInfo.push({
                symbol: v.symbol, status: v.status, minPrice: v['filters'][0].minPrice,
                minQty: v['filters'][2].minQty
            })
        }))
    }

    async getOpenOrders() {
        this.openOrders = []
        await this.api.openOrders().then(openOrders => openOrders.forEach(v => {
            this.openOrders.push({symbol: v.symbol, price: Number(v.price), volume: Number(v['origQty']), time: v.time})
        }))
    }

    async getBookTickers() {
        this.bookTickers = []
        await this.api.bookTickers().then(bookTickers => Object.entries(bookTickers).forEach(([k,v]) => {
            this.bookTickers.push({symbol: k, price: Number(v.ask)})
        }))
    }

    async getBalances() {
        this.balances = []
        this.price = 0
        this.total = 0
        await this.api.balance().then(balances => Object.entries(balances).forEach(([k,v]) => {
            let price = this.bookTickers.find(v => v.symbol === k + config.baseMoney()) !== undefined ? this.bookTickers.find(v => v.symbol === k + config.baseMoney()).price : 0
            this.total += price * (Number(v.available) + Number(v.onOrder))
            this.balances.push({symbol: k, available: Number(v.available), onOrder: Number(v.onOrder), price: price * (Number(v.available) + Number(v.onOrder)) })
        }))

        this.available = this.balances.find(v => v.symbol === "USDT").available

        this.total += this.available

        this.mise = this.total * 99 / 100
    }

    getOrders() {
        this.orders = []
        this.openOrders.forEach(order => {
            let openValue = (order.price / (this.gain / 100 + 1) * order.volume).toFixed(2)
            let nowValue = (order.volume * this.bookTickers.find(v2 => v2.symbol === order.symbol).price).toFixed(2)
            let wantValue = (order.price * order.volume).toFixed(2)

            this.orders.push(func.order(
                order.symbol,
                order.volume,
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

    async getHistories() {
        await new Promise((resolve,) => {
            let counter = 0
            this.exchangeInfo.forEach(function(v) {
                let startDate = new Date()
                startDate.setHours(startDate.getHours() - 1)

                this.api.candlesticks(v.symbol, '15m', false, {
                    startTime: startDate.getTime(), endTime: new Date().getTime(), limit: 500
                }).then(res => {
                    this.histories[v.symbol] = res
                    if (++counter === this.exchangeInfo.length) resolve();
                }).catch(e => console.log(e))
            }, this)
        })
    }

    getCurrenciesFilteredByConditions() {
        this.bookTickers.forEach(value => {

            let val = []
            this.histories[value.symbol].forEach(v => {
                val.push({ price: v[4], prc: Number(((v[4] - this.histories[value.symbol][0][4])
                        / this.histories[value.symbol][0][4]) * 100)})
            })

            this.histories[value.symbol] = val
        })

        this.bookTickers = this.bookTickers.filter(k =>
            Number(this.histories[k.symbol][0].price) < Number(this.histories[k.symbol][1].price)
            && Number(this.histories[k.symbol][1].price) < Number(this.histories[k.symbol][2].price)
            && Number(this.histories[k.symbol][2].price) < Number(this.histories[k.symbol][3].price)
            && Number(this.histories[k.symbol][0].prc) < Number(this.histories[k.symbol][1].prc)
            && Number(this.histories[k.symbol][1].prc) < Number(this.histories[k.symbol][2].prc)
            && Number(this.histories[k.symbol][2].prc) < Number(this.histories[k.symbol][3].prc)
            && this.balances.find(v => v.symbol + config.baseMoney() === k.symbol).onOrder === 0)

        console.log(new Date().toLocaleTimeString())
        this.bookTickers.sort((a, b) => b.prc - a.prc)
            .forEach(k => console.log([k.symbol, this.histories[k.symbol]]))

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

                    value.price = Number(this.histories[value.symbol][this.histories[value.symbol].length - 1].price)

                    value.lenPrice = value.minPrice.split('.')[0] === "0"
                        ? (value.minPrice.split('.')[1].split('1')[0] + '1').length : 0

                    value.lenVol = value.minQty.split('.')[0] === "0"
                        ? (value.minQty.split('.')[1].split('1')[0] + '1').length : 0

                    value.volume = String(this.mise / value.price)
                    value.volume = value.volume.substr(0, value.volume.split('.')[0].length
                        + (value.lenVol ? 1 : 0) + value.lenVol)

                    value.sellPrice = String(value.price * (this.gain / 100 + 1))
                    value.sellPrice = value.sellPrice.substr(0, value.sellPrice.split('.')[0].length
                        + (value.lenPrice ? 1 : 0) + value.lenPrice)

                    value.price = String(value.price * Number(value.volume))
                    value.price = value.price.substr(0, value.price.split('.')[0].length
                        + (value.lenPrice ? 1 : 0) + value.lenPrice)

                    this.api.marketBuy(value.symbol, value.volume, (error,data) => {
                        if (error !== null) {
                            let responseJson = JSON.parse(error.body)
                            console.error("Buy: " + value.symbol + " [" + responseJson.code + "]: "
                                + responseJson["msg"] + " " + Number(value.price)
                                + " " + value.volume)

                            if (this.currencies.indexOf(value) === this.currencies.length - 1)
                                resolve()
                        } else {
                            data.fills.forEach(v => value.volume = Number(value.volume) - Number(v.commission))

                            value.volume = String(value.volume)
                            value.volume = value.volume.substr(0, value.volume.split('.')[0].length
                                + (value.lenVol ? 1 : 0) + value.lenVol)

                            this.available -= Number(value.price)

                            this.api.sell(value.symbol, value.volume, value.sellPrice, {type: 'LIMIT'}, (error,) => {
                                if (error !== null) {
                                    let responseJson = JSON.parse(error.body)
                                    console.error("Sell: " + value.symbol + " [" + responseJson.code + "]: "
                                        + responseJson["msg"] + " " + value.sellPrice + " " + value.volume)
                                } else {
                                    this.new_orders.push((func.order(value.symbol,
                                            value.volume,
                                            Number(value.sellPrice) * Number(value.volume),
                                            value.price,
                                            value.price,
                                            Date.now(),
                                            0
                                        )
                                    ))
                                }

                                if (this.currencies.indexOf(value) === this.currencies.length - 1)
                                    resolve()
                            })
                        }
                    })
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

    await myBot.getHistories()

    myBot.getCurrenciesFilteredByConditions()

    await myBot.getBuy()

    myBot.getConsole()

    start(15000)
}

start()
