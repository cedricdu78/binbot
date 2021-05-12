const binSecret = require('./config/secrets');
const config = require('./config/config');
const func = require('./lib/func');

const Binance = require('node-binance-api');

class Bot {

    api = new Binance().options({
        APIKEY: binSecret.key(),
        APISECRET: binSecret.secret()
    });

    exchangeInfo = []
    bookTickers = []

    histories = []

    async getExchangeInfo() {
        await this.api.exchangeInfo().then(exchangeInfo => exchangeInfo['symbols'].forEach(v => {
            this.exchangeInfo.push({
                symbol: v.symbol, status: v.status, minPrice: v['filters'][0].minPrice,
                minQty: v['filters'][2].minQty
            })
        }))
    }

    async getBookTickers() {
        this.bookTickers = []
        await this.api.bookTickers().then(bookTickers => Object.entries(bookTickers).forEach(([k,v]) => {
            this.bookTickers.push({symbol: k, price: Number(v.ask)})
        }))
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

                value.prc = Number(((value.price
                    - this.histories[value.symbol][0].price) / this.histories[value.symbol][0].price) * 100)
                this.histories[value.symbol].push({price: value.price, prc: value.prc})
            }
            else this.histories[value.symbol] = [{price: value.price, prc: 0}]
        })

        this.bookTickers = this.bookTickers.filter(k =>
            this.histories[k.symbol].length === 5)

        console.log()
        console.log(new Date().toLocaleString())
        if (this.bookTickers.length > 0) console.table(this.bookTickers.sort((a, b) => b.prc - a.prc).slice(0,20))
    }
}

const myBot = new Bot()

function start(delay = config.restartTime()) {
    console.log(delay)
    new Promise(res => setTimeout(res, delay)).then(() => main(myBot))
}

async function main(myBot) {

    if (myBot.exchangeInfo.length === 0) {
        await myBot.getExchangeInfo()
    }

    await myBot.getBookTickers()

    myBot.getCurrenciesFilteredByBaseMoney()
    myBot.getCurrenciesFilteredByConditions()

    start(process.argv[2])
}

start(0)
