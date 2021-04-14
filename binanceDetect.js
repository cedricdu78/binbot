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
    bnb = 0
    total = 0

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
            this.openOrders.push({symbol: v.symbol, price: Number(v.price), volume: Number(v['origQty']), time: v.time,
                orderId: v.orderId})
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
            let price = this.bookTickers.find(v => v.symbol === k + config.baseMoney()) !== undefined ?
                this.bookTickers.find(v => v.symbol === k + config.baseMoney()).price : 0
            this.total += price * (Number(v.available) + Number(v.onOrder))
            this.balances.push({symbol: k, available: Number(v.available), onOrder: Number(v.onOrder),
                price: price * (Number(v.available) + Number(v.onOrder)) })
        }))

        this.available = this.balances.find(v => v.symbol === "USDT").available
        this.bnb = this.balances.find(v => v.symbol === "BNB").price

        this.total += this.available

        this.mise = (this.total - this.bnb) * 24.5 / 100
    }

    getOrders() {
        this.orders = []
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
                (nowValue / openValue * 100) - 100,
                order.orderId
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

                value.prc = Number(((this.histories[value.symbol][this.histories[value.symbol].length - 1].price
                    - this.histories[value.symbol][0].price) / this.histories[value.symbol][0].price) * 100)
                this.histories[value.symbol].push({price: value.price, prc: value.prc})
            }
            else this.histories[value.symbol] = [{price: value.price, prc: 0}]
        })

        this.bookTickers = this.bookTickers.filter(k =>
            this.histories[k.symbol].length === 5)

        console.log()
        console.log(new Date().toLocaleString())
        console.table(this.bookTickers.sort((a, b) => b.prc - a.prc).slice(0,20))
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

    start(process.argv[2])
}

start(0)
