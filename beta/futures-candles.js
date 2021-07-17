const binSecret = require('../config/secrets');
const config = require('../config/config-futures');
const func = require('../lib/func');

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
    candleInfo = []

    histories = []
    orders = []
    newOrders = []
    resume = {total: 0, available: 0, current: 0, mise: 0, details: 0}

    async getBalances() {
        let account = await this.api.futuresAccountInfo()
        account['assets'].forEach(function(v) {
            this.push({
                symbol: v.asset,
                available: Number(v.availableBalance),
                onOrder: Number(v.walletBalance) - Number(v.availableBalance),
                leverage: 0, isolated: false
            })
        }, this.balances)

        account['positions'].forEach(function(v) {
            this.push({
                symbol: v.symbol,
                available: 0,
                onOrder: Number(v.positionAmt),
                leverage: v.leverage, isolated: v.isolated
            })
        }, this.balances)
    }

    async getOpenOrders() {
        (await this.api.futuresOpenOrders()).forEach(function(v) {
            if (v.type === "TAKE_PROFIT_MARKET") {
                this.push({symbol: v.symbol, volume: Number(v['origQty']), stopPrice: v.stopPrice, time: v.time})
            }
        }, this.openOrders)
    }

    async getExchangeInfo() {
        (await this.api.futuresExchangeInfo())['symbols'].forEach(function(v) {
            this.push({symbol: v.symbol, status: v.status, pricePrecision: v.pricePrecision,
                quantityPrecision: v.quantityPrecision
            })
        }, this.exchangeInfo)
    }

    async getBookTickers() {
        Object.entries(await this.api.prices()).forEach(function([k,v]) {
            this.push({symbol: k, price: Number(v)})
        }, this.bookTickers)
    }

    getTotal() {
        this.resume.available = this.balances.find(v => v.symbol === config.baseMoney()).available
        this.balances.forEach(function(v) {
            if (this[0].find(v2 => v2.symbol === v.symbol) !== undefined)
                this[1].current += this[0].find(v2 => v2.symbol === v.symbol).price
                    * (v.available + v.onOrder) / v.leverage
        }, [this.bookTickers, this.resume])

        this.resume.total = this.resume.available + this.resume.current

        if (this.resume.total < config.minimalAmount()) {
            console.log("exit because you not have minimal amount.")
            process.exit()
        }
    }

    getMise() {
        this.resume.mise = this.resume.total * config.mise() / 100
    }

    getOrders() {
        this.openOrders.forEach(function(order) {
            let openValue = (order.stopPrice / (config.profit() / 100 + 1) * order.volume).toFixed(2)
            let nowValue = (order.volume * this.bookTickers.find(v2 => v2.symbol === order.symbol).price)
                .toFixed(2)
            let wantValue = (order.stopPrice * order.volume).toFixed(2)

            this.orders.push(func.order(
                order.symbol,
                order.volume,
                wantValue,
                openValue,
                nowValue,
                order.time,
                (nowValue / openValue * 100) - 100
            ))
        }, this)
    }

    getCurrenciesFilteredByBaseMoney() {
        this.exchangeInfo = this.exchangeInfo.filter(k => k.symbol.endsWith(config.baseMoney()))
    }

    getCurrenciesFilteredByOrders() {
        this.exchangeInfo = this.exchangeInfo.filter(k =>
            this.balances.find(v => v.onOrder > 0 && v.symbol === k.symbol) === undefined
        )

        this.exchangeInfo = this.exchangeInfo.filter(k => this.openOrders.find(v => v.symbol === k.symbol)
            === undefined)
    }

    async getHistories() {
        await new Promise((resolve,) => {
            let counter = 0
            this.exchangeInfo.forEach(function(v) {
                let startDate = new Date()
                startDate.setDate(startDate.getDate() - 7)

                this.api.futuresCandles({ symbol: v.symbol, interval: config.interval()[0],
                    startTime: startDate.getTime(), endTime: new Date().getTime(), limit: config.interval()[1]
                }).then(res => {
                    this.histories[v.symbol] = res

                    let nbRange = 0
                    let run = null
                    let lastPrc = 0

                    res.reverse().forEach(k => {
                        if (res.indexOf(k) === 0 && k.open < k.close) {
                            run = true
                        } else if (run) {
                            let prc = (( k.close - k.open ) / k.open ) * 100
                            if (k.open > k.close && prc < lastPrc) {
                                lastPrc = prc
                                nbRange++
                            } else run = false
                        }
                    })

                    this.candleInfo.push({
                        symbol: v.symbol,
                        number: nbRange
                    })

                    if (++counter === this.exchangeInfo.length) {
                        this.candleInfo = this.candleInfo.sort((a, b) => b.number - a.number).filter(v => v.number >= 3)
                        console.table(this.candleInfo)
                        resolve();
                    }
                }).catch(e => {
                    console.error(v.symbol + " " + e)
                    if (++counter === this.exchangeInfo.length) resolve();
                })
            }, this)
        })
    }

    getCurrenciesFilteredByHistories() {
        this.exchangeInfo = this.exchangeInfo.filter(k => this.candleInfo.filter(z => z.symbol === k.symbol).length > 0)
    }

    getAveragesAndPrice() {
        this.exchangeInfo.forEach(v => {
            v.lAvg = []

            this.histories[v.symbol].forEach(function (v2) {
                v.lAvg.push(Number(v2.close))
            })
            v.avg = func.lAvg(v.lAvg)

            v.price = this.bookTickers.filter(y => y.symbol === v.symbol)[0].price

            v.am_price = ((v.price - (v.avg * (100 - config.median()[0]) / 100))
                / (v.avg * (100 - config.median()[0]) / 100)) * 100
        })
    }

    getCurrenciesFilteredByConditions() {
        this.exchangeInfo = this.exchangeInfo.filter(v => v.avg * (100 - config.median()[1]) / 100 <= v.price
            && v.avg * (100 - config.median()[0]) / 100 >= v.price && v.price > 0
            && ((((Math.max.apply(null, v.lAvg)) - v.avg) / v.avg) * 100) >= config.prc())

        this.resume.details = this.exchangeInfo
        let nbMise = String(this.resume.available / this.resume.mise).split('.')[0]
        this.exchangeInfo = this.exchangeInfo.sort((a, b) => a.am_price - b.am_price)
            .slice(0, nbMise <= 29 ? nbMise : 29)
    }

    getPrecisions() {
        this.exchangeInfo.forEach(v => {
            v.leverage = this.balances.filter(k => k.symbol === v.symbol)[0].leverage
            v.isolated = this.balances.filter(k => k.symbol === v.symbol)[0].isolated

            v.volume = String((this.resume.mise / v.price) * config.leverage())
            v.volume = v.volume.substr(0, v.volume.split('.')[0].length
                + (v.quantityPrecision ? 1 : 0) + v.quantityPrecision)

            v.sellPrice = String(v.price * (config.profit() / config.leverage() / 100 + 1))
            v.sellPrice = v.sellPrice.substr(0, v.sellPrice.split('.')[0].length
                + (v.pricePrecision ? 1 : 0) + v.pricePrecision)

            v.stopPrice = String(v.price / (config.loss() / config.leverage() / 100 + 1))
            v.stopPrice = v.stopPrice.substr(0, v.stopPrice.split('.')[0].length
                + (v.pricePrecision ? 1 : 0) + v.pricePrecision)

            console.log(v.symbol + " " + v.price + " " + v.sellPrice + " " + v.stopPrice)

            v.price = String(v.price * Number(v.volume))
            v.price = v.price.substr(0, v.price.split('.')[0].length
                + (v.pricePrecision ? 1 : 0) + v.pricePrecision)
        })
    }

    async configuration() {
        if (this.exchangeInfo.length > 0) {
            await new Promise((resolve,) => {
                this.exchangeInfo.forEach(v => {
                    if (v.leverage !== config.leverage())
                        this.api.futuresLeverage({
                            symbol: v.symbol,
                            leverage: config.leverage()
                        }).then(() => {
                            if (v.isolated)
                                this.api.futuresMarginType({
                                    symbol: v.symbol,
                                    marginType: "CROSSED"
                                }).then(() => {
                                    if (this.exchangeInfo.indexOf(v) === this.exchangeInfo.length - 1)
                                        resolve()
                                })
                            else if (this.exchangeInfo.indexOf(v) === this.exchangeInfo.length - 1)
                                resolve()
                        })
                    else if (this.exchangeInfo.indexOf(v) === this.exchangeInfo.length - 1)
                        resolve()
                })
            })
        }
    }

    async getBuy() {
        if (this.exchangeInfo.length > 0) {
            await new Promise((resolve,) => {
                this.exchangeInfo.forEach(v => {
                    this.api.futuresOrder({symbol: v.symbol, side: 'BUY', positionSide: 'LONG', quantity: v.volume,
                        type: 'MARKET'
                    }).then(() => {
                        this.resume.available -= (Number(v.price) + (Number(v.price) * config.feeValue() / 100)) / config.leverage()
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

    async setTakeProfit() {
        if (this.exchangeInfo.length > 0) {
            await new Promise((resolve,) => {
                this.exchangeInfo.forEach(v => {

                    this.api.futuresOrder({ symbol: v.symbol, side: 'SELL', positionSide: 'LONG', quantity: v.volume,
                        type: 'TAKE_PROFIT_MARKET', stopPrice: v.sellPrice
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

                        this.resume.current += Number(v.price)
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

    async setStopLoss() {
        if (this.exchangeInfo.length > 0) {
            await new Promise((resolve,) => {
                this.exchangeInfo.forEach(v => {
                    this.api.futuresOrder({ symbol: v.symbol, side: 'SELL', positionSide: 'LONG', quantity: v.volume,
                        type: 'STOP_MARKET', stopPrice: v.stopPrice
                    }).then(() => {
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
        if (this.resume.details.length > 0) console.table(this.resume.details.slice(0, 9), ["symbol", "am_price"])
        if (this.newOrders.length > 0) console.table(this.newOrders)
        if (this.balances.filter(v => v.price > 1
            && v.symbol !== config.baseMoney()).length > 0) console.table(this.balances.filter(v => v.price > 1
            && v.symbol !== config.baseMoney()))
        console.table({
            status: {
                Mise: Number(this.resume.mise.toFixed(2)),
                Num: this.resume.details.length,
                USD: Number(this.resume.available.toFixed(2)),
                Current: Number(this.resume.current.toFixed(2)),
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
    /* Get orders in list */
    myBot.getOrders()
    /* Remove currencies without baseMoney */
    myBot.getCurrenciesFilteredByBaseMoney()
    // /* Remove currencies ordered */
    myBot.getCurrenciesFilteredByOrders()

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

    /* configuration currencies */
    await myBot.configuration()
    /* Buy currencies */
    await myBot.getBuy()
    /* Take profit currencies */
    await myBot.setTakeProfit()
    /* Stop loss currencies */
    await myBot.setStopLoss()

    /* Get console output */
    myBot.getConsole()

    /* Restart bot */
    // start()
}

/* Start bot */
start(0)
