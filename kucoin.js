const secret = require('./config/secrets');
const config = require('./config/config-spot');
const func = require('./lib/func');

const { SpotClient } = require('kucoin-api');

let nextBuy = new Date()

class Bot {

    api = new SpotClient({ apiKey: secret.key(), apiSecret: secret.secret(), apiPassphrase: secret.passphrase() });
    apiBinance = (require('binance-api-node').default)();

    balances = []
    balancesOrders = {}
    openOrdersId = {}
    openOrders = []
    exchangeInfo = []
    exchangeInfoBinance = []
    bookTickers = []

    histories = []
    orders = []
    newOrders = []
    resume = {total: 0, available: 0, placed: 0, current: 0, target: 0, bnb: 0, mise: 0, length: 0}

    async getOpenOrders() {
        (await this.api.getOrders({ status: 'active' }))['data']['items'].forEach(function(v) {
            console.log({symbol: v.symbol, price: Number(v.price), volume: Number(v.size)})
        });
    }

    async getOCOOrders() {
        (await this.api.getOCOOrders({ status: 'active' }))['data']['items'].forEach(function(v) {
            if (v.status == 'NEW')
                this.openOrdersId[v.symbol] = v.orderId
        }, this);

        for(var id in this.openOrdersId) {
            let data = (await this.api.getOCOOrderDetails({ orderId: this.openOrdersId[id] }))['data']
            let orderTime = data['orderTime']
            data = data['orders'][0]
            this.balancesOrders[id.replace('-USDT', '')] = data.size
            this.openOrders.push({symbol: data.symbol, price: Number(data.price), volume: Number(data.size), time: orderTime})
        }
    }

    async getBalances() {
        (await this.api.getBalances())['data'].forEach(function(v) {
            if (v.currency in this.balancesOrders)
                v.holds = this.balancesOrders[v.currency]
            this.balances.push({symbol: v.currency, available: Number(v.available) - Number(v.holds), onOrder: Number(v.holds)})
        }, this)
    }

    async getExchangeInfo() {
        (await this.api.getSymbols())['data'].forEach(function(v) {
            this.push({symbol: v.symbol, status: v.enableTrading, minPrice: v.priceIncrement,
                minQty: v.baseIncrement, minSize: v.baseMinSize
            })
        }, this.exchangeInfo);

        (await this.apiBinance.exchangeInfo())['symbols'].forEach(function(v) {
            this.push(v.symbol)
        }, this.exchangeInfoBinance);
    }

    async getBookTickers() {
        (await this.api.getTickers())['data']['ticker'].forEach(function(v) {
            this.push({symbol: v.symbol, price: Number(v.buy)})
        }, this.bookTickers)
    }

    getMoneyValues() {
        this.resume.available = this.balances.find(v => v.symbol === config.baseMoney()).available

        this.resume.bnb = this.balances.find(v => v.symbol === config.feeMoney()).available
            * this.bookTickers.find(v => v.symbol === config.feeMoney() + '-' + config.baseMoney()).price

        this.balances.forEach(function(v) {
            if (this[0].find(v2 => v2.symbol === v.symbol + '-' + config.baseMoney()) !== undefined && v.symbol !== config.feeMoney())
                this[1].current += this[0].find(v2 => v2.symbol === v.symbol + '-' + config.baseMoney()).price * (v.available + v.onOrder)
        }, [this.bookTickers, this.resume])

        this.resume.total = this.resume.available + this.resume.bnb + this.resume.current

        this.resume.mise = this.resume.total * config.mise() / 100

        if (this.resume.total < config.minimalAmount()) {
            console.log("exit because you not have minimal amount.")
            process.exit()
        }
    }

    getPricesUnordered() {
        this.balances.filter(v => (v.available > 0 || v.available < 0)
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney()).forEach(function(v) {
            if (this.find(v2 => v2.symbol === v.symbol + '-' + config.baseMoney()) !== undefined
                && v.symbol !== config.feeMoney())
                v.price = Number((this.find(v2 => v2.symbol === v.symbol + '-' + config.baseMoney()).price
                    * (v.available + v.onOrder)).toFixed(2))
            else v.price = NaN
        }, this.bookTickers)
    }

