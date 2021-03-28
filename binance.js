const binSecret = require('./config/secrets');
const config = require('./config/config');
const func = require('./lib/func');

const Binance = require('node-binance-api');

/*
┌────────────┬───────────┬───────┬────┬──────────────────┐
│  (index)   │ Available │ Total │ %  │      Status      │
├────────────┼───────────┼───────┼────┼──────────────────┤
│ Currencies │    39     │  209  │ 19 │ 'Market bullish' │
└────────────┴───────────┴───────┴────┴──────────────────┘
┌────────────┬─────────┬─────────┬─────────┐
│  (index)   │ Placed  │ Current │ Target  │
├────────────┼─────────┼─────────┼─────────┤
│ Trades ($) │ 5908.33 │ 4890.15 │ 6499.17 │
│  USDT ($)  │ 177.23  │ 177.23  │ 177.23  │
│  BNB ($)   │  21.86  │  21.86  │  21.86  │
│ Total ($)  │ 6107.42 │ 5089.23 │ 6698.26 │
└────────────┴─────────┴─────────┴─────────┘
 */

class Bot {

    api = new Binance().options({
        APIKEY: binSecret.key(),
        APISECRET: binSecret.secret()
    });

    balances = []
    openOrders = []
    exchangeInfo = []
    bookTickers = []

    unordered = []
    histories = []
    orders = []
    newOrders = []
    resume = {total: 0, available: 0, current: 0, target: 0, bnb: 0, mise: 0, number: 0}

    async getBalances() {
        await this.api.balance().then(balances => Object.entries(balances).forEach(([k,v]) => {
            this.balances.push({symbol: k, available: Number(v.available), onOrder: Number(v.onOrder)})
        }))
    }

    async getOpenOrders() {
        await this.api.openOrders().then(openOrders => openOrders.forEach(v => {
            this.openOrders.push({symbol: v.symbol, price: Number(v.price), volume: Number(v['origQty']), time: v.time})
        }))
    }

    async getExchangeInfo() {
        await this.api.exchangeInfo().then(exchangeInfo => exchangeInfo['symbols'].forEach(v => {
            this.exchangeInfo.push({symbol: v.symbol, status: v.status, minPrice: v['filters'][0].minPrice,
                minQty: v['filters'][2].minQty
            })
        }))
    }

    async getBookTickers() {
        await this.api.bookTickers().then(bookTickers => Object.entries(bookTickers).forEach(([k,v]) => {
            this.bookTickers.push({symbol: k, price: Number(v.ask)})
        }))
    }

    getTotal() {
        this.resume.available = this.balances.find(v => v.symbol === config.baseMoney()).available
        
        this.resume.bnb = this.balances.find(v => v.symbol === config.feeMoney()).available
            * this.bookTickers.find(v => v.symbol === config.feeMoney() + config.baseMoney()).price

        this.balances.forEach(v => {
            if (this.bookTickers.find(v2 => v2.symbol === v.symbol + config.baseMoney()) !== undefined
                && v.symbol !== config.feeMoney()) {

                this.resume.current += this.bookTickers.find(v2 => v2.symbol === v.symbol + config.baseMoney()).price
                    * (v.available + v.onOrder)
            }
        })

        this.resume.total = this.resume.available + this.resume.bnb + this.resume.current
    }

    getMise() {
        this.resume.mise = this.resume.total * 4 / 100
    }

    getUnordered() {
        this.unordered = this.balances.filter(v => v.available > 0
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney())
    }

    getOrders() {
        this.openOrders.forEach(order => {
            let openValue = (order.price / (config.profit() / 100 + 1) * order.volume).toFixed(2)
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

            this.resume.target += order.price * order.volume
        })
    }

