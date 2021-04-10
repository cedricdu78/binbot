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
    openOrders = []
    exchangeInfo = []
    bookTickers = []

    histories = []
    orders = []
    newOrders = []
    resume = {total: 0, available: 0, placed: 0, current: 0, target: 0, bnb: 0, mise: 0, details: 0}

    async getBalances() {
        (await this.api.accountInfo())['balances'].forEach(function(v) {
            this.push({symbol: v.asset, available: Number(v.free), onOrder: Number(v.locked)})
        }, this.balances)
    }

    async getOpenOrders() {
        (await this.api.openOrders()).forEach(function(v) {
            this.push({symbol: v.symbol, price: Number(v.price), volume: Number(v['origQty']), time: v.time})
        }, this.openOrders)
    }

    async getExchangeInfo() {
        (await this.api.exchangeInfo())['symbols'].forEach(function(v) {
            this.push({symbol: v.symbol, status: v.status, minPrice: v['filters'][0].minPrice,
                minQty: v['filters'][2].minQty
            })
        }, this.exchangeInfo)
    }

    async getBookTickers() {
        Object.entries(await this.api.allBookTickers()).forEach(function([k,v]) {
            this.push({symbol: k, price: Number(v.askPrice)})
        }, this.bookTickers)
    }

    getTotal() {
        this.resume.available = this.balances.find(v => v.symbol === config.baseMoney()).available

        this.resume.bnb = this.balances.find(v => v.symbol === config.feeMoney()).available
            * this.bookTickers.find(v => v.symbol === config.feeMoney() + config.baseMoney()).price

        this.balances.forEach(function(v) {
            if (this[0].find(v2 => v2.symbol === v.symbol + config.baseMoney()) !== undefined
                && v.symbol !== config.feeMoney())
                this[1].current += this[0].find(v2 => v2.symbol === v.symbol + config.baseMoney()).price
                    * (v.available + v.onOrder)
        }, [this.bookTickers, this.resume])

        this.resume.total = this.resume.available + this.resume.bnb + this.resume.current
    }

    getMise() {
        this.resume.mise = this.resume.total * config.mise() / 100
    }

    getPricesUnordered() {
        this.balances.filter(v => v.available > 0
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney()).forEach(function(v) {
            if (this.find(v2 => v2.symbol === v.symbol + config.baseMoney()) !== undefined
                && v.symbol !== config.feeMoney())
                v.price = Number((this.find(v2 => v2.symbol === v.symbol + config.baseMoney()).price
                    * (v.available + v.onOrder)).toFixed(2))
            else v.price = NaN
        }, this.bookTickers)
    }

    getOrders() {
        this.openOrders.forEach(function(order) {
            let openValue = (order.price / (config.profit() / 100 + 1) * order.volume).toFixed(2)
            let nowValue = (order.volume * this.bookTickers.find(v2 => v2.symbol === order.symbol).price)
                .toFixed(2)
            let wantValue = (order.price * order.volume).toFixed(2)

            this.orders.push(func.order(
                order.symbol,
                order.volume,
                wantValue,
                openValue,
                nowValue,
                order.time,
                (nowValue / openValue * 100) - 100,
                order.orderId
            ))

            this.resume.placed += order.price / (config.profit() / 100 + 1) * order.volume
            this.resume.target += order.price * order.volume
        }, this)
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

        this.exchangeInfo = this.exchangeInfo.filter(k => this.openOrders.find(v => v.symbol === k.symbol)
            === undefined)
    }

    getCurrenciesFilteredByUnordered() {
        this.exchangeInfo = this.exchangeInfo.filter(k => this.balances.filter(v => v.available > 0
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney()).find(v =>
            k.symbol === v.symbol + config.baseMoney()) === undefined)
    }

    async getHistories() {
        await new Promise((resolve,) => {
            let counter = 0
            this.exchangeInfo.forEach(function(v) {
                let startDate = new Date()
                let endDate = new Date()
                startDate.setDate(startDate.getDate() - 7)

                if (this.histories[v.symbol] !== undefined)
                    startDate = new Date(this.histories[v.symbol][this.histories[v.symbol].length - 1][0])

                this.api.candles({ symbol: v.symbol, interval: config.interval()[0],
                    startTime: startDate.getTime(), endTime: endDate.getTime(), limit: config.interval()[1]
                }).then(res => {
                    if (this.histories[v.symbol] !== undefined) {
                        for (let i = 0; i < res.length; i++) {
                            i === 0 ? this.histories[v.symbol].pop() : this.histories[v.symbol].shift()
                        }

                        res.forEach(function(v) {
                            this[v.symbol].push(v)
                        }, this.histories)
                    } else this.histories[v.symbol] = res

                    if (++counter === this.exchangeInfo.length) resolve();
                })
            }, this)
        })
    }

    getCurrenciesFilteredByHistories() {
        this.exchangeInfo = this.exchangeInfo.filter(k => this.histories[k.symbol].length >= 600)
    }

    getAveragesAndPrice() {
        this.exchangeInfo.forEach(v => {
            v.lAvg = []

            this.histories[v.symbol].forEach(function (v2) {
                v.lAvg.push(Number(v2.close))
            })
            v.avg = func.lAvg(v.lAvg)

            v.price = this.histories[v.symbol][this.histories[v.symbol].length - 1].close

            v.am_price = ((v.price - (v.avg * (100 - config.median()[0]) / 100))
                / (v.avg * (100 - config.median()[0]) / 100)) * 100
        })
    }

    getCurrenciesFilteredByConditions() {
        this.exchangeInfo = this.exchangeInfo.filter(v => v.avg * (100 - config.median()[1]) / 100 <= v.price
            && v.avg * (100 - config.median()[0]) / 100 >= v.price && v.price > 0
            && ((((Math.max.apply(null, v.lAvg)) - v.avg) / v.avg) * 100) >= config.prc()
            && this.histories[v.symbol][this.histories[v.symbol].length - 1].close
            > this.histories[v.symbol][this.histories[v.symbol].length - 2].close)

        this.resume.details = this.exchangeInfo
        let nbMise = String(this.resume.available / this.resume.mise).split('.')[0]
        this.exchangeInfo = this.exchangeInfo.sort((a, b) => a.am_price - b.am_price)
            .slice(0, nbMise <= 29 ? nbMise : 29)
    }

    getPrecisions() {
        this.exchangeInfo.forEach(v => {
            v.lenPrice = v.minPrice.split('.')[0] === "0"
                ? (v.minPrice.split('.')[1].split('1')[0] + '1').length : 0

            v.lenVol = v.minQty.split('.')[0] === "0"
                ? (v.minQty.split('.')[1].split('1')[0] + '1').length : 0

            v.volume = String((this.resume.mise / v.price))
            v.volume = v.volume.substr(0, v.volume.split('.')[0].length
                + (v.lenVol ? 1 : 0) + v.lenVol)

            v.sellPrice = String(v.price * (config.profit() / 100 + 1))
            v.sellPrice = v.sellPrice.substr(0, v.sellPrice.split('.')[0].length
                + (v.lenPrice ? 1 : 0) + v.lenPrice)

            v.price = String(v.price * Number(v.volume))
            v.price = v.price.substr(0, v.price.split('.')[0].length
                + (v.lenPrice ? 1 : 0) + v.lenPrice)
        })
    }

    async getBuy() {
        if (this.exchangeInfo.length > 0) {
            await new Promise((resolve,) => {
                this.exchangeInfo.forEach(v => {
                    this.api.order({symbol: v.symbol, side: 'BUY', quantity: v.volume, type: 'MARKET'
                    }).then(function() {
                        this.resume.available -= Number(v.price) + (Number(v.price) * config.feeValue() / 100)
                        this.resume.bnb -= Number(v.price) * config.feeValue() / 100

                        if (this.exchangeInfo.indexOf(v) === this.exchangeInfo.length - 1)
                            resolve()
                    }, this).catch(function(e) {
                        console.error(e)
                        if (this.indexOf(v) === this.length - 1)
                            resolve()
                    }, this.exchangeInfo)
                })
            })
        }
    }

    async getSell() {
        if (this.exchangeInfo.length > 0) {
            await new Promise((resolve,) => {
                this.exchangeInfo.forEach(v => {
                    this.api.order({ symbol: v.symbol, side: 'SELL', quantity: v.volume, price: v.sellPrice,
                        type: 'LIMIT'
                    }).then(() => {
                        this.newOrders.push(
                            func.order(v.symbol,
                                v.volume,
                                Number(v.sellPrice) * Number(v.volume),
                                v.price,
                                v.price,
                                Date.now(),
                                0
                            )
                        )

                        this.resume.placed += Number(v.price)
                        this.resume.current += Number(v.price)
                        this.resume.target += Number(v.sellPrice) * Number(v.volume)

                        if (this.exchangeInfo.indexOf(v) === this.exchangeInfo.length - 1)
                            resolve()
                    }).catch(e => {
                        console.error(e)
                        if (this.exchangeInfo.indexOf(v) === this.exchangeInfo.length - 1)
                            resolve()
                    })
                })
            })
        }
    }

    getConsole() {
        if (this.orders.length > 0) console.table(this.orders.sort((a, b) => b.plusValue - a.plusValue))
        if (this.exchangeInfo.length > 0) console.table(this.resume.details, ["symbol", "am_price"])
        if (this.newOrders.length > 0) console.table(this.newOrders)
        if (this.balances.filter(v => v.available > 0
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney()).length > 0) console.table(this.balances.filter(v => v.available > 0
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney()))
        console.table({
            status: {
                Mise: Number(this.resume.mise.toFixed(2)),
                Num: this.resume.details.length,
                BNB: Number((this.resume.bnb).toFixed(2)),
                USD: Number(this.resume.available.toFixed(2)),
                Placed: Number(this.resume.placed.toFixed(2)),
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
    myBot.getPricesUnordered()
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
    /* Sell currencies */
    await myBot.getSell()

    /* Get console output */
    myBot.getConsole()

    /* Restart bot */
    start()
}

/* Start bot */
start()