    getOrders() {
        this.openOrders.forEach(function(order) {
            let openValue = (order.price / (config.profit() / 100 + 1) * order.volume).toFixed(2)
            let price = this.bookTickers.find(v2 => v2.symbol === order.symbol).price
            let nowValue = (order.volume * price)
                .toFixed(2)
            let wantValue = (order.price * order.volume).toFixed(2)

            this.orders.push(func.order(
                order.symbol,
                order.volume,
                price,
                wantValue,
                openValue,
                nowValue,
                order.time,
                (nowValue / openValue * 100) - 100
            ))

            this.resume.placed += order.price / (config.profit() / 100 + 1) * order.volume
            this.resume.target += order.price * order.volume
        }, this)
    }

    getCurrenciesFilteredByBaseMoney() {
        this.exchangeInfo = this.exchangeInfo.filter(k => k.symbol.endsWith('-' + config.baseMoney()));
    }

    getCurrenciesFilteredByBinance() {
        this.exchangeInfo = this.exchangeInfo.filter(k => this.exchangeInfoBinance.includes(k.symbol.replace('-', '')));
    }

    getCurrenciesFilteredByOrders() {
        this.exchangeInfo = this.exchangeInfo.filter(k => this.openOrders.find(v => v.symbol === k.symbol)
            === undefined)
    }

    getCurrenciesFilteredByUnordered() {
        this.exchangeInfo = this.exchangeInfo.filter(k => this.balances.filter(v => v.available > 0
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney()).find(v =>
            k.symbol === v.symbol + '-' + config.baseMoney()) === undefined)
    }