    getCurrenciesFilteredByBaseMoney() {
        this.exchangeInfo = this.exchangeInfo.filter(k => k.symbol.endsWith(config.baseMoney())
            && !k.symbol.endsWith('DOWN' + config.baseMoney())
            && !k.symbol.endsWith('UP' + config.baseMoney())
            && !k.symbol.endsWith('BULL' + config.baseMoney())
            && !k.symbol.endsWith('BEAR' + config.baseMoney())
            && k.status !== 'BREAK')
    }

    getCurrenciesFilteredByOrders() {
        this.exchangeInfo = this.exchangeInfo.filter(k =>
            this.balances.find(v => v.onOrder > 0 && v.symbol + config.baseMoney() === k.symbol) === undefined
        )

        this.exchangeInfo = this.exchangeInfo.filter(k => this.openOrders.find(v => v.symbol === k.symbol) === undefined)
    }

    getCurrenciesFilteredByUnordered() {
        this.exchangeInfo = this.exchangeInfo.filter(k => this.unordered.find(v =>
            k.symbol === v.symbol + config.baseMoney()) === undefined)
    }

    async getHistories() {
        await new Promise((resolve,) => {
            let counter = 0
            this.exchangeInfo.forEach(value => {
                let startDate = new Date()
                let endDate = new Date()
                startDate.setDate(startDate.getDate() - 7)

                if (this.histories[value.symbol] !== undefined)
                    startDate = new Date(this.histories[value.symbol][this.histories[value.symbol].length - 1][0])

                this.api.candlesticks(value.symbol, config.interval()[0], null, {
                    startTime: startDate.getTime(), endTime: endDate.getTime(), limit: config.interval()[1]
                }).then(res => {
                    if (this.histories[value.symbol] !== undefined) {
                        for (let i = 0; i < res.length; i++) {
                            i === 0 ? this.histories[value.symbol].pop() : this.histories[value.symbol].shift()
                        }

                        res.forEach(v => {
                            this.histories[value.symbol].push(v)
                        })
                    } else this.histories[value.symbol] = res

                    if (++counter === this.exchangeInfo.length) resolve();
                })
            })
        })
    }

    getCurrenciesFilteredByHistories() {
        this.exchangeInfo = this.exchangeInfo.filter(k => this.histories[k.symbol].length >= 600)
    }

    getAveragesAndPrice() {
        this.exchangeInfo.forEach(value => {
            value.lAvg = []
            this.histories[value.symbol].forEach(function (val) {
                value.lAvg.push(Number(val[4]))
            })
            value.avg = func.lAvg(value.lAvg)

            value.price = this.histories[value.symbol][this.histories[value.symbol].length - 1][4]

            value.am_price = ((value.price - (value.avg * (100 - config.median()[0]) / 100))
                / (value.avg * (100 - config.median()[0]) / 100)) * 100
        })
    }

    getCurrenciesFilteredByConditions() {
        this.exchangeInfo = this.exchangeInfo.filter(value => value.avg * (100 - config.median()[1]) / 100 <= value.price
            && value.avg * (100 - config.median()[0]) / 100 >= value.price && value.price > 0
            && ((((Math.max.apply(null, value.lAvg)) - value.avg) / value.avg) * 100) >= config.prc())
    }

    getPrecisions() {
        this.exchangeInfo.forEach(value => {
            value.lenPrice = value.minPrice.split('.')[0] === "0"
                ? (value.minPrice.split('.')[1].split('1')[0] + '1').length : 0

            value.lenVol = value.minQty.split('.')[0] === "0"
                ? (value.minQty.split('.')[1].split('1')[0] + '1').length : 0

            value.volume = String(this.resume.mise / value.price)
            value.volume = value.volume.substr(0, value.volume.split('.')[0].length
                + (value.lenVol ? 1 : 0) + value.lenVol)

            value.sellPrice = String(value.price * (config.profit() / 100 + 1))
            value.sellPrice = value.sellPrice.substr(0, value.sellPrice.split('.')[0].length
                + (value.lenPrice ? 1 : 0) + value.lenPrice)

            value.price = String(value.price * Number(value.volume))
            value.price = value.price.substr(0, value.price.split('.')[0].length
                + (value.lenPrice ? 1 : 0) + value.lenPrice)
        })
    }

    async getBuy() {
        for (let i = 0; i < this.exchangeInfo.length; i++) {
            let value = this.exchangeInfo.sort((a, b) => a.am_price - b.am_price)[i]

            if (this.resume.available < Number(value.price) + (Number(value.price) * config.feeValue() / 100))
                continue

            await this.api.marketBuy(value.symbol, value.volume, async (error,) => {
                if (error !== null) {
                    let responseJson = JSON.parse(error.body)
                    console.error(value.symbol + " [" + responseJson.code + "]: " + responseJson["msg"] + " " + Number(value.price)
                        + " " + value.volume)
                } else {
                    this.resume.available -= Number(value.price) + (Number(value.price) * config.feeValue() / 100)
                    this.resume.bnb -= Number(value.price) * config.feeValue() / 100

                    await this.api.sell(value.symbol, value.volume, value.sellPrice, {type: 'LIMIT'}, (error,) => {
                        if (error !== null) {
                            let responseJson = JSON.parse(error.body)
                            console.error(value.symbol + " [" + responseJson.code + "]: "
                                + responseJson["msg"] + " " + value.sellPrice + " " + value.volume)
                        } else {
                            this.newOrders.push(
                                func.order(value.symbol,
                                    value.volume,
                                    Number(value.sellPrice) * Number(value.volume),
                                    value.price,
                                    value.price,
                                    Date.now(),
                                    0
                                )
                            )
                        }
                    })
                }
            })
        }
    }

    getConsole() {
        if (this.orders.length > 0) console.table(this.orders.sort((a, b) => b.plusValue - a.plusValue))
        if (this.newOrders.length > 0) console.table(this.newOrders)
        if (this.unordered.length > 0) console.table(this.unordered)
        console.table({
            status: {
                Mise: Number(this.resume.mise.toFixed(2)),
                Num: this.exchangeInfo.length,
                BNB: Number((this.resume.bnb).toFixed(2)),
                USD: Number(this.resume.available.toFixed(2)),
                Placed: Number((this.resume.target - (this.resume.target * config.profit() / 100)).toFixed(2)),
                Current: Number(this.resume.current.toFixed(2)),
                Target: Number(this.resume.target.toFixed(2)),
                Total: Number(this.resume.total.toFixed(2))
            }
        })
    }
}

function start(delay = config.restartTime()) {
    new Promise(res => setTimeout(res, delay)).then(() => main())
}

async function main() {

    const myBot = new Bot()

    /* Get Balances */
    await myBot.getBalances()
    /* Get orders exists */
    await myBot.getOpenOrders()
    /* Get list of currencies */
    await myBot.getExchangeInfo()
    /* Get prices of currencies */
    await myBot.getBookTickers()

    /* Get total value and others */
    myBot.getTotal()
    /* Get mises and nb mise */
    myBot.getMise()
    /* Get cryptos on Balances without orders */
    myBot.getUnordered()
    /* Get orders in list */
    myBot.getOrders()
    /* Remove currencies without baseMoney */
    myBot.getCurrenciesFilteredByBaseMoney()
    /* Remove currencies ordered */
    myBot.getCurrenciesFilteredByOrders()
    /* Remove currencies unordered */
    myBot.getCurrenciesFilteredByUnordered()

    /* Get histories of currencies */
    await myBot.getHistories()

    /* Remove currencies when no have full histories */
    myBot.getCurrenciesFilteredByHistories()
    /* Get average and price for currencies */
    myBot.getAveragesAndPrice()
    /* Remove currencies not have full conditions */
    myBot.getCurrenciesFilteredByConditions()
    /* Get precisions for prices and volumes */
    myBot.getPrecisions()

    /* Buy currencies */
    await myBot.getBuy()

    /* Get console output */
    myBot.getConsole()
    //
    /* Restart bot */
    // start()
}

/* Start bot */
start(0)