    async getHistories() {
        if (this.exchangeInfo.length > 0) {
            await new Promise((resolve,) => {
                let counter = 0
                this.exchangeInfo.forEach(function (v) {
                    let startDate = new Date()
                    startDate.setDate(startDate.getDate() - 7)

                    this.apiBinance.candles({
                        symbol: v.symbol.replace('-', ''), interval: config.interval()[0],
                        startTime: startDate.getTime(), endTime: new Date().getTime(), limit: config.interval()[1]
                    }).then(res => {
                        this.histories[v.symbol] = res
                        if (++counter === this.exchangeInfo.length) resolve();
                    }).catch(e => {
                        console.error(e)
                        if (++counter === this.exchangeInfo.length) resolve();
                    })
                }, this)
            })
        }
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

            v.priceb = Number(this.histories[v.symbol][this.histories[v.symbol].length - 1].close)
            v.price = Number(this.bookTickers.find(v2 => v.symbol == v2.symbol).price)

            if (Number(this.resume.mise / v.price) < Number(v.minSize))
                v.price = 0

            if ((((v.price - v.priceb) / v.priceb) * 100) > 1)
                v.price = 0

            v.am_price = ((v.price - (v.avg * (100 - config.median()[0]) / 100))
                / (v.avg * (100 - config.median()[0]) / 100)) * 100
        })
    }

    getCurrenciesFilteredByConditions() {
        this.exchangeInfo = this.exchangeInfo.filter(v => v.price > 0
            && v.avg * (100 - config.median()[0]) / 100 >= v.price
            && v.avg * (100 - config.median()[1]) / 100 <= v.price
            && ((((Math.max.apply(null, v.lAvg)) - v.avg) / v.avg) * 100) >= config.prc())

        this.resume.length = this.exchangeInfo.length

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

            v.stopLoss = String(v.price * (1 - config.stopLoss() / 100))
            v.stopLoss = v.stopLoss.substr(0, v.stopLoss.split('.')[0].length
                + (v.lenPrice ? 1 : 0) + v.lenPrice)

            v.stopLimit = String(v.price * (1 - config.stopLimit() / 100))
            v.stopLimit = v.stopLimit.substr(0, v.stopLimit.split('.')[0].length
                + (v.lenPrice ? 1 : 0) + v.lenPrice)

            v.amount = String(v.price * Number(v.volume))
            v.amount = v.amount.substr(0, v.amount.split('.')[0].length
                + (v.lenPrice ? 1 : 0) + v.lenPrice)
        })
    }

    async getBuy() {
        if (this.exchangeInfo.length > 0) {
            await new Promise((resolve,) => {
                let counter = 0
                this.exchangeInfo.forEach(v => {
                    this.api.submitOrder({clientOid: this.api.generateNewOrderID(), side: 'buy', symbol: v.symbol, type: 'market', size: v.volume
                    }).then(() => {
                        this.resume.available -= Number(v.amount) + (Number(v.amount) * config.feeValue() / 100)
                        this.resume.bnb -= Number(v.amount) * config.feeValue() / 100
                        this.resume.placed += Number(v.amount)
                        this.resume.current += Number(v.amount)

                        if (++counter === this.exchangeInfo.length) resolve();
                    }).catch(e => {
                        console.error(e)
                        if (++counter === this.exchangeInfo.length) resolve();
                    })
                })
            })
        }
    }

    async getSell() {
        if (this.exchangeInfo.length > 0) {
            await new Promise((resolve,) => {
                let counter = 0
                this.exchangeInfo.forEach(v => {
                    this.api.submitOCOOrder({clientOid: this.api.generateNewOrderID(), side: 'sell', symbol: v.symbol, type: 'market', size: v.volume, price: v.sellPrice, stopPrice: v.stopLoss, limitPrice: v.stopLimit
                    }).then(() => {
                        this.newOrders.push(
                            func.order(v.symbol, v.volume, v.price, Number(v.sellPrice) * Number(v.volume), v.amount,
                                v.amount, Date.now(), 0)
                        )

                        this.resume.target += Number(v.sellPrice) * Number(v.volume)

                        if (++counter === this.exchangeInfo.length) resolve();
                    }).catch(e => {
                        console.error(e)
                        if (++counter === this.exchangeInfo.length) resolve();
                    })
                })
            })
        }
    }

    getConsole() {
        if (this.orders.length > 0) console.table(this.orders.sort((a, b) => b.plusValue - a.plusValue))
        if (this.newOrders.length > 0) console.table(this.newOrders)
        if (this.balances.filter(v => v.price > 1
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney()).length > 0) console.table(this.balances.filter(v => v.price > 1
            && v.symbol !== config.baseMoney()
            && v.symbol !== config.feeMoney()))
        console.table({
            status: {
                Mise: Number(this.resume.mise.toFixed(2)),
                Num: this.resume.length,
                KCS: Number((this.resume.bnb).toFixed(2)),
                USD: Number(this.resume.available.toFixed(2)),
                Placed: Number(this.resume.placed.toFixed(2)),
                Current: Number(this.resume.current.toFixed(2)),
                Target: Number(this.resume.target.toFixed(2)),
                Total: Number(this.resume.total.toFixed(2)),
                NextBuy: nextBuy
            }
        })
    }
}

function start(delay = config.restartTime()) {
    new Promise(res => setTimeout(res, delay)).then(() => main())
}

async function main() {

    const myBot = new Bot()

    /* Get orders exists */
    await myBot.getOpenOrders()
    /* Get orders exists */
    await myBot.getOCOOrders()
    /* Get Balances */
    await myBot.getBalances()
    /* Get list of currencies */
    await myBot.getExchangeInfo()
    /* Get prices of currencies */
    await myBot.getBookTickers()

    /* Get total value and others */
    myBot.getMoneyValues()
    /* Get cryptos on Balances without orders */
    myBot.getPricesUnordered()
    /* Get orders in list */
    myBot.getOrders()

    if (new Date().getTime() > nextBuy.getTime()) {

        /* Remove currencies without baseMoney */
        myBot.getCurrenciesFilteredByBaseMoney()
        /* Remove currencies not in Binance */
        myBot.getCurrenciesFilteredByBinance()
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

        nextBuy = new Date()
        nextBuy.setMinutes(nextBuy.getMinutes() + 15)
    }

    /* Get console output */
    myBot.getConsole()

    /* Restart bot */
    start()
}

/* Start bot */
start(2000)
